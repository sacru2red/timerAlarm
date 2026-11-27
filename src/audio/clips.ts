import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CueKind, Lang, SchedulerResult } from '../alarm/types.ts'

export type ResponseKind = SchedulerResult | 'unknown'
export type ClipKind = CueKind | ResponseKind
export type Clip = { kind: ClipKind; packets: readonly Buffer[]; durationMs: number }
export type ClipLibrary = Readonly<Record<Lang, Readonly<Record<ClipKind, Clip>>>>

export const LANGS: readonly Lang[] = ['ko', 'en']
export const CUE_KINDS: readonly CueKind[] = ['intro', 'three', 'two', 'now']
export const RESPONSE_KINDS: readonly ResponseKind[] = ['ok', 'full', 'tooShort', 'conflict', 'notFound', 'unknown']
export const CLIP_KINDS: readonly ClipKind[] = [...CUE_KINDS, ...RESPONSE_KINDS]
export const FRAME_MS = 20
export const MAX_CUE_CLIP_MS = 850

export function packFrames (packets: readonly Buffer[]): Buffer {
  return Buffer.concat(packets.flatMap(packet => {
    const length = Buffer.alloc(2)
    length.writeUInt16LE(packet.length)
    return [length, packet]
  }))
}

export function unpackFrames (data: Buffer): Buffer[] {
  const packets: Buffer[] = []
  let offset = 0
  while (offset < data.length) {
    if (offset + 2 > data.length) throw new Error(`truncated frame header at byte ${offset}`)
    const length = data.readUInt16LE(offset)
    const end = offset + 2 + length
    if (end > data.length) throw new Error(`truncated frame at byte ${offset}`)
    packets.push(data.subarray(offset + 2, end))
    offset = end
  }
  return packets
}

export function clipPath (dir: string, lang: Lang, kind: ClipKind): string {
  return join(dir, lang, `${kind}.opusf`)
}

export function loadClips (dir: string): ClipLibrary {
  return recordOf(LANGS, lang => recordOf(CLIP_KINDS, kind => {
    const packets = unpackFrames(readFileSync(clipPath(dir, lang, kind)))
    return { kind, packets, durationMs: packets.length * FRAME_MS }
  }))
}

function recordOf<K extends string, V> (keys: readonly K[], value: (key: K) => V): Record<K, V> {
  return Object.fromEntries(keys.map(key => [key, value(key)])) as Record<K, V>
}
