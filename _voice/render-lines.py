# -*- coding: utf-8 -*-
"""
按 lines-manifest.json 把每一条播报**整句**渲染成一个 wav 文件。

  python render-lines.py --engine azure          # 正式（需要 key，商用授权干净）
  python render-lines.py --engine edge           # 内部试听（不要对外用，见下）
  python render-lines.py --engine cosy           # 本机离线
  python render-lines.py --engine azure --limit 5  # 先渲 5 条看看

═══ 为什么是「整句」而不是「拼接零件」════════════════════════════════════════
README 的待办第 1 条写着「不要做数字拼接」，但 _voice/stitch.js 做的正是拼接。
拼接听起来假，根因不是接缝的咔哒声（那个交叉淡化能压掉），而是
**每个片段单独合成时都会带一个句尾降调**，「一千」「二百」「八十美元」
三个降调连着出现 = 报电话号码的听感。这一层调参修不了。

而「金额连续所以不可能每句都预录」这个前提是错的：引擎是时间的纯函数，
一场展会会播哪些金额可以提前算出来（build-lines.js 干这个），4 天展期
去重后只有 381 句、45MB。见 build-lines.js 顶部的长注释。

═══ 各引擎的授权状况（展会是公开商业场合，这条不能跳）══════════════════════
  azure  ✓ 可商用。zh-CN-XiaoxiaoNeural 等，Azure 语音服务条款覆盖。
            免费额度 50 万字符/月，381 句约 8 千字符，**额度内**。
  edge   ✗ 不可对外。走的是 Edge 浏览器「朗读」用的接口，不是商用授权渠道。
            音色和 azure 是同一批模型，所以**只用来选音色 / 内部试听**，
            选定后必须用 azure 重渲一遍再对外。
  cosy   ⚠ 代码权重是 Apache-2.0，但当前参考音是 CosyVoice 仓库自带的
            某个真人声音，声音人格权不在授权范围内（参见北京互联网法院
            2024 年那起 AI 声音侵权案：拿到录音著作权 ≠ 拿到 AI 化授权）。
            要对外必须换成自己录的参考音。
  sapi   ✓ 随 Windows 授权，但这就是现在被吐槽「机械/电子」的那个 Huihui。
"""
import argparse
import concurrent.futures as cf
import threading
import io
import json
import os
import sys
import time

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

import numpy as np
import soundfile as sf

HERE = os.path.dirname(os.path.abspath(__file__))
MANIFEST = os.path.join(HERE, 'lines-manifest.json')

# 目标格式：24kHz / 单声道 / 16bit。和 CosyVoice 原生一致，也是 Azure 的一档标准输出。
SR = 24000
# 归一化目标。所有句子电平必须一致 —— 播报之间忽大忽小比音色差更容易被听出是拼的。
PEAK = 0.708          # -3 dBFS

VOICE_DEFAULT = 'zh-CN-XiaoxiaoNeural'
RATE_DEFAULT = '+8%'   # 播报比朗读稍快；过了 +20% 开始有「赶」的电子感


# ──────────────────────────────────────────────────────────────────────────
def postprocess(x, sr):
    """切首尾静音 + 归一到 -3dBFS。

    为什么必须切静音：TTS 输出前后普遍挂 100~500ms 静音。播报要「一响就到」，
    而且前面还要接一个提示音（sting），留着静音节奏就散了。
    判据「超过峰值 1.5%」，两端各留 20ms 余量，避免把气口切秃。
    """
    if x.ndim > 1:
        x = x.mean(axis=1)
    x = x.astype(np.float32)
    if x.size:
        peak = float(np.abs(x).max())
        if peak > 0:
            idx = np.where(np.abs(x) > peak * 0.015)[0]
            if idx.size:
                pad = int(0.020 * sr)
                x = x[max(0, idx[0] - pad):min(x.size, idx[-1] + pad)]
    peak = float(np.abs(x).max()) if x.size else 0.0
    if peak > 0:
        x = x * (PEAK / peak)
    return x


def save(path, x, sr):
    sf.write(path, x, sr, subtype='PCM_16')
    return len(x) / float(sr)


def decode_bytes(buf):
    """把引擎返回的音频字节（mp3 或 wav）解成 (float array, sr)。"""
    data, sr = sf.read(io.BytesIO(buf), dtype='float32', always_2d=True)
    return data, sr


def resample_to(x, sr, target):
    if sr == target or x.size == 0:
        return x, target
    # 线性重采样够用 —— 24k↔24k 基本用不上，只是兜底
    n = int(round(len(x) * target / float(sr)))
    xi = np.interp(np.linspace(0, len(x) - 1, n), np.arange(len(x)), x)
    return xi.astype(np.float32), target


