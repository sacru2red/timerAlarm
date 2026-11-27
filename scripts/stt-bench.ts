import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { parseArgs } from 'node:util'
import opus from '@discordjs/opus'
import sherpa from 'sherpa-onnx-node'
import type { Wave } from 'sherpa-onnx-node'
import { SttPool, spawnSttWorker } from '../src/stt/pool.ts'
import { createRecognizer, recognize } from '../src/stt/recognizer.ts'
import type { Recognition } from '../src/stt/recognizer.ts'

const FIXTURES = 'test/fixtures/transcripts.jsonl'
const MODES = ['auto', 'ko', 'opus'] as const
type Mode = typeof MODES[number]
type Run = Recognition & { ms: number }

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    threads: { type: 'string', default: '1' },
    runs: { type: 'string', default: '5' },
    modes: { type: 'string', default: 'auto,ko' },
    'via-pool': { type: 'boolean', default: false },
    'model-dir': { type: 'string', default: process.env.MODEL_DIR ?? 'models/sense-voice' },
    'emit-fixtures': { type: 'boolean', default: false },
  },
})

const modelDir = values['model-dir']
const numThreads = Number(values.threads)
const runs = Number(values.runs)
const modes = values['via-pool'] ? ['opus' as const] : values.modes.split(',').map(parseMode)
const files = positionals.length > 0
  ? positionals
  : readdirSync('test/fixtures/wav').filter(f => f.endsWith('.wav')).sort().map(f => join('test/fixtures/wav', f))

const emitted: Array<{ file: string; mode: Mode } & Recognition> = []

for (const mode of modes) {
  const { decode, close } = decoderFor(mode)
  console.log(`\n== mode=${mode} threads=${mode === 'opus' ? 1 : numThreads} runs=${runs}`)
  for (const file of files) {
    const wave = sherpa.readWave(file)
    const results: Run[] = []
    for (let i = 0; i < runs; i++) results.push(await decode(wave))
    const times = results.map(result => result.ms).sort((a, b) => a - b)
    const { text, lang } = results.at(-1)!
    const audioSec = wave.samples.length / wave.sampleRate
    console.log(`${basename(file)} audio=${audioSec.toFixed(2)}s median=${ms(median(times))} p95=${ms(percentile(times, 0.95))} range=${ms(times[0])}-${ms(times.at(-1))} lang=${lang} text=${JSON.stringify(text)}`)
    emitted.push({ file: basename(file), mode, text, lang })
  }
  await close()
}

if (values['emit-fixtures']) mergeFixtures(emitted)

function decoderFor (mode: Mode): { decode: (wave: Wave) => Promise<Run>; close: () => Promise<void> } {
  if (mode === 'opus') {
    const pool = new SttPool({ workers: [spawnSttWorker(modelDir)], maxWaitMs: Infinity })
    const encoder = new opus.OpusEncoder(48000, 2)
    return {
      decode: async wave => {
        const transcript = await pool.transcribe({ guildId: 'bench', userId: 'bench', packets: toDiscordPackets(encoder, wave), endedAt: 0 })
        const { text, lang, decodeMs } = transcript!
        return { text, lang, ms: decodeMs }
      },
      close: () => pool.close(),
    }
  }
  const recognizer = createRecognizer({ modelDir, numThreads, ...(mode === 'ko' && { forceLanguage: 'ko' as const }) })
  return {
    decode: async wave => {
      const start = performance.now()
      const result = recognize(recognizer, wave.samples, wave.sampleRate)
      return { ...result, ms: performance.now() - start }
    },
    close: async () => {},
  }
}

function toDiscordPackets (encoder: InstanceType<typeof opus.OpusEncoder>, wave: Wave): Buffer[] {
  if (wave.sampleRate !== 16000) throw new Error(`opus mode expects 16 kHz WAV, got ${wave.sampleRate}`)
  const pcm = Buffer.alloc(wave.samples.length * 3 * 4)
  for (let i = 0; i < wave.samples.length; i++) {
    const sample = Math.max(-32768, Math.min(32767, Math.round(wave.samples[i]! * 32767)))
    for (let k = 0; k < 3; k++) {
      pcm.writeInt16LE(sample, (i * 3 + k) * 4)
      pcm.writeInt16LE(sample, (i * 3 + k) * 4 + 2)
    }
  }
  const frameBytes = 960 * 2 * 2
  const packets: Buffer[] = []
  for (let offset = 0; offset + frameBytes <= pcm.length; offset += frameBytes) packets.push(encoder.encode(pcm.subarray(offset, offset + frameBytes)))
  return packets
}

function mergeFixtures (rows: typeof emitted): void {
  const lines = existsSync(FIXTURES) ? readFileSync(FIXTURES, 'utf8').split('\n').filter(Boolean) : []
  const existing = lines.map(line => JSON.parse(line) as Record<string, unknown>)
  for (const row of rows) {
    const match = existing.find(line => line['file'] === row.file && line['mode'] === row.mode)
    if (match) Object.assign(match, row)
    else existing.push({ ...row })
  }
  writeFileSync(FIXTURES, existing.map(line => JSON.stringify(line)).join('\n') + '\n')
  console.log(`\nwrote ${existing.length} lines to ${FIXTURES}`)
}

function parseMode (name: string): Mode {
  const mode = MODES.find(candidate => candidate === name)
  if (!mode) throw new Error(`unknown mode ${name}; expected one of ${MODES.join(', ')}`)
  return mode
}

function median (sorted: number[]): number {
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

function percentile (sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)]!
}

function ms (value: number | undefined): string {
  return `${(value ?? NaN).toFixed(0)}ms`
}
