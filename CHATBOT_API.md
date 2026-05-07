# Chatbot API — Usage Guide

End-to-end guide for the Project Memory chatbot flow: ingest → search → chat → timeline → experts.

All endpoints are mounted under `/api`. Most require a JWT (issued by `/api/auth/login`).

---

## 0. Authenticate

```http
POST /api/auth/register
Content-Type: application/json

{ "email": "you@team.com", "password": "secret123", "name": "You" }
```

```http
POST /api/auth/login
Content-Type: application/json

{ "email": "you@team.com", "password": "secret123" }
```

Response:
```json
{ "access_token": "eyJhbGciOi...", "user": { "id": 1, "email": "...", "name": "..." } }
```

Send the token on every protected call:
```
Authorization: Bearer <access_token>
```

---

## 1. Ingest knowledge (so the bot has something to answer from)

You only need to do this once per source. All ingest endpoints write into the same `documents` table; `module` and `kind` are auto-derived from source metadata.

### 1a. Manual document
```http
POST /api/documents
Content-Type: application/json

{
  "title": "ADR-007: PostgreSQL with pgvector for Project Memory",
  "content": "We picked pgvector over a dedicated vector DB because...",
  "source": "manual",
  "author": "asha@team.com",
  "module": "ai-integration",
  "kind": "decision",
  "decision_type": "architecture"
}
```

### 1b. Slack channel
```http
POST /api/integrations/slack/ingest
Content-Type: application/json

{ "channelId": "C0123ABCD", "limit": 200 }
```
(Requires `SLACK_BOT_TOKEN` env var or pass `"token": "xoxb-..."`.)

### 1c. Notion database/page
```http
POST /api/integrations/notion/ingest
Content-Type: application/json

{ "databaseId": "abc123..." }
```

### 1d. GitHub repo
```http
POST /api/integrations/github/ingest
Content-Type: application/json

{ "owner": "acme", "repo": "quiz-app", "type": "all", "limit": 200 }
```
`type` ∈ `commits | pulls | issues | all`.

After ingest the docs are embedded with `text-embedding-3-small` (1536 dim) and stored in pgvector for similarity search.

---

## 2. Raw semantic search (no LLM, no auth)

Use this when you want plain vector matches and don't need a synthesized answer.

```http
POST /api/search
Content-Type: application/json

{
  "query": "what is project about",
  "limit": 5,
  "threshold": 0.15
}
```

Response:
```json
{
  "query": "what is project about",
  "count": 3,
  "results": [
    {
      "document_id": 42,
      "title": "Project Memory Overview",
      "content": "...",
      "summary": null,
      "source": "notion",
      "author": null,
      "module": "ai-integration",
      "kind": "doc",
      "metadata": { "notion_id": "...", "url": "..." },
      "similarity": 0.82,
      "created_at": "2025-04-12T09:14:00.000Z"
    }
  ]
}
```

| Param | Type | Default | Notes |
|---|---|---|---|
| `query` | string | — | required |
| `limit` | int | 5 | max results |
| `threshold` | float | 0.2 | cosine similarity floor (0–1) |

---

## 3. Chat (RAG) — recommended flow

Two calls: create session once, then post messages.

### 3a. Create a session
```http
POST /api/chat/sessions
Authorization: Bearer <JWT>
Content-Type: application/json

{ "title": "Project overview" }
```
Response: `{ "id": 7, "user_id": 1, "title": "Project overview", ... }` — keep `id`.

### 3b. Ask a question
```http
POST /api/chat/sessions/7/messages
Authorization: Bearer <JWT>
Content-Type: application/json

{ "content": "what is project about" }
```

That is the **minimum** payload. The server will:
1. Auto-detect a mode (`qa` here — no decision/onboarding/history keywords).
2. Embed the question and run filtered pgvector search.
3. Build a context block from the top results.
4. Pull the last 10 messages of the session as conversational history.
5. Call GPT-4o-mini with a mode-specific system prompt.
6. Save the assistant message with rich source citations.
7. Auto-title the session from the first user turn.

