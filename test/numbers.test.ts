import { test } from 'node:test'
import assert from 'node:assert/strict'
import { englishTokens, extractEnglishDuration, extractKoreanDuration, parseKoreanNumber } from '../src/nlu/numbers.ts'

const koreanNumbers: Array<[string, number | undefined]> = [
  ['25', 25], ['이십오', 25], ['십', 10], ['십오', 15], ['삼십', 30], ['백', 100], ['백이십', 120], ['구', 9],
  ['스무', 20], ['스물', 20], ['스물다섯', 25], ['열', 10], ['열한', 11], ['한', 1], ['두', 2], ['서른', 30], ['마흔다섯', 45],
  ['십십', undefined], ['일이', undefined], ['알람', undefined],
]
for (const [token, expected] of koreanNumbers) {
  test(`Korean number ${token}`, () => assert.equal(parseKoreanNumber(token), expected))
}

const koreanDurations: Array<[text: string, ms: number, rest: string, after: string]> = [
  ['2분알람', 120_000, '알람', '알람'],
  ['1분반', 90_000, '', ''],
  ['1분30초알람맞춰줘', 90_000, '알람맞춰줘', '알람맞춰줘'],
  ['1푼30초알람맞춰줘', 90_000, '알람맞춰줘', '알람맞춰줘'],
  ['알람10초뒤로밀어줘', 10_000, '알람뒤로밀어줘', '뒤로밀어줘'],
  ['삼십초', 30_000, '', ''],
  ['이분삼십초', 150_000, '', ''],
  ['한시간반', 5_400_000, '', ''],
  ['스무초', 20_000, '', ''],
  ['1.5분', 90_000, '', ''],
  ['30초앞으로', 30_000, '앞으로', '앞으로'],
  ['앞으로2분알람', 120_000, '앞으로알람', '알람'],
  ['1분30알람', 90_000, '알람', '알람'],
  ['일분삼십', 90_000, '', ''],
  ['2분이남았어', 120_000, '이남았어', '이남았어'],
  ['이삼분알람', 180_000, '이알람', '알람'],
  ['사이오분', 300_000, '사이', ''],
]
for (const [text, ms, rest, after] of koreanDurations) {
  test(`Korean duration ${text}`, () => assert.deepEqual(extractKoreanDuration(text), { ms, rest, after }))
}

for (const text of ['두번째알람꺼줘', '얼마남았어', '세번째', '한명있어']) {
  test(`no Korean duration in ${text}`, () => assert.equal(extractKoreanDuration(text), undefined))
}

const englishDurations: Array<[text: string, ms: number, rest: string, after: string]> = [
  ['two minutes alarm', 120_000, 'alarm', 'alarm'],
  ['one and a half minutes', 90_000, '', ''],
  ['1 minute and a half', 90_000, '', ''],
  ['push back 10 seconds.', 10_000, 'push back', ''],
  ['a minute and 30 seconds', 90_000, '', ''],
  ['twenty-five seconds', 25_000, '', ''],
  ['twenty five seconds', 25_000, '', ''],
  ['half a minute', 30_000, '', ''],
  ['an hour', 3_600_000, '', ''],
  ['1.5 minutes', 90_000, '', ''],
  ['two seconds', 2_000, '', ''],
  ['ninety seconds', 90_000, '', ''],
  ['nineteen seconds', 19_000, '', ''],
  ['set a timer for 2 minutes 30 seconds', 150_000, 'set a timer for', ''],
  ['one minute thirty', 90_000, '', ''],
  ['set a second alarm for two minutes', 120_000, 'set a second alarm for', ''],
  ['wait a second', 1_000, 'wait', ''],
]
for (const [text, ms, rest, after] of englishDurations) {
  test(`English duration ${text}`, () => assert.deepEqual(extractEnglishDuration(englishTokens(text)), { ms, rest, after }))
}

for (const text of ['cancel all alarms', 'how long is left', 'the second alarm', 'cancel a second timer', 'and a second one']) {
  test(`no English duration in ${text}`, () => assert.equal(extractEnglishDuration(englishTokens(text)), undefined))
}
