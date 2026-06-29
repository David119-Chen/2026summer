// 一份母片 → 兩份輸出。
//
//   來源（本地）：北海道隨身手冊-離線版-密碼鎖.html  ← Claude 匯出的加密母片，含全部字型
//   輸出①（發布）：index.html                       ← 線上版：AES 加密 + 字型走 Google CDN，~140KB
//                                                      （React/Babel 執行時由 unpkg 載入，線上會快取）
//   輸出②（本地）：北海道隨身手冊-離線版.html          ← 離線版：不加密、系統字、內嵌 React+ReactDOM+Babel，
//                                                      真正可離線開（~3MB），手動傳手機當備案
//
// 密碼從環境變數讀取，不寫進任何檔案：
//   PowerShell:  $env:HANDBOOK_PW='你的密碼'; node build.mjs
//   bash:        HANDBOOK_PW='你的密碼' node build.mjs
import fs from 'fs';
import zlib from 'zlib';
import path from 'path';

const SRC = '北海道隨身手冊-離線版-密碼鎖.html';
const ONLINE_OUT = 'index.html';
const OFFLINE_OUT = '北海道隨身手冊-離線版.html';
const CACHE = '.vendor-cache';
const PW = process.env.HANDBOOK_PW;
if (!PW) { console.error('請先設定環境變數 HANDBOOK_PW（解鎖密碼）'); process.exit(1); }

const NUL = String.fromCharCode(0);
const DELIM = NUL + '~~SECTION~~' + NUL;
const b64ToBytes = b64 => Uint8Array.from(Buffer.from(b64, 'base64'));
const bytesToB64 = u8 => Buffer.from(u8).toString('base64');
const enc = new TextEncoder();
const FONT_CDN = '\n<link href="https://fonts.googleapis.com/css2?family=Noto+Serif+TC:wght@500;600;700;900&family=Noto+Sans+TC:wght@400;500;700&display=swap" rel="stylesheet">\n';
// 內嵌 JS 時必須跳脫 </script>，否則會提前關閉 script 標籤
const escClose = s => s.replace(/<\/script/gi, '<\\/script');

async function deriveKey(saltBytes, iterations, usages) {
  const baseKey = await crypto.subtle.importKey('raw', enc.encode(PW), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: saltBytes, iterations, hash: 'SHA-256' },
    baseKey, { name: 'AES-GCM', length: 256 }, false, usages);
}

// 建置時抓 runtime（带本地快取，避免每次重抓 ~3MB）
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

// ---------- 解密母片（共用） ----------
const html = fs.readFileSync(SRC, 'utf8');
const blobRe = /(<script[^>]*id="encblob"[^>]*>)([\s\S]*?)(<\/script>)/;
const mm = html.match(blobRe);
if (!mm) throw new Error('找不到 encblob');
const BLOB = JSON.parse(mm[2]);
const decKey = await deriveKey(b64ToBytes(BLOB.s), BLOB.it, ['decrypt']);
let ptBuf;
try { ptBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBytes(BLOB.iv) }, decKey, b64ToBytes(BLOB.ct)); }
catch { console.error('解密失敗：密碼錯誤？'); process.exit(1); }
const parts = new TextDecoder().decode(ptBuf).split(DELIM);
if (parts.length !== 3) throw new Error('區段數不符：' + parts.length);
const manifest = JSON.parse(parts[0]);
const extText = parts[1];
const template = JSON.parse(parts[2]);

const allUuids = Object.keys(manifest);
const fontUuids = allUuids.filter(u => (manifest[u].mime || '').startsWith('font/'));
const jsUuid = allUuids.find(u => manifest[u].mime === 'text/javascript');

