@echo off
chcp 65001 >nul
cd /d "%~dp0"
REM ===========================================================================
REM  This file is deliberately PURE ASCII. Do NOT put Chinese text in it.
REM
REM  Why: with `chcp 65001` active, cmd.exe tracks its position in the batch
REM  file by BYTE offset but parses by CHARACTER. Multi-byte (UTF-8) text makes
REM  the two drift apart, and once the drift crosses a read-buffer boundary
REM  cmd starts executing fragments of later lines as if they were commands:
REM
REM      'xxx' is not recognized as an internal or external command
REM
REM  The tail of the file is what gets shredded -- including `pause`. So the
REM  window closes instantly and you never see the error. That is exactly the
REM  bug this file had: 27 lines with Chinese banners, tail destroyed.
REM  A short file (the original 6-line version) does not drift far enough to
REM  trip it, which is why this only appeared after the file grew.
REM
REM  All operator-facing Chinese text now comes from _serve.js instead --
REM  node writes UTF-8 to the console correctly and has no such limitation.
REM  Same rule the project already documented for make-voice.ps1.
REM ===========================================================================
node _serve.js
echo.
pause
