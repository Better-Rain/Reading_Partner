# Architecture

## Product Direction

Reading Partner is a local-first desktop app for reading large PDF literature with AI assistance. The app should feel like a real reading desk, not a chat wrapper: every highlight, note, translation, summary, and AI explanation should remain attached to the source document, page, and selected text.

The first product milestone is a reliable PDF reading and annotation MVP. RAG, OCR, concept maps, and exports come after the reading surface and data model are stable.

## Stack

| Layer | Choice | Reason |
| --- | --- | --- |
| Desktop shell | Electron | Stable Chromium runtime for PDF.js, text selection, canvas rendering, file dialogs, and mature packaging. |
| UI | React + TypeScript | Component model fits reader panels, floating tools, and stateful annotations. |
| Build | Vite + electron-vite | Fast development loop and clear separation between main, preload, and renderer. |
| PDF | `react-pdf` / PDF.js | Uses Mozilla PDF.js and provides text layer support for selection. |
| Local database | SQLite via `better-sqlite3` | Local-first, simple backups, good enough for documents, annotations, notes, vocabulary, and FTS. |
| IPC | Electron `contextBridge` + typed channels | Renderer never gets Node access directly. |
| AI | OpenAI-compatible provider adapter | DeepSeek, Alibaba Bailian/Qwen, Kimi, Zhipu, and custom providers can share one interface. |
| Styling | Plain CSS first | The MVP needs precise layout and readable density before introducing a larger design system. |

## Process Boundaries

### Main Process

Responsibilities:

- Window lifecycle.
- Native file dialogs.
- Reading PDF files from disk.
- SQLite database initialization and queries.
- Secure AI key storage in a later milestone.
- AI provider requests in a later milestone, so API keys do not enter the renderer.

### Preload

Responsibilities:

- Expose a small typed API under `window.readingPartner`.
- Hide raw IPC channels from the renderer.
- Keep the renderer sandboxed.

### Renderer

Responsibilities:

- PDF reading UI.
- Selection toolbar.
- Annotation and note interface.
- AI panel.
- Provider configuration form.

Renderer state should be treated as UI state. Durable reading state belongs in SQLite through IPC.

## Initial App Layout

The first screen is the reading workspace:

- Left rail: library, recent PDFs, document outline later.
- Center: PDF viewer.
- Right rail: annotations, AI actions, provider settings.
- Floating toolbar: appears after text selection with highlight, note, translate, and explain actions.

## Source Anchoring

Every user-created and AI-created artifact should be source anchored.

Minimum anchor:

- `document_id`
- `page_number`
- `selected_text`

Later anchor:

- Bounding rectangles per page.
- Text quote selector with prefix/suffix.
- Content hash for drift detection.

This keeps AI output auditable: answers should point back to page numbers and source passages.

## AI Design

AI should be a reading assistant, not the database of record.

Core rules:

- Store prompts and outputs as artifacts.
- Store model/provider metadata.
- Prefer local dictionary lookup for single-word translation.
- Use long-context models only when the task truly needs them.
- For book-level Q&A, retrieve relevant chunks first instead of sending the entire PDF.

## Security Notes

- API keys must not be stored in renderer localStorage.
- Main process should own provider credentials.
- External content in AI responses should be rendered as sanitized Markdown when Markdown rendering is added.
- PDF file paths should be persisted locally, but sync/export features must treat them as sensitive user data.

