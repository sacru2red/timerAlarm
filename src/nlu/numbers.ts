export type DurationMatch = { ms: number; rest: string }

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE

const SINO_DIGITS: Readonly<Record<string, number>> = { 일: 1, 이: 2, 삼: 3, 사: 4, 오: 5, 육: 6, 칠: 7, 팔: 8, 구: 9 }
const SINO_UNITS: Readonly<Record<string, number>> = { 십: 10, 백: 100 }
const NATIVE_TENS: Readonly<Record<string, number>> = { 열: 10, 스물: 20, 스무: 20, 서른: 30, 마흔: 40, 쉰: 50 }
const NATIVE_ONES: Readonly<Record<string, number>> = {
  한: 1, 하나: 1, 두: 2, 둘: 2, 세: 3, 셋: 3, 네: 4, 넷: 4, 다섯: 5, 여섯: 6, 일곱: 7, 여덟: 8, 아홉: 9,
}
const KOREAN_UNITS: Readonly<Record<string, number>> = { 시간: HOUR, 분: MINUTE, 푼: MINUTE, 초: SECOND }

const nativeTens = Object.keys(NATIVE_TENS).join('|')
const nativeOnes = Object.keys(NATIVE_ONES).sort((a, b) => b.length - a.length).join('|')
const koreanNumber = `\\d+(?:\\.\\d+)?|[일이삼사오육칠팔구십백]+|(?:${nativeTens})?(?:${nativeOnes})|${nativeTens}`
const koreanSegment = `(${koreanNumber})(시간|분|푼|초)(반)?`
const KOREAN_DURATION = new RegExp(`(?:${koreanSegment})+`)
const KOREAN_SEGMENT = new RegExp(koreanSegment, 'g')
const NATIVE_NUMBER = new RegExp(`^(${nativeTens})?(${nativeOnes})?$`)

export function parseKoreanNumber (token: string): number | undefined {
  if (/^\d+(\.\d+)?$/.test(token)) return Number(token)
  return parseSino(token) ?? parseNative(token)
}

function parseSino (token: string): number | undefined {
  if (!/^[일이삼사오육칠팔구십백]+$/.test(token)) return undefined
  let total = 0
  let digit: number | undefined
  let lastUnit = Infinity
  for (const char of token) {
    const unit = SINO_UNITS[char]
    if (unit === undefined) {
      if (digit !== undefined) return undefined
      digit = SINO_DIGITS[char]
      continue
    }
    if (unit >= lastUnit) return undefined
    total += (digit ?? 1) * unit
    digit = undefined
    lastUnit = unit
  }
  return total + (digit ?? 0)
}

function parseNative (token: string): number | undefined {
  const match = NATIVE_NUMBER.exec(token)
  if (!match || (!match[1] && !match[2])) return undefined
  return (match[1] ? NATIVE_TENS[match[1]]! : 0) + (match[2] ? NATIVE_ONES[match[2]]! : 0)
}

export function extractKoreanDuration (compact: string): DurationMatch | undefined {
  const found = KOREAN_DURATION.exec(compact)
  if (!found) return undefined
  let ms = 0
  for (const [, number, unit, half] of found[0].matchAll(KOREAN_SEGMENT)) {
    const value = parseKoreanNumber(number!)
    if (value === undefined) return undefined
    const unitMs = KOREAN_UNITS[unit!]!
    ms += value * unitMs + (half ? unitMs / 2 : 0)
  }
  return { ms: Math.round(ms), rest: compact.slice(0, found.index) + compact.slice(found.index + found[0].length) }
}

const ENGLISH_ONES: Readonly<Record<string, number>> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
}
const ENGLISH_TENS: Readonly<Record<string, number>> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
}
const ENGLISH_UNITS: Readonly<Record<string, number>> = {
  hour: HOUR,
  hours: HOUR,
  hr: HOUR,
  hrs: HOUR,
  minute: MINUTE,
  minutes: MINUTE,
  min: MINUTE,
  mins: MINUTE,
  second: SECOND,
  seconds: SECOND,
  sec: SECOND,
  secs: SECOND,
}

export function englishTokens (text: string): string[] {
  return text.toLowerCase().replace(/-/g, ' ').replace(/[^a-z0-9.\s]|\.(?!\d)/g, ' ').split(/\s+/).filter(Boolean)
}

function readEnglishNumber (tokens: readonly string[], start: number): { value: number; next: number } | undefined {
  const word = tokens[start]
  if (word === undefined) return undefined
  if (/^\d+(\.\d+)?$/.test(word)) return { value: Number(word), next: start + 1 }
  if (word === 'a' || word === 'an') return { value: 1, next: start + 1 }
  const ones = ENGLISH_ONES[word]
  if (ones !== undefined) return { value: ones, next: start + 1 }
  const tens = ENGLISH_TENS[word]
  if (tens === undefined) return undefined
  const unit = ENGLISH_ONES[tokens[start + 1] ?? '']
  return unit !== undefined && unit > 0 && unit < 10
    ? { value: tens + unit, next: start + 2 }
    : { value: tens, next: start + 1 }
}

function isAndAHalf (tokens: readonly string[], at: number): boolean {
  return tokens[at] === 'and' && tokens[at + 1] === 'a' && tokens[at + 2] === 'half'
}

function readEnglishSegment (tokens: readonly string[], start: number): { ms: number; next: number } | undefined {
  if (tokens[start] === 'half' && (tokens[start + 1] === 'a' || tokens[start + 1] === 'an')) {
    const unitMs = ENGLISH_UNITS[tokens[start + 2] ?? '']
    return unitMs === undefined ? undefined : { ms: unitMs / 2, next: start + 3 }
  }
  const number = readEnglishNumber(tokens, start)
  if (!number) return undefined
  let { value, next } = number
  if (isAndAHalf(tokens, next)) {
    value += 0.5
    next += 3
  }
  const unitMs = ENGLISH_UNITS[tokens[next] ?? '']
  if (unitMs === undefined) return undefined
  next++
  if (isAndAHalf(tokens, next)) {
    value += 0.5
    next += 3
  }
  return { ms: value * unitMs, next }
}

export function extractEnglishDuration (tokens: readonly string[]): DurationMatch | undefined {
  for (let start = 0; start < tokens.length; start++) {
    const first = readEnglishSegment(tokens, start)
    if (!first) continue
    let { ms, next } = first
    for (;;) {
      const skip = tokens[next] === 'and' ? 1 : 0
      const more = readEnglishSegment(tokens, next + skip)
      if (!more) break
      ms += more.ms
      next = more.next
    }
    return { ms: Math.round(ms), rest: [...tokens.slice(0, start), ...tokens.slice(next)].join(' ') }
  }
  return undefined
}
