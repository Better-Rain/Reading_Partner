# Roadmap

## Phase 0: Project Foundation

Status: in progress.

Goals:

- Initialize Git repository.
- Create Electron + React + TypeScript scaffold.
- Define architecture, data model, and AI provider strategy.
- Establish lint, typecheck, and build scripts.

Exit criteria:

- `npm run dev` opens a desktop window.
- `npm run typecheck` passes.
- The repository contains durable planning documents.

## Phase 1: PDF Reading MVP

Goals:

- Open local PDF files.
- Render pages with text selection.
- Support page navigation and zoom.
- Persist imported documents in SQLite.
- Persist annotations, bookmarks, and notes.

Initial scope:

- One active PDF at a time.
- Text selection-based annotation.
- Annotation list in the right panel.
- Page-level bookmarks.

Deferred:

- Writing annotations back into PDF files.
- Multi-window reading.
- PDF outline synchronization.

## Phase 2: AI-Assisted Reading

Status: in progress.

Implemented:

- Configurable OpenAI-compatible provider presets.
- Encrypted API Key storage through Electron `safeStorage`.
- Main-process streaming AI requests.
- Selection translation, explanation, and summary entry points.
- AI output saved back as source-linked notes.

Remaining goals:

- Configure OpenAI-compatible providers.
- Add DeepSeek and Alibaba Bailian/Qwen presets.
- Add Kimi and Zhipu presets.
- Stream model output in the right panel.
- Save AI output as source-linked notes.
- Add cancellable requests.
- Add model/base URL editing in the UI.
- Add saved AI artifact browser separate from note annotations.

Initial AI actions:

- Translate selected text.
- Explain selected text.
- Summarize selected text.
- Ask a question about selected text.

Exit criteria:

- A user can select PDF text, ask for an explanation, and save the result as a note bound to the selected passage.

## Phase 3: English Reading Tools

Status: in progress.

Implemented:

- Local vocabulary table and IPC APIs.
- Right-side vocabulary panel.
- Manual vocabulary entry for the active PDF.
- Add selected PDF text to the vocabulary book with source page and source sentence.

Goals:

- Add local English-Chinese dictionary lookup.
- Add vocabulary book.
- Save word, definition, source sentence, document, and page.
- Add AI fallback for phrases and difficult sentences.

Recommended source:

- ECDICT local dictionary imported into SQLite.

Remaining work:

- Import ECDICT into a local lookup table.
- Prefer local dictionary lookup before AI calls.
- Add "AI refine definition" for vocabulary entries.
- Add export support for vocabulary and review cards.

## Phase 4: Search and RAG

Goals:

- Extract PDF text into page and paragraph chunks.
- Add SQLite FTS5 full-text search.
- Add embeddings and vector retrieval.
- Ask questions across a document with page citations.

Important rule:

- Do not send entire books to the model by default. Retrieve relevant chunks and cite source pages.

## Phase 5: Knowledge Organization

Goals:

- Convert highlights into excerpt cards.
- Add tags, backlinks, and parent-child relationships.
- Generate chapter summaries.
- Generate review cards.
- Export Markdown and Anki-friendly formats.

## Phase 6: Advanced Reading

Goals:

- OCR for scanned PDFs.
- Import existing PDF annotations.
- Export annotations back to PDF where practical.
- Multi-document projects.
- Backup and migration.
- Windows installer.
