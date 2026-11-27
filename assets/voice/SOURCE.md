# Voice clips

`<lang>/<kind>.opusf` holds 20 ms Opus frames (48 kHz stereo), each stored as a little-endian u16 length followed by the packet.

## Source

The clips are machine-generated with [Supertonic 3](https://huggingface.co/Supertone/supertonic-3) by Supertone Inc., voice `F1`. The model is under the BigScience OpenRAIL-M license. The licensor claims no rights in generated output, but its use restrictions apply. One of them requires saying that the content is machine-generated, which README and `docs/privacy.md` do. Synthesis output varies from run to run, so the committed clips are the reference.

## Regenerating

The lines live in `lines.json`. The first run downloads the model (about 400 MB) to `~/.cache/supertonic3`.

```sh
uv run --with supertonic==1.3.1 python scripts/tts.py assets/voice/lines.json data/voice-tts
npm run encode-clips          # data/voice-tts -> assets/voice, trims silence
npm run check-clips           # cue clips must be <= 850 ms
```

Check the result by transcribing it: `node scripts/stt-bench.ts --via-pool --runs 1 assets/voice/*/*.opusf`. Single-syllable Korean cues (삼, 이) come back with a wrong language tag there but read correctly with `--modes ko` on the WAVs.

The League of Legends load-test scenario in `test/fixtures/lol` is made the same way with four other voices (`scripts/tts.py test/fixtures/lol/scenario.json data/lol-wav`, then `npm run encode-scenario`). So are the 16 kHz corpus WAVs in `test/fixtures/wav` (`scripts/tts.py test/fixtures/wav/lines.json test/fixtures/wav --rate 16000`, then `npm run stt-bench -- --modes auto,ko --emit-fixtures` and `-- --via-pool --emit-fixtures`). After re-emitting, mark lines the rules now get wrong as `knownMiss` with their `actual` result.
