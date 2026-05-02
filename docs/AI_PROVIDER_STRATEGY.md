# AI Provider Strategy

## Principle

The app should not depend on one model vendor. Providers should be configured through one OpenAI-compatible adapter whenever possible.

Provider fields:

```ts
type AIProvider = {
  id: string
  label: string
  baseUrl: string
  apiKeyRef: string
  defaultModel: string
  supportsThinking: boolean
  supportsLongContext: boolean
}
```

## Recommended Default Providers

| Provider | Role | Notes |
| --- | --- | --- |
| DeepSeek | Default low-cost reasoning and long-context option | Official API is OpenAI-compatible and currently offers long-context models. |
| Alibaba Bailian / Qwen | Primary domestic fallback and long-context provider | Good China availability; useful for Qwen Flash/Plus tiers. |
| Kimi / Moonshot | Long-context and document-heavy backup | OpenAI-compatible API; good fit for long document tasks. |
| Zhipu GLM | Backup provider and free/cheap experimentation path | Useful as an alternate domestic model provider. |
| Custom | User-controlled provider | Allows local gateways, OpenRouter-like proxies, or future vendors. |

## Cost Control

Single-word translation:

- Use local dictionary first.
- Only call AI when dictionary lookup fails or the selected text is a phrase/sentence.

Selected paragraph explanation:

- Use a cheap/fast model first.
- Offer a "deeper explanation" action for expensive models.

Whole chapter/book Q&A:

- Use RAG retrieval.
- Send only relevant chunks.
- Attach citations.

## Provider Implementation Plan

1. Store provider records in SQLite without raw keys in renderer state.
2. Add main-process API key storage.
3. Implement OpenAI-compatible chat completion calls in main process.
4. Stream partial output to renderer.
5. Persist AI outputs as `ai_artifacts`.

## Prompt Types

Initial prompt types:

- `translate_selection`
- `explain_selection`
- `summarize_selection`
- `ask_selection`
- `word_lookup_fallback`

Later prompt types:

- `chapter_summary`
- `document_question`
- `compare_passages`
- `make_review_cards`
- `extract_terms`

