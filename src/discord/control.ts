export const IDLE_MS = 30 * 60_000

export type BotChannel = { id: string; humans: number }
export type Caller = { channelId: string | null; canMoveMembers: boolean }
export type JoinRefusal = 'joining' | 'alreadyHere' | 'inUse' | 'noSlot'

export function mayControl (caller: Caller, bot: BotChannel): boolean {
  return caller.channelId === bot.id || bot.humans === 0 || caller.canMoveMembers
}

export function joinRefusal ({ targetId, current, caller, joining, active, maxActive }: {
  targetId: string
  current: BotChannel | undefined
  caller: Caller
  joining: boolean
  active: number
  maxActive: number
}): JoinRefusal | undefined {
  if (joining) return 'joining'
  if (current?.id === targetId) return 'alreadyHere'
  if (current && !mayControl(caller, current)) return 'inUse'
  if (!current && active >= maxActive) return 'noSlot'
  return undefined
}

export function isIdle (alarmCount: number, lastActivity: number, now: number): boolean {
  return alarmCount === 0 && now - lastActivity > IDLE_MS
}
