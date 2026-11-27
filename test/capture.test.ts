import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { startCapture } from '../src/voice/capture.ts'
import type { Receiver } from '../src/voice/capture.ts'
import type { Utterance } from '../src/stt/types.ts'

function setup (listening = (userId: string) => userId !== 'stranger') {
  let clock = 0
  const streams = new Map<string, EventEmitter>()
  const receiver: Receiver = {
    speaking: new EventEmitter(),
    subscriptions: { has: userId => streams.has(userId) },
    subscribe: userId => {
      const stream = streams.get(userId) ?? new EventEmitter()
      streams.set(userId, stream)
      return stream
    },
  }
  const utterances: Utterance[] = []
  startCapture({ guildId: 'g', receiver, shouldListen: listening, onUtterance: u => utterances.push(u), now: () => clock })
  const speak = (userId: string, count: number) => {
    receiver.speaking.emit('start', userId)
    const stream = streams.get(userId)
    for (let i = 0; i < count; i++) {
      clock += 20
      stream?.emit('data', Buffer.from([i % 256]))
    }
  }
  const end = (userId: string) => {
    streams.get(userId)?.emit('end')
    streams.delete(userId)
  }
  return { speak, end, utterances, receiver, streams }
}

test('drops utterances shorter than 20 packets', () => {
  const { speak, end, utterances } = setup()
  speak('u', 19)
  end('u')
  assert.equal(utterances.length, 0)
})

test('splits at 400 packets and drops a short tail', () => {
  const { speak, end, utterances } = setup()
  speak('u', 401)
  end('u')
  assert.deepEqual(utterances.map(u => u.packets.length), [400])
})

test('a long utterance becomes 400, 400 and 100 packets with each chunk ending at its last packet', () => {
  const { speak, end, utterances } = setup()
  speak('u', 900)
  end('u')
  assert.deepEqual(utterances.map(u => u.packets.length), [400, 400, 100])
  assert.deepEqual(utterances.map(u => u.endedAt), [400 * 20, 800 * 20, 900 * 20])
  assert.ok(utterances.every(u => u.guildId === 'g' && u.userId === 'u'))
})

test('does not subscribe to users who have not opted in', () => {
  const { speak, streams } = setup()
  speak('stranger', 50)
  assert.equal(streams.has('stranger'), false)
})

test('a repeated speaking start while the stream is open does not duplicate packets', () => {
  const { speak, end, utterances, receiver, streams } = setup()
  receiver.speaking.emit('start', 'u')
  receiver.speaking.emit('start', 'u')
  assert.equal(streams.get('u')?.listenerCount('data'), 1)
  speak('u', 50)
  end('u')
  assert.deepEqual(utterances.map(u => u.packets.length), [50])
})

test('end and close together emit the utterance once', () => {
  const { speak, utterances, streams } = setup()
  speak('u', 30)
  streams.get('u')?.emit('end')
  streams.get('u')?.emit('close')
  assert.equal(utterances.length, 1)
})

test('an utterance still open when the user opts out is dropped', () => {
  let consented = true
  const { speak, end, utterances } = setup(() => consented)
  speak('a', 50)
  consented = false
  end('a')
  assert.deepEqual(utterances, [])
})
