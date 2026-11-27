import { test } from 'node:test'
import assert from 'node:assert/strict'
import { isIdle, joinRefusal, mayControl } from '../src/discord/control.ts'

const THIRTY_MINUTES = 30 * 60_000

const busy = { id: 'game', humans: 4 }
const outsider = { channelId: 'other', canMoveMembers: false }

test('only people in the bot channel control it, unless the channel is empty or they can move members', () => {
  assert.equal(mayControl({ channelId: 'game', canMoveMembers: false }, busy), true)
  assert.equal(mayControl(outsider, busy), false)
  assert.equal(mayControl({ channelId: null, canMoveMembers: false }, busy), false)
  assert.equal(mayControl(outsider, { id: 'game', humans: 0 }), true)
  assert.equal(mayControl({ channelId: null, canMoveMembers: true }, busy), true)
})

test('join is refused while connecting, when already there, when pulled away from a busy channel, or when slots are full', () => {
  const base = { targetId: 'lobby', current: undefined, caller: { channelId: 'lobby', canMoveMembers: false }, joining: false, active: 0, maxActive: 3 }
  assert.equal(joinRefusal(base), undefined)
  assert.equal(joinRefusal({ ...base, joining: true }), 'joining')
  assert.equal(joinRefusal({ ...base, joining: true, current: { id: 'lobby', humans: 2 } }), 'joining')
  assert.equal(joinRefusal({ ...base, current: { id: 'lobby', humans: 2 } }), 'alreadyHere')
  assert.equal(joinRefusal({ ...base, current: busy }), 'inUse')
  assert.equal(joinRefusal({ ...base, current: { id: 'game', humans: 0 } }), undefined)
  assert.equal(joinRefusal({ ...base, current: busy, caller: { channelId: 'lobby', canMoveMembers: true } }), undefined)
  assert.equal(joinRefusal({ ...base, active: 3 }), 'noSlot')
  assert.equal(joinRefusal({ ...base, active: 3, current: { id: 'game', humans: 0 } }), undefined, 'moving within a guild keeps its slot')
})

test('a guild is idle only with no alarms and no activity for 30 minutes', () => {
  assert.equal(isIdle(0, 0, THIRTY_MINUTES), false)
  assert.equal(isIdle(0, 0, THIRTY_MINUTES + 1), true)
  assert.equal(isIdle(1, 0, THIRTY_MINUTES * 10), false)
})
