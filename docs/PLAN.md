# 타이머봇 계획 v4 (sherpa-onnx 로컬 STT, Oracle Always Free)

목표. 음성 채널에서 "헤이 타이머봇, 2분 알람" 같은 한국어와 영어 명령을 듣고, 알람 3초 전부터 "알람입니다, 3, 2, 지금"을 말해 주는 Discord 봇을 운영비 0원으로 공개 서비스한다. 알람은 길드당 최대 3개이고, "10초 뒤로 밀어줘" 같은 수정 명령을 받는다.

## 1. 현재 상태와 전제

- 저장소(HEAD 3fe8989)는 Discord HTTP 인터랙션 예제다. `app.js`는 Express `POST /interactions` 웹훅이라 음성을 받을 수 없다. `commands.js`, `game.js`, `examples/`는 가위바위보 예제다. 전부 지우고 Gateway 봇으로 새로 짠다.
- 음성은 DAVE(E2EE)가 필수다(2026-03-01부터). `@discordjs/voice` 0.19.2 이상은 davey를 기본 의존성으로 설치하고 수신 패킷도 복호화한다.
- STT는 sherpa-onnx SenseVoice 다국어 원본 모델 `sense-voice-zh-en-ja-ko-yue-2024-07-17`의 int8 파일이다. 같은 이름의 `int8-2025-09-09`는 광둥어 전용 파인튜닝이라 한국어를 못 읽는다(프로토타입에서 확인).
- 프로토타입 측정(i5-12600K, SAPI 합성 음성, 버리는 코드는 scratchpad/stt-proto). 3~4초 발화 1스레드 디코딩 약 200~270ms, 8.2초 발화 512ms로 길이에 거의 선형. worker 2개 실행 중 메인 루프 최대 지연 20.8~22.4ms. RSS 386MB. 이 숫자는 x64 값이고 ARM 용량은 Step 9와 Step 14에서 VM에서 잰다.
- Opus 경로 프로토타입(측정). SAPI WAV를 48kHz stereo Opus 패킷으로 인코딩하고, worker 안에서 `@discordjs/opus`의 `OpusEncoder(16000, 1)`로 16kHz mono로 바로 디코딩해 sherpa에 넣었다. WAV 직결 1스레드 출력과 비교하면 원문 기준 10개 중 4개가 달랐고(en1 `timerbot`이 `timer bot`, en4 쉼표, ko3 `1 분`이 `1푼`, ko4 `타이임머`가 `타이임머봇`), 공백과 문장부호를 지운 뒤에도 2개(ko3, ko4)가 달랐다. 압축만으로 출력이 흔들린다는 증거라서 코퍼스에 Opus 경로 출력을 별도 모드로 넣는다. 디코딩과 인식을 합쳐 발화당 188~373ms였다.
- 모델 출력 특성. `lang`은 `<|ko|>`, `<|en|>` 형태다. 한국어 띄어쓰기가 불규칙하다(`남 았 어`). 웨이크워드가 `타이임머봇`, `타임머옷`, `타이임머`, `헤 타이임머`로 흔들린다. 영어 숫자는 `two`와 `10`이 섞인다.

## 2. 설계

### 2.1 데이터 구조

```ts
type Lang = 'ko' | 'en'
type Utterance = { guildId: string; userId: string; packets: Buffer[]; endedAt: number }  // Opus 패킷 20ms 단위, 20~400개(0.4~8초)
type Transcript = { utterance: Utterance; text: string; lang: Lang | 'other'; decodeMs: number }
type Intent =
  | { kind: 'set'; ms: number }
  | { kind: 'shift'; deltaMs: number; target: Target }
  | { kind: 'cancel'; target: Target }
  | { kind: 'list' }
  | { kind: 'unknown' }
type Target = { by: 'next' } | { by: 'index'; n: number } | { by: 'all' }   // index는 명령 시점의 fireAt 오름차순 1부터
type Alarm = { id: number; fireAt: number; lang: Lang }                       // id는 길드별 증가 카운터
type Cue = { alarmId: number; kind: 'intro' | 'three' | 'two' | 'now'; at: number }
type SchedulerResult = 'ok' | 'full' | 'tooShort' | 'conflict' | 'notFound'
```

### 2.2 흐름

