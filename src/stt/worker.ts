import { parentPort, workerData } from 'node:worker_threads'
import opus from '@discordjs/opus'
import { createRecognizer, recognize } from './recognizer.ts'
import type { WorkerReply, WorkerRequest } from './types.ts'

const SAMPLE_RATE = 16000

const { modelDir } = workerData as { modelDir: string }
const recognizer = createRecognizer({ modelDir, numThreads: 1 })

// Packets come from any opted-in client, so a corrupt one is skipped instead of killing the worker.
function decodeAll (packets: readonly Uint8Array[]): Buffer {
  // A fresh decoder per utterance, so the previous speaker's state does not leak into this one.
  const decoder = new opus.OpusEncoder(SAMPLE_RATE, 1)
  const pcm: Buffer[] = []
  for (const packet of packets) {
    try {
      pcm.push(decoder.decode(Buffer.from(packet.buffer, packet.byteOffset, packet.byteLength)))
    } catch {}
  }
  return Buffer.concat(pcm)
}

parentPort!.on('message', ({ id, packets }: WorkerRequest) => {
  const start = performance.now()
  let reply: WorkerReply
  try {
    const pcm = decodeAll(packets)
    const samples = new Float32Array(pcm.length / 2)
    for (let i = 0; i < samples.length; i++) samples[i] = pcm.readInt16LE(i * 2) / 32768
    const { text, lang } = samples.length > 0 ? recognize(recognizer, samples, SAMPLE_RATE) : { text: '', lang: 'other' as const }
    reply = { id, text, lang, decodeMs: performance.now() - start }
  } catch (error) {
    reply = { id, text: '', lang: 'other', decodeMs: performance.now() - start, error: String(error) }
  }
  parentPort!.postMessage(reply)
})
