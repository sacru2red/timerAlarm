import type { Target } from '../alarm/types.ts'
import { englishTokens, extractEnglishDuration, extractKoreanDuration } from './numbers.ts'
import type { WakeMatch } from './wake-word.ts'

export type Intent =
  | { kind: 'set'; ms: number }
  | { kind: 'shift'; deltaMs: number; target: Target }
  | { kind: 'cancel'; target: Target }
  | { kind: 'list' }
  | { kind: 'unknown' }

type Grammar = {
  cancel: RegExp
  later: RegExp
  earlier: RegExp
  list: RegExp
  all: RegExp
  ordinals: ReadonlyArray<readonly [RegExp, number]>
}

const KOREAN: Grammar = {
  cancel: /꺼|끄|취소|지워|지우|삭제|없애/,
  later: /밀어|미뤄|늦춰|뒤로|연장|추가/,
  earlier: /당겨|앞으로|줄여/,
  list: /남았|남은|몇개|목록|얼마/,
  all: /전부|모두|전체|다(?=꺼|끄|취소|지워|지우|삭제|없애)/,
  ordinals: [[/첫번째|첫째|1번/, 1], [/두번째|둘째|2번/, 2], [/세번째|셋째|3번/, 3]],
}

const ENGLISH: Grammar = {
  cancel: /\b(?:cancel|stop|clear|delete|remove|turn off)\b/,
  later: /\b(?:push\b.*\bback|delay|postpone|add|extend|snooze)\b/,
  earlier: /\b(?:bring\b.*\bforward|move\b.*\bup|reduce|subtract|earlier)\b/,
  list: /\b(?:how long|how much time|time left|list|how many|remaining)\b/,
  all: /\b(?:all|every|everything)\b/,
  ordinals: [[/\b(?:first|1st|number one)\b/, 1], [/\b(?:second|2nd|number two)\b/, 2], [/\b(?:third|3rd|number three)\b/, 3]],
}

export function parseCommand (wake: WakeMatch): Intent {
  const grammar = wake.script === 'ko' ? KOREAN : ENGLISH
  const duration = wake.script === 'ko' ? extractKoreanDuration(wake.rest) : extractEnglishDuration(englishTokens(wake.rest))
  const words = duration?.rest ?? wake.rest

  if (grammar.cancel.test(words)) return { kind: 'cancel', target: targetOf(grammar, words) }
  if (duration && grammar.later.test(words)) return { kind: 'shift', deltaMs: duration.ms, target: targetOf(grammar, words) }
  if (duration && grammar.earlier.test(words)) return { kind: 'shift', deltaMs: -duration.ms, target: targetOf(grammar, words) }
  if (grammar.list.test(words)) return { kind: 'list' }
  if (duration && duration.ms > 0) return { kind: 'set', ms: duration.ms }
  return { kind: 'unknown' }
}

function targetOf (grammar: Grammar, words: string): Target {
  if (grammar.all.test(words)) return { by: 'all' }
  const ordinal = grammar.ordinals.find(([pattern]) => pattern.test(words))
  return ordinal ? { by: 'index', n: ordinal[1] } : { by: 'next' }
}