Response:
```json
{
  "userMessage": { "id": 21, "role": "user", "content": "what is project about", ... },
  "assistantMessage": {
    "id": 22,
    "role": "assistant",
    "content": "Project Memory is a RAG-powered knowledge engine... [Source 1] ...",
    "sources": [
      {
        "document_id": 42,
        "title": "Project Memory Overview",
        "source": "notion",
        "author": null,
        "module": "ai-integration",
        "kind": "doc",
        "created_at": "2025-04-12T09:14:00.000Z",
        "similarity": 0.82,
        "snippet": "...",
        "metadata": { "url": "..." }
      }
    ],
    "created_at": "2026-05-07T10:00:00.000Z"
  },
  "mode": "qa"
}
```

### 3c. Optional parameters

```json
{
  "content": "...",
  "limit": 8,
  "threshold": 0.1,
  "mode": "decision",
  "filters": {
    "sources": ["notion", "github"],
    "modules": ["ai-integration"],
    "authors": ["asha@team.com"],
    "kinds": ["decision", "pr", "thread"],
    "dateFrom": "2025-01-01",
    "dateTo": "2025-12-31"
  }
}
```

| Field | Type | Notes |
|---|---|---|
| `content` | string | the user question (required) |
| `limit` | int | top-K to retrieve, default 5 |
| `threshold` | float | similarity floor, default 0.15 |
| `mode` | enum | `qa` \| `decision` \| `onboarding` \| `history`. Auto-detected from keywords if omitted. |
| `filters.sources` | string[] | e.g. `slack`, `notion`, `github`, `manual` |
| `filters.modules` | string[] | repo / channel / database name |
| `filters.authors` | string[] | exact match on `documents.author` |
| `filters.kinds` | string[] | `decision`, `pr`, `thread`, `code`, `issue`, `doc`, `note`, `message` |
| `filters.dateFrom` / `dateTo` | ISO date | bounds on `created_at` |

### 3d. Modes — what each one does

| Mode | Auto-trigger keywords | Defaults applied |
|---|---|---|
| `qa` (default) | (everything else) | base RAG prompt |
| `decision` | "why did we…", "decision", "debate", "concerns raised", "alternatives", "picked X over Y" | `kinds=[decision,pr,thread,doc]`, `limit≥10`, **thread expansion ON** (pulls Slack thread replies + PR review comments around each hit). Prompt extracts who decided, when, alternatives, dissent. |
| `onboarding` | "how does", "where is", "walk me through", "onboard…" | `kinds=[code,doc,pr,note]`, `limit≥8`. Prompt cites file paths + describes data flow concretely. |
| `history` | "has anyone", "ever seen", "previously", "in the past" | `limit≥15`, lower threshold, sources sorted chronologically. Prompt summarizes prior occurrences with dates. |

You can always override the auto-detection by passing `"mode": "..."`.

### 3e. Other session endpoints
```http
GET    /api/chat/sessions                         # list user's sessions
GET    /api/chat/sessions/:id/messages            # full transcript
DELETE /api/chat/sessions/:id                     # cascade-delete session + messages
```

### 3f. Drill into a citation
After receiving an assistant message with `sources`, you can fetch the full thread / PR / issue chain for any one citation without re-running the LLM:

```http
GET /api/chat/sessions/:sessionId/messages/:messageId/sources/:sourceIndex
Authorization: Bearer <JWT>
```
`sourceIndex` is the 0-based position in `assistantMessage.sources`.

Response:
```json
{
  "root": { "document_id": 42, "title": "...", ... },
  "siblings": [
    { "id": 43, "title": "Re: ...", "source": "slack", "author": "...", "created_at": "...", ... }
  ]
}
```

---

## 4. Memory Timeline

Chronological event feed with faceted filters. Pure SQL, no LLM call.

```http
GET /api/chat/timeline?modules=ai-integration,mock-tests
                      &sources=slack,github
                      &kinds=decision,pr
                      &dateFrom=2025-01-01
                      &dateTo=2025-12-31
                      &limit=100&offset=0
Authorization: Bearer <JWT>
```

All filter params are CSV strings. Response:
```json
{
  "events": [
    {
      "id": 87,
      "title": "PR #142: switch to pgvector",
      "summary": null,
      "source": "github",
      "kind": "pr",
      "module": "acme/quiz-app",
      "author": "asha",
      "created_at": "2025-08-12T...",
      "metadata": { "pr_number": 142, "repo": "acme/quiz-app", "type": "pull_request", "state": "closed" }
    }
  ],
  "facets": {
    "modules": { "ai-integration": 14, "mock-tests": 9 },
    "sources": { "github": 17, "slack": 6 },
    "kinds":   { "pr": 8, "decision": 3, "thread": 12 },
    "authors": { "asha": 11, "ravi": 5 }
  },
  "total": 23
}
```

