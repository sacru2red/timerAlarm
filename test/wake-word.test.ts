import { test } from 'node:test'
import assert from 'node:assert/strict'
import { detectWake } from '../src/nlu/wake-word.ts'
import { currentBehavior, label, loadCorpus } from './corpus.ts'

const corpus = loadCorpus('./fixtures/transcripts.jsonl')

test('corpus has 30 lines and every line has an expectation', () => {
  assert.equal(corpus.length, 30)
  for (const line of corpus) assert.equal(typeof line.expected.wake, 'boolean', label(line))
})

test('wake word matches the corpus', () => {
  for (const line of corpus) assert.equal(detectWake(line.text) !== undefined, currentBehavior(line).wake, label(line))
})

test('wake word variants the model produces', () => {
  const cases: Array<[string, string]> = [
    ['헤 타이임머2 분 알람', '2분알람'],
    ['헤이 타이임머봇2 분알람.', '2분알람'],
    ['타임머옷 1 분 30 초 알람 맞춰 줘.', '1분30초알람맞춰줘'],
    ['타이머뽓 얼마 남았어', '얼마남았어'],
    ['타이머보 2분', '2분'],
    ['Hey timerbot, two minutes alarm.', 'two minutes alarm'],
    ['hey time a bot cancel', 'cancel'],
    ['Timer but, list alarms', 'list alarms'],
    ['hey timer but cancel', 'cancel'],
    ['페이 타이머봇 육분 알람.', '육분알람'],
    ['케이 타이임머버 두번째 알람꺼 죠.', '버두번째알람꺼죠'],
    ['제이 타이이머 보다 알람 30 초 당겨줘.', '보다알람30초당겨줘'],
    ['헤이타임 어옷 6분 알람.', '6분알람'],
    ['Kytimerbot set an alarm for two minutes.', 'set an alarm for two minutes'],
    ['Hey timer bot, cancel', 'cancel'],
    ['Hey timer bought two minutes alarm.', 'two minutes alarm'],
    ['Hey timert, how long is left?', 'how long is left'],
  ]
  for (const [text, rest] of cases) assert.equal(detectWake(text)?.rest, rest, text)
})

test('chatter about timers does not wake the bot', () => {
  const cases = [
    '타이머 맞춰놨어?', '타이머 몇 분 남았지', '타이머 보여?', '타이머보니까 1분 남았네',
    '타이머보고 있어', '타이머보다 스톱워치가 낫지', '타이머보는 중', '타이머보면', '타이머보자', '타이머보이', '타이머보세요',
    '드래곤 타이머 몇 분이야', '바론 타이머 봐봐 곧이야', '타머 맞춰나스 누가가', '타이어 바꿨어', '제이가 타이머 맞췄대',
    '오케이 타이머 맞출게', '오케이, 타이머 켜놨어', '오케이 타이머 2분 맞출게', '오케이 타이머 30초 남았어', '오케이 타임 어때',
    '타이어 보러 가자', '타이어 보통 2분이면 갈아', '타이머 보러 가자', '타이머 보통 2분이야',
    "Hey, timer's set for two minutes", "Hey, timer's up in thirty seconds", 'hey timers are off by a minute', "Hey, timer's up!",
    'set a timer for me', 'the timer is broken', 'I set the timer but it only had 2 minutes left',
  ]
  for (const text of cases) {
    assert.equal(detectWake(text), undefined, text)
  }
})
