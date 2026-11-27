import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CUE_KINDS, LANGS, MAX_CUE_CLIP_MS, loadClips, packFrames, unpackFrames } from '../src/audio/clips.ts'

test('frame files round-trip', () => {
  const packets = [Buffer.from([1, 2, 3]), Buffer.alloc(0), Buffer.alloc(300, 7)]
  assert.deepEqual(unpackFrames(packFrames(packets)), packets)
  assert.throws(() => unpackFrames(Buffer.from([5, 0, 1, 2])), /truncated/)
})

test('every clip exists and cue clips fit in one second slot', () => {
  const clips = loadClips('assets/voice')
  for (const lang of LANGS) {
    for (const kind of CUE_KINDS) {
      const clip = clips[lang][kind]
      assert.ok(clip.packets.length > 0, `${lang}/${kind} is empty`)
      assert.ok(clip.durationMs <= MAX_CUE_CLIP_MS, `${lang}/${kind} is ${clip.durationMs}ms`)
    }
  }
})
