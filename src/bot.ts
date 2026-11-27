import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  PermissionFlagsBits,
} from 'discord.js'
import type { ButtonInteraction, ChatInputCommandInteraction, Guild, VoiceBasedChannel } from 'discord.js'
import {
  NoSubscriberBehavior,
  VoiceConnectionStatus,
  createAudioPlayer,
  entersState,
  generateDependencyReport,
  joinVoiceChannel,
} from '@discordjs/voice'
import type { VoiceConnection } from '@discordjs/voice'
import { Announcer, nextCueAt } from './alarm/announcer.ts'
import { AlarmScheduler, systemClock } from './alarm/scheduler.ts'
import type { Lang, Target } from './alarm/types.ts'
import { loadClips, packFrames } from './audio/clips.ts'
import type { Config } from './config.ts'
import { ConsentStore } from './consent.ts'
import { isIdle, joinRefusal, mayControl } from './discord/control.ts'
import type { BotChannel, Caller } from './discord/control.ts'
import { englishTokens, extractEnglishDuration, extractKoreanDuration } from './nlu/numbers.ts'
import type { Intent } from './nlu/parse-command.ts'
import { compactKorean } from './nlu/wake-word.ts'
import { SttPool, spawnSttWorker, workerCount } from './stt/pool.ts'
import type { Utterance } from './stt/types.ts'
import { startCapture } from './voice/capture.ts'
import { createSession } from './voice/session.ts'

const RECONNECT_MS = 5000
const ALONE_MS = 60_000
const HEARTBEAT_MS = 5 * 60_000
const IDLE_CHECK_MS = 60_000
const CONSENT_BUTTON = 'voice:on'

type GuildVoice = {
  connection: VoiceConnection
  channel: VoiceBasedChannel
  announcer: Announcer
  session: ReturnType<typeof createSession>
  stopCapture: () => void
  aloneTimer: ReturnType<typeof setTimeout> | undefined
  lastActivity: number
}

