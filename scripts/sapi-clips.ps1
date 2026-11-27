param([string]$OutDir = 'data/voice-sapi')

Add-Type -AssemblyName System.Speech

$lines = @{
  ko = [ordered]@{
    intro = '알람입니다'; three = '삼'; two = '이'; now = '지금!'
    ok = '네'; full = '알람이 꽉 찼어요'; tooShort = '너무 짧아요'; conflict = '다른 알람과 너무 가까워요'
    notFound = '그 알람이 없어요'; unknown = '잘 못 알아들었어요'
  }
  en = [ordered]@{
    intro = 'Alarm'; three = 'Three'; two = 'Two'; now = 'Now!'
    ok = 'Okay'; full = 'Alarms are full'; tooShort = 'Too short'; conflict = 'Too close to another alarm'
    notFound = 'No such alarm'; unknown = "Sorry, I didn't catch that"
  }
}
$voices = @{ ko = 'Microsoft Heami Desktop'; en = 'Microsoft Zira Desktop' }
$format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(48000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)

foreach ($lang in $lines.Keys) {
  $dir = Join-Path $OutDir $lang
  New-Item -ItemType Directory -Force $dir | Out-Null
  $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
  $synth.SelectVoice($voices[$lang])
  $synth.Rate = 2
  foreach ($key in $lines[$lang].Keys) {
    $synth.SetOutputToWaveFile((Join-Path (Resolve-Path $dir) "$key.wav"), $format)
    $synth.Speak($lines[$lang][$key])
  }
  $synth.SetOutputToNull()
  $synth.Dispose()
}