```
receiver(Opus 패킷, 메인 스레드는 모으기만 함)
  → Utterance → pool(worker × N) [worker 안에서 Opus를 16kHz mono로 디코딩하고 sherpa 인식]
  → Transcript → wakeWord → parseCommand → AlarmScheduler(순수) → Cue/응답
  → Announcer(우선순위 재생 큐, 미리 인코딩한 Opus 프레임 클립) + 음성 채널 텍스트 채팅
```

- 메인 스레드는 Discord 이벤트, 타이머, 패킷 수집만 한다. Opus 디코딩도 worker로 보낸다. Opus 디코더는 출력 샘플레이트를 고를 수 있어서 `OpusEncoder(16000, 1)`로 바로 16kHz mono를 얻는다. 리샘플링 코드가 없다.
- 알람 클립은 개발 PC에서 미리 Opus 프레임으로 인코딩해 둔다. 재생은 `StreamType.Opus`라 런타임 인코딩이 없다.
- `N = max(1, os.availableParallelism() - 1)`. 2코어 VM이면 worker 1개다. 메인 스레드 몫으로 코어 하나를 남긴다.
- 발화 길이는 패킷 수로 잰다(1패킷 20ms). 20개 미만은 버린다. 400개(8초)에 닿으면 그 지점에서 Utterance를 끊어 보내고, 같은 구독에서 이어지는 패킷은 새 Utterance로 모은다. 8초 상한의 근거는 8.2초 디코딩 512ms 측정값이다.
- 알람 기준 시각은 `endedAt`(마지막 패킷 수신 시각)이다. 인식 지연이 알람 시각을 밀지 않는다.

### 2.3 규칙

- **동의(opt-in).** 음성 처리는 동의한 사용자만 한다. `/join` 메시지에 "음성 명령 켜기" 버튼을 두고, `/voice on|off`로도 바꾼다. 동의는 길드별이다. 한 서버에서 켠 동의가 다른 서버로 번지지 않는다. 동의 목록은 `guildId:userId` 문자열 집합을 JSON 파일에 저장한다(임시 파일에 쓰고 rename). 동의하지 않은 사용자는 구독조차 하지 않는다. 그래서 CPU도 아낀다. 오디오와 transcript는 저장하지 않는다. 예외는 Step 11의 디버그 덤프이고, 지정한 테스트 사용자만 대상이다.
- **스케줄러.**
  - 길드당 최대 `MAX_ALARMS`(3)개. 넘으면 `full`.
  - 남은 시간이 5초 미만이 되는 set과 shift는 `tooShort`로 거절하고 원래 알람을 그대로 둔다.
  - 다른 알람과 fireAt 차이가 4초 미만이 되는 set과 shift는 `conflict`로 거절한다. 카운트다운 두 개가 겹치지 않게 하려는 것이다. `all` shift는 모든 알람을 같은 양만큼 옮기므로 간격이 유지된다. 대상이 여럿인 shift(`all`)는 원자적이다. 하나라도 `tooShort`가 되면 전부 거절하고 아무것도 바꾸지 않는다.
  - cue는 fireAt 기준 −3, −2, −1, 0초. 매번 `fireAt - now`로 절대시각을 다시 계산한다. shift하면 남은 cue를 취소하고 새로 예약하며, 이미 지난 시각의 cue는 건너뛴다. cancel하면 그 알람의 남은 cue를 모두 취소한다. now cue를 낸 알람은 지운다.
- **Announcer.** 길드당 AudioPlayer 하나에 우선순위 큐를 두고, 재생 결정은 순수 함수 `decide(playing, incoming, nextCueAt, now)`로 분리한다. 규칙은 세 가지다.
  - cue가 응답 클립(ok, full, tooShort, conflict, notFound, unknown)보다 우선하고, 재생 중인 응답 클립을 끊는다.
  - 새 cue는 재생 중인 cue를 끊는다. cue 클립은 전부 850ms 이하이고 `silencePaddingFrames: 0`으로 만들어서 정상이면 겹치지 않는다. 끊는 규칙은 지연이 생겼을 때 now가 밀리지 않게 하려는 것이다.
  - 응답 클립은 다음 cue까지 남은 시간이 클립 길이 + 200ms보다 짧으면 음성은 생략하고 텍스트만 보낸다.
