import { join } from 'node:path'
import sherpa from 'sherpa-onnx-node'
import type { OfflineRecognizer } from 'sherpa-onnx-node'

export type DetectedLang = 'ko' | 'en' | 'other'
export type Recognition = { text: string; lang: DetectedLang }

export type RecognizerOptions = {
  modelDir: string
  numThreads: number
  forceLanguage?: 'ko' | 'en'
}

export function createRecognizer ({ modelDir, numThreads, forceLanguage }: RecognizerOptions): OfflineRecognizer {
  return new sherpa.OfflineRecognizer({
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: {
      senseVoice: {
        model: join(modelDir, 'model.int8.onnx'),
        language: forceLanguage ?? '',
        useInverseTextNormalization: 1,
      },
      tokens: join(modelDir, 'tokens.txt'),
      numThreads,
      provider: 'cpu',
      debug: 0,
    },
  })
}

export function recognize (recognizer: OfflineRecognizer, samples: Float32Array, sampleRate: number): Recognition {
  const stream = recognizer.createStream()
  stream.acceptWaveform({ samples, sampleRate })
  recognizer.decode(stream)
  const { text, lang } = recognizer.getResult(stream)
  return { text: text.trim(), lang: normalizeLang(lang) }
}

export function normalizeLang (tag: string): DetectedLang {
  const code = tag.replace(/^<\|/, '').replace(/\|>$/, '')
  return code === 'ko' || code === 'en' ? code : 'other'
}
