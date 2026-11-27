import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ConfigError, parseConfig } from '../src/config.ts'

const base = { DISCORD_TOKEN: 'secret-token-value', APP_ID: '123' }

test('applies defaults when only required keys are set', () => {
  const config = parseConfig(base)
  assert.equal(config.maxAlarms, 3)
  assert.equal(config.maxActiveGuilds, 3)
  assert.equal(config.audioLatencyMs, 0)
  assert.equal(config.modelDir, 'models/sense-voice')
  assert.equal(config.dataDir, 'data')
  assert.equal(config.devGuildId, undefined)
  assert.equal(config.heartbeatUrl, undefined)
  assert.deepEqual([...config.debugDumpUsers], [])
})

test('missing required key names the key and leaks no other value', () => {
  const error = captureError(() => parseConfig({ DISCORD_TOKEN: base.DISCORD_TOKEN, APP_ID: ' ' }))
  assert.deepEqual(error.keys, ['APP_ID'])
  assert.match(error.message, /APP_ID/)
  assert.doesNotMatch(error.message, /secret-token-value/)
})

test('reports every missing key at once', () => {
  assert.deepEqual(captureError(() => parseConfig({})).keys, ['DISCORD_TOKEN', 'APP_ID'])
})

test('rejects non-integer and out-of-range numbers', () => {
  assert.deepEqual(captureError(() => parseConfig({ ...base, MAX_ALARMS: 'three' })).keys, ['MAX_ALARMS'])
  assert.deepEqual(captureError(() => parseConfig({ ...base, MAX_ACTIVE_GUILDS: '0' })).keys, ['MAX_ACTIVE_GUILDS'])
  assert.deepEqual(captureError(() => parseConfig({ ...base, AUDIO_LATENCY_MS: '1.5' })).keys, ['AUDIO_LATENCY_MS'])
})

test('accepts only plain decimal digits for integers', () => {
  assert.equal(parseConfig({ ...base, MAX_ALARMS: ' 5 ' }).maxAlarms, 5)
  assert.deepEqual(captureError(() => parseConfig({ ...base, MAX_ALARMS: '0x10' })).keys, ['MAX_ALARMS'])
  assert.deepEqual(captureError(() => parseConfig({ ...base, AUDIO_LATENCY_MS: '1e3' })).keys, ['AUDIO_LATENCY_MS'])
})

test('rejects a heartbeat URL that is not http or https', () => {
  assert.equal(parseConfig({ ...base, HEARTBEAT_URL: 'http://example.com/ping' }).heartbeatUrl?.protocol, 'http:')
  assert.deepEqual(captureError(() => parseConfig({ ...base, HEARTBEAT_URL: 'ftp://example.com/ping' })).keys, ['HEARTBEAT_URL'])
  assert.deepEqual(captureError(() => parseConfig({ ...base, HEARTBEAT_URL: 'file:///etc/passwd' })).keys, ['HEARTBEAT_URL'])
})

test('parses optional lists and URLs', () => {
  const config = parseConfig({ ...base, DEBUG_DUMP_USERS: ' 1, 2 ,,', HEARTBEAT_URL: 'https://hc-ping.com/abc' })
  assert.deepEqual([...config.debugDumpUsers], ['1', '2'])
  assert.equal(config.heartbeatUrl?.href, 'https://hc-ping.com/abc')
  assert.deepEqual(captureError(() => parseConfig({ ...base, HEARTBEAT_URL: 'not a url' })).keys, ['HEARTBEAT_URL'])
})

function captureError (fn: () => unknown): ConfigError {
  try {
    fn()
  } catch (error) {
    if (error instanceof ConfigError) return error
    throw error
  }
  assert.fail('expected ConfigError')
}
