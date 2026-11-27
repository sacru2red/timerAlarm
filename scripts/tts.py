"""Synthesize 16-bit mono WAVs (48 kHz unless --rate is given) with Supertonic 3 (model: OpenRAIL-M, see assets/voice/SOURCE.md).

uv run --with supertonic==1.3.1 python scripts/tts.py <lines.json> <out dir> [--rate 16000]

<lines.json> is a list, or an object with a "lines" list, of
{"file": "ko/intro.wav", "lang": "ko", "voice": "F1", "text": "...", "speed": 1.1}.
Without "voice", the line's "player" is looked up in the object's "players" map. Other keys are ignored. The first run downloads the model (~400 MB) to ~/.cache/supertonic3.
"""

import argparse
import json
from pathlib import Path

import numpy as np
import soundfile
from supertonic import TTS


def resample(wav: np.ndarray, rate: int, out_rate: int) -> np.ndarray:
    if rate == out_rate:
        return wav
    size = round(len(wav) * out_rate / rate)
    return np.fft.irfft(np.fft.rfft(wav), size) * (size / len(wav))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("lines")
    parser.add_argument("out")
    parser.add_argument("--rate", type=int, default=48000)
    args = parser.parse_args()
    data = json.loads(Path(args.lines).read_text(encoding="utf-8"))
    lines = data["lines"] if isinstance(data, dict) else data
    out = Path(args.out)
    tts = TTS(auto_download=True)
    styles = {}
    for line in lines:
        voice = line.get("voice") or data["players"][line["player"]]
        if voice not in styles:
            styles[voice] = tts.get_voice_style(voice_name=voice)
        wav, _ = tts.synthesize(line["text"], voice_style=styles[voice], lang=line["lang"], speed=line.get("speed", 1.05))
        samples = resample(np.asarray(wav, dtype=np.float64).reshape(-1), tts.sample_rate, args.rate)
        target = out / line["file"]
        target.parent.mkdir(parents=True, exist_ok=True)
        soundfile.write(target, np.clip(samples, -1, 1), args.rate, subtype="PCM_16")
        print(f"{target} {len(samples) / args.rate:.2f}s {line['text']}")


main()