export async function startBot (config: Config): Promise<void> {
  console.log(generateDependencyReport())
  const consent = new ConsentStore(join(config.dataDir, 'consent.json'))
  const clips = loadClips('assets/voice')
  const spawn = () => spawnSttWorker(config.modelDir)
  const pool = new SttPool({
    workers: Array.from({ length: workerCount() }, spawn),
    respawn: () => {
      console.warn('an STT worker died; starting a new one')
      return spawn()
    },
    // Exit so the container restarts instead of staying up deaf.
    onNoWorkers: () => {
      console.error('STT workers keep dying; exiting so the container restarts')
      process.exit(1)
    },
  })
  const voices = new Map<string, GuildVoice>()
  /** Counted toward MAX_ACTIVE_GUILDS while /join connects. */
  const joining = new Set<string>()
  const touch = (guildId: string) => {
    const voice = voices.get(guildId)
    if (voice) voice.lastActivity = Date.now()
  }
  if (config.debugDumpUsers.size > 0) console.warn(`DEBUG_DUMP_USERS is set: utterances of ${config.debugDumpUsers.size} user(s) are saved to ${join(config.dataDir, 'dumps')}`)
  const scheduler = new AlarmScheduler({
    maxAlarms: config.maxAlarms,
    clock: { ...systemClock, setTimeout: (fn, ms) => systemClock.setTimeout(fn, Math.max(0, ms - config.audioLatencyMs)) },
    onCue: (guildId, cue, alarm) => {
      touch(guildId)
      voices.get(guildId)?.announcer.cue(cue, alarm)
    },
  })
  const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] })

  const say = (channel: VoiceBasedChannel, text: string) => {
    channel.send(text).catch(error => console.warn(`text reply failed in ${channel.guild.id}: ${error}`))
  }

  const leave = (guildId: string, notice?: string) => {
    const voice = voices.get(guildId)
    if (!voice) return
    voices.delete(guildId)
    clearTimeout(voice.aloneTimer)
    voice.stopCapture()
    voice.announcer.stop()
    scheduler.clear(guildId)
    if (voice.connection.state.status !== VoiceConnectionStatus.Destroyed) voice.connection.destroy()
    if (notice) say(voice.channel, notice)
  }

  const dump = (utterance: Utterance) => {
    if (!config.debugDumpUsers.has(utterance.userId)) return
    const dir = join(config.dataDir, 'dumps')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, `${utterance.guildId}-${utterance.userId}-${utterance.endedAt}.opusf`), packFrames(utterance.packets))
  }

  const connect = async (guild: Guild, channel: VoiceBasedChannel): Promise<void> => {
    const connection = joinVoiceChannel({ channelId: channel.id, guildId: guild.id, adapterCreator: guild.voiceAdapterCreator, selfDeaf: false })
    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 20_000)
    } catch (error) {
      connection.destroy()
      throw error
    }
    const player = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Play } })
    connection.subscribe(player)
    const announcer = new Announcer({
      player,
      clips,
      nextCueAt: () => nextCueAt(scheduler.list(guild.id), Date.now()),
      sendText: text => say(voices.get(guild.id)?.channel ?? channel, text),
      log: message => console.log(`[${guild.id}] ${message}`),
    })
    const session = createSession({
      guildId: guild.id,
      scheduler,
      respond: reply => {
        touch(guild.id)
        return announcer.respond(reply)
      },
      now: Date.now,
    })
    const isCurrent = () => voices.get(guild.id)?.connection === connection
    const stopCapture = startCapture({
      guildId: guild.id,
      receiver: connection.receiver,
      shouldListen: userId => consent.has(guild.id, userId) && !guild.members.cache.get(userId)?.user.bot,
      onUtterance: utterance => {
        dump(utterance)
        pool.transcribe(utterance)
          // The bot may have left or rejoined while this utterance was queued or decoding.
          .then(transcript => transcript && voices.get(guild.id)?.session === session ? session.onTranscript(transcript) : undefined)
          .catch(error => console.error(`[${guild.id}] transcription failed`, error))
      },
    })
    connection.on(VoiceConnectionStatus.Disconnected, () => {
      Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, RECONNECT_MS),
        entersState(connection, VoiceConnectionStatus.Connecting, RECONNECT_MS),
      ]).catch(() => {
        if (isCurrent()) leave(guild.id, '음성 연결이 끊겨서 알람을 지웠어요. / Voice connection lost, alarms cleared.')
      })
    })
    connection.on(VoiceConnectionStatus.Destroyed, () => {
      if (isCurrent()) leave(guild.id)
    })
    voices.set(guild.id, { connection, channel, announcer, session, stopCapture, aloneTimer: undefined, lastActivity: Date.now() })
  }

  const onJoin = async (interaction: ChatInputCommandInteraction<'cached'>) => {
    const channel = interaction.member.voice.channel
    if (!channel) return interaction.reply({ content: text(interaction, '먼저 음성 채널에 들어가 주세요.', 'Join a voice channel first.'), flags: MessageFlags.Ephemeral })
    const current = voices.get(interaction.guildId)
    const refusal = joinRefusal({
      targetId: channel.id,
      current: current && botChannel(current.channel),
      caller: callerOf(interaction, current?.channel),
      joining: joining.has(interaction.guildId),
      active: voices.size + joining.size,
      maxActive: config.maxActiveGuilds,
    })
    if (refusal) {
      const where = current?.channel.name ?? ''
      const messages = {
        joining: text(interaction, '지금 들어가는 중이에요.', 'Already joining.'),
        alreadyHere: text(interaction, '이미 이 채널에 있어요.', 'Already here.'),
        inUse: text(interaction, `${where}에서 쓰는 중이에요. 그 채널에서 /leave 하거나 멤버 이동 권한이 있어야 옮길 수 있어요.`, `In use in ${where}. Use /leave there, or you need the Move Members permission.`),
        noSlot: text(interaction, '지금은 자리가 없어요. 잠시 뒤에 다시 시도해 주세요.', 'No free slot right now. Please try again later.'),
      }
      return interaction.reply({ content: messages[refusal], flags: MessageFlags.Ephemeral })
    }
    joining.add(interaction.guildId)
    try {
      await interaction.deferReply()
      if (current) leave(interaction.guildId)
      await connect(interaction.guild, channel)
    } finally {
      joining.delete(interaction.guildId)
    }
    const button = new ButtonBuilder().setCustomId(CONSENT_BUTTON).setLabel('음성 명령 켜기 / Enable voice commands').setStyle(ButtonStyle.Primary)
    await interaction.editReply({
      content: [
        `🔔 ${channel.name}에 들어왔어요. "헤이 타이머봇, 2분 알람"처럼 말하면 알람 3초 전부터 카운트다운해요.`,
        '음성은 버튼을 누른 사람 것만 듣고, 봇 서버 안에서 인식한 뒤 버려요. 자세한 내용은 /privacy.',
        `Joined ${channel.name}. Say "hey timer bot, two minutes alarm". Only people who press the button are heard; audio is recognized on the bot server and discarded. See /privacy.`,
      ].join('\n'),
      components: [new ActionRowBuilder<ButtonBuilder>().addComponents(button)],
    })
  }

  const onAlarm = async (interaction: ChatInputCommandInteraction<'cached'>) => {
    const voice = voices.get(interaction.guildId)
    if (!voice) return interaction.reply({ content: text(interaction, '먼저 /join 으로 봇을 음성 채널에 불러 주세요.', 'Use /join first.'), flags: MessageFlags.Ephemeral })
    if (interaction.options.getSubcommand() !== 'list' && !mayControl(callerOf(interaction, voice.channel), botChannel(voice.channel))) {
      return interaction.reply({ content: text(interaction, `${voice.channel.name} 음성 채널에 들어와서 써 주세요.`, `Join ${voice.channel.name} to change its alarms.`), flags: MessageFlags.Ephemeral })
    }
    const intent = slashIntent(interaction)
    if (!intent) return interaction.reply({ content: text(interaction, '시간을 이해하지 못했어요. 예: 2분, 1분 30초', 'Could not read the time. e.g. 2 minutes, 90 seconds'), flags: MessageFlags.Ephemeral })
    const reply = voice.session.execute(intent, langOf(interaction), Date.now())
    if (reply.kind === 'ok' && intent.kind !== 'list') touch(interaction.guildId)
    await interaction.reply(reply.text)
    voice.announcer.respond(reply, { text: false }).catch(() => {})
  }

  const onLeave = async (interaction: ChatInputCommandInteraction<'cached'>) => {
    const voice = voices.get(interaction.guildId)
    if (!voice) return interaction.reply({ content: text(interaction, '음성 채널에 있지 않아요.', 'Not in a voice channel.'), flags: MessageFlags.Ephemeral })
    if (!mayControl(callerOf(interaction, voice.channel), botChannel(voice.channel))) {
      return interaction.reply({ content: text(interaction, `${voice.channel.name} 음성 채널에 들어와서 써 주세요.`, `Join ${voice.channel.name} to make the bot leave.`), flags: MessageFlags.Ephemeral })
    }
    leave(interaction.guildId)
    await interaction.reply({ content: text(interaction, '나갔어요. 알람도 지웠어요.', 'Left and cleared alarms.') })
  }

  const onVoice = async (interaction: ChatInputCommandInteraction<'cached'> | ButtonInteraction<'cached'>, on: boolean) => {
    consent.set(interaction.guildId, interaction.user.id, on)
    await interaction.reply({
      content: on
        ? text(interaction, '음성 명령을 켰어요. /voice off 로 언제든 끌 수 있어요.', 'Voice commands on. Use /voice off any time.')
        : text(interaction, '음성 명령을 껐어요. 더 이상 듣지 않아요.', 'Voice commands off. The bot no longer listens to you.'),
      flags: MessageFlags.Ephemeral,
    })
  }

  client.on(Events.InteractionCreate, async interaction => {
    try {
      if (!interaction.inCachedGuild()) return
      if (interaction.isButton() && interaction.customId === CONSENT_BUTTON) return await onVoice(interaction, true)
      if (!interaction.isChatInputCommand()) return
      switch (interaction.commandName) {
        case 'join': return await onJoin(interaction)
        case 'leave': return await onLeave(interaction)
        case 'alarm': return await onAlarm(interaction)
        case 'voice': return await onVoice(interaction, interaction.options.getSubcommand() === 'on')
        case 'privacy': return await interaction.reply({ content: PRIVACY, flags: MessageFlags.Ephemeral })
      }
    } catch (error) {
      console.error('interaction failed', error)
      if (interaction.isRepliable() && !interaction.replied) {
        const content = 'Something went wrong.'
        await (interaction.deferred ? interaction.editReply({ content }) : interaction.reply({ content, flags: MessageFlags.Ephemeral })).catch(() => {})
      }
    }
  })

  client.on(Events.VoiceStateUpdate, (before, after) => {
    const voice = voices.get(after.guild.id)
    if (!voice) return
    if (after.id === client.user?.id && after.channel && after.channelId !== voice.channel.id) voice.channel = after.channel
    if (before.channelId !== voice.channel.id && after.channelId !== voice.channel.id) return
    if (botChannel(voice.channel).humans > 0) {
      clearTimeout(voice.aloneTimer)
      voice.aloneTimer = undefined
    } else {
      voice.aloneTimer ??= setTimeout(() => leave(after.guild.id, '아무도 없어서 나갔어요. / Left because the channel was empty.'), ALONE_MS)
    }
  })

  setInterval(() => {
    for (const [guildId, voice] of voices) {
      if (isIdle(scheduler.list(guildId).length, voice.lastActivity, Date.now())) {
        leave(guildId, '30분 동안 알람이 없어서 나갔어요. 필요하면 /join 해 주세요. / Left after 30 minutes without alarms; use /join again any time.')
      }
    }
  }, IDLE_CHECK_MS).unref()

  if (config.heartbeatUrl) {
    const url = config.heartbeatUrl
    const beat = () => { fetch(url, { signal: AbortSignal.timeout(10_000) }).catch(error => console.warn(`heartbeat failed: ${error}`)) }
    client.once(Events.ClientReady, () => {
      beat()
      setInterval(beat, HEARTBEAT_MS).unref()
    })
  }

  const shutdown = async () => {
    for (const guildId of [...voices.keys()]) leave(guildId)
    await pool.close()
    await client.destroy()
    process.exit(0)
  }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)

  client.once(Events.ClientReady, ready => console.log(`logged in as ${ready.user.tag}, ${workerCount()} STT workers`))
  await client.login(config.discordToken)
}

