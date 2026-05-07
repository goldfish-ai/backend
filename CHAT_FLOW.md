# How `POST /api/chat/sessions/:id/messages` Works

Internal walkthrough of every step the backend executes when you send a chat message.

---

## Overview

```
Client Request
     │
     ▼
JwtAuthGuard          ← validate token, attach req.user
     │
     ▼
ChatController        ← route handler
     │
     ▼
ChatService.addMessage
     ├─ 1. assertOwner          ← DB check
     ├─ 2. save user message    ← DB insert
     ├─ 3. detectMode           ← keyword heuristic
     ├─ 4. buildSearchOptions   ← merge mode defaults + filters
     ├─ 5. SearchService.search
     │       ├─ generateEmbedding   ← OpenAI API call #1
     │       ├─ pgvector query      ← DB cosine search
     │       └─ appendThreadSiblings (if decision mode)
     ├─ 6. build context block  ← format top results
     ├─ 7. load history         ← DB select
     ├─ 8. chatWithContext      ← OpenAI API call #2 (GPT-4o-mini)
     ├─ 9. save assistant msg   ← DB insert with sources JSON
     └─10. session housekeeping ← DB update + auto-title
          │
          ▼
     Response: { userMessage, assistantMessage, mode }
```

2 OpenAI API calls · 4–6 DB queries per message.

---

## Step-by-step

### 1. JWT Authentication — `JwtAuthGuard`

Before the controller is reached, `JwtAuthGuard` (a thin `AuthGuard('jwt')` wrapper) runs
`JwtStrategy.validate`:

```
Authorization: Bearer <token>
         │
         ▼
decode JWT → { sub: userId, email }
         │
         ▼
SELECT * FROM users WHERE id = $1
         │
         ▼
attach { id, email, name } to req.user
```

Fails with `401 Unauthorized` if token is missing, expired, or the user no longer exists.

---

### 2. Route handler — `chat.controller.ts:51`

```ts
@Post('sessions/:id/messages')
addMessage(@Req() req, @Param('id', ParseIntPipe) id, @Body() dto) {
  return this.chat.addMessage(req.user.id, id, dto);
}
```

`ParseIntPipe` converts the `:id` path param to an integer.
`dto` is validated by `class-validator` against `CreateMessageDto` — rejects if
`content` is empty or `mode` is not one of `qa | decision | onboarding | history`.

---

### 3. Ownership check — `ChatService.assertOwner`

```sql
SELECT user_id FROM chat_sessions WHERE id = $1
```

- Row missing → `404 NotFoundException`
- `user_id` ≠ `req.user.id` → `403 ForbiddenException`

---

### 4. Save the user message — `chat_messages` insert

```sql
INSERT INTO chat_messages (session_id, role, content, sources)
VALUES ($1, 'user', $2, '[]')
RETURNING *
```

The returned row's `id` is used as the upper bound when loading conversation
history later (so we never include the current turn in its own context).

---

### 5. Mode detection

If you did **not** pass `"mode"` in the request body, `detectMode(content)` runs a
set of regex patterns against the question:

| Pattern (case-insensitive) | Mode assigned |
|---|---|
| `why did we/you/the team`, `decision`, `debate`, `concerns? raised`, `alternatives?`, `picked X over Y`, `chose X over Y` | `decision` |
| `has anyone`, `ever seen`, `in the past`, `previously`, `before.*issue` | `history` |
| `how does`, `how do i`, `where is`, `where does`, `walk me through`, `onboard` | `onboarding` |
| (no match) | `qa` |

Explicit `"mode"` in the body always wins over auto-detection.

---

### 6. Build `SearchOptions`

`buildSearchOptions(mode, dto)` starts from the caller-supplied `limit`, `threshold`,
and `filters`, then layers on mode defaults:

| Mode | `kinds` default | `limit` floor | `threshold` | `expandThreads` |
|---|---|---|---|---|
| `qa` | — | 5 | 0.15 | false |
| `decision` | `[decision, pr, thread, doc]` | 10 | 0.15 | **true** |
| `onboarding` | `[code, doc, pr, note]` | 8 | 0.15 | false |
| `history` | — | 15 | **0.10** | false |

