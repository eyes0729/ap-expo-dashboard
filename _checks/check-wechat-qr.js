/* 验收：左下角使用用户提供的微信二维码，不再出现调研抽奖文案。 */
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'E-后台-可操作版', 'index.html'), 'utf8');
const image = path.join(ROOT, 'E-后台-可操作版', 'wechat-qr.png');

if (!fs.existsSync(image) || fs.statSync(image).size < 1000) throw new Error('微信二维码图片缺失');
if (!/id="lotQr"[^>]+src="wechat-qr\.png"/.test(html)) throw new Error('页面未引用微信二维码');
if (!html.includes('扫描添加微信')) throw new Error('缺少“扫描添加微信”文案');
if (/扫码参与调研抽奖|100% 中奖/.test(html)) throw new Error('旧抽奖文案仍然可见');
console.log('通过：微信二维码图片和文案均已替换');
