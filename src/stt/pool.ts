import { availableParallelism } from 'node:os'
import { Worker } from 'node:worker_threads'
import type { DetectedLang } from './recognizer.ts'
import type { Transcript, Utterance, WorkerReply, WorkerRequest } from './types.ts'

export type Recognized = { text: string; lang: DetectedLang; decodeMs: number }

export type SttWorker = {
  run (packets: readonly Buffer[]): Promise<Recognized>
  close (): Promise<void>
  /** True once the worker thread has crashed or exited; it will reject every further job. */
  readonly dead?: boolean
}

export type PoolOptions = {
  workers: readonly SttWorker[]
  /** Replaces a dead worker. */
  respawn?: () => SttWorker
  /** Respawns allowed per minute, so a model that cannot load does not restart on every utterance. */
  maxRespawnsPerMinute?: number
  onNoWorkers?: () => void
  maxWaitMs?: number
  now?: () => number
}

type Job = { utterance: Utterance; queuedAt: number; resolve: (transcript: Transcript | undefined) => void; reject: (error: unknown) => void }

export const DEFAULT_MAX_WAIT_MS = 2000
export const DEFAULT_MAX_RESPAWNS_PER_MINUTE = 5

export function workerCount (cores = availableParallelism()): number {
  return Math.max(1, cores - 1)
}

export class SttPool {
  #idle: SttWorker[]
  #workers: SttWorker[]
  #queue: Job[] = []
  #respawn: (() => SttWorker) | undefined
  #maxRespawnsPerMinute: number
  #onNoWorkers: (() => void) | undefined
  #respawnTimes: number[] = []
  #maxWaitMs: number
  #now: () => number
  dropped = 0
  respawned = 0

  constructor ({ workers, respawn, maxRespawnsPerMinute = DEFAULT_MAX_RESPAWNS_PER_MINUTE, onNoWorkers, maxWaitMs = DEFAULT_MAX_WAIT_MS, now = () => performance.now() }: PoolOptions) {
    this.#workers = [...workers]
    this.#idle = [...workers]
    this.#respawn = respawn
    this.#maxRespawnsPerMinute = maxRespawnsPerMinute
    this.#onNoWorkers = onNoWorkers
    this.#maxWaitMs = maxWaitMs
    this.#now = now
  }

  transcribe (utterance: Utterance): Promise<Transcript | undefined> {
    return new Promise((resolve, reject) => {
      if (this.#workers.length === 0) return reject(new Error('no STT worker is running'))
      this.#queue.push({ utterance, queuedAt: this.#now(), resolve, reject })
      this.#drain()
    })
  }

  async close (): Promise<void> {
    await Promise.all(this.#workers.map(worker => worker.close()))
  }

  #drain (): void {
    while (this.#idle.length > 0 && this.#queue.length > 0) {
      const job = this.#queue.shift()!
      if (this.#now() - job.queuedAt > this.#maxWaitMs) {
        this.dropped++
        job.resolve(undefined)
        continue
      }
      const worker = this.#idle.pop()!
      if (worker.dead) {
        // Died while idle: replace it and put the job back instead of failing it.
        this.#queue.unshift(job)
        this.#release(worker)
        continue
      }
      worker.run(job.utterance.packets).then(
        recognized => job.resolve({ utterance: job.utterance, ...recognized }),
        job.reject
      ).finally(() => {
        this.#release(worker)
        this.#drain()
      })
    }
  }

  #release (worker: SttWorker): void {
    if (!worker.dead) {
      this.#idle.push(worker)
      return
    }
    this.#workers = this.#workers.filter(other => other !== worker)
    worker.close().catch(() => {})
    const now = this.#now()
    this.#respawnTimes = this.#respawnTimes.filter(at => now - at < 60_000)
    if (this.#respawn && this.#respawnTimes.length < this.#maxRespawnsPerMinute) {
      const fresh = this.#respawn()
      this.#respawnTimes.push(now)
      this.respawned++
      this.#workers.push(fresh)
      this.#idle.push(fresh)
    }
    if (this.#workers.length === 0) {
      for (const job of this.#queue.splice(0)) job.reject(new Error('no STT worker is running'))
      this.#onNoWorkers?.()
    }
  }
}

export function spawnSttWorker (modelDir: string): SttWorker {
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { workerData: { modelDir } })
  const pending = new Map<number, { resolve: (recognized: Recognized) => void; reject: (error: Error) => void }>()
  let nextId = 0
  let failure: Error | undefined
  const fail = (error: Error) => {
    failure ??= error
    for (const { reject } of pending.values()) reject(error)
    pending.clear()
  }
  worker.on('message', ({ id, text, lang, decodeMs, error }: WorkerReply) => {
    const job = pending.get(id)
    pending.delete(id)
    if (error) job?.reject(new Error(error))
    else job?.resolve({ text, lang, decodeMs })
  })
  worker.on('error', fail)
  worker.on('exit', code => fail(new Error(`STT worker exited with code ${code}`)))
  return {
    run: packets => new Promise((resolve, reject) => {
      if (failure) return reject(failure)
      const id = nextId++
      pending.set(id, { resolve, reject })
      worker.postMessage({ id, packets: [...packets] } satisfies WorkerRequest)
    }),
    close: async () => { await worker.terminate() },
    get dead () { return failure !== undefined },
  }
}