Any value you pass in `filters` (sources, modules, authors, kinds, dateFrom, dateTo)
overrides the defaults.

---

### 7. Semantic search — `SearchService.search`

#### 7a. Embedding generation (OpenAI API call #1)

```
OpenAI text-embedding-3-small
input: "<your question>"
output: float[1536]
```

The vector is serialised to pgvector literal format: `[0.012, -0.034, ...]`.

#### 7b. pgvector cosine similarity query

```sql
SELECT
  d.id AS document_id,
  d.title, d.content, d.summary,
  d.source, d.author, d.module, d.kind, d.metadata, d.created_at,
  1 - (e.embedding <=> $1::vector) AS similarity
FROM embeddings e
JOIN documents d ON d.id = e.document_id
WHERE 1 - (e.embedding <=> $1::vector) > $2   -- similarity threshold
  AND d.source  = ANY($3)                       -- if sources filter
  AND d.module  = ANY($4)                       -- if modules filter
  AND d.author  = ANY($5)                       -- if authors filter
  AND d.kind    = ANY($6)                       -- if kinds filter
  AND d.created_at >= $7                        -- if dateFrom filter
  AND d.created_at <= $8                        -- if dateTo filter
ORDER BY e.embedding <=> $1::vector             -- cosine distance ASC (closest first)
LIMIT $N
```

`<=>` is the pgvector cosine-distance operator. The index
`idx_embeddings_vector` (ivfflat, lists=100) makes this sub-linear.

#### 7c. Thread expansion (decision mode only)

For each result, `appendThreadSiblings()` checks the document's `metadata`:

```
metadata.thread_ts present (Slack)?
  → SELECT all docs WHERE source='slack' AND metadata->>'thread_ts' = <same ts>

metadata.pr_number + repo present (GitHub PR)?
  → SELECT all docs WHERE source='github' AND metadata->>'pr_number' = <same> AND repo = <same>

metadata.issue_number + repo present (GitHub issue)?
  → same pattern for issue_number
```

Sibling documents are appended to the results list with `similarity = 0`
(they show in the context block labelled "related", not ranked).
This is what lets the model see the full debate thread or PR review discussion.

---

### 8. Build context block

Each result is formatted into a richly-labelled block:

```
[Source 1 | notion | doc | module=ai-integration | by asha | 2025-08-12 | 82%]
Title: ADR-007: PostgreSQL with pgvector
We evaluated Pinecone, Weaviate, and pgvector. Key concerns were operational
complexity and cost. pgvector won because...

---

[Source 2 | slack | thread | module=general | by ravi | 2025-09-01 | 71%]
Title: [Slack #engineering] JWT debate
Thread: started by ravi... (full 800-char slice)
```

For **`history` mode** the results are sorted by `created_at` ascending
(oldest first) before building the block, so the model narrates
events in chronological order.

---

### 9. Load conversation history

```sql
SELECT role, content
FROM chat_messages
WHERE session_id = $1
  AND id < $2            -- everything before the current user message
ORDER BY created_at DESC
LIMIT 10
```

Rows are reversed to chronological order and passed as the `messages[]` array.
This gives the model memory of the last 10 turns without unbounded context growth.

---

### 10. GPT-4o-mini call — `OpenAIService.chatWithContext` (OpenAI API call #2)

The messages array sent to the API:

```
[
  { role: "system",    content: <mode-specific system prompt> },
  { role: "user",      content: "previous question 1" },
  { role: "assistant", content: "previous answer 1" },
  ...  (up to 10 history turns)
  { role: "user",      content: "<current question>" }
]
```

Temperature: `0.2` (low = factual, consistent answers).

#### System prompt by mode

**`qa` (default)**
```
You are Project Memory, an AI assistant with access to your team's
institutional knowledge. Answer using ONLY the context below.
Cite sources by their number [Source N]. If the context is
insufficient, say so honestly.

Context:
[Source 1 | ...]
...
```