- **세션.**
  - 웨이크워드만 들리면 ok 클립을 내고, 그 사용자(guildId+userId 단위)의 다음 발화를 웨이크워드 없이 명령으로 받는다. 대기 창은 ok 클립 재생이 끝난 시점(음성을 생략했으면 웨이크워드 Utterance의 `endedAt`)부터 5초이고, 판정 기준은 발화가 이 창 안에서 시작했는지다. 끝난 시각은 보지 않으므로 긴 명령도 잘리지 않는다.
  - pool이 2초 대기로 버린 발화는 아직 인식 전이라 명령인지 알 수 없다. 사용자 피드백은 하지 않고 카운트만 남긴다. 버림 비율 5%는 Step 14에서 용량 문제로 다룬다.
  - 웨이크워드 뒤 명령을 해석하지 못하면 unknown 클립을 낸다. 오탐 웨이크워드율을 Step 11에서 재서 시간당 1회를 넘으면 unknown은 텍스트만 보내도록 바꾼다.
  - 텍스트 응답은 봇이 들어간 음성 채널의 내장 텍스트 채팅으로 보낸다. 전송에 실패해도 음성 응답은 계속한다.
  - 응답 언어는 `lang` 태그를 벗긴 값이다. `'other'`면 ko로 응답한다.
- **연결.** VoiceConnection이 Disconnected가 되면 5초 안에 Signalling 또는 Connecting 상태로 돌아오는지 기다린다(discord.js 표준 패턴). 돌아오지 않으면 연결을 없애고, 그 길드의 알람을 지우고, 텍스트로 알린다. 채널에 봇만 남고 60초가 지나면 나간다. 프로세스가 재시작되면 알람과 연결은 사라진다. 이 동작은 README에 적는다.
- **용량.** 활성 음성 연결이 `MAX_ACTIVE_GUILDS`에 닿으면 `/join`은 "지금은 자리가 없어요. 잠시 뒤에 다시 시도해 주세요"로 거절한다. pool 대기열에서 2초 넘게 기다린 Utterance는 버리고 카운트한다.
- **명령 등록.** `npm run deploy-commands -- --guild`는 개발 길드에, `-- --global`은 전역에 등록한다. `--clear-guild`는 개발 길드 명령을 지운다. 전역 등록 전에 실행해서 개발 길드에 명령이 두 번 보이지 않게 한다. 봇 시작과 등록을 분리한다.
- **생존 감시.** 봇은 5분마다 healthchecks.io 무료 체크 URL에 빈 GET을 보낸다(`HEARTBEAT_URL`, 비어 있으면 끔). 사용자 데이터는 보내지 않는다. 15분 동안 신호가 없으면 메일 알림이 온다. VM에서 Docker 서비스를 enable해 두면 재부팅 후 compose가 `restart: unless-stopped`로 다시 뜬다.

## 3. 실행·검증 체크리스트

### Phase 0. 인프라

- [ ] **Step 0. Oracle Cloud 가입과 A1 VM.** 가입할 때 홈 리전을 춘천이나 서울로 정한다. Always Free 인스턴스는 홈 리전에서만 만들 수 있고 홈 리전은 바꿀 수 없다. 서울과 춘천은 가용 도메인이 1개라 A1 용량이 없으면 1 OCPU/6GB로 줄이거나 시간을 두고 다시 시도하는 수밖에 없다. 다른 리전에는 절대 만들지 않는다. Ubuntu 24.04 aarch64, 인바운드는 SSH만 연다. 기본 결정은 PAYG 업그레이드와 $1 예산 알림이다. 유휴 회수 기준(7일간 CPU p95, 네트워크, 메모리가 모두 20% 미만)에 대기 중인 봇이 걸릴 수 있기 때문이다. PAYG가 회수를 면제한다는 문서가 없어도 이 결정은 유지한다. 회수되면 인스턴스가 정지될 뿐 부트 볼륨은 남으므로 콘솔에서 다시 시작하는 절차를 README에 적는다. Docker 서비스를 enable한다.
  - ➔ **Verify**: 콘솔에서 인스턴스 shape에 "Always Free-eligible" 표시가 있다. `ssh vm 'uname -m && nproc && free -g'`가 aarch64를 출력한다. 생성 24시간 뒤 Billing이 $0.00이다. `systemctl is-enabled docker`가 enabled다. PAYG 면제 여부 조사 결과(문서 링크 또는 "명시 없음")를 README에 적는다.

### Phase 1. 정리와 순수 코어

