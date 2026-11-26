export type Config = {
  discordToken: string
  appId: string
  devGuildId: string | undefined
  maxAlarms: number
  maxActiveGuilds: number
  audioLatencyMs: number
  modelDir: string
  dataDir: string
  debugDumpUsers: ReadonlySet<string>
  heartbeatUrl: URL | undefined
}

type Env = Readonly<Record<string, string | undefined>>

export class ConfigError extends Error {
  readonly keys: readonly string[]

  constructor (problems: ReadonlyArray<readonly [key: string, reason: string]>) {
    super(`Invalid configuration: ${problems.map(([key, reason]) => `${key} ${reason}`).join(', ')}`)
    this.name = 'ConfigError'
    this.keys = problems.map(([key]) => key)
  }
}

export function parseConfig (env: Env): Config {
  const problems: Array<[string, string]> = []

  const text = (key: string, fallback?: string): string => {
    const value = env[key]?.trim() || fallback
    if (value === undefined) {
      problems.push([key, 'is required'])
      return ''
    }
    return value
  }

  const optional = (key: string): string | undefined => env[key]?.trim() || undefined

  const integer = (key: string, fallback: number, min: number): number => {
    const raw = optional(key)
    if (raw === undefined) return fallback
    const value = Number(raw)
    if (!Number.isInteger(value) || value < min) {
      problems.push([key, `must be an integer >= ${min}`])
      return fallback
    }
    return value
  }

  const url = (key: string): URL | undefined => {
    const raw = optional(key)
    if (raw === undefined) return undefined
    if (!URL.canParse(raw)) {
      problems.push([key, 'must be a URL'])
      return undefined
    }
    return new URL(raw)
  }

  const config: Config = {
    discordToken: text('DISCORD_TOKEN'),
    appId: text('APP_ID'),
    devGuildId: optional('DEV_GUILD_ID'),
    maxAlarms: integer('MAX_ALARMS', 3, 1),
    maxActiveGuilds: integer('MAX_ACTIVE_GUILDS', 3, 1),
    audioLatencyMs: integer('AUDIO_LATENCY_MS', 0, 0),
    modelDir: text('MODEL_DIR', 'models/sense-voice'),
    dataDir: text('DATA_DIR', 'data'),
    debugDumpUsers: new Set((optional('DEBUG_DUMP_USERS') ?? '').split(',').map(id => id.trim()).filter(Boolean)),
    heartbeatUrl: url('HEARTBEAT_URL'),
  }

  if (problems.length > 0) throw new ConfigError(problems)
  return config
}

export function loadConfig (): Config {
  try {
    return parseConfig(process.env)
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error
    console.error(error.message)
    process.exit(1)
  }
}