**`decision`** — adds:
```
This is a DECISION ARCHAEOLOGY query. Structure your answer to surface:
  • What was decided and when (date from sources).
  • Who decided / who participated.
  • What alternatives were considered and rejected, with reasons.
  • Concerns or dissent raised — quote dissenting voices verbatim when present.
  • Trade-offs that were accepted.
If thread replies or PR review comments are in the context, weave them
into the narrative.
```

**`onboarding`** — adds:
```
This is an ONBOARDING query from a new engineer. Explain concretely:
  • Cite file paths, function names, or module names from source metadata.
  • Describe the data flow step by step.
  • Point to the canonical place to start reading.
```

**`history`** — adds:
```
This is a HISTORY query. Summarize prior occurrences in chronological order:
  • Group by date (oldest → newest).
  • Note who reported / who resolved each instance.
  • Call out unresolved or recurring issues explicitly.
```

If no relevant documents were found (empty context block), a fallback prompt
is used instead: the model answers from general knowledge and states it
transparently.

---

### 11. Save assistant message

```sql
INSERT INTO chat_messages (session_id, role, content, sources)
VALUES ($1, 'assistant', $2, $3)
RETURNING *
```

`sources` is a JSONB array — one entry per search result:

```json
[
  {
    "document_id": 42,
    "title": "ADR-007: PostgreSQL with pgvector",
    "source": "notion",
    "author": "asha@team.com",
    "module": "ai-integration",
    "kind": "decision",
    "created_at": "2025-08-12T10:00:00Z",
    "similarity": 0.82,
    "snippet": "first 200 chars of content...",
    "metadata": { "notion_id": "...", "url": "..." }
  }
]
```

The frontend uses `sources[N]` to render citation cards and to call the
drill-down endpoint when the user wants to read the full thread.

---

### 12. Session housekeeping

```sql
-- always
UPDATE chat_sessions SET updated_at = NOW() WHERE id = $1

-- only when message count <= 2 (first turn in the session)
SELECT COUNT(*) FROM chat_messages WHERE session_id = $1
UPDATE chat_sessions SET title = $1 WHERE id = $2   -- first 80 chars of user question
```

This keeps the session list sorted by most-recent activity and auto-titles
new sessions from the first question.

---

## Final response shape

```json
{
  "userMessage": {
    "id": 21,
    "session_id": 4,
    "role": "user",
    "content": "why did we pick PostgreSQL with pgvector?",
    "sources": [],
    "created_at": "2026-05-07T10:00:00Z"
  },
  "assistantMessage": {
    "id": 22,
    "session_id": 4,
    "role": "assistant",
    "content": "The team chose pgvector over Pinecone and Weaviate for three reasons... [Source 1] ...",
    "sources": [ { "document_id": 42, "title": "...", "similarity": 0.82, ... } ],
    "created_at": "2026-05-07T10:00:01Z"
  },
  "mode": "decision"
}
```

---

## DB query summary

| # | Query | Purpose |
|---|---|---|
| 1 | `SELECT user_id FROM chat_sessions` | ownership check |
| 2 | `INSERT INTO chat_messages` (user) | persist user turn |
| 3 | pgvector `SELECT … FROM embeddings JOIN documents` | semantic retrieval |
| 3a | extra `SELECT FROM documents` × N siblings | thread expansion (decision mode only) |
| 4 | `SELECT role, content FROM chat_messages` | load history |
| 5 | `INSERT INTO chat_messages` (assistant) | persist assistant turn + sources |
| 6 | `UPDATE chat_sessions SET updated_at` | touch session |
| 7 | `SELECT COUNT(*) FROM chat_messages` | auto-title check |

---

## Error cases

| Condition | HTTP code |
|---|---|
| Missing / expired JWT | `401 Unauthorized` |
| Session not found | `404 Not Found` |
| Session belongs to another user | `403 Forbidden` |
| `content` empty or invalid `mode` | `400 Bad Request` |
| Source index out of range (expand endpoint) | `404 Not Found` |
| OpenAI API down | `500` (propagated) |
| pgvector not installed / columns missing (run `npm run migrate`) | `500` |
