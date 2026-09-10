@echo off
chcp 65001 >nul
cd /d "%~dp0"
REM ===========================================================================
REM  PURE ASCII ONLY -- Chinese text in a .bat gets shredded under chcp 65001
REM  and destroys the tail of the file (including `pause`), so the window just
REM  flashes and closes. Keep every byte in this file below 0x80.
REM
REM  This launcher turns the public Cloudflare tunnel ON. It is NOT the default.
REM
REM  WARNING: *.trycloudflare.com is generally NOT reachable from ordinary
REM  mainland-China mobile networks. Scanning the QR from a phone on 4G/5G
REM  will most likely show a network error.
REM
REM  Measured on this machine: the local gateway hijacks DNS and answers with a
REM  Clash-style fake IP (198.18.0.0/15), so traffic from THIS laptop goes out
REM  through a proxy and curl returns 200 -- while a phone on 5G fails. Do not
REM  treat a successful curl here as proof that a phone can reach the tunnel.
REM
REM  Use this only on a network that can genuinely reach Cloudflare.
REM  For the show, prefer the default LAN launcher plus a travel router.
REM ===========================================================================
set AP_TUNNEL=1
node _serve.js
echo.
pause
