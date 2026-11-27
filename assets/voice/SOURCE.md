# Voice clips

`<lang>/<kind>.opusf` holds 20 ms Opus frames (48 kHz stereo), each stored as a little-endian u16 length followed by the packet.

Build them from 48 kHz 16-bit WAV files laid out as `<in>/<lang>/<kind>.wav`:

```sh
npm run encode-clips -- --in <wav dir> --out assets/voice
```

Development clips come from Windows SAPI voices (`pwsh scripts/sapi-clips.ps1`, writes `data/voice-sapi`). They are not licensed for distribution, so `.gitignore` excludes `*.opusf` here. Clips committed for release must be our own recordings. Remove the ignore rule when they land and note the recording source below.

Recording source: none committed yet.