Use the facet counts to drive the visual filter UI (question #5 in the demo).

---

## 5. Expert Finder

Ranks team members by semantic relevance × recency on a topic.

```http
GET /api/chat/experts?topic=Gujarat+Police+mock+test+architecture
                     &modules=mock-tests
                     &limit=5
Authorization: Bearer <JWT>
```

| Param | Notes |
|---|---|
| `topic` | required, free-text |
| `modules` | CSV, optional scope |
| `sources` | CSV, optional scope |
| `limit` | top-N authors, default 5 |

Response:
```json
{
  "topic": "Gujarat Police mock test architecture",
  "experts": [
    {
      "author": "asha@team.com",
      "score": 4.21,
      "contributions": 17,
      "last_active": "2026-04-30T...",
      "sources_breakdown": { "github": 9, "slack": 6, "notion": 2 },
      "modules_breakdown": { "mock-tests": 12, "ai-integration": 5 },
      "top_documents": [
        { "document_id": 314, "title": "PR #88: scoring engine", "source": "github", "module": "mock-tests", "kind": "pr", "similarity": 0.81, "created_at": "..." }
      ]
    }
  ]
}
```

Score formula: `Σ(similarity × exp(-ln(2) × age_days / 180))` per author over the top 50 semantic matches. 180-day half-life favors recent contributors.

---

## End-to-end flow per demo question

| # | Demo question | Endpoint | Body / query |
|---|---|---|---|
| 1 | "Why did we pick PostgreSQL with pgvector over a dedicated vector DB?" | `POST /api/chat/sessions/:id/messages` | `{ "content": "..." }` — auto-detects `mode=decision` |
| 2 | "Specific concerns raised during the JWT auth debate for the quiz app?" | same | `{ "content": "...", "mode": "decision", "filters": { "modules": ["quiz-app"] } }` — thread expansion pulls the debate |
| 3 | "How does the Node.js inventory OCR logic work and where is the mapping?" | same | `{ "content": "...", "mode": "onboarding", "filters": { "modules": ["inventory-ocr"] } }` |
| 4 | "Has anyone seen issues with handwritten digit normalization?" | same | `{ "content": "...", "mode": "history" }` (auto-detected) |
| 5 | Visual timeline filtered to `/ai-integration/` or `/mock-tests/` | `GET /api/chat/timeline` | `?modules=ai-integration,mock-tests` |
| 6 | "Who knows the most about the Gujarat Police mock test architecture?" | `GET /api/chat/experts` | `?topic=Gujarat+Police+mock+test+architecture&modules=mock-tests` |

---

## Quick start checklist

1. `npm install` and configure `.env` (`OPENAI_API_KEY`, `DATABASE_URL`, `JWT_SECRET`).
2. `npm run migrate` — creates schema + the new `module` / `kind` columns + backfills existing rows.
3. `npm run start:dev`.
4. `POST /api/auth/register` → `POST /api/auth/login` → save the token.
5. Ingest at least one source (Slack / Notion / GitHub / manual `POST /api/documents`).
6. `POST /api/chat/sessions` then `POST /api/chat/sessions/:id/messages` with `{ "content": "what is project about" }`.

---

## Field reference — `documents` row

| Field | Source |
|---|---|
| `id` | DB PK |
| `title` | provided / derived per integration |
| `content` | full text |
| `summary` | optional, set via `POST /api/summary` |
| `source` | `manual` \| `slack` \| `notion` \| `github` |
| `author` | committer / Slack user / PR author |
| `module` | auto: `metadata.module` ∥ `metadata.repo` ∥ `metadata.channel` ∥ `metadata.database_id` |
| `kind` | auto: `pr` \| `code` \| `issue` \| `thread` \| `message` \| `doc` \| `decision` \| `note` |
| `decision_type` | optional: `architecture` \| `tech-choice` \| `process` |
| `metadata` | JSONB — source-specific (`thread_ts`, `pr_number`, `repo`, `url`, …) |
| `created_at` / `updated_at` | timestamps |

Embeddings live in a separate `embeddings` table (`vector(1536)`, ivfflat cosine index).
