/* 验收：最新版后台的系统 TTS 兜底只选择配置名单中的中文女声。 */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');

const ctx = {
  console, Math, Date, setTimeout, setInterval: function () {},
  speechSynthesis: {
    getVoices: function () {
      return [
        { name: 'Eddy (Chinese (China mainland))', lang: 'zh_CN' },
        { name: 'Tingting', lang: 'zh_CN' },
        { name: 'Alex', lang: 'en_US' }
      ];
    },
    speak: function () {}, cancel: function () {}
  },
  SpeechSynthesisUtterance: function (text) { this.text = text; }
};
ctx.window = ctx; ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', '_shared', 'audio.js'), 'utf8'), ctx);

const selected = ctx.APAudio.setFallbackVoiceNames(['Tingting', 'Xiaoxiao']);
if (selected !== 'Tingting') throw new Error('错误音色：' + selected);
if (!ctx.APAudio.voiceAvailable) throw new Error('女声未识别为可用');
if (!ctx.APAudio.setSystemVoiceOnly(true) || !ctx.APAudio.systemVoiceOnly) {
  throw new Error('没有锁定系统女声模式');
}

ctx.APAudio.setFallbackVoiceNames(['Xiaoxiao']);
if (ctx.APAudio.voiceAvailable) throw new Error('女声不存在时不应回退到 Eddy 男声');
console.log('通过：优先使用 Tingting 女声，且不会回退到男声');
