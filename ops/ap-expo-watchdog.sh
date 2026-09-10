#!/bin/bash
# =============================================================================
#  ap-expo 探活 · 自愈 · 告警      （部署在 Mac mini，由 launchd 每 60 秒调一次）
# -----------------------------------------------------------------------------
#  为什么要有这个东西：
#    2026-09-01 展会前，有人在这台机器上整理 cloudflared 隧道，把
#    com.deeplumen.ap-expo-survey 和 com.deeplumen.cloudflared-ap-expo
#    两个服务 bootout + **disable** 掉了，之后没有拉回来。
#    结果是手机扫码得到 Cloudflare Error 1033，而**没有任何人知道** ——
#    现有的 com.deeplumen.cloudflared-watchdog 只覆盖 shopify-followup。
#
#    两个 plist 自带 KeepAlive，进程崩溃能自愈；但 KeepAlive 救不了
#    「被 disable」这一类，因为那时候服务根本不在 launchd 手里。
#    这个脚本补的就是这个洞。
#
#  盘三件事，不是一件（只盘「进程在不在」会漏掉后两种）：
#    ① 本机 8099 能不能返回问卷页   → Node 服务活着吗
#    ② 公网 https 能不能返回问卷页   → 隧道注册着吗（手机走的就是这条）
#    ③ 飞书推送重试队列有没有积压   → 同步在悄悄失败吗
#
#    ③ 是最容易被忽略的：问卷照常收、屏上照常显示、扫码一切正常，
#    只有飞书那份投影在掉。而这份线索的唯一用途就是展后跟进，
#    等展会结束才发现就来不及了。落库是权威副本所以数据不会丢，
#    但「以为同步好了」和「真的同步好了」差一次人工补推。
#
#  端到端探活为什么可信：实测这台 Mac mini 自己 curl 自己的公网域名
#  3/3 返回 200（约 1s），没有 hairpin 问题。所以 ② 失败是真失败。
#
#  ── 三类通知，别合成一类 ───────────────────────────────────────────────────
#    【故障】  连续 ALERT_AFTER 次探活失败 = 自愈没搞定，需要人。
#    【已恢复】发过【故障】之后恢复了。只有发过故障才会发恢复。
#    【已自愈】60 秒内自己修好了、压根没到告警阈值。
#              这一类**必须限流**（SELFHEAL_COOLDOWN），否则网络一抖就刷屏。
#
#    第一版把后两类合并成一条「已恢复」，结果是：自愈在第 1 个周期就成功、
#    告警阈值(2 次)永远达不到，人收到的是一条**没头没尾的「已恢复」**——
#    从没被告知坏过，却被告知恢复了。所以必须分开。
#
#  ── 两条纪律 ───────────────────────────────────────────────────────────────
#  · **只碰 ap-expo 这两个 label**。这台机器上还跑着 ac-radar / deeplumen-api /
#    lumenshop-engine / shopify-followup 等多条生产隧道，绝不 taskkill 式操作，
#    绝不 `killall cloudflared`。
#  · **修复动作分两档**：先只 enable + bootstrap（幂等、无副作用，专治 disable）；
#    只有「服务已经在 launchd 手里、但探活连续失败」才 kickstart -k 强制重启。
#    不这样分档的话，每 60 秒踹一次会把一个正在恢复的服务反复打断。
# =============================================================================
set -uo pipefail

LABEL_SRV="com.deeplumen.ap-expo-survey"
LABEL_TUN="com.deeplumen.cloudflared-ap-expo"
DOMAIN="gui/$(id -u)"
AGENTS="$HOME/Library/LaunchAgents"
BASE="$HOME/work/ap-expo"
OPS="$BASE/ops"
STATE="$OPS/.watchdog-state"
CONF="$OPS/notify.conf"
ENVF="$BASE/.feishu.env"
QUEUE="$BASE/E-survey/_data/_push-queue.jsonl"
LOG="$HOME/Library/Logs/ap-expo-watchdog.log"

LOCAL_URL="http://127.0.0.1:8099/E-survey/"
PUBLIC_URL="https://ap.lumioi.com/E-survey/"

ALERT_AFTER=2          # 连续坏 2 次(≈2 分钟)才算真故障。1 次就报会被网络抖动骗到
REMIND_EVERY=900       # 还没好，每 15 分钟再提醒一次（别 60 秒刷一条）
KICK_AFTER=2           # 服务在跑但一直不通 → 第 3 个周期开始强制重启
QUEUE_ALERT=5          # 飞书队列积压到这个条数才算异常（偶发 1~2 条会自己补推）
HEARTBEAT_EVERY=3600   # 一切正常时，每小时往日志写一行，证明看门狗自己还活着
SELFHEAL_COOLDOWN=1800 # 「已自愈」通知的限流窗口：30 分钟内最多一条

log() { printf '%s  %s\n' "$(date '+%m-%d %H:%M:%S')" "$*" >>"$LOG"; }