- [ ] **Step 1. 레거시 삭제와 툴체인.** `app.js`, `commands.js`, `game.js`, `utils.js`, `examples/`, `.glitch-assets`, `shrinkwrap.yaml`, `.eslintrc`를 지운다. 의존성 `express`, `discord-interactions`, `node-fetch`, `dotenv`, `nodemon`, `eslint-config-standard`, `eslint-plugin-import`, `eslint-plugin-n`, `eslint-plugin-promise`를 지운다. `discord.js@^14`, `@discordjs/voice@^0.19.2`, `@discordjs/opus@^0.11`, `sherpa-onnx-node@2.0.3`, `typescript`, `@types/node`, `eslint@^9.22`, `neostandard`를 추가한다. `engines.node`는 `>=24`. `eslint.config.js`(neostandard, ts 켬). `tsconfig.json`은 `noEmit`, `strict`, `erasableSyntaxOnly`, `allowImportingTsExtensions`, `verbatimModuleSyntax`, `module: nodenext`. `.gitignore`에 `models/`, `data/`를 추가한다. 스크립트는 `start`(`node src/index.ts`, 환경변수는 셸이나 compose가 주입), `dev`(`node --env-file=.env --watch src/index.ts`), `test`(`node --test`), `typecheck`, `lint`, `deploy-commands`, `fetch-model`, `encode-clips`, `stt-bench`, `load-test`.
  - ➔ **Verify**: `npm ci && npm run lint && npm run typecheck && npm test`가 통과한다(빈 테스트 1개 포함). `git ls-files | grep -E "app.js|examples/|eslintrc"` 결과가 없다.
- [ ] **Step 2. `src/config.ts`, `.env.sample`.** `DISCORD_TOKEN`, `APP_ID`, `DEV_GUILD_ID`, `MAX_ALARMS=3`, `MAX_ACTIVE_GUILDS=3`(Step 14에서 실측값으로 바꿈), `AUDIO_LATENCY_MS=0`(Step 8에서 보정), `MODEL_DIR=models/sense-voice`, `DATA_DIR=data`, `DEBUG_DUMP_USERS`(빈 값이 기본), `HEARTBEAT_URL`(빈 값이 기본)을 받는다. 필수 값이 없으면 키 이름을 출력하고 종료한다.
  - ➔ **Verify**: `test/config.test.ts`. 필수 키 누락 시 오류 메시지에 키 이름은 있고 다른 키의 값은 없다. 숫자 키에 문자열을 넣으면 거절한다.
- [ ] **Step 3. `scripts/stt-bench.ts`, `test/fixtures/transcripts.jsonl`.** 프로토타입의 bench, lang 스크립트를 하나로 합쳐 저장소에 넣는다. 입력 WAV 목록에 대해 `numThreads`, 반복 횟수, 언어 모드(자동, ko 강제)별로 텍스트, lang, 디코딩 중앙값과 범위를 출력하고, `--emit-fixtures`로 `{ file, mode, text, lang }` 줄을 코퍼스에 추가한다. 프로토타입 WAV 10개(SAPI, `test/fixtures/wav/`에 커밋, 개당 약 110KB)와 두 모드의 출력 20줄로 코퍼스를 시작한다. 줄마다 사람이 `expected: { wake, intent }`(말한 내용 기준의 참값)를 채운다. 현재 규칙으로 맞히지 못하는 줄은 `knownMiss: true`와 현재 결과 `actual`을 함께 적는다(예: ko4 `거죠`). 테스트는 knownMiss가 아닌 줄은 `expected`와 같아야 하고, knownMiss 줄은 `actual`과 같아야 한다. 그래서 놓치는 줄이 늘거나 바뀌면 테스트가 실패한다.
  - ➔ **Verify**: `npm run stt-bench -- --threads 1 --runs 7 test/fixtures/wav/*.wav`가 파일마다 중앙값과 범위를 출력한다. 계획 1절의 1스레드 수치가 이 출력으로 재현된다. 코퍼스가 20줄이고 모든 줄에 `expected`가 있다.
