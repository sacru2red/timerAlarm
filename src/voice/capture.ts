import type { EventEmitter } from 'node:events'
import { EndBehaviorType } from '@discordjs/voice'
import type { Utterance } from '../stt/types.ts'

export const MIN_PACKETS = 20
export const MAX_PACKETS = 400
export const SILENCE_MS = 800

export type ReceiveStream = EventEmitter
export type Receiver = {
  speaking: EventEmitter
  subscriptions: { has (userId: string): boolean }
  subscribe (userId: string, options: { end: { behavior: EndBehaviorType.AfterSilence; duration: number } }): ReceiveStream
}

export type CaptureOptions = {
  guildId: string
  receiver: Receiver
  shouldListen: (userId: string) => boolean
  onUtterance: (utterance: Utterance) => void
  now?: () => number
}

export function startCapture ({ guildId, receiver, shouldListen, onUtterance, now = Date.now }: CaptureOptions): () => void {
  const onStart = (userId: string) => {
    if (receiver.subscriptions.has(userId) || !shouldListen(userId)) return
    const stream = receiver.subscribe(userId, { end: { behavior: EndBehaviorType.AfterSilence, duration: SILENCE_MS } })
    let packets: Buffer[] = []
    let lastAt = now()
    const flush = () => {
      // Re-check consent: /voice off can arrive while this stream is still open.
      if (packets.length >= MIN_PACKETS && shouldListen(userId)) onUtterance({ guildId, userId, packets, endedAt: lastAt })
      packets = []
    }
    stream.on('data', (packet: Buffer) => {
      packets.push(packet)
      lastAt = now()
      if (packets.length === MAX_PACKETS) flush()
    })
    stream.once('end', flush)
    stream.once('close', flush)
  }
  receiver.speaking.on('start', onStart)
  return () => { receiver.speaking.off('start', onStart) }
}