function botChannel (channel: VoiceBasedChannel): BotChannel {
  return { id: channel.id, humans: channel.members.filter(member => !member.user.bot).size }
}

function callerOf (interaction: ChatInputCommandInteraction<'cached'>, botVoice: VoiceBasedChannel | undefined): Caller {
  return {
    channelId: interaction.member.voice.channelId,
    canMoveMembers: botVoice?.permissionsFor(interaction.member).has(PermissionFlagsBits.MoveMembers) ?? false,
  }
}

function langOf (interaction: { locale: string }): Lang {
  return interaction.locale.startsWith('ko') ? 'ko' : 'en'
}

function text (interaction: { locale: string }, ko: string, en: string): string {
  return langOf(interaction) === 'ko' ? ko : en
}

function parseDuration (input: string): number | undefined {
  return extractKoreanDuration(compactKorean(input))?.ms ?? extractEnglishDuration(englishTokens(input))?.ms
}

function slashTarget (value: string | null): Target {
  if (value === 'all') return { by: 'all' }
  if (value === 'last') return { by: 'last' }
  if (value === '1' || value === '2' || value === '3') return { by: 'index', n: Number(value) }
  return { by: 'next' }
}

function slashIntent (interaction: ChatInputCommandInteraction<'cached'>): Intent | undefined {
  const options = interaction.options
  switch (options.getSubcommand()) {
    case 'set': {
      const ms = parseDuration(options.getString('time', true))
      return ms ? { kind: 'set', ms } : undefined
    }
    case 'shift': {
      const amount = options.getString('amount', true).trim()
      const ms = parseDuration(amount)
      return ms ? { kind: 'shift', deltaMs: amount.startsWith('-') ? -ms : ms, target: slashTarget(options.getString('target')) } : undefined
    }
    case 'cancel': return { kind: 'cancel', target: slashTarget(options.getString('target')) }
    default: return { kind: 'list' }
  }
}

