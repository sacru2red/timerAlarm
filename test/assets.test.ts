import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CLIP_KINDS, LANGS, clipPath, clipProblems, packFrames, unpackFrames } from '../src/audio/clips.ts'

test('frame files round-trip', () => {
  const packets = [Buffer.from([1, 2, 3]), Buffer.alloc(0), Buffer.alloc(300, 7)]
  assert.deepEqual(unpackFrames(packFrames(packets)), packets)
  assert.throws(() => unpackFrames(Buffer.from([5, 0, 1, 2])), /truncated/)
})

test('clip check reports missing clips and cue clips over 850 ms', () => {
  const dir = mkdtempSync(join(tmpdir(), 'clips-'))
  const frames = (count: number) => packFrames(Array.from({ length: count }, () => Buffer.from([0xf8])))
  for (const lang of LANGS) {
    for (const kind of CLIP_KINDS) {
      mkdirSync(join(dir, lang), { recursive: true })
      writeFileSync(clipPath(dir, lang, kind), frames(kind === 'conflict' ? 80 : 40))
    }
  }
  assert.deepEqual(clipProblems(dir), [])

  writeFileSync(clipPath(dir, 'ko', 'two'), frames(43))
  rmSync(clipPath(dir, 'en', 'ok'))
  assert.deepEqual(clipProblems(dir), [
    `${clipPath(dir, 'ko', 'two')} is 860ms, cue clips must be <= 850ms`,
    `${clipPath(dir, 'en', 'ok')} is missing`,
  ])
})
