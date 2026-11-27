export type Playing = { kind: 'cue' | 'response'; endsAt: number } | undefined
export type Incoming = { kind: 'cue' } | { kind: 'response'; durationMs: number }
export type Decision = 'play' | 'wait' | 'textOnly'

export const CUE_GUARD_MS = 200

export function decide (playing: Playing, incoming: Incoming, nextCueAt: number | undefined, now: number): Decision {
  if (incoming.kind === 'cue') return 'play'
  const startsAt = playing?.kind === 'cue' ? playing.endsAt : now
  if (nextCueAt !== undefined && nextCueAt - startsAt < incoming.durationMs + CUE_GUARD_MS) return 'textOnly'
  return playing?.kind === 'cue' ? 'wait' : 'play'
}