const PRIVACY = [
  '**음성 처리 방식**',
  '- 음성은 "음성 명령 켜기" 버튼이나 `/voice on`으로 동의한 사람 것만 듣습니다. 동의는 서버별이고 `/voice off`로 언제든 끕니다.',
  '- 들은 음성은 봇 서버 안에서 바로 문자로 바꾸고(외부 API 없음) 명령만 처리한 뒤 버립니다. 음성과 문자 모두 저장하지 않습니다.',
  '- 저장하는 것은 동의한 사용자 ID 목록뿐입니다.',
  '- 예외: 운영자가 인식 품질을 조정할 때, 설정에 직접 적은 테스트 사용자의 발화만 파일로 저장합니다. 공개 운영에서는 비워 둡니다.',
  '- 봇의 목소리는 Supertonic 3 음성 합성으로 만든 기계 음성입니다.',
  '',
  '**How your voice is handled**',
  '- Only people who opted in (button or `/voice on`) are heard. Opt-in is per server; `/voice off` stops it.',
  '- Audio is transcribed on the bot server (no external API), used for the command, then discarded. Neither audio nor text is stored.',
  '- The only stored data is the list of opted-in user IDs.',
  '- Exception: while tuning recognition, the operator may save utterances of test users listed in the bot settings. It is empty in public operation.',
  "- The bot's voice is machine-generated with Supertonic 3 speech synthesis.",
].join('\n')
