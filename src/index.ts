import { startBot } from './bot.ts'
import { loadConfig } from './config.ts'

await startBot(loadConfig())
