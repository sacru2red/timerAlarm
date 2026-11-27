import type { AlarmScheduler } from '../alarm/scheduler.ts'
import type { Alarm, Lang } from '../alarm/types.ts'
import { FRAME_MS } from '../audio/clips.ts'
import type { ResponseKind } from '../audio/clips.ts'
import { englishTokens } from '../nlu/numbers.ts'
import { parseCommand } from '../nlu/parse-command.ts'
import type { Intent } from '../nlu/parse-command.ts'
import { compactKorean, detectWake } from '../nlu/wake-word.ts'
import type { WakeMatch } from '../nlu/wake-word.ts'
import type { Transcript } from '../stt/types.ts'

export const FOLLOW_UP_MS = 5000

export type Reply = { kind: ResponseKind; lang: Lang; text: string }

export type SessionOptions = {
  guildId: string
  scheduler: Pick<AlarmScheduler, 'set' | 'shift' | 'cancel' | 'list'>
  respond: (reply: Reply) => Promise<void>
  now: () => number
}

type FollowUp = { since: number; until: number }

export function createSession ({ guildId, scheduler, respond, now }: SessionOptions) {
  const followUps = new Map<string, FollowUp>()

  function execute (intent: Intent, lang: Lang, startAt: number): Reply {
    const t = TEXT[lang]
    switch (intent.kind) {
      case 'set': {
        const outcome = scheduler.set(guildId, intent.ms, lang, startAt)
        return outcome.result === 'ok'
          ? { kind: 'ok', lang, text: t.set(intent.ms) }
          : { kind: outcome.result, lang, text: t[outcome.result] }
      }
      case 'shift': {
        const outcome = scheduler.shift(guildId, intent.deltaMs, intent.target)
        return outcome.result === 'ok'
          ? { kind: 'ok', lang, text: t.shift(intent.deltaMs, outcome.alarms.length) }
          : { kind: outcome.result, lang, text: t[outcome.result] }
      }
      case 'cancel': {
        const outcome = scheduler.cancel(guildId, intent.target)
        return outcome.result === 'ok'
          ? { kind: 'ok', lang, text: t.cancel(outcome.alarms.length) }
          : { kind: outcome.result, lang, text: t[outcome.result] }
      }
      case 'list': {
        const alarms = scheduler.list(guildId)
        return alarms.length === 0
          ? { kind: 'notFound', lang, text: t.notFound }
          : { kind: 'ok', lang, text: t.list(alarms, now()) }
      }
      case 'unknown':
        return { kind: 'unknown', lang, text: t.unknown }
    }
  }

  async function onTranscript ({ utterance, text, lang: detected }: Transcript): Promise<void> {
    const lang: Lang = detected === 'en' ? 'en' : 'ko'
    const startedAt = utterance.endedAt - utterance.packets.length * FRAME_MS
    const wake = detectWake(text)
    let command: WakeMatch
    if (wake) {
      followUps.delete(utterance.userId)
      if (!/[\p{L}\p{N}]/u.test(wake.rest)) {
        const followUp = { since: utterance.endedAt, until: Infinity }
        followUps.set(utterance.userId, followUp)
        await respond({ kind: 'ok', lang, text: TEXT[lang].listening })
        followUp.until = now() + FOLLOW_UP_MS
        return
      }
      command = wake
    } else {
      const followUp = followUps.get(utterance.userId)
      if (!followUp || startedAt < followUp.since || startedAt > followUp.until) return
      followUps.delete(utterance.userId)
      command = /\p{Script=Hangul}/u.test(text)
        ? { script: 'ko', rest: compactKorean(text) }
        : { script: 'en', rest: englishTokens(text).join(' ') }
    }
    await respond(execute(parseCommand(command), lang, utterance.endedAt))
  }

  return { execute, onTranscript }
}

type Messages = Record<Exclude<ResponseKind, 'ok'>, string> & {
  listening: string
  set: (ms: number) => string
  shift: (deltaMs: number, count: number) => string
  cancel: (count: number) => string
  list: (alarms: readonly Alarm[], now: number) => string
}

export function formatDuration (ms: number, lang: Lang): string {
  const total = Math.max(0, Math.round(ms / 1000))
  const parts: Array<[number, string, string]> = [
    [Math.floor(total / 3600), '시간', 'h'],
    [Math.floor(total / 60) % 60, '분', 'm'],
    [total % 60, '초', 's'],
  ]
  const shown = parts.filter(([value]) => value > 0)
  if (shown.length === 0) return lang === 'ko' ? '0초' : '0s'
  return shown.map(([value, ko, en]) => `${value}${lang === 'ko' ? ko : en}`).join(' ')
}

const TEXT: Record<Lang, Messages> = {
  ko: {
    listening: '네, 말씀하세요.',
    set: ms => `${formatDuration(ms, 'ko')} 뒤 알람을 맞췄어요.`,
    shift: (deltaMs, count) => `알람 ${count}개를 ${formatDuration(Math.abs(deltaMs), 'ko')} ${deltaMs > 0 ? '늦췄어요' : '당겼어요'}.`,
    cancel: count => `알람 ${count}개를 껐어요.`,
    list: (alarms, now) => alarms.map((alarm, i) => `${i + 1}. ${formatDuration(alarm.fireAt - now, 'ko')} 남음`).join('\n'),
    full: '알람이 꽉 찼어요. 하나를 끄고 다시 말해 주세요.',
    tooShort: '너무 짧아요. 5초 이상 남게 해 주세요.',
    conflict: '다른 알람과 4초 이상 떨어져야 해요.',
    notFound: '그 알람이 없어요.',
    unknown: '잘 못 알아들었어요.',
  },
  en: {
    listening: "Yes? I'm listening.",
    set: ms => `Alarm set for ${formatDuration(ms, 'en')}.`,
    shift: (deltaMs, count) => `Moved ${count} alarm${count > 1 ? 's' : ''} ${deltaMs > 0 ? 'back' : 'forward'} by ${formatDuration(Math.abs(deltaMs), 'en')}.`,
    cancel: count => `Cancelled ${count} alarm${count > 1 ? 's' : ''}.`,
    list: (alarms, now) => alarms.map((alarm, i) => `${i + 1}. ${formatDuration(alarm.fireAt - now, 'en')} left`).join('\n'),
    full: 'Alarms are full. Cancel one first.',
    tooShort: 'Too short. Leave at least 5 seconds.',
    conflict: 'Alarms must be at least 4 seconds apart.',
    notFound: 'No such alarm.',
    unknown: "Sorry, I didn't catch that.",
  },
}
