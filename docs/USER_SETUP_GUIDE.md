# User Setup Guide

This guide covers the manual operations that cannot be completed reliably by the coding agent: GitHub authentication and AI provider API Key creation.

## 1. Install Dependencies

The project is configured to skip optional native packages because `canvas` can block installation on Windows. Rollup's Windows binary is listed explicitly.

In PowerShell:

```powershell
cd "<project-directory>"
$env:ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/'
npm install
```

Run the app:

```powershell
npm run dev
```

Build check:

```powershell
npm run build
```

Harness smoke checks:

```powershell
npm run probe:local
npm run probe:cancel
npm run probe:deepseek
npm run probe:electron
```

`probe:local` exercises the local LLM Hub tool loop. `probe:cancel` uses a local
mock stream to verify cancellation preserves partial output. `probe:deepseek` uses the
encrypted key already stored by the app and checks the live DeepSeek endpoint.
`probe:electron` launches an isolated Electron profile, copies the current
local database when available, and verifies preload, document loading, chat
completion, and the AI operation action before cleaning up. These probes do
not belong in CI because the local profile and provider credentials are
machine-specific.

## 2. Push to GitHub

The remote is already configured:

```powershell
git remote -v
```

Expected remote:

```text
origin  git@github.com:Better-Rain/Reading_Partner.git (fetch)
origin  git@github.com:Better-Rain/Reading_Partner.git (push)
```

Push when the network can reach GitHub:

```powershell
git push -u origin main
```

If Git opens a browser or Git Credential Manager prompt:

1. Sign in with your GitHub account.
2. Authorize Git Credential Manager.
3. Re-run `git push -u origin main` if the first push was interrupted.

If SSH is unavailable, HTTPS can be used temporarily with `git remote set-url origin https://github.com/Better-Rain/Reading_Partner.git`. If the error is `Failed to connect to github.com port 443`, it is a network issue. Retry after switching network, proxy, or VPN.

## 3. Configure AI Provider API Keys

Open the app, then:

1. Go to the right-side `配置` tab.
2. Pick a provider, for example DeepSeek or Qwen.
3. Paste the API Key into that provider's password input.
4. Click `保存`.
5. Keep the provider enabled.
6. Open a PDF, select text, and choose `翻译` or `解释`.

The API Key is sent to the Electron main process and encrypted through Electron `safeStorage`. The renderer page only receives a "key saved / no key" status.

## 4. Provider Notes

### DeepSeek

Recommended for the first live test because the API is OpenAI-compatible and the base URL is already set:

```text
https://api.deepseek.com
```

Default model in the app:

```text
deepseek-v4-flash
```

The current harness has been verified against this account with a normal streamed answer, an annotation tool call, the follow-up answer after the tool result, and a later follow-up question.

### Local LLM Hub

The app seeds a `本地 LLM Hub` provider on first launch:

```text
Base URL: http://127.0.0.1:18080/v1
Model: qwen-local
API Key: not required; the app uses local-only
```

For `qwen-reason`, change the model field to `qwen-reason`; the app automatically sends `llm_hub_mode: thinking`. Other local models use `direct`. Local tool-call and second-round completion have also been verified.

### Alibaba Bailian / Qwen

Base URL:

```text
https://dashscope.aliyuncs.com/compatible-mode/v1
```

Default model:

```text
qwen3.5-flash
```

### Kimi / Moonshot

Base URL:

```text
https://api.moonshot.ai/v1
```

Default model:

```text
kimi-k2-0905-preview
```

### Zhipu GLM

Base URL:

```text
https://open.bigmodel.cn/api/paas/v4
```

Default model:

```text
glm-4.5-flash
```

If a provider changes model names, update `defaultModel` in the app's provider configuration later. The current UI stores base provider records in the local SQLite database.

## 5. Current AI Workflow

1. Import a PDF.
2. Select text on the current page.
3. Use the floating toolbar:
   - `翻译`: translate selected text into Chinese.
   - `解释`: explain selected text.
4. Or use the AI panel for:
   - translate
   - explain
   - summarize
5. The streamed result is saved as a note attached to the source page and selected text.
6. In co-reading chat or an explicit document annotation request, the model may call `create_annotations`. The app validates and stores candidate marks, returns the tool result to the model, and then completes the answer. Use the operation card's `保留` or `撤销` action to decide what remains.

Tool failure, unsupported tool schemas, or stopping output do not cancel an otherwise completed answer. Unsupported providers automatically retry once without tools, and the message can be sent again after stopping.

## 6. Local Data Locations

Electron stores app data in the user data directory. On Windows it is usually:

```text
%APPDATA%\reading-partner
```

Important local files:

```text
reading-partner.sqlite
secrets.json
```

`secrets.json` contains encrypted API keys. Do not commit it to Git.

## 7. Import a Local English-Chinese Dictionary

The app can use a local dictionary before spending model tokens. It supports:

- ECDICT-style `stardict.csv`.
- StarDict binary dictionaries with `.ifo`, `.idx`, and `.dict` files.

Recommended workflow:

1. Download or clone ECDICT on your machine.
2. Locate either `stardict.csv` or the StarDict `.ifo` file.
3. Open Reading Partner.
4. Go to the right-side `词汇` tab.
5. Click `导入词典`.
6. Select `stardict.csv` or a `.ifo` file.
7. Wait for the status line to show the imported count.

After import:

- Selecting a word or phrase and clicking `生词` first searches the local dictionary.
- If a match is found, the vocabulary entry is saved with the local translation and definition.
- If no match is found, the entry is saved as `待补充释义`; you can then click `AI 释义`.

Supported CSV shapes:

- ECDICT-like column order: `word, phonetic, definition, translation, pos, ... exchange ...`.
- Header-based CSVs with fields such as `word`, `phonetic`, `definition`, `translation`, `pos`, and `exchange`.

For large StarDict dictionaries, the app registers the dictionary source and performs exact lookups on demand. It does not copy millions of entries into the main app database.

## 8. Cross-Computer Reading Record Migration

Keep PDF files in a dedicated library directory outside the code repository, for example:

```text
E:\Programs\Reading Partner Library
```

Use the same directory for future books so the database keeps stable local paths. A reading-record migration should include the PDF and either the source `reading-partner.sqlite` database or an exported `.reading-partner-marks.json` file. The SQLite database also contains vocabulary, document indexes, AI artifacts, and co-reading history; the JSON export contains user annotations only.

API keys are not portable between computers because Electron encrypts them with the source machine's key store. Configure the provider key again on the destination computer after migration.
