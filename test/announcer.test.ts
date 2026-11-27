import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { AudioPlayerStatus } from '@discordjs/voice'
import type { AudioPlayer, AudioResource } from '@discordjs/voice'
import { Announcer } from '../src/alarm/announcer.ts'
import { CLIP_KINDS, CUE_KINDS } from '../src/audio/clips.ts'
import type { Clip, ClipKind, ClipLibrary } from '../src/audio/clips.ts'
import type { CueKind, Lang } from '../src/alarm/types.ts'
import type { Reply } from '../src/voice/session.ts'

const CLIP_MS = { cue: 500, response: 1000 }

class FakePlayer extends EventEmitter {
  played: AudioResource[] = []
  status = AudioPlayerStatus.Idle
  play (resource: AudioResource) {
    this.played.push(resource)
    this.#set(AudioPlayerStatus.Playing)
  }

  stop () {
    this.#set(AudioPlayerStatus.Idle)
    return true
  }

  finish () {
    this.#set(AudioPlayerStatus.Idle)
  }

  #set (status: AudioPlayerStatus) {
    const before = { status: this.status }
    this.status = status
    this.emit('stateChange', before, { status })
  }
}

function clips (): ClipLibrary {
  const library = (lang: Lang) => {
    const byKind = {} as Record<ClipKind, Clip>
    for (const kind of CLIP_KINDS) {
      byKind[kind] = { kind, packets: [Buffer.from(`${lang}:${kind}`)], durationMs: CUE_KINDS.includes(kind as CueKind) ? CLIP_MS.cue : CLIP_MS.response }
    }
    return byKind
  }
  return { ko: library('ko'), en: library('en') }
}

function setup () {
  let now = 0
  let nextCue: number | undefined
  const player = new FakePlayer()
  const texts: string[] = []
  const announcer = new Announcer({
    player: player as unknown as AudioPlayer,
    clips: clips(),
    nextCueAt: () => nextCue,
    sendText: text => texts.push(text),
    log: () => {},
    now: () => now,
  })
  const names = new Map<AudioResource, Promise<string>>()
  const nameOf = (resource: AudioResource) => {
    if (!names.has(resource)) names.set(resource, resource.playStream.toArray().then(packets => String(packets[0])))
    return names.get(resource)!
  }
  const played = async () => Promise.all(player.played.map(nameOf))
  const settled = (promise: Promise<void>) => {
    let done = false
    promise.then(() => { done = true }, () => { done = true })
    return () => done
  }
  return {
    announcer,
    player,
    texts,
    played,
    settled,
    advance: (ms: number) => { now += ms },
    setNextCue: (at: number | undefined) => { nextCue = at },
  }
}

const reply = (kind: Reply['kind'], text: string = kind): Reply => ({ kind, lang: 'ko', text })
const cue = (kind: 'intro' | 'three' | 'two' | 'now', at = 0) => [{ alarmId: 1, kind, at }, { id: 1, fireAt: 3000, lang: 'ko' as const }] as const
const tick = () => new Promise(resolve => setImmediate(resolve))

test('a reply plays its clip, posts its text, and resolves when playback ends', async () => {
  const { announcer, player, texts, played, settled } = setup()
  const isDone = settled(announcer.respond(reply('ok', '2분 뒤 알람을 맞췄어요.')))
  assert.deepEqual(texts, ['2분 뒤 알람을 맞췄어요.'])
  assert.deepEqual(await played(), ['ko:ok'])
  await tick()
  assert.equal(isDone(), false)
  player.finish()
  await tick()
  assert.equal(isDone(), true)
})

test('a slash reply can skip the text and still play', async () => {
  const { announcer, texts, played } = setup()
  announcer.respond(reply('ok'), { text: false })
  assert.deepEqual(texts, [])
  assert.deepEqual(await played(), ['ko:ok'])
})

test('a reply that would still be playing at the next cue is text only', async () => {
  const { announcer, texts, played, settled, setNextCue } = setup()
  setNextCue(CLIP_MS.response + 100)
  const isDone = settled(announcer.respond(reply('ok', 'text')))
  await tick()
  assert.deepEqual(await played(), [])
  assert.deepEqual(texts, ['text'])
  assert.equal(isDone(), true)
})

test('a reply during a cue waits for the cue to finish, then plays', async () => {
  const { announcer, player, played, settled } = setup()
  announcer.cue(...cue('now'))
  const isDone = settled(announcer.respond(reply('ok')))
  assert.deepEqual(await played(), ['ko:now'])
  player.finish()
  assert.deepEqual(await played(), ['ko:now', 'ko:ok'])
  await tick()
  assert.equal(isDone(), false)
  player.finish()
  await tick()
  assert.equal(isDone(), true)
})

test('a newer reply replaces one still waiting behind a cue', async () => {
  const { announcer, player, played, settled } = setup()
  announcer.cue(...cue('now'))
  const older = settled(announcer.respond(reply('full')))
  announcer.respond(reply('ok'))
  await tick()
  assert.equal(older(), true)
  player.finish()
  assert.deepEqual(await played(), ['ko:now', 'ko:ok'])
})

test('a cue cuts off a reply that is playing', async () => {
  const { announcer, played, settled } = setup()
  const isDone = settled(announcer.respond(reply('ok')))
  announcer.cue(...cue('intro'))
  await tick()
  assert.equal(isDone(), true)
  assert.deepEqual(await played(), ['ko:ok', 'ko:intro'])
})

test('stop silences the player and settles both the playing and the waiting reply', async () => {
  const { announcer, player, played, settled } = setup()
  announcer.cue(...cue('now'))
  const waiting = settled(announcer.respond(reply('ok')))
  announcer.stop()
  await tick()
  assert.equal(waiting(), true)
  assert.equal(player.status, AudioPlayerStatus.Idle)
  assert.deepEqual(await played(), ['ko:now'])
})
