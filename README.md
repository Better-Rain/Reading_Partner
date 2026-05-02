# Reading Partner

Reading Partner is a desktop reading workspace for large PDF books and papers. The target experience is close to a research-focused PDF reader plus notebook: open heavy PDFs, highlight passages, add comments and bookmarks, translate words or sentences, and bind AI explanations back to exact source passages.

The project is planned around a local-first architecture. Reading data, annotations, AI artifacts, vocabulary items, and provider settings are stored locally first, with model calls routed through configurable OpenAI-compatible providers that are accessible in China.

## Current Status

This repository has been initialized with the first Electron + React + TypeScript scaffold. The initial implementation focuses on:

- Desktop shell with Electron.
- React reading workspace.
- PDF opening and rendering through PDF.js via `react-pdf`.
- Local SQLite data model owned by the Electron main process.
- Annotation and AI Provider IPC boundaries.
- A right-side panel for notes, AI actions, and provider configuration.

## Recommended Local Setup

Required:

- Node.js 22+.
- npm 10+.
- Git for Windows.

Install and run:

```powershell
$env:ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/'
npm install
npm run dev
```

The `ELECTRON_MIRROR` line uses the npmmirror Electron binary mirror because the default Electron download host can be slow or blocked on domestic networks.
The project also sets `omit=optional` in `.npmrc` to avoid optional native packages such as `canvas` blocking installation on Windows. Rollup's Windows binary package is listed explicitly in `devDependencies`.

Useful checks:

```powershell
npm run typecheck
npm run lint
npm run build
```

## Documents

- [Architecture](docs/ARCHITECTURE.md)
- [Roadmap](docs/ROADMAP.md)
- [AI Provider Strategy](docs/AI_PROVIDER_STRATEGY.md)
- [Data Model](docs/DATA_MODEL.md)
