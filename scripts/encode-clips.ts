import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { parseArgs } from 'node:util'
import opus from '@discordjs/opus'
import { CLIP_KINDS, LANGS, clipPath, packFrames } from '../src/audio/clips.ts'

const SAMPLE_RATE = 48000
const CHANNELS = 2
const FRAME_SAMPLES = 960
const SILENCE = 0.02 * 32768

const { values } = parseArgs({
  options: {
    in: { type: 'string', default: 'data/voice-sapi' },
    out: { type: 'string', default: 'assets/voice' },
  },
})

const encoder = new opus.OpusEncoder(SAMPLE_RATE, CHANNELS)

for (const lang of LANGS) {
  for (const kind of CLIP_KINDS) {
    const source = join(values.in, lang, `${kind}.wav`)
    const pcm = trimSilence(toStereo(readWav(source)))
    const packets: Buffer[] = []
    const frameBytes = FRAME_SAMPLES * CHANNELS * 2
    for (let offset = 0; offset < pcm.length; offset += frameBytes) {
      const frame = Buffer.alloc(frameBytes)
      pcm.copy(frame, 0, offset, Math.min(offset + frameBytes, pcm.length))
      packets.push(encoder.encode(frame))
    }
    const target = clipPath(values.out, lang, kind)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, packFrames(packets))
    console.log(`${target} frames=${packets.length} ms=${packets.length * 20}`)
  }
}

type Wav = { channels: number; samples: Buffer }

function readWav (path: string): Wav {
  const data = readFileSync(path)
  if (data.toString('ascii', 0, 4) !== 'RIFF' || data.toString('ascii', 8, 12) !== 'WAVE') throw new Error(`${path} is not a WAV file`)
  let channels = 0
  let offset = 12
  while (offset + 8 <= data.length) {
    const id = data.toString('ascii', offset, offset + 4)
    const size = data.readUInt32LE(offset + 4)
    const body = offset + 8
    if (id === 'fmt ') {
      const format = data.readUInt16LE(body)
      channels = data.readUInt16LE(body + 2)
      const rate = data.readUInt32LE(body + 4)
      const bits = data.readUInt16LE(body + 14)
      if (format !== 1 || rate !== SAMPLE_RATE || bits !== 16 || channels < 1 || channels > 2) {
        throw new Error(`${path} must be 48 kHz 16-bit PCM mono or stereo (got format=${format} rate=${rate} bits=${bits} channels=${channels})`)
      }
    } else if (id === 'data') {
      if (channels === 0) throw new Error(`${path} has data before fmt`)
      return { channels, samples: data.subarray(body, body + size) }
    }
    offset = body + size + (size % 2)
  }
  throw new Error(`${path} has no data chunk`)
}

function toStereo ({ channels, samples }: Wav): Buffer {
  if (channels === 2) return samples
  const stereo = Buffer.alloc(samples.length * 2)
  for (let i = 0; i < samples.length / 2; i++) {
    const sample = samples.readInt16LE(i * 2)
    stereo.writeInt16LE(sample, i * 4)
    stereo.writeInt16LE(sample, i * 4 + 2)
  }
  return stereo
}

function trimSilence (stereo: Buffer): Buffer {
  const frames = stereo.length / 4
  const loud = (i: number) => Math.abs(stereo.readInt16LE(i * 4)) > SILENCE || Math.abs(stereo.readInt16LE(i * 4 + 2)) > SILENCE
  let start = 0
  while (start < frames && !loud(start)) start++
  let end = frames
  while (end > start && !loud(end - 1)) end--
  return stereo.subarray(start * 4, end * 4)
}
