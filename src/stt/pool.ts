import { availableParallelism } from 'node:os'
import { Worker } from 'node:worker_threads'
import type { DetectedLang } from './recognizer.ts'
import type { Transcript, Utterance, WorkerReply, WorkerRequest } from './types.ts'

export type Recognized = { text: string; lang: DetectedLang; decodeMs: number }

export type SttWorker = {
  run (packets: readonly Buffer[]): Promise<Recognized>
  close (): Promise<void>
}

export type PoolOptions = {
  workers: readonly SttWorker[]
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
  #workers: readonly SttWorker[]
  #queue: Job[] = []
  #maxWaitMs: number
  #now: () => number
  dropped = 0

  constructor ({ workers, maxWaitMs = DEFAULT_MAX_WAIT_MS, now = () => performance.now() }: PoolOptions) {
    this.#workers = workers
    this.#idle = [...workers]
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
        this.#idle.push(worker)
        this.#drain()
      })
    }
  }
}

export function spawnSttWorker (modelDir: string): SttWorker {
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { workerData: { modelDir } })
  const pending = new Map<number, { resolve: (recognized: Recognized) => void; reject: (error: Error) => void }>()
  let nextId = 0
  let failure: Error | undefined
  worker.on('message', ({ id, text, lang, decodeMs }: WorkerReply) => {
    pending.get(id)?.resolve({ text, lang, decodeMs })
    pending.delete(id)
  })
  worker.on('error', error => {
    failure = error
    for (const { reject } of pending.values()) reject(error)
    pending.clear()
  })
  return {
    run: packets => new Promise((resolve, reject) => {
      if (failure) return reject(failure)
      const id = nextId++
      pending.set(id, { resolve, reject })
      worker.postMessage({ id, packets: [...packets] } satisfies WorkerRequest)
    }),
    close: async () => { await worker.terminate() },
  }
}
