# Chat Flow — Backend Presentation Guide

A slide-by-slide walkthrough of `POST /api/chat/sessions/:id/messages`.

---

## Slide 1 — Big Picture

> "Every chat message goes through 4 layers: auth, controller, service logic, and two external calls — one to OpenAI for embeddings, one for the actual AI answer."

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
     │       └─ appendThreadSiblings (decision mode only)
     ├─ 6. build context block  ← format top results
     ├─ 7. load history         ← DB select
     ├─ 8. chatWithContext      ← OpenAI API call #2 (GPT-4o-mini)
     ├─ 9. save assistant msg   ← DB insert with sources JSON
     └─10. session housekeeping ← DB update + auto-title
          │
          ▼
     Response: { userMessage, assistantMessage, mode }
```

**2 OpenAI API calls · 4–6 DB queries per message.**

---

## Slide 2 — Security First: JWT Guard

Before the controller is reached, `JwtAuthGuard` runs `JwtStrategy.validate`:

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

| Failure condition | Response |
|---|---|
| Token missing or expired | `401 Unauthorized` |
| User no longer exists in DB | `401 Unauthorized` |

**Key point:** User identity is verified before any business logic runs.

---

## Slide 3 — Ownership + Persistence

Two quick DB steps before anything else:

**1. Ownership check**
```sql
SELECT user_id FROM chat_sessions WHERE id = $1
```
- Session not found → `404 Not Found`
- Session belongs to another user → `403 Forbidden`

**2. Save the user message immediately**
```sql
INSERT INTO chat_messages (session_id, role, content, sources)
VALUES ($1, 'user', $2, '[]')
RETURNING *
```

**Key point:** User message is persisted before calling OpenAI — nothing is lost even if the AI call fails.

---

## Slide 4 — Mode Detection

4 modes control how search and the AI prompt behave:

| Mode | Auto-detected when question contains |
|---|---|
| `decision` | "why did we", "decision", "alternatives", "picked X over Y" |
| `history` | "has anyone", "in the past", "previously", "before.*issue" |
| `onboarding` | "how does", "how do I", "where is", "walk me through" |
| `qa` | (no match — default) |

- Client can pass `"mode"` explicitly in the request body — that always wins.
- Auto-detection runs only when `mode` is omitted.

**Example:** Asking *"why did we pick PostgreSQL?"* → `decision` mode triggered automatically.

---

## Slide 5 — Semantic Search (the smart part)

### Step 5a — Embedding (OpenAI API call #1)

```
OpenAI text-embedding-3-small
input:  "<your question>"
output: float[1536]  ← a vector representing the meaning of the question
```

### Step 5b — pgvector cosine similarity query

```sql
SELECT d.*, 1 - (e.embedding <=> $1::vector) AS similarity
FROM embeddings e
JOIN documents d ON d.id = e.document_id
WHERE 1 - (e.embedding <=> $1::vector) > $threshold
  -- optional filters: source, module, author, kind, date range
