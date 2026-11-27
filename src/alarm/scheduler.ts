import type { Alarm, Cue, CueKind, Lang, SchedulerResult, Target } from './types.ts'

type TimerHandle = ReturnType<typeof setTimeout>

export type Clock = {
  now: () => number
  setTimeout: (fn: () => void, ms: number) => TimerHandle
  clearTimeout: (handle: TimerHandle) => void
}

export type SchedulerOptions = {
  maxAlarms: number
  clock: Clock
  onCue: (guildId: string, cue: Cue, alarm: Alarm) => void
}

export type Outcome =
  | { result: 'ok'; alarms: Alarm[] }
  | { result: Exclude<SchedulerResult, 'ok'> }

export const MIN_REMAINING_MS = 5000
export const MIN_GAP_MS = 4000

const CUES: ReadonlyArray<readonly [kind: CueKind, offsetMs: number]> = [
  ['intro', -3000],
  ['three', -2000],
  ['two', -1000],
  ['now', 0],
]

type Entry = { alarm: Alarm; timer: TimerHandle | undefined }
type Guild = { nextId: number; entries: Map<number, Entry> }

export const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: handle => clearTimeout(handle),
}

export class AlarmScheduler {
  #options: SchedulerOptions
  #guilds = new Map<string, Guild>()

  constructor (options: SchedulerOptions) {
    this.#options = options
  }

  set (guildId: string, ms: number, lang: Lang, startAt = this.#options.clock.now()): Outcome {
    const guild = this.#guild(guildId)
    if (guild.entries.size >= this.#options.maxAlarms) return { result: 'full' }
    const fireAt = startAt + ms
    if (this.#tooShort(fireAt)) return { result: 'tooShort' }
    if (this.#conflicts(guild, fireAt)) return { result: 'conflict' }

    const alarm: Alarm = { id: guild.nextId++, fireAt, lang }
    const entry: Entry = { alarm, timer: undefined }
    guild.entries.set(alarm.id, entry)
    this.#schedule(guildId, guild, entry)
    return { result: 'ok', alarms: [{ ...alarm }] }
  }

  shift (guildId: string, deltaMs: number, target: Target): Outcome {
    const guild = this.#guilds.get(guildId)
    const targets = guild ? this.#select(guild, target) : []
    if (!guild || targets.length === 0) return { result: 'notFound' }
    if (targets.some(entry => this.#tooShort(entry.alarm.fireAt + deltaMs))) return { result: 'tooShort' }
    if (targets.length < guild.entries.size) {
      const moved = new Set(targets)
      const others = [...guild.entries.values()].filter(entry => !moved.has(entry))
      if (targets.some(entry => this.#conflicts(guild, entry.alarm.fireAt + deltaMs, others))) return { result: 'conflict' }
    }

    for (const entry of targets) {
      this.#unschedule(entry)
      entry.alarm.fireAt += deltaMs
      this.#schedule(guildId, guild, entry)
    }
    return { result: 'ok', alarms: targets.map(entry => ({ ...entry.alarm })) }
  }

  cancel (guildId: string, target: Target): Outcome {
    const guild = this.#guilds.get(guildId)
    const targets = guild ? this.#select(guild, target) : []
    if (!guild || targets.length === 0) return { result: 'notFound' }
    for (const entry of targets) {
      this.#unschedule(entry)
      guild.entries.delete(entry.alarm.id)
    }
    return { result: 'ok', alarms: targets.map(entry => ({ ...entry.alarm })) }
  }

  list (guildId: string): Alarm[] {
    const guild = this.#guilds.get(guildId)
    return guild ? this.#sorted(guild).map(entry => ({ ...entry.alarm })) : []
  }

  clear (guildId: string): void {
    const guild = this.#guilds.get(guildId)
    if (!guild) return
    for (const entry of guild.entries.values()) this.#unschedule(entry)
    this.#guilds.delete(guildId)
  }

  #guild (guildId: string): Guild {
    let guild = this.#guilds.get(guildId)
    if (!guild) {
      guild = { nextId: 1, entries: new Map() }
      this.#guilds.set(guildId, guild)
    }
    return guild
  }

  #tooShort (fireAt: number): boolean {
    return fireAt - this.#options.clock.now() < MIN_REMAINING_MS
  }

  #conflicts (guild: Guild, fireAt: number, others: Iterable<Entry> = guild.entries.values()): boolean {
    for (const entry of others) {
      if (Math.abs(entry.alarm.fireAt - fireAt) < MIN_GAP_MS) return true
    }
    return false
  }

  #sorted (guild: Guild): Entry[] {
    return [...guild.entries.values()].sort((a, b) => a.alarm.fireAt - b.alarm.fireAt || a.alarm.id - b.alarm.id)
  }

  #select (guild: Guild, target: Target): Entry[] {
    const sorted = this.#sorted(guild)
    if (target.by === 'all') return sorted
    if (target.by === 'last') return sorted.slice(-1)
    const entry = sorted[target.by === 'next' ? 0 : target.n - 1]
    return entry ? [entry] : []
  }

  #schedule (guildId: string, guild: Guild, entry: Entry): void {
    this.#arm(guildId, guild, entry, 0)
  }

  #arm (guildId: string, guild: Guild, entry: Entry, index: number): void {
    const [kind, offsetMs] = CUES[index]!
    const cue: Cue = { alarmId: entry.alarm.id, kind, at: entry.alarm.fireAt + offsetMs }
    entry.timer = this.#options.clock.setTimeout(() => {
      entry.timer = undefined
      if (index === CUES.length - 1) guild.entries.delete(entry.alarm.id)
      else this.#arm(guildId, guild, entry, index + 1)
      this.#options.onCue(guildId, cue, { ...entry.alarm })
    }, Math.max(0, cue.at - this.#options.clock.now()))
  }

  #unschedule (entry: Entry): void {
    if (entry.timer !== undefined) this.#options.clock.clearTimeout(entry.timer)
    entry.timer = undefined
  }
}
