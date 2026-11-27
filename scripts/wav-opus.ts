import { readFileSync } from 'node:fs'
import opus from '@discordjs/opus'

const SAMPLE_RATE = 48000
const CHANNELS = 2
const FRAME_SAMPLES = 960
const SILENCE = 0.01 * 32768
const PAD_SAMPLES = 1920 // 40 ms kept around the speech so quiet onsets and endings survive

const encoder = new opus.OpusEncoder(SAMPLE_RATE, CHANNELS)

/** Reads a 48 kHz 16-bit WAV, trims leading and trailing silence and returns 20 ms Opus packets as Discord sends them. */
export function encodeWavFile (path: string): Buffer[] {
  const pcm = trimSilence(toStereo(readWav(path)))
  const packets: Buffer[] = []
  const frameBytes = FRAME_SAMPLES * CHANNELS * 2
  for (let offset = 0; offset < pcm.length; offset += frameBytes) {
    const frame = Buffer.alloc(frameBytes)
    pcm.copy(frame, 0, offset, Math.min(offset + frameBytes, pcm.length))
    packets.push(encoder.encode(frame))
  }
  return packets
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
  for (let i = 0; i < Math.floor(samples.length / 2); i++) {
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
  return stereo.subarray(Math.max(0, start - PAD_SAMPLES) * 4, Math.min(frames, end + PAD_SAMPLES) * 4)
}