// ============ 輸出① 線上版（加密 + CDN 字型） ============
async function buildOnline() {
  const keep = {}; for (const u of allUuids) if (!fontUuids.includes(u)) keep[u] = manifest[u];
  let t = template.replace(/@font-face\s*\{[^}]*\}/g, m => fontUuids.some(u => m.includes(u)) ? '' : m);
  if (!t.includes('<helmet>')) throw new Error('找不到 <helmet>');
  t = t.replace('<helmet>', () => '<helmet>' + FONT_CDN).replace(/離線版/g, '線上版');
  const leaked = fontUuids.filter(u => t.includes(u));
  if (leaked.length) throw new Error('字型 uuid 殘留：' + leaked.length);

  const plaintext = JSON.stringify(keep) + DELIM + extText + DELIM + JSON.stringify(t);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const k = await deriveKey(salt, BLOB.it, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, enc.encode(plaintext)));
  const NEWBLOB = { s: bytesToB64(salt), it: BLOB.it, iv: bytesToB64(iv), ct: bytesToB64(ct) };
  let out = html.replace(blobRe, (_, a, __, c) => a + JSON.stringify(NEWBLOB) + c).replace(/離線版/g, '線上版');
  fs.writeFileSync(ONLINE_OUT, out);

  // 回環自測
  const v = JSON.parse(fs.readFileSync(ONLINE_OUT, 'utf8').match(blobRe)[2]);
  const vk = await deriveKey(b64ToBytes(v.s), v.it, ['decrypt']);
  const vp = new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBytes(v.iv) }, vk, b64ToBytes(v.ct))).split(DELIM);
  if (!(vp.length === 3 && JSON.parse(vp[2]) === t)) throw new Error('線上版自測失敗');
  console.log('① 線上版 index.html  ' + (fs.statSync(ONLINE_OUT).size / 1024).toFixed(0) + 'KB（加密 + CDN 字型，字型移除 ' + fontUuids.length + ' 子集）');
}

// ============ 輸出② 離線版（不加密 + 內嵌 runtime + 系統字） ============
// 重用母片裡「已驗證可運作」的 runBundle 渲染流程：不解密、直接餵明文，
// 並把 React/ReactDOM/Babel 預先內嵌，讓 support.js 跳過 unpkg。
async function buildOffline() {
  // 解出 support.js，讀它原本要抓的 runtime 版本（保持同步）
  const je = manifest[jsUuid];
  let sjs = Buffer.from(je.data, 'base64'); if (je.compressed) sjs = zlib.gunzipSync(sjs);
  const supportJs = sjs.toString('utf8');
  const pick = re => (supportJs.match(re) || [])[1];
  const reactUrl = pick(/\bREACT_URL\s*=\s*"([^"]+)"/);
  const reactDomUrl = pick(/\bREACT_DOM_URL\s*=\s*"([^"]+)"/);
  const babelUrl = pick(/\bBABEL_URL\s*=\s*"([^"]+)"/);
  if (!reactUrl || !reactDomUrl || !babelUrl) throw new Error('support.js 內找不到 runtime URL');
  const [react, reactdom, babel] = await Promise.all([fetchCached(reactUrl), fetchCached(reactDomUrl), fetchCached(babelUrl)]);

  // 從母片抽出 runBundle 函式原始碼（與線上版同一條渲染路徑）
  const rbStart = html.indexOf('async function runBundle');
  const rbEnd = html.indexOf('async function attempt', rbStart);
  if (rbStart < 0 || rbEnd < 0) throw new Error('母片裡找不到 runBundle');
  const runBundleSrc = html.slice(rbStart, rbEnd).trim();
  if (!/Babel\.transformScriptTags/.test(runBundleSrc)) throw new Error('runBundle 抽取不完整');

  // 只留 support.js（丟掉字型），template 移除內嵌字型 + Google Fonts 連線
  const keep = {}; for (const u of allUuids) if (!fontUuids.includes(u)) keep[u] = manifest[u];
  let t = template.replace(/@font-face\s*\{[^}]*\}/g, '');
  t = t.replace(/\s*<link[^>]*fonts\.(?:googleapis|gstatic)[^>]*>/gi, '');
  if (fontUuids.some(u => t.includes(u))) throw new Error('字型 uuid 殘留');

  // 明文三段（與解密後的格式相同），以 base64 內嵌避免任何字元破壞 HTML
  const b64 = s => Buffer.from(s, 'utf8').toString('base64');
  const bundle = JSON.stringify({ m: b64(JSON.stringify(keep)), e: b64(extText), t: b64(JSON.stringify(t)) });

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

  // 安全檢查：成品不可再引用任何外部資源（確保真離線）
  for (const host of ['unpkg.com', 'fonts.googleapis.com', 'fonts.gstatic.com']) {
    if (new RegExp('(src|href)="https?://' + host.replace(/\./g, '\\.'), 'i').test(offline))
      throw new Error('離線版仍引用外部資源：' + host);
  }
  fs.writeFileSync(OFFLINE_OUT, offline);
  console.log('② 離線版 ' + OFFLINE_OUT + '  ' + (fs.statSync(OFFLINE_OUT).size / 1048576).toFixed(2) + 'MB（不加密 + 內嵌 React/ReactDOM/Babel + 系統字）');
}

await buildOnline();
await buildOffline();
console.log('完成。母片 ' + (fs.statSync(SRC).size / 1048576).toFixed(1) + 'MB（保留本地當來源）');
