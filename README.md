# Timer Alarm

A Discord bot that sits in a voice channel and counts down your alarms. Say "헤이 타이머봇, 2분 알람" or "hey timer bot, two minutes alarm", and three seconds before the alarm it says "알람입니다, 3, 2, 지금!". Speech is recognized on the bot's own server with [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) and SenseVoice. No audio leaves the server.

## Voice commands

Start with the wake word ("헤이 타이머봇" / "hey timer bot"). If you only say the wake word, the bot answers and waits 5 seconds for the command.

| Intent | Korean | English |
| --- | --- | --- |
| Set | 2분 알람, 1분 30초 맞춰줘 | two minutes alarm, set a timer for 90 seconds |
| Later | 알람 10초 뒤로 밀어줘, 두 번째 알람 1분 늦춰줘 | push back 10 seconds, delay the second alarm 30 seconds |
| Earlier | 10초 당겨줘 | bring forward 20 seconds |
| Cancel | 두 번째 알람 꺼줘, 알람 다 꺼줘 | cancel all alarms |
| List | 얼마 남았어 | how long is left |

Each server can hold 3 alarms (`MAX_ALARMS`), at least 5 seconds away and at least 4 seconds apart so countdowns never overlap. The slash commands `/alarm set|shift|cancel|list` do the same without voice.

## Privacy

The bot only listens to people who opt in, per server, with the button on the `/join` message or `/voice on`. `/voice off` stops it. Audio and transcripts are never stored; the only stored data is the list of opted-in `server:user` IDs. `/privacy` shows the details in Discord. Users listed in `DEBUG_DUMP_USERS` have their utterances saved to `data/dumps/` for tuning; leave it empty in production.

## Setup

1. Create an application at <https://discord.com/developers/applications>, add a bot, and copy its token and the application ID. No privileged intents are needed.
2. Install Node 24 or later, then:

   ```sh
   npm ci
   cp .env.sample .env        # fill DISCORD_TOKEN, APP_ID, DEV_GUILD_ID
   npm run fetch-model        # 239 MB, checked by sha256
   ```

3. Voice clips are committed in `assets/voice/<lang>/<kind>.opusf`. They are synthesized with Supertonic 3; [assets/voice/SOURCE.md](assets/voice/SOURCE.md) explains how to regenerate them. `npm run check-clips` verifies them.
4. Register commands and run:

   ```sh
   npm run deploy-commands -- --guild   # development server only, instant
   npm run dev
   ```

Invite link permissions: View Channel, Connect, Speak, Send Messages, plus the `applications.commands` scope.

For a public launch, clear the development copy first so commands do not show twice, then register globally:

```sh
npm run deploy-commands -- --clear-guild
npm run deploy-commands -- --global
```

## Configuration

| Key | Default | Meaning |
| --- | --- | --- |
| `DISCORD_TOKEN`, `APP_ID` | required | Bot credentials |
| `DEV_GUILD_ID` | | Server for `deploy-commands --guild` |
| `MAX_ALARMS` | 3 | Alarms per server |
| `MAX_ACTIVE_GUILDS` | 3 | Voice connections at once; `/join` is refused above this |
| `AUDIO_LATENCY_MS` | 0 | Playback latency calibration |
| `MODEL_DIR` | `models/sense-voice` | SenseVoice files |
| `DATA_DIR` | `data` | Consent list and debug dumps |
| `DEBUG_DUMP_USERS` | | Comma-separated user IDs whose audio is dumped |
| `HEARTBEAT_URL` | | healthchecks.io ping URL, hit every 5 minutes |

## Deploying to Oracle Cloud Always Free

1. Sign up with Seoul or Chuncheon as the home region. Always Free instances only exist in the home region, and the home region cannot change.
2. Create a VM.Standard.A1.Flex instance (Ubuntu 24.04, aarch64) and check that the shape shows "Always Free-eligible". Open only SSH inbound.
3. Upgrade to Pay As You Go and set a $1 budget alert. Idle Always Free instances can be reclaimed (CPU, network and memory under 20% for 7 days); a reclaimed instance is only stopped, so start it again from the console.
4. Install Docker, run `sudo systemctl enable docker`, clone this repo, copy `.env`, then:

   ```sh
   docker compose up -d --build
   docker compose logs bot     # dependency report: opus, aes-256-gcm, davey
   ```

   Update with `git pull && docker compose up -d --build`.

Alarms and voice connections live in memory. A restart clears them; the consent list survives in the `bot-data` volume.

## Development

```sh
npm run lint && npm run typecheck && npm test
npm run stt-bench -- --threads 1 --runs 7          # decode timing per WAV
npm run stt-bench -- --via-pool --emit-fixtures    # Opus path through the worker pool
npm run load-test -- --guilds 1,4,8 --seconds 60   # four-player LoL scenario across N guilds
```

`test/fixtures/transcripts.jsonl` holds real model outputs with the expected wake word and intent. Lines the rules still get wrong are marked `knownMiss` with their current `actual` result, so any change in either direction fails a test.

## Capacity

`npm run load-test` replays `test/fixtures/lol`: four players talking over each other for a minute, 28 utterances per guild per minute, while every guild also fires a fake alarm cue each second. Results on the Always Free VM (A1.Flex, 2 OCPU, 12 GB), 60 s per run:

| Guilds | STT workers | Latency p95 | Dropped | Event loop lag p99 | Cue lateness max | Process CPU |
|---|---|---|---|---|---|---|
| 10 | 1 | 341 ms | 0% | 1.1 ms | 0.1 ms | 70% |
| 14 | 1 | 670 ms | 0% | 0.7 ms | 1.0 ms | 97% |
| 16 | 1 | 2119 ms | 7.6% | 0.6 ms | 0.7 ms | 100% |
| 24 | 2 | 433 ms | 0% | 1.2 ms | 1.4 ms | 176% |
| 28 | 2 | 2031 ms | 0.9% | 1.3 ms | 14.7 ms | 197% |

The limit is the single STT worker (decode p95 stays about 210 ms; waiting in the queue is what grows). The main thread stays idle in this test, but it does not include receiving and decrypting live Discord voice, so `MAX_ACTIVE_GUILDS` stays at 3 until that is measured with a real channel. CPU is a percentage of one core. The bot is unverified, so Discord limits it to 100 servers.

## Licenses

Code: MIT. The SenseVoice model is distributed under the [FunASR model license](https://github.com/modelscope/FunASR?tab=readme-ov-file#license). The bot's voice clips and the load-test audio are machine-generated with [Supertonic 3](https://huggingface.co/Supertone/supertonic-3) (OpenRAIL-M); see [assets/voice/SOURCE.md](assets/voice/SOURCE.md).
