import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { monitorEventLoopDelay } from 'node:perf_hooks'
import { isDeepStrictEqual, parseArgs } from 'node:util'
import { unpackFrames } from '../src/audio/clips.ts'
import { detectWake } from '../src/nlu/wake-word.ts'
import { parseCommand } from '../src/nlu/parse-command.ts'
import type { Intent } from '../src/nlu/parse-command.ts'
import { SttPool, spawnSttWorker, workerCount } from '../src/stt/pool.ts'
import type { SttWorker } from '../src/stt/pool.ts'
import { MAX_PACKETS, MIN_PACKETS, SILENCE_MS } from '../src/voice/capture.ts'
import { SCENARIO_DIR, loadScenario, opusfName } from './scenario.ts'
import type { ScenarioLine } from './scenario.ts'

const LOOP_RESOLUTION_MS = 10
const LIMITS = { latencyP95Ms: 1500, dropRatio: 0.05, loopP99Ms: 30, cueLateMaxMs: 50 }

const { values } = parseArgs({
  options: {
    guilds: { type: 'string', default: '1,2,3,4,6,8' },
    seconds: { type: 'string', default: '60' },
    workers: { type: 'string', default: String(workerCount()) },
    'model-dir': { type: 'string', default: process.env.MODEL_DIR ?? 'models/sense-voice' },
  },
})

type Clip = { line: ScenarioLine; packets: Buffer[]; expected: Intent | undefined }
type RunResult = {
  guilds: number
  utterances: number
  latencyP95: number
  decodeP95: number
  dropRatio: number
  loopP99: number
  cueLateMax: number
  cpuPercent: number
  commandsRight: number
  commands: number
  falseWakes: number
}

const scenario = loadScenario()
const clips: Clip[] = scenario.lines
  .map(line => ({ line, packets: unpackFrames(readFileSync(join(SCENARIO_DIR, opusfName(line)))), expected: intentOf(line.text) }))
  .filter(clip => clip.packets.length >= MIN_PACKETS)
  .map(clip => ({ ...clip, packets: clip.packets.slice(0, MAX_PACKETS) }))
const guildCounts = values.guilds.split(',').map(Number)
const seconds = Number(values.seconds)
const workers = Array.from({ length: Number(values.workers) }, () => spawnSttWorker(values['model-dir']))
await Promise.all(workers.map(worker => worker.run(clips[0]!.packets)))

console.log(`scenario: ${clips.length} utterances per ${scenario.loopSec}s per guild, ${workers.length} STT worker(s), ${seconds}s per run`)
console.log('guilds  utt  utt/guild/min  latency-p95  decode-p95  dropped  loop-lag-p99  cue-late-max  cpu   commands  false-wakes  pass')
const results: RunResult[] = []
for (const guilds of guildCounts) {
  const result = await run(guilds, workers)
  results.push(result)
  console.log([
    String(guilds).padStart(6),
    String(result.utterances).padStart(4),
    (result.utterances / guilds / (seconds / 60)).toFixed(1).padStart(13),
    `${result.latencyP95.toFixed(0)}ms`.padStart(11),
    `${result.decodeP95.toFixed(0)}ms`.padStart(10),
    `${(result.dropRatio * 100).toFixed(1)}%`.padStart(7),
    `${result.loopP99.toFixed(1)}ms`.padStart(12),
    `${result.cueLateMax.toFixed(1)}ms`.padStart(12),
    `${result.cpuPercent.toFixed(0)}%`.padStart(4),
    `${result.commandsRight}/${result.commands}`.padStart(8),
    String(result.falseWakes).padStart(11),
    passes(result) ? 'yes' : 'no',
  ].join('  '))
}
await Promise.all(workers.map(worker => worker.close()))

const best = Math.max(0, ...results.filter(passes).map(result => result.guilds))
console.log(best > 0
  ? `\nlargest passing N = ${best}; MAX_ACTIVE_GUILDS = ${Math.max(1, Math.floor(best * 0.7))} (70%)`
  : '\nno run passed; follow the Step 14 fallback in docs/PLAN.md')

