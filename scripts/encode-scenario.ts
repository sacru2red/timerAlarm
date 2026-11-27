import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { packFrames } from '../src/audio/clips.ts'
import { SCENARIO_DIR, loadScenario, opusfName } from './scenario.ts'
import { encodeWavFile } from './wav-opus.ts'

const { values } = parseArgs({ options: { in: { type: 'string', default: 'data/lol-wav' } } })

for (const line of loadScenario().lines) {
  const packets = encodeWavFile(join(values.in, line.file))
  const target = join(SCENARIO_DIR, opusfName(line))
  writeFileSync(target, packFrames(packets))
  console.log(`${target} ms=${packets.length * 20} ${line.text}`)
}