# ── 引擎一：Azure 语音服务（正式）────────────────────────────────────────────
def make_azure(voice, rate):
    """用 REST 接口，不装 SDK —— 少一个依赖，也少一层版本风险。

    需要两个环境变量：
        AZURE_SPEECH_KEY     语音服务的密钥
        AZURE_SPEECH_REGION  区域，如 eastasia / eastus（默认 eastasia）
    """
    import urllib.request
    key = os.environ.get('AZURE_SPEECH_KEY', '').strip()
    region = os.environ.get('AZURE_SPEECH_REGION', 'eastasia').strip()
    if not key:
        raise SystemExit(
            '\n没有 AZURE_SPEECH_KEY。\n'
            '  1) Azure 门户建一个「语音服务」资源（免费 F0 档即可）\n'
            '  2) set AZURE_SPEECH_KEY=<你的密钥>\n'
            '     set AZURE_SPEECH_REGION=eastasia\n'
            '  3) 重跑本脚本\n'
            '想先听音色不开账号的话：--engine edge（仅内部试听，不能对外用）\n')
    url = 'https://%s.tts.speech.microsoft.com/cognitiveservices/v1' % region

    def gen(text):
        # SSML。语速走 prosody，读法已经在文本里写成中文所以不依赖数字归一化。
        ssml = (
            '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" '
            'xml:lang="zh-CN">'
            '<voice name="%s"><prosody rate="%s">%s</prosody></voice></speak>'
        ) % (voice, rate, text)
        req = urllib.request.Request(url, data=ssml.encode('utf-8'), method='POST')
        req.add_header('Ocp-Apim-Subscription-Key', key)
        req.add_header('Content-Type', 'application/ssml+xml')
        # 直接要 24k PCM wav，省掉一次 mp3 解码
        req.add_header('X-Microsoft-OutputFormat', 'riff-24khz-16bit-mono-pcm')
        req.add_header('User-Agent', 'ap-expo-voice')
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.read()
    return gen


# ── 引擎二：edge-tts（仅内部试听）───────────────────────────────────────────
def make_edge(voice, rate):
    import asyncio
    import edge_tts

    def gen(text):
        async def run():
            buf = b''
            async for ch in edge_tts.Communicate(text, voice, rate=rate).stream():
                if ch['type'] == 'audio':
                    buf += ch['data']
            return buf
        return asyncio.run(run())
    return gen


# ── 引擎三：CosyVoice2 本机离线 ─────────────────────────────────────────────
def make_cosy(_voice, _rate):
    sys.path.insert(0, r'C:\Users\1\cosy\CosyVoice')
    sys.path.insert(0, r'C:\Users\1\cosy\CosyVoice\third_party\Matcha-TTS')
    os.chdir(r'C:\Users\1\cosy\CosyVoice')
    import torch
    import torchaudio

    def _load(path, *a, **kw):
        d, s = sf.read(str(path), dtype='float32', always_2d=True)
        return torch.from_numpy(d.T), s
    torchaudio.load = _load
    from cosyvoice.cli.cosyvoice import CosyVoice2
    m = CosyVoice2('pretrained_models/CosyVoice2-0.5B',
                   load_jit=False, load_trt=False, fp16=False)
    prompt = r'./asset/zero_shot_prompt.wav'          # 注意：仅内部评估，见文件头
    ptxt = '希望你以后能够做的比我还好呦。'

    def gen(text):
        got = None
        for out in m.inference_zero_shot(text, ptxt, prompt, stream=False, speed=1.0):
            got = out['tts_speech']
        a = got.detach().cpu().float().numpy()
        a = a[0] if a.ndim == 2 else a
        b = io.BytesIO()
        sf.write(b, a, m.sample_rate, format='WAV', subtype='PCM_16')
        return b.getvalue()
    return gen


