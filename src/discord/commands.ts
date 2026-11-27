import { SlashCommandBuilder } from 'discord.js'
import type { SlashCommandStringOption } from 'discord.js'

const target = (option: SlashCommandStringOption) => option
  .setName('target')
  .setDescription('Which alarm (default: the next one)')
  .setDescriptionLocalizations({ ko: '어느 알람 (기본: 가장 빠른 알람)' })
  .addChoices(
    { name: 'next', value: 'next', name_localizations: { ko: '다음' } },
    { name: '1', value: '1' },
    { name: '2', value: '2' },
    { name: '3', value: '3' },
    { name: 'last', value: 'last', name_localizations: { ko: '마지막' } },
    { name: 'all', value: 'all', name_localizations: { ko: '전부' } }
  )

export const COMMANDS = [
  new SlashCommandBuilder()
    .setName('join')
    .setDescription('Join your voice channel and listen for alarm commands')
    .setDescriptionLocalizations({ ko: '내 음성 채널에 들어와 알람 명령을 듣기' }),
  new SlashCommandBuilder()
    .setName('leave')
    .setDescription('Leave the voice channel and clear alarms')
    .setDescriptionLocalizations({ ko: '음성 채널에서 나가고 알람 지우기' }),
  new SlashCommandBuilder()
    .setName('alarm')
    .setDescription('Manage alarms')
    .setDescriptionLocalizations({ ko: '알람 관리' })
    .addSubcommand(sub => sub
      .setName('set')
      .setDescription('Set an alarm')
      .setDescriptionLocalizations({ ko: '알람 맞추기' })
      .addStringOption(option => option.setName('time').setDescription('e.g. 2분, 1분 30초, 90 seconds').setRequired(true)))
    .addSubcommand(sub => sub
      .setName('shift')
      .setDescription('Move an alarm later (or earlier with a minus sign)')
      .setDescriptionLocalizations({ ko: '알람 늦추기 (앞에 -를 붙이면 당기기)' })
      .addStringOption(option => option.setName('amount').setDescription('e.g. 10초, -30초, 1 minute').setRequired(true))
      .addStringOption(target))
    .addSubcommand(sub => sub
      .setName('cancel')
      .setDescription('Cancel an alarm')
      .setDescriptionLocalizations({ ko: '알람 끄기' })
      .addStringOption(target))
    .addSubcommand(sub => sub
      .setName('list')
      .setDescription('Show remaining time')
      .setDescriptionLocalizations({ ko: '남은 시간 보기' })),
  new SlashCommandBuilder()
    .setName('voice')
    .setDescription('Turn voice commands on or off for you in this server')
    .setDescriptionLocalizations({ ko: '이 서버에서 내 음성 명령 켜기/끄기' })
    .addSubcommand(sub => sub.setName('on').setDescription('Let the bot listen to you').setDescriptionLocalizations({ ko: '봇이 내 음성을 듣게 하기' }))
    .addSubcommand(sub => sub.setName('off').setDescription('Stop listening to you').setDescriptionLocalizations({ ko: '내 음성 듣지 않기' })),
  new SlashCommandBuilder()
    .setName('privacy')
    .setDescription('How the bot handles your voice')
    .setDescriptionLocalizations({ ko: '음성 처리 방식 안내' }),
].map(command => command.toJSON())
