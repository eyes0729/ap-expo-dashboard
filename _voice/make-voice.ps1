# =============================================================================
#  用 Windows 自带的 SAPI 语音（Microsoft Huihui, zh-CN）把文案候选录成 wav
#
#  这一版**只用来判断句式 / 节奏 / 时长**，不是最终音色。
#  Huihui 是 2013 年那代拼接式合成，音质离「惊艳」很远；
#  最终音色要走 CosyVoice 2（Apache-2.0 可商用、可离线）或真人录音。
#
#  脚本本身刻意保持纯 ASCII：PowerShell 5.1 读 .ps1 默认按系统 ANSI 码页，
#  中文直接写进 .ps1 会变乱码。所以文案全部放在 lines.json 里用 UTF8 读。
# =============================================================================
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path

Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer

# 选中文音色
$zh = $synth.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Culture.Name -like 'zh*' } | Select-Object -First 1
if ($null -eq $zh) { Write-Error 'no zh-CN voice installed'; exit 1 }
$synth.SelectVoice($zh.VoiceInfo.Name)
Write-Output ("voice = " + $zh.VoiceInfo.Name)

# 语速：0 是默认。播报要比朗读稍快一点，但不能赶
$synth.Rate = 1
$synth.Volume = 100

$json = Get-Content (Join-Path $here 'lines.json') -Raw -Encoding UTF8 | ConvertFrom-Json

foreach ($item in $json.lines) {
  $out = Join-Path $here $item.file
  $synth.SetOutputToWaveFile($out)
  $synth.Speak($item.text)
  $synth.SetOutputToNull()
  $len = (Get-Item $out).Length
  # 16kHz / 16bit / mono => 32000 bytes per second
  $sec = [math]::Round(($len - 44) / 32000.0, 2)
  Write-Output ("{0,-24} {1,5}s  {2}" -f $item.file, $sec, $item.desc)
}
$synth.Dispose()
Write-Output 'done'
