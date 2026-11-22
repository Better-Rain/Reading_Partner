# Architecture

## Product Direction

Reading Partner is a local-first desktop app for reading large PDF literature with AI assistance. The app should feel like a real reading desk, not a chat wrapper: every highlight, note, translation, summary, and AI explanation should remain attached to the source document, page, and selected text.

The first product milestone is a reliable PDF reading and annotation MVP. The current implementation also includes local text indexing, document retrieval, and OCR; concept maps and richer export workflows remain future work.

## Stack

| Layer | Choice | Reason |
| --- | --- | --- |
| Desktop shell | Electron | Stable Chromium runtime for PDF.js, text selection, canvas rendering, file dialogs, and mature packaging. |
| UI | React + TypeScript | Component model fits reader panels, floating tools, and stateful annotations. |
| Build | Vite + electron-vite | Fast development loop and clear separation between main, preload, and renderer. |
| PDF | `react-pdf` / PDF.js | Uses Mozilla PDF.js and provides text layer support for selection. |
| Local database | SQLite via `sql.js` | Local-first persistence without Windows native build friction; suitable for documents, annotations, notes, vocabulary, and early search indexes. |
| IPC | Electron `contextBridge` + typed channels | Renderer never gets Node access directly. |
| AI | OpenAI-compatible provider adapter | DeepSeek, Alibaba Bailian/Qwen, Kimi, Zhipu, and custom providers can share one interface. |
| Styling | Plain CSS first | The MVP needs precise layout and readable density before introducing a larger design system. |

## Process Boundaries

### Main Process

Responsibilities:

- Window lifecycle.
- Native file dialogs.
- Reading PDF files from disk.
- Extracting PDF page text and search/RAG chunks.
- SQLite database initialization and queries.
- Secure AI key storage through Electron `safeStorage`.
- AI provider requests, so API keys do not enter the renderer.

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

## Text Indexing

PDF text extraction is owned by the main process. After a PDF loads successfully in the renderer, the renderer asks the main process to ensure a text index exists. The main process uses PDF.js to extract page text, writes `document_pages`, then splits page text into paragraph-aware `document_chunks`.

Current behavior:

- Indexing is cached per document and skipped when all pages have already been processed.
- Scanned pages can be recognized locally on the current page or across the whole document. OCR text is written back into `document_pages` and `document_chunks`, and OCR line geometry is stored for the transparent selection layer.
- Chunks retain source page numbers, which is the citation anchor for document search and RAG.

## AI Design

AI should be a reading assistant, not the database of record.

Core rules:

- Store prompts and outputs as artifacts.
- Store model/provider metadata.
- Prefer local dictionary lookup for single-word translation.
- Use long-context models only when the task truly needs them.
- For book-level Q&A, retrieve relevant chunks first instead of sending the entire PDF.

Current implementation:

- Renderer sends selected text, prompt type, document id, and page number through IPC.
- Main process retrieves the encrypted provider key, calls the OpenAI-compatible `/chat/completions` endpoint with `stream: true`, and emits typed stream events back to the renderer. The adapter accepts UTF-8 SSE and JSON responses, `content`, `reasoning`/`reasoning_content`, and streamed `tool_calls`.
- On completion, the main process stores an `ai_artifacts` row.
- The renderer also creates a visible note annotation from the returned AI artifact.
- Document Q&A and co-reading chats retrieve current-page context plus nearby page chunks, with larger context/history windows for providers that support long context.
- Co-reading and explicit document annotation requests expose a `create_annotations` OpenAI-compatible function. The main process validates page bounds, note length, colors, duplicate items, and selection anchors before writing candidate annotations. It emits a separate `annotations` event, sends the tool result back to the model, and only then saves the final answer. Candidates remain reversible through the renderer's keep/revert operation card.
- Providers that reject tool schemas automatically retry once without tools. A legacy `RP_ANNOTATIONS` HTML comment remains a fallback for older models, and is stripped before visible rendering.
- Each round has a 300-second request timeout and a 120-second read-idle timeout. Cancellation aborts the underlying fetch and reader; errors retain partial output and reasoning so the conversation can be recovered or resent.
- The bundled local Hub is recognized at `http://127.0.0.1:18080/v1` and uses `local-only` authentication plus `llm_hub_mode: direct` (or `thinking` for `qwen-reason`).

## Vocabulary Design

Vocabulary is local-first and document-aware.

Current implementation:

- The main process owns vocabulary CRUD through SQLite.
- The renderer can add selected PDF text to the active document's vocabulary book.
- Vocabulary rows store the term, definition, source sentence, source page, and source document.
- Vocabulary entries can request an AI-generated Chinese definition, then write the result back to the local vocabulary row.

Planned implementation:

- Improve word normalization before dictionary lookup.
- Export vocabulary to Markdown, CSV, or Anki-friendly formats.

## Security Notes

- API keys must not be stored in renderer localStorage.
- Main process should own provider credentials.
- External content in AI responses should be rendered as sanitized Markdown when Markdown rendering is added.
- PDF file paths should be persisted locally, but sync/export features must treat them as sensitive user data.
