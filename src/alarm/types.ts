export type Lang = 'ko' | 'en'

// index is the 1-based position in fireAt ascending order at command time.
export type Target = { by: 'next' } | { by: 'index'; n: number } | { by: 'all' }

// id is a per-guild increasing counter.
export type Alarm = { id: number; fireAt: number; lang: Lang }

export type CueKind = 'intro' | 'three' | 'two' | 'now'

export type Cue = { alarmId: number; kind: CueKind; at: number }

export type SchedulerResult = 'ok' | 'full' | 'tooShort' | 'conflict' | 'notFound'
