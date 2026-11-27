export type WakeMatch = { script: 'ko' | 'en'; rest: string }

// SenseVoice writes the core as 타이머, 타임머, 타이이머, 타임어 and so on.
const KOREAN_CORE = /타이{0,2}임?[머어]/g
const KOREAN_SUFFIX = /^(?:[봇옷뽓벗]|보(?![여니면자이고다는세]))/
// "헤이" also comes back as 페이, 케이, 제이 or 데이 right before the core.
const KOREAN_MISHEARD_HEY = /[페케제데]이$/
// Tried in order, so "hey timer bot" is cut after "bot" before the bare "hey timer" fallback applies.
const ENGLISH_WAKES = [/timer ?(?:bot|bought)\b|\btime a bot\b|^(?:hey |a )?timer but\b/, /^hey timer\w*\b/]

export function compactKorean (text: string): string {
  return text.replace(/[\s\p{P}]/gu, '')
}

export function detectWake (text: string): WakeMatch | undefined {
  return detectKorean(compactKorean(text)) ?? detectEnglish(text)
}

function detectKorean (compact: string): WakeMatch | undefined {
  for (const match of compact.matchAll(KOREAN_CORE)) {
    const end = match.index + match[0].length
    const suffix = KOREAN_SUFFIX.exec(compact.slice(end))
    const before = compact.slice(Math.max(0, match.index - 3), match.index)
    const hasPrefix = before.includes('헤') || KOREAN_MISHEARD_HEY.test(before)
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
