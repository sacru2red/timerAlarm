import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { parseArgs } from 'node:util'
import sherpa from 'sherpa-onnx-node'
import { createRecognizer, recognize } from '../src/stt/recognizer.ts'
import type { Recognition } from '../src/stt/recognizer.ts'

const FIXTURES = 'test/fixtures/transcripts.jsonl'
const MODES = { auto: undefined, ko: 'ko' } as const
type Mode = keyof typeof MODES

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    threads: { type: 'string', default: '1' },
    runs: { type: 'string', default: '5' },
    modes: { type: 'string', default: 'auto,ko' },
    'model-dir': { type: 'string', default: process.env.MODEL_DIR ?? 'models/sense-voice' },
    'emit-fixtures': { type: 'boolean', default: false },
  },
})

const numThreads = Number(values.threads)
const runs = Number(values.runs)
const modes = values.modes.split(',').map(parseMode)
const files = positionals.length > 0
  ? positionals
  : readdirSync('test/fixtures/wav').filter(f => f.endsWith('.wav')).sort().map(f => join('test/fixtures/wav', f))

const emitted: Array<{ file: string; mode: Mode } & Recognition> = []

for (const mode of modes) {
  const forceLanguage = MODES[mode]
  const recognizer = createRecognizer({ modelDir: values['model-dir'], numThreads, ...(forceLanguage && { forceLanguage }) })
  console.log(`\n== mode=${mode} threads=${numThreads} runs=${runs}`)
  for (const file of files) {
    const wave = sherpa.readWave(file)
    const times: number[] = []
    let result: Recognition = { text: '', lang: 'other' }
    for (let i = 0; i < runs; i++) {
      const start = performance.now()
      result = recognize(recognizer, wave.samples, wave.sampleRate)
      times.push(performance.now() - start)
    }
    times.sort((a, b) => a - b)
    const audioSec = wave.samples.length / wave.sampleRate
    console.log(`${basename(file)} audio=${audioSec.toFixed(2)}s median=${ms(median(times))} range=${ms(times[0])}-${ms(times.at(-1))} lang=${result.lang} text=${JSON.stringify(result.text)}`)
    emitted.push({ file: basename(file), mode, ...result })
  }
}

if (values['emit-fixtures']) mergeFixtures(emitted)

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
  if (name in MODES) return name as Mode
  throw new Error(`unknown mode ${name}; expected one of ${Object.keys(MODES).join(', ')}`)
}

function median (sorted: number[]): number {
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

function ms (value: number | undefined): string {
  return `${(value ?? NaN).toFixed(0)}ms`
}
