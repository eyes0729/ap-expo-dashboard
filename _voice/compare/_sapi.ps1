
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Speech
$s=New-Object System.Speech.Synthesis.SpeechSynthesizer
$zh=$s.GetInstalledVoices()|Where-Object{$_.VoiceInfo.Culture.Name -like 'zh*'}|Select-Object -First 1
$s.SelectVoice($zh.VoiceInfo.Name)
$s.Rate=1
$items=Get-Content -Raw -Encoding UTF8 "C:\Users\1\Desktop\工作汇总\AP展会\展会大屏播报\_voice\compare\_sapi.json" | ConvertFrom-Json
foreach($i in $items){ $s.SetOutputToWaveFile($i.file); $s.Speak($i.text); $s.SetOutputToNull()
  Write-Output ("  " + (Split-Path $i.file -Leaf)) }
$s.Dispose()
