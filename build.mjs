// 一份可讀母片 → 兩份輸出。
//
//   母片（來源, 本地）：北海道隨身手冊-網頁版.dc.html  ← Claude design 匯出的「網頁版」，未加密、可讀可編輯
//   建置資產（本地）  ：support.js（dc-runtime 引擎）、shell.html（解鎖畫面 + 解密腳本 + runBundle）
//                       兩者一次性從加密母片抽出，內容穩定、不含行程；可由 18MB 母片重抽。
//
//   輸出①（發布）：index.html                ← 線上版：AES 加密 + 字型走 Google CDN，~140KB
//                                              （React/Babel 執行時由 unpkg 載入，線上會快取）
//   輸出②（本地）：北海道隨身手冊-離線版.html  ← 離線版：不加密、系統字、內嵌 React+ReactDOM+Babel，
//                                              真正可離線開（~3MB），手動傳手機當備案
//
// 密碼（HANDBOOK_PW）只用於「加密線上版輸出」，不寫進任何已提交的檔案。
// 取得順序：① 既有環境變數優先 ② 否則讀本地 .env（已被 gitignore 擋下）。
//   平常：把密碼放進 .env（內容：HANDBOOK_PW=...，可參考 .env.example），然後直接 `node build.mjs`
//   臨時覆蓋：PowerShell `$env:HANDBOOK_PW='...'; node build.mjs`／bash `HANDBOOK_PW='...' node build.mjs`
import fs from 'fs';
import zlib from 'zlib';
import path from 'path';
import crypto from 'crypto';

// 載入本地 .env（Node 20.12+ 內建，免裝套件）；已存在的環境變數優先，不被覆蓋
if (!process.env.HANDBOOK_PW && fs.existsSync('.env')) process.loadEnvFile('.env');

const DC = '北海道隨身手冊-網頁版.dc.html';   // 內容母片
const SUPPORT = 'support.js';                  // dc-runtime 引擎
const SHELL = 'shell.html';                    // 解鎖畫面 + 解密腳本 + runBundle
const ONLINE_OUT = 'index.html';
const OFFLINE_OUT = '北海道隨身手冊-離線版.html';
const CACHE = '.vendor-cache';
const PW = process.env.HANDBOOK_PW;
if (!PW) { console.error('找不到密碼。請在 .env 設定 HANDBOOK_PW=...（可參考 .env.example），或用環境變數提供。'); process.exit(1); }
for (const f of [DC, SUPPORT, SHELL]) if (!fs.existsSync(f)) { console.error('缺少建置來源：' + f); process.exit(1); }

const NUL = String.fromCharCode(0);
const DELIM = NUL + '~~SECTION~~' + NUL;
const bytesToB64 = u8 => Buffer.from(u8).toString('base64');
const b64ToBytes = b64 => Uint8Array.from(Buffer.from(b64, 'base64'));
const enc = new TextEncoder();
const escClose = s => s.replace(/<\/script/gi, '<\\/script');

// ---------- 共用：把 .dc.html 整理成 runBundle 用的 template + manifest ----------
const dcRaw = fs.readFileSync(DC, 'utf8');
const supportSrc = fs.readFileSync(SUPPORT, 'utf8');
const shell = fs.readFileSync(SHELL, 'utf8');
const blobRe = /(<script[^>]*id="encblob"[^>]*>)([\s\S]*?)(<\/script>)/;
const SUPPORT_UUID = crypto.randomUUID();

// support.js 以 gzip 收進 manifest（runBundle 會用 DecompressionStream 解開）
const manifest = { [SUPPORT_UUID]: { data: zlib.gzipSync(Buffer.from(supportSrc, 'utf8')).toString('base64'), mime: 'text/javascript', compressed: true } };
const extText = '[]';

// .dc.html → 共用基底：移除縮圖樣板、把外部 support.js 換成 uuid 參照
let baseTpl = dcRaw
  .replace(/<template id="__bundler_thumbnail"[\s\S]*?<\/template>\s*/i, '')
  .replace(/<script[^>]*src="\.\/support\.js"[^>]*>\s*<\/script>/i, () => `<script src="${SUPPORT_UUID}"></script>`);
if (!baseTpl.includes(SUPPORT_UUID)) throw new Error('.dc.html 裡找不到 ./support.js 參照');

async function deriveKey(saltBytes, usages) {
  const baseKey = await crypto.webcrypto.subtle.importKey('raw', enc.encode(PW), 'PBKDF2', false, ['deriveKey']);
  return crypto.webcrypto.subtle.deriveKey({ name: 'PBKDF2', salt: saltBytes, iterations: 250000, hash: 'SHA-256' }, baseKey, { name: 'AES-GCM', length: 256 }, false, usages);
}
async function fetchCached(url) {
  const file = path.join(CACHE, url.replace(/[^a-z0-9.@_-]/gi, '_'));
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8');
  const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0' } });
  if (!r.ok) throw new Error('抓取失敗 ' + r.status + ' ' + url);
  const txt = Buffer.from(await r.arrayBuffer()).toString('utf8');
  fs.mkdirSync(CACHE, { recursive: true });
  fs.writeFileSync(file, txt);
  return txt;
}

