export type WakeMatch = { script: 'ko' | 'en'; rest: string }

const KOREAN_CORE = /타이?임?머/g
const KOREAN_SUFFIX = /^(?:[봇옷뽓벗]|보(?![여니면자이]))/
const ENGLISH_WAKE = /\b(?:timer ?bot|time a bot|timer but)\b/

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
    const hasPrefix = compact.slice(Math.max(0, match.index - 3), match.index).includes('헤')
    if (suffix || hasPrefix) return { script: 'ko', rest: compact.slice(end + (suffix?.[0].length ?? 0)) }
  }
  return undefined
}

function detectEnglish (text: string): WakeMatch | undefined {
  const normalized = text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim()
  const match = ENGLISH_WAKE.exec(normalized)
  return match ? { script: 'en', rest: normalized.slice(match.index + match[0].length).trim() } : undefined
}
