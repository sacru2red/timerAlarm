import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { AlarmScheduler } from '../src/alarm/scheduler.ts'
import type { CueKind } from '../src/alarm/types.ts'

type Emitted = { guildId: string; alarmId: number; kind: CueKind; at: number; firedAt: number }

function setup (t: TestContext) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 0 })
  const emitted: Emitted[] = []
  const scheduler = new AlarmScheduler({
    maxAlarms: 3,
    clock: {
      now: () => Date.now(),
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: handle => clearTimeout(handle),
    },
    onCue: (guildId, cue) => emitted.push({ guildId, ...cue, firedAt: Date.now() }),
  })
  // MockTimers.tick(n) moves Date to the end of the whole tick before firing callbacks, so a callback
  // would read the wrong time. Advancing 1 ms at a time keeps Date.now() exact inside every callback.
  const tick = (ms: number) => {
    for (let i = 0; i < ms; i++) t.mock.timers.tick(1)
  }
  // [kind, time it was emitted] pairs, the shape most assertions care about.
  const fired = () => emitted.map(e => [e.kind, e.firedAt])
  return { scheduler, emitted, tick, fired }
}

test('a 2 minute alarm emits its four cues at 117, 118, 119 and 120 seconds, then is gone', t => {
  const { scheduler, emitted, tick, fired } = setup(t)
  assert.deepEqual(scheduler.set('A', 120_000, 'ko'), { result: 'ok', alarms: [{ id: 1, fireAt: 120_000, lang: 'ko' }] })

  tick(116_999)
  assert.equal(emitted.length, 0)
  tick(10_000)
  assert.deepEqual(fired(), [['intro', 117_000], ['three', 118_000], ['two', 119_000], ['now', 120_000]])
  assert.deepEqual(emitted.filter(e => e.at !== e.firedAt || e.alarmId !== 1 || e.guildId !== 'A'), [])
  assert.deepEqual(scheduler.list('A'), [])
})

test('the fourth alarm is full', t => {
  const { scheduler } = setup(t)
  for (const ms of [10_000, 20_000, 30_000]) assert.equal(scheduler.set('A', ms, 'ko').result, 'ok')
  assert.equal(scheduler.set('A', 40_000, 'ko').result, 'full')
  assert.equal(scheduler.list('A').length, 3)
})

test('a set less than 4 seconds from another alarm is a conflict', t => {
  const { scheduler } = setup(t)
  scheduler.set('A', 10_000, 'ko')
  assert.equal(scheduler.set('A', 13_999, 'ko').result, 'conflict')
  assert.equal(scheduler.set('A', 6_001, 'ko').result, 'conflict')
  assert.equal(scheduler.set('A', 14_000, 'ko').result, 'ok')
  assert.deepEqual(scheduler.list('A').map(a => a.fireAt), [10_000, 14_000])
})

test('a set with less than 5 seconds remaining is too short', t => {
  const { scheduler, tick, emitted } = setup(t)
  assert.equal(scheduler.set('A', 3_000, 'ko').result, 'tooShort')
  assert.equal(scheduler.set('A', 4_999, 'ko').result, 'tooShort')
  assert.deepEqual(scheduler.list('A'), [])
  tick(10_000)
  assert.equal(emitted.length, 0)
  assert.equal(scheduler.set('A', 5_000, 'ko').result, 'ok')
})

test('set counts from the given start time, not from now', t => {
  const { scheduler, tick } = setup(t)
  tick(1_000)
  assert.deepEqual(scheduler.set('A', 10_000, 'en', 400), { result: 'ok', alarms: [{ id: 1, fireAt: 10_400, lang: 'en' }] })
})

test('a -10s shift with 8 seconds left is too short and keeps the original alarm', t => {
  const { scheduler, tick, fired } = setup(t)
  scheduler.set('A', 20_000, 'ko')
  tick(12_000)
  assert.deepEqual(scheduler.shift('A', -10_000, { by: 'next' }), { result: 'tooShort' })
  assert.deepEqual(scheduler.list('A').map(a => a.fireAt), [20_000])
  tick(10_000)
  assert.deepEqual(fired(), [['intro', 17_000], ['three', 18_000], ['two', 19_000], ['now', 20_000]])
})

test('an all shift that makes any alarm too short changes nothing', t => {
  const { scheduler } = setup(t)
  scheduler.set('A', 30_000, 'ko')
  scheduler.set('A', 60_000, 'ko')
  assert.deepEqual(scheduler.shift('A', -28_000, { by: 'all' }), { result: 'tooShort' })
  assert.deepEqual(scheduler.list('A').map(a => a.fireAt), [30_000, 60_000])
})