- [ ] **Step 4. `src/nlu/numbers.ts`.** 아라비아 숫자, 한자어 숫자(일~구, 십, 백 조합), 고유어 숫자(한, 두, 세, 네, 다섯~열, 스물/스무, 서른, 마흔), "반", 영어 숫자 단어(one~ninety, a/an, and a half)를 정규화한다.
  - ➔ **Verify**: `node --test test/numbers.test.ts`에서 20개 이상 통과. "이십오"는 25, "스무"는 20, "1분 반"은 90초, "two"는 2, "one and a half minutes"는 90초.
- [ ] **Step 5. `src/nlu/wake-word.ts`.** 한국어는 공백과 문장부호를 지운 문자열에서 찾는다. 핵심 패턴은 `타이?임?머`다. 그 앞 3글자 안에 `헤이?`가 있거나 뒤 1글자가 `[봇옷뽓보벗]` 중 하나면 웨이크워드로 본다. 단 `보` 뒤에 `[여니면자이]`가 이어지면 접미로 보지 않는다("타이머보여?"). 영어는 소문자로 바꾸고 문장부호를 지운 뒤 `timer ?bot|time a bot|timer but`. 반환값은 웨이크워드 뒤의 나머지 텍스트다.
  - ➔ **Verify**: 코퍼스에서 wake=true인 줄은 전부 감지하고 wake=false인 줄은 전부 감지하지 않는다. 추가 음성 케이스 `헤 타이임머2 분 알람`은 감지, `타이머 맞춰놨어?`, `타이머 몇 분 남았지`, `타이머 보여?`, `타이머보니까 1분 남았네`는 미감지.
- [ ] **Step 6. `src/nlu/parse-command.ts`.** 한국어는 공백을 지운 나머지 텍스트에 적용한다. set(시간 + 알람/타이머/맞춰/설정, 또는 동사 없이 시간만), shift(+는 밀어/미뤄/늦춰/뒤로/연장, −는 당겨/앞으로/줄여), cancel(꺼/취소/지워/삭제), list(남았/몇 개/목록), 대상(첫/두/세 번째, 1번/2번, 전부/다/모두). 영어는 alarm/timer, push back/delay/postpone/add, bring forward/move up, cancel/stop/clear/delete, how long/time left/list, first/second/all.
  - ➔ **Verify**: 코퍼스 전체(knownMiss 규칙 포함)와 테이블 케이스 30개 이상 통과. 필수 케이스는 `알람10초뒤로밀어줘`가 shift +10000 next, `two minutes alarm`이 set 120000, `1분30초알람맞춰줘`와 `1푼30초알람맞춰줘`가 set 90000, `두번째알람꺼줘`가 cancel index 2, `cancel all alarms`가 cancel all, `얼마남았어`가 list. Step 11 실측 전에는 "거죠"를 cancel로 받지 않는다(코퍼스의 ko4 줄은 knownMiss).
- [ ] **Step 7. `src/alarm/scheduler.ts`.** 2.3절 스케줄러 규칙을 구현한다. 시계(`now()`)와 타이머를 주입받고 길드 ID별로 상태를 나눈다. cue와 응답은 콜백으로 낸다.
  - ➔ **Verify**: `test/scheduler.test.ts`(`mock.timers`로 setTimeout과 Date 고정)에서 다음을 확인한다.
    - 2분 알람의 cue 4개가 117000, 118000, 119000, 120000ms에 난다.
    - 4번째 set은 `full`, 4초 미만 간격 set은 `conflict`, 3초짜리 set은 `tooShort`.
    - 남은 8초에서 −10초 shift는 `tooShort`이고 원래 fireAt이 유지된다.
    - 알람 30초와 60초가 있을 때 `all` −28초 shift는 30초 알람이 `tooShort`가 되므로 전부 거절되고 둘 다 그대로다.
    - cancel한 알람의 남은 cue는 하나도 나지 않는다.
    - 1.5초 남은 상태(intro와 three가 이미 남)에서 +10초 shift하면 cue 4개가 새 fireAt 기준으로 다시 나고, 옛 two와 now는 나지 않는다.
    - `index 2`는 fireAt 두 번째 알람을 가리킨다. 없으면 `notFound`.
    - 길드 A의 set이 길드 B의 상태를 바꾸지 않는다.

### Phase 2. 텍스트 MVP(STT 없이 슬래시 명령으로 알람 동작)

