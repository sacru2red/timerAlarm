import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { parseArgs } from 'node:util'
import { CLIP_KINDS, LANGS, clipPath, packFrames } from '../src/audio/clips.ts'
import { encodeWavFile } from './wav-opus.ts'

const { values } = parseArgs({
  options: {
    in: { type: 'string', default: 'data/voice-tts' },
    out: { type: 'string', default: 'assets/voice' },
  },
})

for (const lang of LANGS) {
  for (const kind of CLIP_KINDS) {
    const packets = encodeWavFile(join(values.in, lang, `${kind}.wav`))
    const target = clipPath(values.out, lang, kind)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, packFrames(packets))
    console.log(`${target} frames=${packets.length} ms=${packets.length * 20}`)
  }
}