ORDER BY e.embedding <=> $1::vector   -- closest first
LIMIT $N
```

> "We're not doing keyword search. We're finding documents that are *semantically closest* to the question, using vector math in Postgres."

### Step 5c — Thread expansion (decision mode only)

For each result, sibling documents are fetched:
- Slack thread → all messages with the same `thread_ts`
- GitHub PR → all docs with the same `pr_number` + repo
- GitHub issue → same pattern for `issue_number`

This lets the model see the **full debate** — not just the winning argument.

---

## Slide 6 — Search options per mode

`buildSearchOptions` layers mode defaults on top of any caller-supplied filters:

| Mode | Document kinds | Result limit | Threshold | Thread expand |
|---|---|---|---|---|
| `qa` | all | 5 | 0.15 | no |
| `decision` | decision, pr, thread, doc | 10 | 0.15 | **yes** |
| `onboarding` | code, doc, pr, note | 8 | 0.15 | no |
| `history` | all | 15 | **0.10** (wider net) | no |

Any value passed in `filters` overrides the defaults.

---

## Slide 7 — Building the AI Prompt

Three ingredients assembled before calling GPT:

**1. Context block** — top search results, richly labelled:
```
[Source 1 | notion | doc | module=ai-integration | by asha | 2025-08-12 | 82%]
Title: ADR-007: PostgreSQL with pgvector
We evaluated Pinecone, Weaviate, and pgvector...
```

**2. Conversation history** — last 10 turns from DB (oldest → newest), bounded to prevent unbounded context growth.

**3. System prompt** — changes per mode:

| Mode | System prompt focus |
|---|---|
| `qa` | Answer using only the context; cite sources by number |
| `decision` | Surface what was decided, who decided, alternatives rejected, dissent quoted |
| `onboarding` | Cite file paths and function names; describe data flow step by step |
| `history` | Summarize in chronological order; flag unresolved/recurring issues |

---

## Slide 8 — GPT-4o-mini Call + Saving the Response

### OpenAI API call #2

```
model:       gpt-4o-mini
temperature: 0.2   ← low = factual, consistent answers
messages:    [system prompt] + [history turns] + [current question]
```

### Save assistant message

```sql
INSERT INTO chat_messages (session_id, role, content, sources)
VALUES ($1, 'assistant', $2, $3)
RETURNING *
```

`sources` is a JSONB array — one entry per search result — used by the frontend to render **citation cards**:

```json
{
  "document_id": 42,
  "title": "ADR-007: PostgreSQL with pgvector",
  "source": "notion",
  "similarity": 0.82,
  "snippet": "first 200 chars..."
}
```

---

## Slide 9 — Session Housekeeping

```sql
-- always: keep session list sorted by recent activity
UPDATE chat_sessions SET updated_at = NOW() WHERE id = $1

-- only on the first turn: auto-title the session
UPDATE chat_sessions SET title = $1 WHERE id = $2
-- title = first 80 chars of the user's question
```

---

## Slide 10 — Numbers to Know

| Metric | Value |
|---|---|
| OpenAI calls per message | **2** (embed + chat) |
| DB queries per message | **4–6** |
| Conversation history window | **10 turns** |
| Similarity threshold | 0.10–0.15 (mode-dependent) |
| Embedding dimensions | **1536** (text-embedding-3-small) |
| AI model | **GPT-4o-mini**, temperature 0.2 |

---

## Slide 11 — Error Handling

The system is defensive at every layer:

| Condition | HTTP code |
|---|---|
| Missing / expired JWT | `401 Unauthorized` |
| Session not found | `404 Not Found` |
| Session belongs to another user | `403 Forbidden` |
| `content` empty or invalid `mode` | `400 Bad Request` |
| OpenAI API down | `500 Internal Server Error` |
| pgvector not installed (run `npm run migrate`) | `500 Internal Server Error` |

---

## Closing One-liner

> "The backend's job is: verify identity, find the most relevant knowledge, and give GPT-4o-mini just enough context — no more — to answer accurately and cite its sources."

---

## DB Query Summary

| # | Query | Purpose |
|---|---|---|
| 1 | `SELECT user_id FROM chat_sessions` | Ownership check |
| 2 | `INSERT INTO chat_messages` (user) | Persist user turn |
| 3 | pgvector `SELECT … FROM embeddings JOIN documents` | Semantic retrieval |
| 3a | Extra `SELECT FROM documents` × N siblings | Thread expansion (decision mode only) |
| 4 | `SELECT role, content FROM chat_messages` | Load history |
| 5 | `INSERT INTO chat_messages` (assistant) | Persist assistant turn + sources |
| 6 | `UPDATE chat_sessions SET updated_at` | Touch session |
| 7 | `SELECT COUNT(*) FROM chat_messages` | Auto-title check |