- [ ] **Step 8a. `scripts/encode-clips.ts`, `assets/voice/{ko,en}/*.opusf`.** 48kHz 16bit WAV(mono 또는 stereo)를 읽어 `@discordjs/opus`로 20ms 프레임 단위 인코딩하고, `[u16 길이][패킷]`을 이어 쓴 파일로 저장한다. 키는 intro, three, two, now, ok, full, tooShort, conflict, notFound, unknown이다. 공개 배포용 원본은 직접 녹음한 WAV다. 라이선스 문제가 없기 때문이다. 개발 중에는 `scripts/sapi-clips.ps1`(SAPI Heami/Zira, 48kHz)로 만든 임시 클립을 쓰고 커밋하지 않는다.
  - ➔ **Verify**: `test/assets.test.ts`. 모든 언어와 키의 파일이 있고, 파싱한 프레임 수 × 20ms로 계산한 cue 클립(intro, three, two, now) 길이가 전부 850ms 이하다. 커밋된 클립의 출처가 녹음 원본임을 `assets/voice/SOURCE.md`에 적는다.
- [ ] **Step 8b. `src/discord/*`, `src/alarm/announcer.ts`, `src/consent.ts`, `src/index.ts`, `scripts/deploy-commands.ts`.** intents는 Guilds, GuildVoiceStates. 명령은 `/join`(호출자의 채널에 `selfDeaf:false`로 접속, 동의 버튼과 처리 방식 안내 메시지), `/leave`, `/alarm set|list|cancel|shift`(텍스트는 Step 4, 6 파서 재사용), `/voice on|off`, `/privacy`. Announcer는 2.3절 우선순위 규칙을 따르고, 클립을 `StreamType.Opus` 패킷 스트림과 `silencePaddingFrames: 0`으로 재생한다. cue가 날 때 계획 시각을, AudioPlayer가 Playing으로 바뀔 때 그 시각을 로그에 남긴다. 연결 끊김과 혼자 남음 규칙을 구현한다.
  - ➔ **Verify**: `test/announcer.test.ts`에서 `decide`의 세 규칙을 확인한다. cue가 응답 클립을 끊는다. 새 cue가 재생 중인 cue를 끊는다. 다음 cue까지 남은 시간이 부족한 응답 클립은 텍스트로만 간다. 이어서 개발 길드에서 `npm run deploy-commands -- --guild` 후 다음을 확인한다.
    - `/alarm set 1분 10초`를 하면 카운트다운이 들린다.
    - 20회 반복한 now cue의 `Playing 시각 − 계획 시각` 중앙값과 최대값을 기록하고, 최대값이 50ms 미만이다. 중앙값을 `AUDIO_LATENCY_MS`로 정한다.
    - 카운트다운 중 `/alarm list`의 ok 클립이 three, two, now를 끊지 않는다.
    - 4번째 알람은 full 클립으로 거절된다.
    - 시작 로그의 `generateDependencyReport()`에 opus, davey, 암호화 라이브러리가 있다.
    - 봇이 혼자 남고 60초 뒤 나가고, 그 길드의 알람이 지워진다.

### Phase 3. 음성 명령

- [ ] **Step 9. `scripts/fetch-model.ts`, `src/stt/worker.ts`, `src/stt/pool.ts`.** 모델은 Hugging Face에서 `model.int8.onnx`와 `tokens.txt`만 받고, 고정한 revision과 sha256을 검증해 `MODEL_DIR`에 둔다. worker마다 `OpusEncoder(16000, 1)` 디코더와 sherpa 인식기(1스레드)를 하나씩 둔다. pool은 2.2, 2.3절 규칙(N, 2초 대기 버림)을 따른다. sherpa 결과의 `lang`에서 `<|`와 `|>`를 벗기고 ko/en 외에는 `'other'`로 바꾼다.
  - ➔ **Verify**: `test/pool.test.ts`에서 가짜 worker로 대기 2초 초과분 버림과 N 계산을 확인한다. `npm run stt-bench -- --via-pool --emit-fixtures`로 SAPI WAV를 Opus로 인코딩해 pool에 넣은 출력을 코퍼스의 세 번째 모드(`opus`)로 추가하고, Step 5와 Step 6 테스트가 이 줄들(`1푼` 포함)에서도 통과한다. 이 PC와 VM 양쪽에서 3초 발화 p95 디코딩 시간을 기록하고, VM 목표는 600ms 이하다. VM 측정은 Docker 전 단계라 호스트에 Node 24(NodeSource 패키지)를 설치하고, 저장소를 clone한 뒤 `npm ci && npm run fetch-model`로 준비한다. 목표를 넘으면 Step 14의 실패 분기를 따른다.
