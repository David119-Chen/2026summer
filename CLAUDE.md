# 北海道隨身手冊 — 專案說明

家庭旅遊用的加密行程手冊，發布為 GitHub Page，方便旅途中用手機開啟。
本手冊原始設計來自 Claude design（artifact），是一個「執行時編譯的 React App」。

- Repo: https://github.com/David119-Chen/2026summer
- Pages: https://david119-chen.github.io/2026summer/
- 線上版密碼：**不寫在此**。建置時由環境變數 `HANDBOOK_PW` 提供。

## 一份母片 → 兩份輸出

唯一的內容來源是 Claude design 匯出的「加密母片」。`build.mjs` 從它產生兩份輸出：

| 角色 | 檔名 | 大小 | 加密 | 字型 | 版控 |
|------|------|------|------|------|------|
| **母片（來源）** | `北海道隨身手冊-母片-密碼鎖.html` | ~18MB | AES-GCM | 內嵌全 CJK | 🔒 本地（gitignored） |
| **線上版（發布）** | `index.html` | ~140KB | AES-GCM | Google CDN | ✅ 發布 Pages |
| **離線版（備案）** | `北海道隨身手冊-離線版.html` | ~3.1MB | 無 | 系統字 | 🔒 本地（gitignored） |
| 舊網址轉址頁 | `北海道隨身手冊-離線版-密碼鎖.html` | <1KB | — | — | ✅ 發布（純 redirect） |

- **線上版**：行程內容用密碼（PBKDF2 25 萬次迭代 → AES-GCM）加密，原文不存在檔案裡；字型走 Google Fonts CDN。React/ReactDOM/Babel 執行時由 unpkg 載入（線上有網、會快取）。
- **離線版**：不加密、直接開、含行程明文，**只能留本地**手動傳手機當備案。已把 React/ReactDOM/Babel 內嵌，實測載入時零外部請求，飛航模式可開。
- **轉址頁**：沿用舊長檔名網址，純 `<meta refresh>` + JS 導向 `index.html`，不含任何行程內容。

## 架構重點（dc-runtime）

手冊本體是 Claude design 的 React artifact，靠內嵌的 `support.js`（dc-runtime，~58KB）渲染：
- `support.js` 會去 unpkg 抓 **React 18.3.1 + ReactDOM + @babel/standalone 7.26.4**；Babel 在瀏覽器即時把 `<x-dc>` 樣板 + JSX 元件編譯成 React App。
- 因為框架靠 CDN，**離線版必須把這三包內嵌**（Babel 就佔 ~2.9MB），否則沒網路會白畫面。
- 離線版的渲染**重用母片裡已驗證的 `runBundle()` 流程**（與線上版同一條路徑）；不要改用 support.js 的自動 boot——它會把檔名誤判為元件名而渲染失敗。
- 母片裡沒有內嵌圖檔，唯一肥的就是字型。

## 如何更新行程

1. 在 Claude design 改內容 → 匯出新的加密母片，覆蓋本地 `北海道隨身手冊-母片-密碼鎖.html`（沿用同密碼）。
2. 設定密碼並重建兩份輸出：
   ```powershell
   $env:HANDBOOK_PW='（密碼）'; node build.mjs
   ```
   - bash: `HANDBOOK_PW='（密碼）' node build.mjs`
3. 發布線上版：`git add index.html && git commit && git push`。
4. 離線版備案：把產生的 `北海道隨身手冊-離線版.html` 複製到手機（不會、也不該進版控）。

## 安全 / 版控規則（`.gitignore`）

- **預設忽略所有 `*.html`**，只白名單放行兩個「不含行程明文」的檔：`index.html`（密文）與轉址頁。
- 含明文或母片的檔（離線版、母片、`*.dc.html`）一律本地，**絕不可推上 GitHub**。
- 密碼只走 `HANDBOOK_PW` 環境變數，**不可寫進任何 commit、CLAUDE.md、build.mjs**。
- `.vendor-cache/`（建置時抓的 React/Babel）與 `.claude/launch.json`（預覽用）皆已忽略。
- 改 gitignore 或新增檔案後，務必確認離線版/母片仍被 `git check-ignore` 擋下再 commit。

## 已知待辦（選擇性）

- git 歷史中仍留有早期 commit 的 18MB 母片（密文、安全，但會讓 clone 變大）。若要徹底移除需 `git filter-repo` 重寫歷史並 force push（破壞性，未執行）。
