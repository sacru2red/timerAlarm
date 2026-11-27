# Timer Alarm 개인정보 처리 안내 / Privacy

## 한국어

**무엇을 듣나요.** 음성 채널에서 봇이 듣는 사람은 직접 동의한 사람뿐입니다. 동의는 `/join` 메시지의 "음성 명령 켜기" 버튼이나 `/voice on`으로 하고, `/voice off`로 언제든 철회합니다. 동의는 서버별이라 한 서버의 동의가 다른 서버로 번지지 않습니다. 동의하지 않은 사람의 음성 패킷은 구독하지 않으므로 해독하거나 인식하지 않고 버립니다.

**어떻게 처리하나요.** 받은 음성은 봇 서버 안에서 SenseVoice 모델로 바로 문자로 바꿉니다. 외부 음성 인식 API로 보내지 않습니다. 문자에서 "헤이 타이머봇" 같은 호출어와 알람 명령을 찾은 뒤 음성과 문자를 모두 버립니다.

**무엇을 저장하나요.** 저장하는 것은 동의한 사람의 `서버 ID:사용자 ID` 목록 하나뿐입니다. 음성, 인식된 문자, 알람 기록은 저장하지 않습니다. 알람은 메모리에만 있어서 봇이 재시작하면 사라집니다.

**예외.** 개발자가 인식 품질을 조정할 때, 운영 설정 `DEBUG_DUMP_USERS`에 직접 적은 테스트 사용자의 발화만 파일로 저장합니다. 공개 운영에서는 이 값을 비워 둡니다.

**봇 목소리.** 봇이 말하는 목소리는 사람이 녹음한 것이 아니라 Supertonic 3 음성 합성 모델로 만든 기계 음성입니다.

**삭제 요청.** `/voice off`를 실행하면 해당 서버의 동의 기록이 즉시 지워집니다.

## English

**Who is heard.** The bot only listens to people who opted in, with the "Enable voice commands" button on the `/join` message or `/voice on`. `/voice off` withdraws it at any time. Opt-in is per server. Audio packets from people who have not opted in are never subscribed to, so they are dropped without being decoded or transcribed.

**How audio is processed.** Audio is transcribed on the bot's own server by the SenseVoice model. Nothing is sent to an external speech API. The bot looks for the wake word and an alarm command, then discards both the audio and the text.

**What is stored.** Only the list of opted-in `server ID:user ID` pairs. Audio, transcripts and alarm history are not stored. Alarms live in memory and disappear when the bot restarts.

**Exception.** While tuning recognition, the operator may save utterances of test users explicitly listed in the `DEBUG_DUMP_USERS` setting. It is empty in public operation.

**The bot's voice.** The bot's voice is machine-generated with the Supertonic 3 speech synthesis model, not recorded by a person.

**Deletion.** `/voice off` removes your opt-in record for that server immediately.
