# Data Model

The first database lives in the Electron user data directory as SQLite. The main process owns all database access.

## Tables

### documents

Imported PDF metadata.

| Column | Type | Notes |
| --- | --- | --- |
| id | text primary key | UUID. |
| title | text | Defaults to file name. |
| file_path | text unique | Absolute path on local machine. |
| file_size | integer | Bytes. |
| page_count | integer nullable | Filled after parsing. |
| created_at | text | ISO timestamp. |
| last_opened_at | text | ISO timestamp. |

### annotations

Highlights, notes, and bookmarks.

| Column | Type | Notes |
| --- | --- | --- |
| id | text primary key | UUID. |
| document_id | text | FK to documents. |
| type | text | `highlight`, `note`, `bookmark`. |
| page_number | integer | 1-based page number. |
| selected_text | text nullable | Source text for selection-based annotations. |
| color | text nullable | Hex color. |
| note | text nullable | User note. |
| rects_json | text nullable | Future selection rectangles. |
| created_at | text | ISO timestamp. |
| updated_at | text | ISO timestamp. |

### document_pages

Extracted PDF page text cache. The main process rebuilds these rows from PDF.js when the document has no complete index.

| Column | Type | Notes |
| --- | --- | --- |
| document_id | text | FK to documents. |
| page_number | integer | 1-based page number. |
| text | text | Full extracted text for the page. Empty for pages with no extractable text. |
| char_count | integer | Character count for quick diagnostics. |
| indexed_at | text | ISO timestamp. |

Primary key: `(document_id, page_number)`.

### document_chunks

Search/RAG-ready page chunks derived from `document_pages`.

| Column | Type | Notes |
| --- | --- | --- |
| id | text primary key | UUID. |
| document_id | text | FK to documents. |
| page_number | integer | Source page. |
| chunk_index | integer | 0-based order within the page. |
| text | text | Chunk text, currently paragraph-aware with a target max length around 1200 characters. |
| char_count | integer | Character count. |
| indexed_at | text | ISO timestamp. |

### ai_providers

Provider configuration without raw API key material in the renderer.

| Column | Type | Notes |
| --- | --- | --- |
| id | text primary key | `deepseek`, `qwen`, `kimi`, `zhipu`, or custom UUID. |
| label | text | Display name. |
| base_url | text | OpenAI-compatible base URL. |
| default_model | text | Default model name. |
| api_key_ref | text nullable | Reference for secure storage. |
| supports_thinking | integer | Boolean. |
| supports_long_context | integer | Boolean. |
| enabled | integer | Boolean. |
| updated_at | text | ISO timestamp. |

### ai_artifacts

Saved AI outputs.

| Column | Type | Notes |
| --- | --- | --- |
| id | text primary key | UUID. |
| document_id | text | FK to documents. |
| annotation_id | text nullable | Source annotation when applicable. |
| provider_id | text | Provider used. |
| model | text | Model used. |
| prompt_type | text | Translate, explain, summarize, etc. |
| input_text | text | Source text. |
| output_markdown | text | AI output. |
| page_number | integer nullable | Source page. |
| created_at | text | ISO timestamp. |

### vocabulary

English reading support.

| Column | Type | Notes |
| --- | --- | --- |
| id | text primary key | UUID. |
| document_id | text nullable | Source document. |
| word | text | Headword. |
| definition | text | Local or AI definition. |
| source_sentence | text nullable | Original sentence. |
| page_number | integer nullable | Source page. |
| created_at | text | ISO timestamp. |

Current behavior:

- Vocabulary entries are document-scoped when added from an active PDF.
- Selected text can be saved as `word`, with the selected passage also stored as `source_sentence`.
- Definitions can come from user input, local dictionary lookup, or AI-assisted refinement.

## Future Indexes

- SQLite FTS5 or app-level keyword search over extracted PDF chunks.
- Vector index over chunks through `sqlite-vec` or LanceDB.
- Unique index for vocabulary words normalized by lowercase lemma.

### dictionary_entries

Imported local dictionary entries.

| Column | Type | Notes |
| --- | --- | --- |
| id | text primary key | UUID. |
| word | text | Original headword. |
| normalized_word | text unique | Lowercase lookup key. |
| phonetic | text nullable | Pronunciation or phonetic data. |
| definition | text nullable | English definition. |
| translation | text nullable | Chinese translation. |
| pos | text nullable | Part of speech. |
| exchange | text nullable | Inflection/exchange data. |
| source | text | Imported file path or source label. |
| updated_at | text | ISO timestamp. |

### dictionary_sources

Registered external dictionary sources.

| Column | Type | Notes |
| --- | --- | --- |
| id | text primary key | UUID. |
| type | text | `csv` or `stardict`. |
| label | text | Display name. |
| path | text unique | Source path, usually `.ifo` for StarDict. |
| entry_count | integer nullable | Source-provided entry count. |
| created_at | text | ISO timestamp. |

Large StarDict dictionaries are looked up from their source files instead of copied into the SQL table.
