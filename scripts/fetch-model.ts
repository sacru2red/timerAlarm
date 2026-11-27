import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

const REPO = 'csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17'
const REVISION = '2365baeacb507f821a0c8120fcee3d484dba7a07'
const FILES = {
  'model.int8.onnx': 'c71f0ce00bec95b07744e116345e33d8cbbe08cef896382cf907bf4b51a2cd51',
  'tokens.txt': 'f449eb28dc567533d7fa59be34e2abca8784f771850c78a47fb731a31429a1dc',
} as const

const dir = process.env.MODEL_DIR || 'models/sense-voice'
mkdirSync(dir, { recursive: true })

for (const [name, sha256] of Object.entries(FILES)) {
  const target = join(dir, name)
  if (existsSync(target) && await hashFile(target) === sha256) {
    console.log(`${target} ok`)
    continue
  }
  const url = `https://huggingface.co/${REPO}/resolve/${REVISION}/${name}`
  const response = await fetch(url)
  if (!response.ok || !response.body) throw new Error(`GET ${url} failed with ${response.status}`)
  const partial = `${target}.part`
  await pipeline(Readable.fromWeb(response.body), createWriteStream(partial))
  const actual = await hashFile(partial)
  if (actual !== sha256) throw new Error(`${name} sha256 is ${actual}, expected ${sha256}`)
  renameSync(partial, target)
  console.log(`${target} downloaded`)
}

async function hashFile (path: string): Promise<string> {
  const hash = createHash('sha256')
  await pipeline(createReadStream(path), hash)
  return hash.digest('hex')
}
