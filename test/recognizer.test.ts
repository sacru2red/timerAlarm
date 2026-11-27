import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeLang } from '../src/stt/recognizer.ts'

test('strips SenseVoice language tags', () => {
  assert.equal(normalizeLang('<|ko|>'), 'ko')
  assert.equal(normalizeLang('<|en|>'), 'en')
  assert.equal(normalizeLang('<|yue|>'), 'other')
  assert.equal(normalizeLang(''), 'other')
})
