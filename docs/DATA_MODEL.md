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

## Future Indexes

- SQLite FTS5 over extracted PDF chunks.
- Vector index over chunks through `sqlite-vec` or LanceDB.
- Unique index for vocabulary words normalized by lowercase lemma.