- [ ] **Step 10. `src/voice/capture.ts`.** 동의한 사용자의 speaking 시작 이벤트에서 `subscribe(userId, { end: AfterSilence 800ms })`로 받는다. 이미 구독 중이면(`receiver.subscriptions.has(userId)`) 아무것도 하지 않는다. speaking 'start'는 패킷이 100ms만 끊겨도 다시 나지만 구독 스트림은 800ms 무음까지 유지되고, `subscribe`는 기존 스트림을 그대로 돌려주기 때문이다. 이 확인이 없으면 핸들러가 중복으로 붙어 패킷이 두 번 쌓인다. 패킷을 모아 2.2절 길이 규칙으로 Utterance를 만든다. 봇 계정은 무시한다. `DEBUG_DUMP_USERS`에 있는 사용자의 Utterance는 `data/dumps/`에 Opus 프레임 파일로 저장한다.
  - ➔ **Verify**: `test/capture.test.ts`에서 가짜 스트림으로 다음을 확인한다. 19패킷은 버린다. 401패킷은 400 + 1로 나뉘고, 1은 버림 대상이다. 900패킷은 400, 400, 100 세 Utterance가 된다. `endedAt`은 각 조각 마지막 패킷의 수신 시각이다. 동의하지 않은 사용자는 구독하지 않는다. 같은 사용자의 'start'가 스트림이 열린 동안 두 번 나도 data 핸들러는 1개이고, 패킷 50개를 보내면 Utterance의 패킷도 50개다(중복 0).
- [ ] **Step 11. `src/voice/session.ts`와 실제 음성 측정.** 2.3절 세션 규칙대로 웨이크워드, 파서, 스케줄러, Announcer를 연결한다. 그다음 실제 음성을 두 세션으로 나눠 모은다.
  - 튜닝 세션. 테스트 사용자 2명 이상이 게임 소리를 켠 채 30분 이상 대화하며 명령 발화 30개 이상을 섞는다. 덤프는 `stt-bench --opusf data/dumps/*`로 인식한 뒤 사람이 `expected`를 채워 코퍼스에 추가한다. 웨이크워드 규칙과 파서 규칙은 이 코퍼스로 다시 맞춘다("거죠" 같은 오인식 처리 포함).
  - 홀드아웃 세션. 규칙을 고정한 뒤 다른 날에 따로 모은다. 가능하면 튜닝 때와 다른 사용자 2명이고, 명령 20개 이상이다. 홀드아웃은 `test/fixtures/holdout.jsonl`에 따로 두고 규칙 튜닝에 쓰지 않는다. 기준을 못 넘으면 규칙을 고친 뒤 홀드아웃을 새로 모으고, 이전 홀드아웃은 튜닝 코퍼스로 옮긴다.
  - ➔ **Verify**: 다음을 확인한다.
    - 홀드아웃에서만 판정한다. 웨이크워드 재현율 90% 이상(명령 20개 이상 기준), 웨이크워드가 있는 발화의 intent 정확도 80% 이상.
    - 오탐 웨이크워드는 시간당 1회 이하. 넘으면 unknown을 텍스트로만 보낸다.
    - 길드당 분당 발화 수를 로그에서 계산해 Step 14 부하 모델에 쓴다.
    - E2E. ① "헤이 타이머봇, 2분 알람" ② 영어 명령에 영어 클립 ③ 알람 2개 중 가장 이른 것만 10초 밀림 ④ 웨이크워드 뒤 잠시 쉬고 명령 ⑤ 4번째 알람 거절 ⑥ 잡담 무반응 ⑦ 카운트다운 중 다른 사용자의 명령이 카운트다운을 끊지 않음 ⑧ 동의하지 않은 사용자의 명령은 무시됨.
- [ ] **Step 12. (조건부) 오픈 마이크 대응.** 마이크를 계속 켜 둔 사용자는 무음이 없어서 8초마다 잘리고 웨이크워드가 쪼개질 수 있다. Step 11에서 이 때문에 놓친 명령이 확인될 때만 worker 안에 sherpa Silero VAD를 넣어 발화를 자른다.
  - ➔ **Verify**: 오픈 마이크 사용자의 ① 성공률이 일반 사용자와 같다(각 10회).

