import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Lang } from '../src/alarm/types.ts'

export const SCENARIO_DIR = 'test/fixtures/lol'

export type ScenarioLine = { at: number; player: string; lang: Lang; file: string; text: string }
export type Scenario = { loopSec: number; players: Record<string, string>; lines: ScenarioLine[] }

export function loadScenario (dir = SCENARIO_DIR): Scenario {
  return JSON.parse(readFileSync(join(dir, 'scenario.json'), 'utf8')) as Scenario
}

export function opusfName (line: ScenarioLine): string {
  return line.file.replace(/\.wav$/, '.opusf')
}
