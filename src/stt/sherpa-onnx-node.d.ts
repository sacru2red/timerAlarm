declare module 'sherpa-onnx-node' {
  export type Wave = { samples: Float32Array; sampleRate: number }

  export type OfflineRecognizerConfig = {
    featConfig: { sampleRate: number; featureDim: number }
    modelConfig: {
      senseVoice: { model: string; language?: string; useInverseTextNormalization?: number }
      tokens: string
      numThreads: number
      provider: 'cpu'
      debug: number
    }
  }

  export type OfflineStream = {
    acceptWaveform (wave: Wave): void
  }

  export type OfflineRecognizerResult = { text: string; lang: string }

  export class OfflineRecognizer {
    constructor (config: OfflineRecognizerConfig)
    createStream (): OfflineStream
    decode (stream: OfflineStream): void
    getResult (stream: OfflineStream): OfflineRecognizerResult
  }

  export function readWave (path: string): Wave

  const sherpa: {
    OfflineRecognizer: typeof OfflineRecognizer
    readWave: typeof readWave
  }
  export default sherpa
}
