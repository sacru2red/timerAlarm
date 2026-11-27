import type { DetectedLang } from './recognizer.ts'

export type Utterance = { guildId: string; userId: string; packets: Buffer[]; endedAt: number }
export type Transcript = { utterance: Utterance; text: string; lang: DetectedLang; decodeMs: number }

export type WorkerRequest = { id: number; packets: Uint8Array[] }
export type WorkerReply = { id: number; text: string; lang: DetectedLang; decodeMs: number; error?: string }