// ============ 輸出① 線上版（加密 + 沿用 .dc.html 的 CDN 字型） ============
async function buildOnline() {
  const template = baseTpl;  // .dc.html 本來就用 Google CDN 字型，不需處理
  const plaintext = JSON.stringify(manifest) + DELIM + extText + DELIM + JSON.stringify(template);
  const salt = crypto.webcrypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.webcrypto.getRandomValues(new Uint8Array(12));
  const k = await deriveKey(salt, ['encrypt']);
  const ct = new Uint8Array(await crypto.webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, enc.encode(plaintext)));
  const NEWBLOB = { s: bytesToB64(salt), it: 250000, iv: bytesToB64(iv), ct: bytesToB64(ct) };
  const out = shell.replace(blobRe, (_, a, __, c) => a + JSON.stringify(NEWBLOB) + c).replace(/離線版/g, '線上版');
  fs.writeFileSync(ONLINE_OUT, out);

  // 回環自測：重新解開輸出檔，確認可解密且 template 一致
  const v = JSON.parse(fs.readFileSync(ONLINE_OUT, 'utf8').match(blobRe)[2]);
  const vk = await deriveKey(b64ToBytes(v.s), ['decrypt']);
  const vp = new TextDecoder().decode(await crypto.webcrypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBytes(v.iv) }, vk, b64ToBytes(v.ct))).split(DELIM);
  if (!(vp.length === 3 && JSON.parse(vp[2]) === template)) throw new Error('線上版自測失敗');
  console.log('① 線上版 index.html  ' + (fs.statSync(ONLINE_OUT).size / 1024).toFixed(0) + 'KB（加密 · CDN 字型）');
}

// ============ 輸出② 離線版（不加密 + 內嵌 runtime + 系統字） ============
async function buildOffline() {
  // 離線：移除 Google Fonts 連線（改用系統字）
  const template = baseTpl.replace(/\s*<link[^>]*fonts\.(?:googleapis|gstatic)[^>]*>/gi, '');

  // 內嵌 React/ReactDOM/Babel（版本沿用 support.js 內指定的），讓 support.js 跳過 unpkg
  const pick = re => (supportSrc.match(re) || [])[1];
  const urls = { react: pick(/\bREACT_URL\s*=\s*"([^"]+)"/), reactdom: pick(/\bREACT_DOM_URL\s*=\s*"([^"]+)"/), babel: pick(/\bBABEL_URL\s*=\s*"([^"]+)"/) };
  if (!urls.react || !urls.reactdom || !urls.babel) throw new Error('support.js 內找不到 runtime URL');
  const [react, reactdom, babel] = await Promise.all([fetchCached(urls.react), fetchCached(urls.reactdom), fetchCached(urls.babel)]);

  // 重用 shell.html 裡「已驗證」的 runBundle 渲染流程
  const rbStart = shell.indexOf('async function runBundle');
  const rbEnd = shell.indexOf('async function attempt', rbStart);
  if (rbStart < 0 || rbEnd < 0) throw new Error('shell.html 裡找不到 runBundle');
  const runBundleSrc = shell.slice(rbStart, rbEnd).trim();
  if (!/Babel\.transformScriptTags/.test(runBundleSrc)) throw new Error('runBundle 抽取不完整');

  const b64 = s => Buffer.from(s, 'utf8').toString('base64');
  const bundle = JSON.stringify({ m: b64(JSON.stringify(manifest)), e: b64(extText), t: b64(JSON.stringify(template)) });

  const offline = `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<title>北海道隨身手冊</title>
<style>html,body{margin:0;padding:0}body{background:#E9E4D8}</style>
</head>
<body>
<noscript>請啟用 JavaScript 以開啟手冊</noscript>
<script>${escClose(react)}</script>
<script>${escClose(reactdom)}</script>
<script>${escClose(babel)}</script>
<script id="dcbundle" type="application/json">${bundle}</script>
<script>
${runBundleSrc}
(function(){
  var B = JSON.parse(document.getElementById('dcbundle').textContent);
  function dec(b64){ var bin=atob(b64); var u=new Uint8Array(bin.length); for(var i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i); return new TextDecoder().decode(u); }
  runBundle(dec(B.m), dec(B.e), dec(B.t));
})();
</script>
</body>
</html>`;

  for (const host of ['unpkg.com', 'fonts.googleapis.com', 'fonts.gstatic.com']) {
    if (new RegExp('(src|href)="https?://' + host.replace(/\./g, '\\.'), 'i').test(offline))
      throw new Error('離線版仍引用外部資源：' + host);
  }
  fs.writeFileSync(OFFLINE_OUT, offline);
  console.log('② 離線版 ' + OFFLINE_OUT + '  ' + (fs.statSync(OFFLINE_OUT).size / 1048576).toFixed(2) + 'MB（不加密 · 內嵌 runtime · 系統字）');
}

await buildOnline();
await buildOffline();
console.log('完成。來源：' + DC + '（' + (fs.statSync(DC).size / 1024).toFixed(0) + 'KB，可讀母片）');