function intentOf (text: string): Intent | undefined {
  const wake = detectWake(text)
  return wake ? parseCommand(wake) : undefined
}

function passes (result: RunResult): boolean {
  return result.latencyP95 <= LIMITS.latencyP95Ms && result.dropRatio < LIMITS.dropRatio &&
    result.loopP99 <= LIMITS.loopP99Ms && result.cueLateMax < LIMITS.cueLateMaxMs
}

/** Replays the scenario for `guilds` guilds at staggered offsets while a fake alarm cue fires every second per guild. */
async function run (guilds: number, sttWorkers: readonly SttWorker[]): Promise<RunResult> {
  const pool = new SttPool({ workers: sttWorkers })
  const loopDelay = monitorEventLoopDelay({ resolution: LOOP_RESOLUTION_MS })
  const latencies: number[] = []
  const decodes: number[] = []
  const pending: Array<Promise<void>> = []
  const timers: NodeJS.Timeout[] = []
  let cueLateMax = 0
  let commands = 0
  let commandsRight = 0
  let falseWakes = 0
  const start = performance.now()
  const cpuStart = process.cpuUsage()
  loopDelay.enable()

  for (let g = 0; g < guilds; g++) {
    const offsetMs = (g * scenario.loopSec * 1000) / guilds
    // Start one loop early so every guild is already mid-scenario at t=0 and offers the full rate.
    for (let loop = -1; loop * scenario.loopSec * 1000 < seconds * 1000; loop++) {
      for (const clip of clips) {
        const endsAt = offsetMs + (loop * scenario.loopSec + clip.line.at) * 1000 + clip.packets.length * 20 + SILENCE_MS
        if (endsAt < 0 || endsAt > seconds * 1000) continue
        timers.push(setTimeout(() => pending.push(submit(pool, g, clip)), endsAt))
      }
    }
    const cueOffsetMs = (g * 1000) / guilds
    for (let second = 1; second * 1000 + cueOffsetMs < seconds * 1000; second++) {
      const planned = start + second * 1000 + cueOffsetMs
      timers.push(setTimeout(() => { cueLateMax = Math.max(cueLateMax, performance.now() - planned) }, planned - performance.now()))
    }
  }

  await new Promise(resolve => setTimeout(resolve, seconds * 1000 + 100))
  await Promise.all(pending)
  for (const timer of timers) clearTimeout(timer)
  loopDelay.disable()
  const cpu = process.cpuUsage(cpuStart)
  const wallMs = performance.now() - start

  return {
    guilds,
    utterances: pending.length,
    latencyP95: percentile(latencies, 0.95),
    decodeP95: percentile(decodes, 0.95),
    dropRatio: pending.length === 0 ? 0 : pool.dropped / pending.length,
    // The histogram measures the sampling interval itself, so subtract it to get the lag.
    loopP99: Math.max(0, loopDelay.percentile(99) / 1e6 - LOOP_RESOLUTION_MS),
    cueLateMax,
    cpuPercent: ((cpu.user + cpu.system) / 1000 / wallMs) * 100,
    commandsRight,
    commands,
    falseWakes,
  }

  async function submit (sttPool: SttPool, guild: number, clip: Clip): Promise<void> {
    const submittedAt = performance.now()
    const transcript = await sttPool.transcribe({ guildId: `guild-${guild}`, userId: clip.line.player, packets: clip.packets, endedAt: Date.now() })
    if (!transcript) return
    latencies.push(performance.now() - submittedAt)
    decodes.push(transcript.decodeMs)
    const heard = intentOf(transcript.text)
    if (clip.expected) {
      commands++
      if (isDeepStrictEqual(heard, clip.expected)) commandsRight++
    } else if (heard) {
      falseWakes++
    }
  }
}

function percentile (values: number[], p: number): number {
  if (values.length === 0) return NaN
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)]!
}
