export type Lang = 'ko' | 'en'

export type Target = { by: 'next' } | { by: 'last' } | { by: 'index'; n: number } | { by: 'all' }

export type Alarm = { id: number; fireAt: number; lang: Lang }

export type CueKind = 'intro' | 'three' | 'two' | 'now'

export type Cue = { alarmId: number; kind: CueKind; at: number }

export type SchedulerResult = 'ok' | 'full' | 'tooShort' | 'tooLong' | 'conflict' | 'notFound'
