import { parseArgs } from 'node:util'
import { REST, Routes } from 'discord.js'
import { loadConfig } from '../src/config.ts'
import { COMMANDS } from '../src/discord/commands.ts'

const { values } = parseArgs({
  options: {
    guild: { type: 'boolean', default: false },
    global: { type: 'boolean', default: false },
    'clear-guild': { type: 'boolean', default: false },
  },
})

const chosen = [values.guild, values.global, values['clear-guild']].filter(Boolean).length
if (chosen !== 1) {
  console.error('Pass exactly one of --guild, --global, --clear-guild')
  process.exit(1)
}

const config = loadConfig()
const rest = new REST().setToken(config.discordToken)

if (values.global) {
  await rest.put(Routes.applicationCommands(config.appId), { body: COMMANDS })
  console.log(`registered ${COMMANDS.length} global commands`)
} else {
  if (!config.devGuildId) {
    console.error('DEV_GUILD_ID is required for --guild and --clear-guild')
    process.exit(1)
  }
  const body = values.guild ? COMMANDS : []
  await rest.put(Routes.applicationGuildCommands(config.appId, config.devGuildId), { body })
  console.log(`${values.guild ? 'registered' : 'cleared'} guild commands (${body.length})`)
}