### Phase 4. 배포

- [ ] **Step 13. `Dockerfile`, `compose.yaml`.** `node:24-bookworm-slim` arm64에서 `npm ci --omit=dev`, 빌드 단계에서 `fetch-model` 실행, non-root 사용자, CMD는 `node src/index.ts`. compose는 `env_file: .env`로 환경변수를 주입하고 `restart: unless-stopped`, `DATA_DIR`은 볼륨이다. `.dockerignore`에 `.env`, `data`, `models`, `node_modules`, `.git`을 넣어 토큰과 덤프가 이미지에 들어가지 않게 한다. 배포는 VM에서 `git pull && docker compose up -d --build`.
  - ➔ **Verify**: VM에서 `docker compose logs bot`의 dependency report가 정상이고, Step 11 E2E ①이 통과한다. `docker compose restart` 뒤에도 동의 목록이 유지된다. `docker run --rm <image> ls -a /app`에 `.env`, `data`가 없다. `sudo reboot` 뒤 봇이 다시 접속하고 healthchecks.io 체크가 초록색으로 돌아온다.
- [ ] **Step 14. `scripts/load-test.ts`와 용량 결정.** Step 11을 개발 PC에서 했다면 `scp -r data/dumps vm:~/timerAlarm/data/`로 덤프를 VM에 옮긴다. 실제 채널 덤프를 Step 11에서 잰 길드당 분당 발화 수로 N개 길드만큼 pool에 넣는다. 동시에 가짜 알람 cue를 매초 예약한다. 기록하는 값은 디코딩 p95, 버림 비율, `monitorEventLoopDelay` p99, cue 계획 대비 실행 지연 최대값이다.
  - ➔ **Verify**: 다음 네 조건을 모두 만족하는 최대 N을 찾는다. 디코딩 p95 1.5초 이하, 버림 5% 미만, 이벤트 루프 p99 30ms 이하, cue 지연 최대 50ms 미만. 그 70%를 `MAX_ACTIVE_GUILDS`로 정한다. 측정 중 `top`으로 본 worker와 메인 스레드 CPU 사용률을 병목 근거로 README "용량" 절에 같이 적는다.
  - 실패 분기. Step 9 VM p95가 600ms를 넘거나 N이 2 미만이면 순서대로 시도한다. (1) worker 1개에 `numThreads: 2`로 다시 측정. (2) 발화 상한을 6초로 줄인다. (3) 그래도 N이 2 미만이면 "친구 서버 전용"으로 범위를 줄이고 사용자에게 보고한다.
- [ ] **Step 15. `.github/workflows/ci.yml`, `docs/privacy.md`, `README.md`.** CI는 lint, typecheck, test를 돌린다. `docs/privacy.md`는 GitHub Pages로 공개하고 동의 방식, 로컬 처리, 저장하지 않음, 디버그 덤프 예외를 적는다. README는 Glitch/ngrok 내용을 전부 지우고 다음을 적는다. Oracle 셋업, 명령 등록 방법, 재시작 시 알람이 사라진다는 것, 용량, FunASR 모델 라이선스 출처, 100개 서버 미인증 한도. 봇 초대 링크 권한은 Connect, Speak, Send Messages, View Channel, applications.commands. `npm run deploy-commands -- --clear-guild`로 개발 길드 명령을 지운 뒤 `-- --global`로 전역 등록한다.
  - ➔ **Verify**: PR에서 CI가 통과한다. Pages URL이 200을 반환한다. 개발 길드가 아닌 새 서버에 초대 링크로 봇을 넣고 `/join`이 보이며 E2E ①이 통과한다.

**공통 마무리.** `npm run lint && npm run typecheck && npm test`가 통과한다. `grep -rn "TODO\|\.skip\|\.only" src test scripts` 결과가 없다. Oracle Billing이 $0.00이다.

## 4. 남은 미확인 사항

- Discord Developer Policy가 음성 전사에 요구하는 동의 수준. 이 계획은 가장 엄격한 경우를 가정해 opt-in으로 설계했다. Step 15 전에 정책 원문을 확인한다.
- PAYG 업그레이드의 유휴 회수 면제 여부. Step 0에서 확인하되, 결과와 관계없이 PAYG와 $1 예산 알림, 생존 감시, 재시작 절차로 대응한다.
