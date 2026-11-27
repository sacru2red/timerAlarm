import { readFileSync } from 'node:fs'
import type { Intent } from '../src/nlu/parse-command.ts'

export type Expectation = { wake: false } | { wake: true; intent: Intent }

export type CorpusLine = {
  file: string
  mode: string
  text: string
  lang: string
  expected: Expectation
} & ({ knownMiss?: false } | { knownMiss: true; actual: Expectation })

export function loadCorpus (path: string): CorpusLine[] {
  return readFileSync(new URL(path, import.meta.url), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line) as CorpusLine)
}

export function currentBehavior (line: CorpusLine): Expectation {
  return line.knownMiss ? line.actual : line.expected
}

export function label (line: CorpusLine): string {
  return `${line.file} [${line.mode}] ${JSON.stringify(line.text)}`
}
