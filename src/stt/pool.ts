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
  /** Replaces a dead worker. Without it the pool just stops using that worker. */
  respawn?: () => SttWorker
  maxWaitMs?: number
  now?: () => number
}

type Job = { utterance: Utterance; queuedAt: number; resolve: (transcript: Transcript | undefined) => void; reject: (error: unknown) => void }

export const DEFAULT_MAX_WAIT_MS = 2000

export function workerCount (cores = availableParallelism()): number {
  return Math.max(1, cores - 1)
}

export class SttPool {
  #idle: SttWorker[]
  #workers: SttWorker[]
  #queue: Job[] = []
  #respawn: (() => SttWorker) | undefined
  #maxWaitMs: number
  #now: () => number
  dropped = 0
  respawned = 0

  constructor ({ workers, respawn, maxWaitMs = DEFAULT_MAX_WAIT_MS, now = () => performance.now() }: PoolOptions) {
    this.#workers = [...workers]
    this.#idle = [...workers]
    this.#respawn = respawn
    this.#maxWaitMs = maxWaitMs
    this.#now = now
  }

  transcribe (utterance: Utterance): Promise<Transcript | undefined> {
    return new Promise((resolve, reject) => {
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
    if (!this.#respawn) return
    const fresh = this.#respawn()
    this.respawned++
    this.#workers.push(fresh)
    this.#idle.push(fresh)
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