ENGINES = {'azure': make_azure, 'edge': make_edge, 'cosy': make_cosy}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--engine', default='azure', choices=sorted(ENGINES))
    ap.add_argument('--voice', default=VOICE_DEFAULT)
    ap.add_argument('--rate', default=RATE_DEFAULT)
    ap.add_argument('--limit', type=int, default=0, help='只渲前 N 条（试渲用）')
    ap.add_argument('--out', default=None)
    ap.add_argument('--force', action='store_true', help='已存在也重渲')
    ap.add_argument('--jobs', type=int, default=8, help='并发数（cosy 强制 1）')
    a = ap.parse_args()

    if not os.path.exists(MANIFEST):
        raise SystemExit('没有 lines-manifest.json，先跑：node build-lines.js')
    man = json.load(open(MANIFEST, encoding='utf-8'))
    lines = man['lines'][:a.limit] if a.limit else man['lines']

    out = a.out or os.path.join(HERE, 'pack-' + a.engine)
    os.makedirs(out, exist_ok=True)

    if a.engine == 'edge':
        print('⚠ engine=edge 只能内部试听，不能对外用（授权见本文件头）。')
    if a.engine == 'cosy':
        print('⚠ engine=cosy 当前用的是仓库自带参考音，只能内部评估。')

    print('引擎 %s · 音色 %s · 语速 %s · %d 条 → %s\n'
          % (a.engine, a.voice, a.rate, len(lines), out))
    # cosy 是**单个模型实例**，多线程同时 inference 会互相踩状态，强制串行。
    # azure / edge 都是一次 HTTP 请求，纯网络等待，并发就是线性加速。
    jobs = 1 if a.engine == 'cosy' else max(1, a.jobs)
    if jobs != a.jobs:
        print('（%s 强制串行 jobs=1）' % a.engine)
    gen = ENGINES[a.engine](a.voice, a.rate)

    t0 = time.time()
    durs = []
    manifest_out = []
    lock = threading.Lock()
    counts = {'done': 0, 'skipped': 0, 'failed': 0, 'seen': 0}

    def one(ln):
        """渲一条。返回 None 表示失败（失败要报出来，不能静默少一句 ——
        运行时去要一个不存在的文件就会退回 speechSynthesis，
        也就是当场蹦出一句 Huihui，正是我们要消灭的那个音色）。"""
        dst = os.path.join(out, ln['file'] + '.wav')
        if os.path.exists(dst) and not a.force:
            try:
                info = sf.info(dst)
                return ('skip', ln, info.duration)
            except Exception:
                pass                       # 文件坏了，当没渲过重来
        try:
            raw = gen(ln['text'])
            x, sr = decode_bytes(raw)
            x = x.mean(axis=1)
            x, sr = resample_to(x, sr, SR)
            x = postprocess(x, sr)
            return ('ok', ln, save(dst, x, sr))
        except Exception as e:
            return ('fail', ln, e)

    def collect(r):
        kind, ln, val = r
        with lock:
            counts['seen'] += 1
            if kind == 'fail':
                counts['failed'] += 1
                print('  ✗ $%-5s %s' % (ln['usd'], val))
            else:
                counts['done' if kind == 'ok' else 'skipped'] += 1
                durs.append(val)
                manifest_out.append({'usd': ln['usd'], 'file': ln['file'] + '.wav',
                                     'dur': round(val, 3)})
            if counts['seen'] % 40 == 0 or counts['seen'] == len(lines):
                print('  %4d/%d  已渲 %d 跳过 %d 失败 %d  用时 %.0fs'
                      % (counts['seen'], len(lines), counts['done'],
                         counts['skipped'], counts['failed'], time.time() - t0))

    if jobs <= 1:
        for ln in lines:
            collect(one(ln))
    else:
        # 网络请求为主，并发就是线性加速。cosy 是单个模型实例，已在上面强制 jobs=1。
        with cf.ThreadPoolExecutor(max_workers=jobs) as ex:
            for r in ex.map(one, lines):
                collect(r)
    done, skipped, failed = counts['done'], counts['skipped'], counts['failed']

    # 运行时清单：只有真渲出来的才写进去，避免运行时去要一个不存在的文件
    idx = os.path.join(out, 'index.json')
    json.dump({'_note': '由 render-lines.py 生成。整句预渲染，禁止回退到拼接。',
               'engine': a.engine, 'voice': a.voice, 'rate': a.rate,
               'prefix': man['prefix'], 'sr': SR,
               'manualLadder': man.get('manualLadder', []),
               'lines': sorted(manifest_out, key=lambda r: r['usd'])},
              open(idx, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)

    total_mb = sum(os.path.getsize(os.path.join(out, f))
                   for f in os.listdir(out) if f.endswith('.wav')) / 1048576.0
    print('\n完成：渲 %d · 跳过 %d · 失败 %d · 用时 %.0fs' % (done, skipped, failed, time.time() - t0))
    if durs:
        durs.sort()
        print('时长：最短 %.2fs / 中位 %.2fs / 最长 %.2fs'
              % (durs[0], durs[len(durs) // 2], durs[-1]))
        over = sum(1 for d in durs if d > 3.5)
        print('超过 3.5 秒的：%d 条%s' % (over, '（会盖住下一笔订单的音效，考虑提高语速）' if over else ''))
    print('体积：%.1fMB' % total_mb)
    print('清单：%s' % idx)
    if failed:
        sys.exit(1)


if __name__ == '__main__':
    main()
