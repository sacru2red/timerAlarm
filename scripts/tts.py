"""Synthesize 48 kHz 16-bit mono WAVs with Supertonic 3 (model: OpenRAIL-M, see assets/voice/SOURCE.md).

uv run --with supertonic==1.3.1 python scripts/tts.py <lines.json> <out dir>

<lines.json> is a list, or an object with a "lines" list, of
{"file": "ko/intro.wav", "lang": "ko", "voice": "F1", "text": "...", "speed": 1.1}.
Without "voice", the line's "player" is looked up in the object's "players" map. Other keys are ignored. The first run downloads the model (~400 MB) to ~/.cache/supertonic3.
"""

import json
import sys
from pathlib import Path

import numpy as np
import soundfile
from supertonic import TTS

OUT_RATE = 48000


def resample(wav: np.ndarray, rate: int) -> np.ndarray:
    if rate == OUT_RATE:
        return wav
    size = round(len(wav) * OUT_RATE / rate)
    return np.fft.irfft(np.fft.rfft(wav), size) * (size / len(wav))


def main() -> None:
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    data = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    lines = data["lines"] if isinstance(data, dict) else data
    out = Path(sys.argv[2])
    tts = TTS(auto_download=True)
    styles = {}
    for line in lines:
        voice = line.get("voice") or data["players"][line["player"]]
        if voice not in styles:
            styles[voice] = tts.get_voice_style(voice_name=voice)
        wav, _ = tts.synthesize(line["text"], voice_style=styles[voice], lang=line["lang"], speed=line.get("speed", 1.05))
        samples = resample(np.asarray(wav, dtype=np.float64).reshape(-1), tts.sample_rate)
        target = out / line["file"]
        target.parent.mkdir(parents=True, exist_ok=True)
        soundfile.write(target, np.clip(samples, -1, 1), OUT_RATE, subtype="PCM_16")
        print(f"{target} {len(samples) / OUT_RATE:.2f}s {line['text']}")


main()
