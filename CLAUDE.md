# 北海道隨身手冊 — 專案說明

家庭旅遊用的加密行程手冊，發布為 GitHub Page，方便旅途中用手機開啟。
本手冊原始設計來自 Claude design（artifact），是一個「執行時編譯的 React App」。

- Repo: https://github.com/David119-Chen/2026summer
- Pages: https://david119-chen.github.io/2026summer/
- 線上版密碼：**不寫在此**。建置時由環境變數 `HANDBOOK_PW` 提供。

## 一份可讀母片 → 兩份輸出

內容母片是 Claude design 匯出的「網頁版」`.dc.html`（未加密、可讀可編輯）。
`build.mjs` 把它 + 兩個穩定建置資產，產生兩份輸出。

### 檔案角色

| 角色 | 檔名 | 大小 | 版控 | 說明 |
|------|------|------|------|------|
| **內容母片（來源）** | `北海道隨身手冊-網頁版.dc.html` | ~74KB | 🔒 本地 | 未加密、可讀；**改行程就是改這個**。含行程明文 |
| 建置資產 | `support.js` | ~58KB | 🔒 本地 | dc-runtime 引擎（`.dc.html` 原本外部引用它） |
| 建置資產 | `shell.html` | ~8KB | 🔒 本地 | 解鎖畫面 + 解密腳本（含 `runBundle`） |
| **線上版（發布）** | `index.html` | ~140KB | ✅ 發布 | AES 加密 · 字型走 Google CDN |
| **離線版（備案）** | `北海道隨身手冊-離線版.html` | ~3.1MB | 🔒 本地 | 不加密 · 系統字 · 內嵌 React/ReactDOM/Babel |
| 舊網址轉址頁 | `北海道隨身手冊-離線版-密碼鎖.html` | <1KB | ✅ 發布 | 純 redirect → index.html |
| 加密封存（備份） | `北海道隨身手冊-加密封存-密碼鎖.html` | ~18MB | 🔒 本地 | 最初的加密匯出；**建置已不讀它**。`support.js`/`shell.html` 當初從這裡抽出，留作重抽來源 |

- **線上版**：行程內容用密碼（PBKDF2 25 萬次迭代 → AES-GCM）加密，原文不存在檔案裡；字型走 Google Fonts CDN。React/ReactDOM/Babel 執行時由 unpkg 載入（線上有網、會快取）。
- **離線版**：不加密、直接開、含行程明文，**只能留本地**手動傳手機當備案。已內嵌 React/ReactDOM/Babel，實測載入時零外部請求，飛航模式可開。
- **轉址頁**：沿用舊長檔名網址，純 `<meta refresh>` + JS 導向 `index.html`，不含任何行程內容。

## 架構重點（dc-runtime）

手冊本體是 Claude design 的 React artifact，靠 `support.js`（dc-runtime，~58KB）渲染：
- `support.js` 會去 unpkg 抓 **React 18.3.1 + ReactDOM + @babel/standalone 7.26.4**；Babel 在瀏覽器即時把 `<x-dc>` 樣板 + JSX 元件編譯成 React App。
- 因為框架靠 CDN，**離線版必須把這三包內嵌**（Babel 就佔 ~2.9MB），否則沒網路會白畫面。
- 兩份輸出都**重用 `shell.html` 裡已驗證的 `runBundle()` 渲染流程**（`documentElement.replaceWith` → 依序重跑 scripts → boot）。**不要改用 support.js 的自動 boot**——它會把檔名誤判為元件名而渲染失敗。
- `.dc.html` 用外部 `./support.js` + Google CDN 字型；build.mjs 會把 support.js 以 uuid 收進 manifest（線上）或內嵌（離線）。

## 如何更新行程

1. 在 Claude design 改內容 → 匯出新的「網頁版」，覆蓋本地 `北海道隨身手冊-網頁版.dc.html`。
   （若 Claude 升級了 runtime，可能要重抽 `support.js`/`shell.html`：從加密封存檔解密取得。）
2. 設定密碼並重建兩份輸出：
   ```powershell
   $env:HANDBOOK_PW='（密碼）'; node build.mjs
   ```
   - bash: `HANDBOOK_PW='（密碼）' node build.mjs`
3. 發布線上版：`git add index.html && git commit && git push`。
4. 離線版備案：把產生的 `北海道隨身手冊-離線版.html` 複製到手機（不會、也不該進版控）。

## 安全 / 版控規則（`.gitignore`）

- **預設忽略所有 `*.html`**，只白名單放行兩個「不含行程明文」的檔：`index.html`（密文）與轉址頁。
- `support.js` 也忽略（屬建置輸入）。含明文的檔（`.dc.html`、離線版）一律本地，**絕不可推上 GitHub**。
- 密碼只走 `HANDBOOK_PW` 環境變數，**不可寫進任何 commit、CLAUDE.md、build.mjs**。
- `.vendor-cache/`（建置時抓的 React/Babel）與 `.claude/launch.json`（預覽用）皆已忽略。
- 改 gitignore 或新增檔案後，務必 `git check-ignore` 確認 `.dc.html`／離線版仍被擋下再 commit。
