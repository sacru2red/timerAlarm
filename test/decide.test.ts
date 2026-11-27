import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decide } from '../src/alarm/decide.ts'

const response = (durationMs: number) => ({ kind: 'response', durationMs }) as const

test('a cue interrupts a playing response', () => {
  assert.equal(decide({ kind: 'response', endsAt: 1500 }, { kind: 'cue' }, 1000, 1000), 'play')
})

test('a new cue interrupts a playing cue', () => {
  assert.equal(decide({ kind: 'cue', endsAt: 1100 }, { kind: 'cue' }, 1000, 1000), 'play')
})

test('a response that would run into the next cue goes out as text only', () => {
  assert.equal(decide(undefined, response(500), 10_699, 10_000), 'textOnly')
  assert.equal(decide(undefined, response(500), 10_700, 10_000), 'play')
})

test('a response never cuts a playing cue', () => {
  assert.equal(decide({ kind: 'cue', endsAt: 10_300 }, response(500), 20_000, 10_000), 'wait')
  assert.equal(decide({ kind: 'cue', endsAt: 10_300 }, response(500), 10_900, 10_000), 'textOnly')
})

test('a response replaces a playing response and plays freely with no cue ahead', () => {
  assert.equal(decide({ kind: 'response', endsAt: 10_400 }, response(500), undefined, 10_000), 'play')
  assert.equal(decide(undefined, response(1600), undefined, 10_000), 'play')
})