test('an all shift moves every alarm by the same delta', t => {
  const { scheduler } = setup(t)
  scheduler.set('A', 30_000, 'ko')
  scheduler.set('A', 34_000, 'ko')
  const outcome = scheduler.shift('A', 10_000, { by: 'all' })
  assert.equal(outcome.result, 'ok')
  assert.deepEqual(scheduler.list('A').map(a => a.fireAt), [40_000, 44_000])
})

test('a single shift landing less than 4 seconds from another alarm is a conflict', t => {
  const { scheduler } = setup(t)
  scheduler.set('A', 10_000, 'ko')
  scheduler.set('A', 30_000, 'ko')
  assert.deepEqual(scheduler.shift('A', 18_000, { by: 'next' }), { result: 'conflict' })
  assert.deepEqual(scheduler.list('A').map(a => a.fireAt), [10_000, 30_000])
})

test('a cancelled alarm emits none of its remaining cues', t => {
  const { scheduler, tick, fired } = setup(t)
  scheduler.set('A', 10_000, 'ko')
  tick(7_500)
  assert.deepEqual(scheduler.cancel('A', { by: 'next' }), { result: 'ok', alarms: [{ id: 1, fireAt: 10_000, lang: 'ko' }] })
  tick(60_000)
  assert.deepEqual(fired(), [['intro', 7_000]])
  assert.deepEqual(scheduler.list('A'), [])
})

test('a +10s shift with 1.5 seconds left re-emits all four cues from the new fireAt', t => {
  const { scheduler, tick, fired } = setup(t)
  scheduler.set('A', 10_000, 'ko')
  tick(8_500)
  assert.deepEqual(fired(), [['intro', 7_000], ['three', 8_000]])

  assert.deepEqual(scheduler.shift('A', 10_000, { by: 'next' }), { result: 'ok', alarms: [{ id: 1, fireAt: 20_000, lang: 'ko' }] })
  tick(60_000)
  assert.deepEqual(fired(), [
    ['intro', 7_000], ['three', 8_000],
    ['intro', 17_000], ['three', 18_000], ['two', 19_000], ['now', 20_000],
  ])
})

test('index n picks the nth alarm by fireAt, and a missing index is notFound', t => {
  const { scheduler } = setup(t)
  scheduler.set('A', 30_000, 'ko')
  scheduler.set('A', 10_000, 'ko')
  scheduler.set('A', 20_000, 'en')

  assert.deepEqual(scheduler.cancel('A', { by: 'index', n: 2 }), { result: 'ok', alarms: [{ id: 3, fireAt: 20_000, lang: 'en' }] })
  assert.deepEqual(scheduler.list('A').map(a => a.id), [2, 1])
  assert.deepEqual(scheduler.cancel('A', { by: 'index', n: 3 }), { result: 'notFound' })
  assert.deepEqual(scheduler.shift('A', 5_000, { by: 'index', n: 3 }), { result: 'notFound' })
  assert.deepEqual(scheduler.list('A').map(a => a.fireAt), [10_000, 30_000])
})

test('every target is notFound when the guild has no alarms', t => {
  const { scheduler } = setup(t)
  for (const target of [{ by: 'next' }, { by: 'index', n: 1 }, { by: 'all' }] as const) {
    assert.deepEqual(scheduler.shift('A', 10_000, target), { result: 'notFound' })
    assert.deepEqual(scheduler.cancel('A', target), { result: 'notFound' })
  }
})

test('a set in guild A does not change guild B', t => {
  const { scheduler, tick, emitted } = setup(t)
  scheduler.set('A', 10_000, 'ko')
  assert.deepEqual(scheduler.list('B'), [])
  // Same fireAt is not a conflict across guilds, and ids are counted per guild.
  assert.deepEqual(scheduler.set('B', 10_000, 'en'), { result: 'ok', alarms: [{ id: 1, fireAt: 10_000, lang: 'en' }] })
  scheduler.cancel('B', { by: 'all' })
  tick(10_000)
  assert.deepEqual(emitted.map(e => [e.guildId, e.kind]), [['A', 'intro'], ['A', 'three'], ['A', 'two'], ['A', 'now']])
})

test('clear removes every alarm of one guild and its pending cues', t => {
  const { scheduler, tick, emitted } = setup(t)
  scheduler.set('A', 10_000, 'ko')
  scheduler.set('A', 20_000, 'ko')
  scheduler.set('B', 10_000, 'ko')
  scheduler.clear('A')
  assert.deepEqual(scheduler.list('A'), [])
  tick(30_000)
  assert.deepEqual([...new Set(emitted.map(e => e.guildId))], ['B'])
})
