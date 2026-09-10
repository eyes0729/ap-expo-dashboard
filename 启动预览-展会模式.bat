@echo off
chcp 65001 >nul
cd /d "%~dp0"
REM ===========================================================================
REM  PURE ASCII ONLY -- Chinese text in a .bat gets shredded under chcp 65001
REM  and destroys the tail of the file (including `pause`).
REM
REM  SHOW MODE. The survey is served from the Mac mini at https://ap.lumioi.com
REM  (own domain, Cloudflare named tunnel, verified to open on 5G).
REM  The QR on screen points there, so:
REM    - phones scan it over their own 4G/5G, no shared WiFi needed
REM    - the address never changes, so it can be printed on a standee
REM    - 23 bytes -> QR version 2 (25x25), the easiest-to-scan option
REM
REM  This machine then only renders the screen. It does NOT collect data:
REM  submissions go to the Mac mini. Read the summary from a phone at
REM    https://ap.lumioi.com/E-survey/?admin=1&k=<token below>
REM ===========================================================================
set AP_PUBLIC_URL=https://ap.lumioi.com/s
set AP_SURVEY_TOKEN=ap-expo-20260824-347fa273
node _serve.js
echo.
pause
