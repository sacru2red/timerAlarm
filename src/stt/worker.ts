import { parentPort, workerData } from 'node:worker_threads'
import opus from '@discordjs/opus'
import { createRecognizer, recognize } from './recognizer.ts'
import type { WorkerReply, WorkerRequest } from './types.ts'

const SAMPLE_RATE = 16000

const { modelDir } = workerData as { modelDir: string }
const decoder = new opus.OpusEncoder(SAMPLE_RATE, 1)
const recognizer = createRecognizer({ modelDir, numThreads: 1 })

parentPort!.on('message', ({ id, packets }: WorkerRequest) => {
  const start = performance.now()
  const pcm = Buffer.concat(packets.map(packet => decoder.decode(Buffer.from(packet.buffer, packet.byteOffset, packet.byteLength))))
  const samples = new Float32Array(pcm.length / 2)
  for (let i = 0; i < samples.length; i++) samples[i] = pcm.readInt16LE(i * 2) / 32768
  const { text, lang } = recognize(recognizer, samples, SAMPLE_RATE)
  parentPort!.postMessage({ id, text, lang, decodeMs: performance.now() - start } satisfies WorkerReply)
})
