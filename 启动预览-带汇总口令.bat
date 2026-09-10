@echo off
chcp 65001 >nul
cd /d "%~dp0"
REM ===========================================================================
REM  PURE ASCII ONLY -- see the long note in the other launcher for why.
REM  (Short version: Chinese text in a .bat gets shredded past a read-buffer
REM   boundary under chcp 65001. It destroys the tail of the file, which kills
REM   `pause`, so the window closes instantly and you never see the error.)
REM
REM  Difference from the plain launcher: this one sets AP_SURVEY_TOKEN, so that
REM  staff can read the survey summary from a phone at
REM      <tunnel-url>/E-survey/?admin=1&k=<token>
REM  Without a token, the summary and CSV export are readable ONLY from this
REM  machine. That matters: the records hold WeChat IDs and phone numbers, and
REM  the tunnel URL is printed on a screen that everyone photographs.
REM
REM  Change this token for every show. Do not ship the default.
REM ===========================================================================
set AP_SURVEY_TOKEN=ap-expo-2026
node _serve.js
echo.
pause
