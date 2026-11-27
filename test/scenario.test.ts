import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { unpackFrames } from '../src/audio/clips.ts'
import { detectWake } from '../src/nlu/wake-word.ts'
import { parseCommand } from '../src/nlu/parse-command.ts'
import { MAX_PACKETS, MIN_PACKETS } from '../src/voice/capture.ts'
import { SCENARIO_DIR, loadScenario, opusfName } from '../scripts/scenario.ts'

const scenario = loadScenario()
const frames = (file: string) => unpackFrames(readFileSync(join(SCENARIO_DIR, file))).length

test('every scenario line has audio the capture would keep', () => {
  for (const line of scenario.lines) {
    const count = frames(opusfName(line))
    assert.ok(count >= MIN_PACKETS && count <= MAX_PACKETS, `${line.file}: ${count} frames`)
  }
})

test('only lines that start with the wake phrase are commands, and every command parses', () => {
  for (const line of scenario.lines) {
    const wake = detectWake(line.text)
    assert.equal(wake !== undefined, /^(?:헤이|hey) /i.test(line.text), line.text)
    if (wake) assert.notEqual(parseCommand(wake).kind, 'unknown', line.text)
  }
})

test('a player never talks over themselves', () => {
  for (const player of Object.keys(scenario.players)) {
    const lines = scenario.lines.filter(line => line.player === player).sort((a, b) => a.at - b.at)
    for (const [i, line] of lines.entries()) {
      const next = lines[i + 1]?.at ?? scenario.loopSec + (lines[0]?.at ?? 0)
      assert.ok(line.at + frames(opusfName(line)) * 0.02 < next, `${line.file} runs into the next line`)
    }
  }
})
