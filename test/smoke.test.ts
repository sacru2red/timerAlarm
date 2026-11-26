import { test } from 'node:test'
import assert from 'node:assert/strict'

test('toolchain runs TypeScript tests', () => {
  const answer: number = 42
  assert.equal(answer, 42)
})
