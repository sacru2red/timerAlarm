import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SttPool, workerCount } from '../src/stt/pool.ts'
import type { Recognized, SttWorker } from '../src/stt/pool.ts'
import type { Utterance } from '../src/stt/types.ts'

function fakeWorker () {
  const calls: Array<{ packets: readonly Buffer[]; finish: (r: Recognized) => void; fail: (e: Error) => void }> = []
  const worker: SttWorker = {
    run: packets => new Promise((resolve, reject) => { calls.push({ packets, finish: resolve, fail: reject }) }),
    close: async () => {},
  }
  return { worker, calls }
}

const utterance = (userId: string): Utterance => ({ guildId: 'g', userId, packets: [Buffer.from(userId)], endedAt: 0 })
const recognized = (text: string): Recognized => ({ text, lang: 'ko', decodeMs: 100 })
const flush = () => new Promise(resolve => setImmediate(resolve))

test('worker count leaves one core for the main thread', () => {
  assert.equal(workerCount(1), 1)
  assert.equal(workerCount(2), 1)
  assert.equal(workerCount(4), 3)
})

test('returns the transcript with its utterance', async () => {
  const { worker, calls } = fakeWorker()
  const pool = new SttPool({ workers: [worker] })
  const result = pool.transcribe(utterance('a'))
  calls[0]!.finish(recognized('헤이 타이머봇'))
  assert.deepEqual(await result, { utterance: utterance('a'), text: '헤이 타이머봇', lang: 'ko', decodeMs: 100 })
})

test('drops utterances that waited more than 2 seconds for a worker', async () => {
  let now = 0
  const { worker, calls } = fakeWorker()
  const pool = new SttPool({ workers: [worker], now: () => now })
  const first = pool.transcribe(utterance('a'))
  const stale = pool.transcribe(utterance('b'))
  now = 1000
  const fresh = pool.transcribe(utterance('c'))
  now = 2001
  calls[0]!.finish(recognized('first'))
  assert.equal((await first)?.text, 'first')
  assert.equal(await stale, undefined)
  await flush()
  assert.equal(calls.length, 2)
  assert.deepEqual(calls[1]!.packets, utterance('c').packets)
  calls[1]!.finish(recognized('fresh'))
  assert.equal((await fresh)?.text, 'fresh')
  assert.equal(pool.dropped, 1)
})

test('runs one job per worker at a time', async () => {
  const a = fakeWorker()
  const b = fakeWorker()
  const pool = new SttPool({ workers: [a.worker, b.worker] })
  const jobs = ['1', '2', '3'].map(id => pool.transcribe(utterance(id)))
  assert.equal(a.calls.length + b.calls.length, 2)
  b.calls[0]!.finish(recognized('x'))
  await jobs[0]
  await flush()
  assert.equal(a.calls.length + b.calls.length, 3)
})

test('a dead worker is replaced instead of taking every later job', async () => {
  let dead = false
  const calls: string[] = []
  const crashing: SttWorker = {
    run: async packets => {
      calls.push(`crashing:${packets[0]}`)
      dead = true
      throw new Error('worker exited')
    },
    close: async () => {},
    get dead () { return dead },
  }
  const fresh = fakeWorker()
  const pool = new SttPool({ workers: [crashing], respawn: () => fresh.worker })
  await assert.rejects(pool.transcribe(utterance('a')), /worker exited/)
  await flush()
  const next = pool.transcribe(utterance('b'))
  assert.equal(fresh.calls.length, 1)
  fresh.calls[0]!.finish(recognized('ok'))
  assert.equal((await next)?.text, 'ok')
  assert.deepEqual(calls, ['crashing:a'])
  assert.equal(pool.respawned, 1)
})

test('a failing worker rejects its job and keeps serving', async () => {
  const { worker, calls } = fakeWorker()
  const pool = new SttPool({ workers: [worker] })
  const failed = pool.transcribe(utterance('a'))
  const next = pool.transcribe(utterance('b'))
  calls[0]!.fail(new Error('boom'))
  await assert.rejects(failed, /boom/)
  await flush()
  calls[1]!.finish(recognized('ok'))
  assert.equal((await next)?.text, 'ok')
})

test('stops respawning after the per-minute budget and fails jobs once no worker is left', async () => {
  const dying = (): SttWorker => {
    let dead = false
    return {
      run: async () => {
        dead = true
        throw new Error('model failed to load')
      },
      close: async () => {},
      get dead () { return dead },
    }
  }
  let spawned = 0
  let empty = 0
  const pool = new SttPool({ workers: [dying()], respawn: () => { spawned++; return dying() }, maxRespawnsPerMinute: 2, onNoWorkers: () => { empty++ } })
  for (let i = 0; i < 3; i++) await assert.rejects(pool.transcribe(utterance(String(i))), /model failed to load/)
  await flush()
  assert.equal(spawned, 2)
  assert.equal(empty, 1)
  await assert.rejects(pool.transcribe(utterance('late')), /no STT worker/)
})
