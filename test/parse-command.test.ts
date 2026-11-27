import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseCommand } from '../src/nlu/parse-command.ts'
import type { Intent } from '../src/nlu/parse-command.ts'
import { detectWake } from '../src/nlu/wake-word.ts'
import { currentBehavior, label, loadCorpus } from './corpus.ts'

const ko = (rest: string) => parseCommand({ script: 'ko', rest })
const en = (rest: string) => parseCommand({ script: 'en', rest })
const next = { by: 'next' } as const

test('intents match the corpus', () => {
  for (const line of loadCorpus('./fixtures/transcripts.jsonl')) {
    const expected = currentBehavior(line)
    if (!expected.wake) continue
    const wake = detectWake(line.text)
    assert.ok(wake, label(line))
    assert.deepEqual(parseCommand(wake), expected.intent, label(line))
  }
})

test('Korean commands', () => {
  const cases: Array<[string, Intent]> = [
    ['알람10초뒤로밀어줘', { kind: 'shift', deltaMs: 10_000, target: next }],
    ['1분30초알람맞춰줘', { kind: 'set', ms: 90_000 }],
    ['1푼30초알람맞춰줘', { kind: 'set', ms: 90_000 }],
    ['2분알람', { kind: 'set', ms: 120_000 }],
    ['3분', { kind: 'set', ms: 180_000 }],
    ['삼십초타이머설정해줘', { kind: 'set', ms: 30_000 }],
    ['1분반알람', { kind: 'set', ms: 90_000 }],
    ['두번째알람꺼줘', { kind: 'cancel', target: { by: 'index', n: 2 } }],
    ['첫번째알람취소', { kind: 'cancel', target: { by: 'index', n: 1 } }],
    ['알람다꺼줘', { kind: 'cancel', target: { by: 'all' } }],
    ['알람전부지워', { kind: 'cancel', target: { by: 'all' } }],
    ['알람취소', { kind: 'cancel', target: next }],
    ['얼마남았어', { kind: 'list' }],
    ['알람몇개야', { kind: 'list' }],
    ['30초미뤄줘', { kind: 'shift', deltaMs: 30_000, target: next }],
    ['두번째알람1분늦춰줘', { kind: 'shift', deltaMs: 60_000, target: { by: 'index', n: 2 } }],
    ['알람10초당겨줘', { kind: 'shift', deltaMs: -10_000, target: next }],
    ['전부30초앞으로', { kind: 'shift', deltaMs: -30_000, target: { by: 'all' } }],
    ['30초앞으로', { kind: 'shift', deltaMs: -30_000, target: next }],
    ['앞으로2분알람', { kind: 'set', ms: 120_000 }],
    ['2분알람추가해줘', { kind: 'set', ms: 120_000 }],
    ['알람다1분밀어줘', { kind: 'shift', deltaMs: 60_000, target: { by: 'all' } }],
    ['다음알람꺼줘', { kind: 'cancel', target: next }],
    ['마지막알람꺼줘', { kind: 'cancel', target: { by: 'last' } }],
    ['24시간알람', { kind: 'set', ms: 86_400_000 }],
    ['24시간1초알람', { kind: 'set', ms: 86_401_000 }],
    ['25시간밀어줘', { kind: 'shift', deltaMs: 90_000_000, target: next }],
    ['0분', { kind: 'unknown' }],
    ['두번째알람거죠', { kind: 'unknown' }],
    ['알람밀어줘', { kind: 'unknown' }],
    ['', { kind: 'unknown' }],
  ]
  for (const [rest, intent] of cases) assert.deepEqual(ko(rest), intent, rest)
})

test('English commands', () => {
  const cases: Array<[string, Intent]> = [
    ['two minutes alarm', { kind: 'set', ms: 120_000 }],
    ['set an alarm for 90 seconds', { kind: 'set', ms: 90_000 }],
    ['one and a half minutes', { kind: 'set', ms: 90_000 }],
    ['push back 10 seconds', { kind: 'shift', deltaMs: 10_000, target: next }],
    ['delay the second alarm by 30 seconds', { kind: 'shift', deltaMs: 30_000, target: { by: 'index', n: 2 } }],
    ['bring forward 20 seconds', { kind: 'shift', deltaMs: -20_000, target: next }],
    ['move all alarms up 10 seconds', { kind: 'shift', deltaMs: -10_000, target: { by: 'all' } }],
    ['cancel all alarms', { kind: 'cancel', target: { by: 'all' } }],
    ['cancel the first alarm', { kind: 'cancel', target: { by: 'index', n: 1 } }],
    ['cancel the last alarm', { kind: 'cancel', target: { by: 'last' } }],
    ['add a two minute alarm', { kind: 'set', ms: 120_000 }],
    ['add 30 seconds', { kind: 'shift', deltaMs: 30_000, target: next }],
    ['add 30 seconds to the alarm', { kind: 'shift', deltaMs: 30_000, target: next }],
    ['set a second alarm for two minutes', { kind: 'set', ms: 120_000 }],
    ['set an alarm for 25 hours', { kind: 'set', ms: 90_000_000 }],
    ['push back 25 hours', { kind: 'shift', deltaMs: 90_000_000, target: next }],
    ['stop', { kind: 'cancel', target: next }],
    ['how long is left', { kind: 'list' }],
    ['list alarms', { kind: 'list' }],
    ['hello there', { kind: 'unknown' }],
  ]
  for (const [rest, intent] of cases) assert.deepEqual(en(rest), intent, rest)
})
