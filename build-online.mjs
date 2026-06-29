// 從「離線版加密母片」產生「線上版」精簡加密檔（index.html）。
//
// 一份來源 → 兩份輸出：
//   來源：北海道隨身手冊-離線版-密碼鎖.html（本地母片，含內嵌字型，~18MB）
//   輸出①：index.html        ← 本腳本產生，字型改走 Google CDN，~140KB，發布到 Pages
//   輸出②：離線版母片本身      ← 保留本地，手動傳到手機當離線備案
//
// 密碼從環境變數讀取，不寫進檔案：
//   PowerShell:  $env:HANDBOOK_PW='你的密碼'; node build-online.mjs
//   bash:        HANDBOOK_PW='你的密碼' node build-online.mjs
import fs from 'fs';

const SRC = '北海道隨身手冊-離線版-密碼鎖.html';
const OUT = 'index.html';
const PW = process.env.HANDBOOK_PW;
if (!PW) { console.error('請先設定環境變數 HANDBOOK_PW（解鎖密碼）'); process.exit(1); }

const NUL = String.fromCharCode(0);
const DELIM = NUL + '~~SECTION~~' + NUL;
const b64ToBytes = b64 => Uint8Array.from(Buffer.from(b64, 'base64'));
const bytesToB64 = u8 => Buffer.from(u8).toString('base64');
const enc = new TextEncoder();

async function deriveKey(saltBytes, iterations, usages) {
  const baseKey = await crypto.subtle.importKey('raw', enc.encode(PW), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: saltBytes, iterations, hash: 'SHA-256' },
    baseKey, { name: 'AES-GCM', length: 256 }, false, usages);
}

// 1. 取出母片的加密區塊
const html = fs.readFileSync(SRC, 'utf8');
const blobRe = /(<script[^>]*id="encblob"[^>]*>)([\s\S]*?)(<\/script>)/;
const mm = html.match(blobRe);
if (!mm) throw new Error('找不到 encblob');
const BLOB = JSON.parse(mm[2]);

// 2. 解密
const decKey = await deriveKey(b64ToBytes(BLOB.s), BLOB.it, ['decrypt']);
let ptBuf;
try {
  ptBuf = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBytes(BLOB.iv) }, decKey, b64ToBytes(BLOB.ct));
} catch { console.error('解密失敗：密碼錯誤？'); process.exit(1); }
const parts = new TextDecoder().decode(ptBuf).split(DELIM);
if (parts.length !== 3) throw new Error('區段數不符：' + parts.length);
const manifest = JSON.parse(parts[0]);
const extText = parts[1];
let template = JSON.parse(parts[2]);   // 真正的 HTML 字串

// 3. 區分「字型」與「執行環境(support.js)」；只保留非字型資產
const fontUuids = [], keepManifest = {};
for (const [uuid, e] of Object.entries(manifest)) {
  if ((e.mime || '').startsWith('font/')) fontUuids.push(uuid);
  else keepManifest[uuid] = e;
}

// 4. 移除內嵌 @font-face，改注入 Google Fonts CDN
template = template.replace(/@font-face\s*\{[^}]*\}/g, m =>
  fontUuids.some(u => m.includes(u)) ? '' : m);
const CDN = '\n<link href="https://fonts.googleapis.com/css2?family=Noto+Serif+TC:wght@500;600;700;900&family=Noto+Sans+TC:wght@400;500;700&display=swap" rel="stylesheet">\n';
if (!template.includes('<helmet>')) throw new Error('找不到 <helmet> 錨點');
template = template.replace('<helmet>', '<helmet>' + CDN);
template = template.replace(/離線版/g, '線上版');

// 5. 安全檢查：字型 uuid 不可殘留在 template 中
const leaked = fontUuids.filter(u => template.includes(u));
if (leaked.length) throw new Error('字型 uuid 殘留：' + leaked.length);

// 6. 只重新加密 manifest(support.js)+ext+template（新 salt / iv）
const plaintext = JSON.stringify(keepManifest) + DELIM + extText + DELIM + JSON.stringify(template);
const salt = crypto.getRandomValues(new Uint8Array(16));
const iv = crypto.getRandomValues(new Uint8Array(12));
const encKey = await deriveKey(salt, BLOB.it, ['encrypt']);
const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, encKey, enc.encode(plaintext)));
const NEWBLOB = { s: bytesToB64(salt), it: BLOB.it, iv: bytesToB64(iv), ct: bytesToB64(ct) };

// 7. 沿用母片的解鎖畫面與解密腳本，只抽換加密區塊
let online = html.replace(blobRe, (_, a, __, c) => a + JSON.stringify(NEWBLOB) + c);
online = online.replace(/離線版/g, '線上版');
fs.writeFileSync(OUT, online);

// 8. 回環自測：重新解開輸出檔，確認內容一致
const v = JSON.parse(fs.readFileSync(OUT, 'utf8').match(blobRe)[2]);
const vKey = await deriveKey(b64ToBytes(v.s), v.it, ['decrypt']);
const vparts = new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBytes(v.iv) }, vKey, b64ToBytes(v.ct))).split(DELIM);
const ok = vparts.length === 3 && JSON.parse(vparts[2]) === template;
console.log('字型移除：' + fontUuids.length + ' 個 woff2 → Google CDN');
console.log('自測解密：' + (ok ? 'OK' : '失敗') + '｜' + SRC + ' (' + (fs.statSync(SRC).size/1048576).toFixed(1) + 'MB) → ' + OUT + ' (' + (fs.statSync(OUT).size/1024).toFixed(0) + 'KB)');
if (!ok) process.exit(1);