# ── 日志自限：超 1MB 就只留最后 500 行 ──────────────────────────────────────
if [ -f "$LOG" ] && [ "$(wc -c <"$LOG" | tr -d ' ')" -gt 1048576 ]; then
  tail -n 500 "$LOG" >"$LOG.tmp" 2>/dev/null && mv "$LOG.tmp" "$LOG"
fi

# ── 状态（key=value，直接 source；比管道分隔好扩展）─────────────────────────
STRIKES=0; LAST_ALERT=0; LAST_STATE=ok; LAST_HB=0; ALERTED=0
LAST_SELFHEAL=0; INCIDENT=""
# shellcheck source=/dev/null
[ -f "$STATE" ] && . "$STATE" 2>/dev/null || true
for v in STRIKES LAST_ALERT LAST_HB ALERTED LAST_SELFHEAL; do
  eval "x=\${$v:-0}"; case "$x" in ''|*[!0-9]*) eval "$v=0" ;; esac
done
LAST_STATE="${LAST_STATE:-ok}"; INCIDENT="${INCIDENT:-}"
now="$(date +%s)"

save_state() {
  mkdir -p "$OPS"
  {
    printf 'STRIKES=%s\n'       "$STRIKES"
    printf 'LAST_ALERT=%s\n'    "$LAST_ALERT"
    printf 'LAST_STATE=%s\n'    "$LAST_STATE"
    printf 'LAST_HB=%s\n'       "$LAST_HB"
    printf 'ALERTED=%s\n'       "$ALERTED"
    printf 'LAST_SELFHEAL=%s\n' "$LAST_SELFHEAL"
    # INCIDENT 是自由文本，必须引起来才能被 source 读回。
    # 用单引号包裹，并把值里的引号剔掉 —— 值是我们自己拼的
    # （形如 `公网=530; 飞书积压=7; `），不含引号，剔除只是防御。
    printf "INCIDENT='%s'\n" "$(printf '%s' "$INCIDENT" | tr -d "'\"" | tr '\n' ' ')"
  } >"$STATE"
}

# ── 飞书通知。**永不因为发不出去而影响自愈**（自愈是主线，通知是附加）───────
notify() {
  local text="$1" target="" rtype=""
  # shellcheck source=/dev/null
  [ -f "$CONF" ] && . "$CONF"
  if   [ -n "${ALERT_OPEN_ID:-}" ]; then target="$ALERT_OPEN_ID"; rtype="open_id"
  elif [ -n "${ALERT_CHAT_ID:-}" ]; then target="$ALERT_CHAT_ID"; rtype="chat_id"
  fi
  if [ -z "$target" ]; then log "[通知未投递·未配目标] ${text%%$'\n'*}"; return 0; fi
  if [ ! -f "$ENVF" ]; then log "[通知未投递·缺 .feishu.env]"; return 0; fi
  set -a; . "$ENVF"; set +a
  local tok
  tok="$(curl -s --max-time 10 -X POST \
        'https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal' \
        -H 'Content-Type: application/json' \
        -d "$(jq -nc --arg a "${FEISHU_APP_ID:-}" --arg s "${FEISHU_APP_SECRET:-}" \
              '{app_id:$a,app_secret:$s}')" \
        | jq -r '.tenant_access_token // empty' 2>/dev/null)"
  if [ -z "$tok" ]; then log "[通知未投递·取 token 失败]"; return 0; fi
  local body resp
  body="$(jq -nc --arg r "$target" \
          --arg c "$(jq -nc --arg t "$text" '{text:$t}')" \
          '{receive_id:$r,msg_type:"text",content:$c}')"
  resp="$(curl -s --max-time 10 -X POST \
         "https://open.feishu.cn/open-apis/im/v1/messages?receive_id_type=$rtype" \
         -H "Authorization: Bearer $tok" -H 'Content-Type: application/json' \
         -d "$body" 2>/dev/null)"
  if [ "$(printf '%s' "$resp" | jq -r '.code // 1' 2>/dev/null)" = "0" ]; then
    log "[通知已发出] ${text%%$'\n'*}"
  else
    log "[通知发送失败] $(printf '%s' "$resp" | head -c 180)"
  fi
}

is_loaded() { launchctl print "$DOMAIN/$1" >/dev/null 2>&1; }

ensure_up() {
  local label="$1" hard="${2:-no}" plist="$AGENTS/$1.plist"
  if [ ! -f "$plist" ]; then log "！$label 的 plist 不存在，无法自愈：$plist"; return 1; fi
  # enable 是幂等的，专治「被 disable」——disabled 状态会持久化并且直接挡住
  # bootstrap（报 Bootstrap failed: 5: Input/output error，很像 plist 坏了）。
  launchctl enable "$DOMAIN/$label" 2>/dev/null || true
  if ! is_loaded "$label"; then
    if launchctl bootstrap "$DOMAIN" "$plist" 2>/dev/null; then
      log "自愈：已 bootstrap $label"
    else
      log "自愈失败：bootstrap $label 没成功"
    fi
    return 0
  fi
  if [ "$hard" = "hard" ]; then
    if launchctl kickstart -k "$DOMAIN/$label" 2>/dev/null; then
      log "自愈：$label 在跑但探活持续失败，已强制重启"
    else
      log "自愈失败：kickstart $label 没成功"
    fi
  fi
  return 0
}

