export type WakeMatch = { script: 'ko' | 'en'; rest: string }

// SenseVoice writes the core as 타이머, 타임머, 타이이머, 타임어 and so on.
const KOREAN_CORE = /타이{0,2}임?[머어]/g
const KOREAN_HARD_SUFFIX = /^[봇옷뽓벗]/
const KOREAN_SUFFIX = /^(?:[봇옷뽓벗]|보(?![여니면자이고다는세러통]))/
// "헤이" also comes back as 페이, 케이, 제이 or 데이. Only at the very start, so "오케이 타이머" stays chatter.
const KOREAN_MISHEARD_HEY = /^[페케제데]이$/
// Tried in order, so "hey timer bot" is cut after "bot" before the bare "hey timer" fallback applies.
// The fallback keeps the observed "timert" but not "timer's" (normalized to "timer s") or "timers".
const ENGLISH_WAKES = [/timer ?(?:bot|bought)\b|\btime a bot\b|^(?:hey |a )?timer but\b/, /^hey timert?\b(?! s\b)/]

export function compactKorean (text: string): string {
  return text.replace(/[\s\p{P}]/gu, '')
}

export function detectWake (text: string): WakeMatch | undefined {
  return detectKorean(compactKorean(text)) ?? detectEnglish(text)
}

function detectKorean (compact: string): WakeMatch | undefined {
  for (const match of compact.matchAll(KOREAN_CORE)) {
    const end = match.index + match[0].length
    // 타이어 is a tire, so the 어 form needs a hard suffix or 헤이.
    const suffix = (match[0].endsWith('어') ? KOREAN_HARD_SUFFIX : KOREAN_SUFFIX).exec(compact.slice(end))
    const hasPrefix = compact.slice(Math.max(0, match.index - 3), match.index).includes('헤') ||
      KOREAN_MISHEARD_HEY.test(compact.slice(0, match.index))
    if (suffix || hasPrefix) return { script: 'ko', rest: compact.slice(end + (suffix?.[0].length ?? 0)) }
  }
  return undefined
}

function detectEnglish (text: string): WakeMatch | undefined {
  const normalized = text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim()
  for (const wake of ENGLISH_WAKES) {
    const match = wake.exec(normalized)
    if (match) return { script: 'en', rest: normalized.slice(match.index + match[0].length).trim() }
  }
  return undefined
}
