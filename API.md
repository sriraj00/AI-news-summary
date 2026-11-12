# API reference

Base URL for local development: `http://localhost:8000`. Interactive OpenAPI docs are available at `/docs`.

All request and response bodies are JSON except `POST /articles/upload`, which is `multipart/form-data` with a `file` field.

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Reports API, local NLI model readiness (`hf_configured`), and optional service configuration. |
| `POST` | `/articles/upload` | Extracts text from PDF, TXT or DOCX; max 15 MB. Scanned PDFs need OCR first. |
| `POST` | `/articles/process` | Accepts `{ "articles": [{"title":"…","publisher":"…","text":"…"}] }` or `{ "url":"https://…" }`; returns normalized articles and numbered source passages. |
| `POST` | `/summarize` | Accepts `{ "articles": [...] }`; returns the overall summary, per-article summaries, findings, common information and conflicts. Requires Groq. |
| `POST` | `/claims/extract` | Accepts `{ "summary": {...}, "articles": [...] }`; returns unique atomic claims. Requires Groq. |
| `POST` | `/sources/retrieve` | Accepts `{ "claims": [...], "passages": [...] }`; returns the top three Sentence Transformer / FAISS passages per claim. |
| `POST` | `/claims/verify` | Accepts `{ "claims": [...] }`; compares retrieved evidence and claim using local Hugging Face Transformers NLI inference. No inference token or credits are required. |
| `POST` | `/audit/generate` | Accepts the summary, articles and checked claims; saves the report when Supabase is available and otherwise returns it with `persisted: false`. |
| `GET` | `/history` | Returns `{ "items": [...], "persistent": true|false, "message": "…" }`; history problems do not prevent analysis. |
| `GET` | `/history/{id}` | Fetches one saved report. |
| `DELETE` | `/history/{id}` | Deletes one saved report. |

Errors use FastAPI's standard JSON shape, `{ "detail": "…" }`. Missing Groq configuration or local NLI model loading/inference failures are reported explicitly and prevent a fabricated verification result. Supabase is optional: when it is unavailable, the audit endpoint returns the completed report with `persisted: false` and a `history_message`. A retrieval similarity score is only used to find passages and is never represented as a verification score. Claim statuses are `ENTAILED`, `CONTRADICTED`, and `INSUFFICIENT EVIDENCE`; neutral NLI results map to `INSUFFICIENT EVIDENCE`.
