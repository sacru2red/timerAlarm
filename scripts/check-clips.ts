import { clipProblems } from '../src/audio/clips.ts'

const dir = process.argv[2] ?? 'assets/voice'
const problems = clipProblems(dir)
for (const problem of problems) console.error(problem)
if (problems.length > 0) process.exit(1)
console.log(`${dir}: all clips present`)