# ── 三项探活 ────────────────────────────────────────────────────────────────
# curl -w 在失败时**本身就会打印 000**，所以这里不能再叠一个 `|| echo 000` 兜底 ——
# 那会拼成 "000000"，而这个字符串会出现在发给人的告警消息里。
code_local="$(curl -s -o /dev/null -w '%{http_code}' --max-time 6  "$LOCAL_URL"  2>/dev/null)"
code_pub="$(  curl -s -o /dev/null -w '%{http_code}' --max-time 12 "$PUBLIC_URL" 2>/dev/null)"
[ -n "$code_local" ] || code_local="000"
[ -n "$code_pub" ]   || code_pub="000"
qlen=0
if [ -f "$QUEUE" ]; then qlen="$(grep -c . "$QUEUE" 2>/dev/null || echo 0)"; fi
case "$qlen" in ''|*[!0-9]*) qlen=0 ;; esac

problems=""; compact=""
if [ "$code_local" != "200" ]; then
  problems="${problems}· 问卷服务本机探活失败（HTTP $code_local）
"; compact="${compact}本机8099=$code_local; "
fi
if [ "$code_pub" != "200" ]; then
  problems="${problems}· 公网地址打不开（HTTP $code_pub）——手机扫码会失败
"; compact="${compact}公网=$code_pub; "
fi
if [ "$qlen" -ge "$QUEUE_ALERT" ]; then
  problems="${problems}· 飞书同步积压 $qlen 条（落库正常，只是没推上去）
"; compact="${compact}飞书积压=$qlen; "
fi

# ── 自愈 ────────────────────────────────────────────────────────────────────
if [ -n "$problems" ]; then
  hard="no"; [ "$STRIKES" -ge "$KICK_AFTER" ] && hard="hard"
  if [ "$code_local" != "200" ]; then
    ensure_up "$LABEL_SRV" "$hard"
    # 本机都不通时不去踹隧道：隧道很可能是好的，坏的是回源。
    # 但仍要 enable+bootstrap 一次，因为那次事故是两个一起被 disable 的。
    ensure_up "$LABEL_TUN" "no"
  elif [ "$code_pub" != "200" ]; then
    ensure_up "$LABEL_TUN" "$hard"   # 本机好、公网坏 → 嫌疑就是隧道
  fi
  # 飞书积压不自愈：_serve.js 自己每 10 分钟全量对账 + drain 重试队列，
  # 这里再插一手只会打架。积压持续存在说明是凭证/表的问题，需要人。
fi

# ── 通知 ────────────────────────────────────────────────────────────────────
if [ -n "$problems" ]; then
  STRIKES=$((STRIKES + 1))
  INCIDENT="$compact"
  if [ "$STRIKES" -ge "$ALERT_AFTER" ] \
     && { [ "$LAST_STATE" = "ok" ] || [ $((now - LAST_ALERT)) -ge "$REMIND_EVERY" ]; }; then
    notify "【AP 展会问卷 · 故障】
$problems
已连续 $STRIKES 次探活失败（每 60 秒一次），自动拉起没能解决，需要人看一下。
二维码地址：https://ap.lumioi.com/s
排查：ssh lumioi@100.93.72.96 之后
  tail -30 ~/Library/Logs/ap-expo-watchdog.log
  launchctl print-disabled gui/501 | grep ap-expo"
    LAST_ALERT="$now"; ALERTED=1
  else
    log "探活失败（第 $STRIKES 次，未到告警阈值或在提醒间隔内）：$compact"
  fi
  LAST_STATE="bad"
  save_state
else
  if [ "$LAST_STATE" = "bad" ]; then
    if [ "$ALERTED" = "1" ]; then
      notify "【AP 展会问卷 · 已恢复】
本机 8099、公网 https、飞书队列三项均正常。
本次故障共连续失败 $STRIKES 次。详情见 ~/Library/Logs/ap-expo-watchdog.log"
      log "已恢复（之前连续失败 $STRIKES 次，已发过故障通知）"
    elif [ $((now - LAST_SELFHEAL)) -ge "$SELFHEAL_COOLDOWN" ]; then
      notify "【AP 展会问卷 · 已自愈】
刚才检测到异常并已自动修复，扫码现在正常，不用处理。
异常内容：${INCIDENT:-（未记录）}
（未达告警阈值就自己好了，所以之前没打扰你。30 分钟内不再重复通知同类。）"
      LAST_SELFHEAL="$now"
      log "自愈成功并已通知（$INCIDENT）"
    else
      log "自愈成功（在 30 分钟冷却期内，不重复通知）：$INCIDENT"
    fi
    ALERTED=0; STRIKES=0; INCIDENT=""; LAST_HB="$now"
  elif [ $((now - LAST_HB)) -ge "$HEARTBEAT_EVERY" ]; then
    log "心跳：一切正常（本机 $code_local / 公网 $code_pub / 飞书队列 $qlen）"
    LAST_HB="$now"
  fi
  STRIKES=0; LAST_STATE="ok"
  save_state
fi
