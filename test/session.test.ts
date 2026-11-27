import { test } from 'node:test'
import assert from 'node:assert/strict'
import { AlarmScheduler } from '../src/alarm/scheduler.ts'
import type { DetectedLang } from '../src/stt/recognizer.ts'
import { createSession, formatDuration } from '../src/voice/session.ts'
import type { Reply } from '../src/voice/session.ts'

function setup () {
  let clock = 100_000
  const scheduler = new AlarmScheduler({
    maxAlarms: 3,
    clock: { now: () => clock, setTimeout: () => setTimeout(() => {}, 0), clearTimeout: () => {} },
    onCue: () => {},
  })
  const replies: Reply[] = []
  const session = createSession({
    guildId: 'g',
    scheduler,
    now: () => clock,
    respond: async reply => {
      replies.push(reply)
      clock += 300
    },
  })
  const say = (text: string, { userId = 'u', lang = 'ko' as DetectedLang, packets = 100 } = {}) => {
    clock += packets * 20
    return session.onTranscript({ utterance: { guildId: 'g', userId, packets: Array(packets).fill(Buffer.alloc(1)), endedAt: clock }, text, lang, decodeMs: 200 })
  }
  const advance = (ms: number) => { clock += ms }
  const fireAts = () => scheduler.list('g').map(alarm => alarm.fireAt)
  return { say, advance, replies, fireAts, now: () => clock }
}

test('a Korean wake command sets an alarm counted from the end of speech', async () => {
  const { say, replies, fireAts, now } = setup()
  await say('헤이 타이머봇 2 분 알람.')
  assert.deepEqual(fireAts(), [now() - 300 + 120_000])
  assert.deepEqual(replies, [{ kind: 'ok', lang: 'ko', text: '2분 뒤 알람을 맞췄어요.' }])
})

test('an English command gets an English reply', async () => {
  const { say, replies } = setup()
  await say('Hey timer bot, one and a half minutes.', { lang: 'en' })
  assert.deepEqual(replies, [{ kind: 'ok', lang: 'en', text: 'Alarm set for 1m 30s.' }])
})

test('a shift moves only the earliest of two alarms', async () => {
  const { say, fireAts } = setup()
  await say('헤이 타이머봇 1분 알람')
  await say('헤이 타이머봇 2분 알람')
  const [first, second] = fireAts()
  await say('헤이 타이머봇 알람 10초 뒤로 밀어 줘')
  assert.deepEqual(fireAts(), [first! + 10_000, second])
})

test('a bare wake word waits five seconds after the reply for the command', async () => {
  const { say, advance, replies, fireAts } = setup()
  await say('헤이 타이머봇.')
  assert.equal(replies[0]?.kind, 'ok')
  advance(1000)
  await say('3분 알람')
  assert.equal(fireAts().length, 1)

  await say('타이머봇')
  advance(5001)
  await say('3분 알람', { packets: 50 })
  assert.equal(fireAts().length, 1)
  assert.equal(replies.length, 3)
})

test('the follow-up window belongs to the user who woke the bot', async () => {
  const { say, fireAts } = setup()
  await say('헤이 타이머봇')
  await say('3분 알람', { userId: 'other' })
  assert.deepEqual(fireAts(), [])
})

test('a fourth alarm is refused as full', async () => {
  const { say, replies } = setup()
  for (const minutes of [1, 2, 3, 4]) await say(`헤이 타이머봇 ${minutes}분 알람`)
  assert.equal(replies.at(-1)?.kind, 'full')
})

test('chatter gets no reply', async () => {
  const { say, replies } = setup()
  await say('야 적이 오른쪽 에 한 명 있 어.')
  await say('타이머 몇 분 남았지')
  assert.deepEqual(replies, [])
})

test('an unparsable command after the wake word gets the unknown reply', async () => {
  const { say, replies } = setup()
  await say('헤이 타이임머 두 번째 알람 거죠.')
  assert.equal(replies[0]?.kind, 'unknown')
})

test('list reports remaining time per alarm', async () => {
  const { say, replies } = setup()
  await say('헤이 타이머봇 얼마 남았어')
  assert.equal(replies[0]?.kind, 'notFound')
  await say('헤이 타이머봇 1분 알람')
  await say('헤이 타이머봇 얼마 남았어')
  assert.match(replies.at(-1)!.text, /^1\. 5\d초 남음$/)
})

test('durations format in both languages', () => {
  assert.equal(formatDuration(90_000, 'ko'), '1분 30초')
  assert.equal(formatDuration(3_600_000, 'en'), '1h')
  assert.equal(formatDuration(400, 'ko'), '0초')
})
