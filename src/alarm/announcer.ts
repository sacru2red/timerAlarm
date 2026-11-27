import { Readable } from 'node:stream'
import { AudioPlayerStatus, StreamType, createAudioResource } from '@discordjs/voice'
import type { AudioPlayer } from '@discordjs/voice'
import type { Clip, ClipLibrary } from '../audio/clips.ts'
import type { Reply } from '../voice/session.ts'
import { decide } from './decide.ts'
import type { Alarm, Cue } from './types.ts'

export type AnnouncerOptions = {
  player: AudioPlayer
  clips: ClipLibrary
  nextCueAt: () => number | undefined
  sendText: (text: string) => void
  log: (message: string) => void
  now?: () => number
}

type Current = { kind: 'cue' | 'response'; endsAt: number; done: () => void; plannedAt?: number | undefined }
type Pending = { reply: Reply; done: () => void }

export class Announcer {
  #options: AnnouncerOptions
  #now: () => number
  #current: Current | undefined
  #pending: Pending | undefined

  constructor (options: AnnouncerOptions) {
    this.#options = options
    this.#now = options.now ?? Date.now
    options.player.on('stateChange', (before, after) => {
      if (after.status === AudioPlayerStatus.Playing && before.status !== AudioPlayerStatus.Playing && this.#current?.plannedAt !== undefined) {
        this.#options.log(`cue playing at ${this.#now() - this.#current.plannedAt}ms after plan`)
        this.#current.plannedAt = undefined
      }
      if (after.status === AudioPlayerStatus.Idle && before.status !== AudioPlayerStatus.Idle) this.#finish()
    })
  }

  cue (cue: Cue, alarm: Alarm): void {
    this.#play(this.#options.clips[alarm.lang][cue.kind], 'cue', () => {}, cue.at)
  }

  respond (reply: Reply, { text = true } = {}): Promise<void> {
    if (text) this.#options.sendText(reply.text)
    return new Promise(resolve => this.#offer({ reply, done: resolve }))
  }

  stop (): void {
    this.#pending?.done()
    this.#pending = undefined
    this.#options.player.stop(true)
    this.#finish()
  }

  #offer (pending: Pending): void {
    const clip = this.#options.clips[pending.reply.lang][pending.reply.kind]
    const decision = decide(this.#current, { kind: 'response', durationMs: clip.durationMs }, this.#options.nextCueAt(), this.#now())
    if (decision === 'textOnly') return pending.done()
    if (decision === 'wait') {
      this.#pending?.done()
      this.#pending = pending
      return
    }
    this.#play(clip, 'response', pending.done)
  }

  #play (clip: Clip, kind: Current['kind'], done: () => void, plannedAt?: number): void {
    const previous = this.#current
    this.#current = { kind, endsAt: this.#now() + clip.durationMs, done, ...(plannedAt !== undefined && { plannedAt }) }
    previous?.done()
    this.#options.player.play(createAudioResource(Readable.from(clip.packets), { inputType: StreamType.Opus, silencePaddingFrames: 0 }))
  }

  #finish (): void {
    const finished = this.#current
    this.#current = undefined
    finished?.done()
    const pending = this.#pending
    this.#pending = undefined
    if (pending) this.#offer(pending)
  }
}

export function nextCueAt (alarms: readonly Alarm[], now: number): number | undefined {
  const upcoming = alarms.flatMap(alarm => [-3000, -2000, -1000, 0].map(offset => alarm.fireAt + offset)).filter(at => at >= now)
  return upcoming.length > 0 ? Math.min(...upcoming) : undefined
}
