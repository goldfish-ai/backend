# Project Memory — Backend Overview

**Project Memory** is a RAG-powered (Retrieval-Augmented Generation) knowledge engine for software teams. It ingests content from Meetings, Slack, GitHub, and Notion, stores it as semantic embeddings, and lets authenticated users query it via a conversational chat interface.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | NestJS 10 (TypeScript) |
| Database | PostgreSQL + `pgvector` extension |
| AI / Embeddings | OpenAI `text-embedding-3-small` + `gpt-4o-mini` |
| Auth | JWT (Passport) + bcryptjs |
| Scheduled Jobs | `@nestjs/schedule` (cron) |
| HTTP Client | axios |
| Validation | `class-validator` / `class-transformer` |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Client / Frontend                        │
│                    (http://localhost:5173)                       │
└───────────────────────────┬─────────────────────────────────────┘
                            │ REST  (Bearer JWT)
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                   NestJS API  :3002/api                         │
│                                                                  │
│  ┌──────────┐  ┌──────────┐  ┌───────────┐  ┌───────────────┐  │
│  │   Auth   │  │  Chat    │  │ Documents │  │  Integrations │  │
│  │ /auth    │  │ /chat    │  │ /documents│  │  /integrations│  │
│  └──────────┘  └──────────┘  └───────────┘  └───────────────┘  │
│                                                                  │
│  ┌──────────┐  ┌──────────┐  ┌───────────┐  ┌───────────────┐  │
│  │  Search  │  │ Summary  │  │ Webhooks  │  │  Health       │  │
│  │ /search  │  │ /summary │  │ /webhooks │  │  /health      │  │
│  └──────────┘  └──────────┘  └───────────┘  └───────────────┘  │
│                                                                  │
│                    ┌──────────────────┐                         │
│                    │   OpenAI Service │                         │
│                    │  (embeddings +   │                         │
│                    │   chat + rewrite)│                         │
│                    └────────┬─────────┘                         │
└─────────────────────────────┼───────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                PostgreSQL  (pgvector)                           │
│                                                                  │
│   users   chat_sessions   chat_messages                         │
│   documents   embeddings   meta                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Module Map

```
src/
├── main.ts                    # Bootstrap — CORS, ValidationPipe, global prefix /api
├── app.module.ts              # Root module — wires all feature modules
│
├── auth/                      # JWT authentication
│   ├── auth.controller.ts     # POST /auth/register, POST /auth/login, GET /auth/me
│   ├── auth.service.ts        # bcrypt password hashing, JWT signing
│   ├── strategies/jwt.strategy.ts
│   └── guards/jwt-auth.guard.ts
│
├── chat/                      # Conversational AI (RAG pipeline)
│   ├── chat.controller.ts     # CRUD for sessions & messages
│   ├── chat.service.ts        # Core addMessage pipeline (see Workflow below)
│   ├── timeline.service.ts    # Chronological event view
│   └── experts.service.ts     # "Who knows this best?" heuristic
│
├── documents/                 # Core knowledge store
│   ├── documents.service.ts   # create / list / get / delete + deriveModuleAndKind()
│   └── dto/                   # CreateDocumentDto, SeedDocumentDto, SeedBulkDto
│
├── search/                    # Semantic vector search
│   └── search.service.ts      # pgvector cosine similarity + optional thread expansion
│
├── openai/                    # OpenAI wrapper
│   └── openai.service.ts      # generateEmbedding, chatWithContext, rewriteQuery,
│                              #   processDocument, summarize
│
├── summary/                   # On-demand summarisation
│   └── summary.service.ts     # Summarise by document ID or raw text
│
├── integrations/              # One-shot bulk ingest endpoints
│   ├── meetings/              # POST /integrations/meetings/ingest
│   ├── slack/                 # POST /integrations/slack/ingest (channel history)
│   ├── github/                # POST /integrations/github/ingest (commits/PRs/issues)
│   └── notion/                # POST /integrations/notion/ingest (database or page)
│
├── webhooks/                  # Real-time event receivers + scheduled polling
│   ├── github-events.controller.ts   # POST /github/events (push, pull_request, issue_comment)
│   ├── github-webhook.service.ts
│   ├── slack-events.controller.ts    # POST /slack/events (url_verification, message)
│   ├── slack-webhook.service.ts
│   ├── notion-poll.service.ts        # Cron every 30 min — polls NOTION_POLL_DATABASES
│   └── webhooks.controller.ts        # POST /webhooks/notion/poll (manual trigger)
│
└── database/
    ├── database.service.ts    # pg Pool wrapper
    ├── schema.sql             # Full idempotent DDL
    └── migrate.ts             # Migration runner
```

---

## Database Schema

```
users
  id · email (unique) · password_hash · name · created_at

documents
  id · title · content · summary · source · author · module · kind
  decision_type · data_created_at · metadata (JSONB) · created_at · updated_at

embeddings
  id · document_id → documents · embedding (vector 1536) · model_name
  chunk_index · processed_text · created_at

chat_sessions
  id · user_id → users · title · created_at · updated_at

chat_messages
  id · session_id → chat_sessions · role (user|assistant) · content
  sources (JSONB array) · created_at

meta
  key · value   ← stores notion_last_poll_<dbId> timestamps
```

**Key indexes:** IVFFlat cosine index on `embeddings.embedding`; GIN on `documents.metadata`; B-tree on `source`, `kind`, `author`, `module`, `created_at`.

---

## Core Workflow — Chat Message Pipeline

This is the critical path for `POST /api/chat/sessions/:id/messages`.

```
User sends message
       │
       ▼
1. Ownership check (assertOwner)
       │
       ▼
2. Save user message to chat_messages
       │
       ▼
3. Detect chat mode (qa | decision | onboarding | history)
   — from dto.mode, or keyword regex on the question
       │
       ├─────────────────────────────────────────────┐
       ▼                                             ▼
4a. Fetch last 10 messages             4b. Generate embedding
    from DB (conversation history)         for the user query
       │                                             │
       └─────────────────────────────────────────────┘
                         │  (both complete in parallel)
                         ▼
5. rewriteQuery(content, history)
   — LLM rewrites contextual follow-ups into a self-contained
     search query (3-turn context window)
   — If query unchanged: reuse pre-computed embedding (saves one API call)
       │
       ▼
6. Semantic search (pgvector cosine similarity)
   — Filters: source, module, author, kind, date range
   — Mode-specific limit/threshold/expandThreads overrides
       │
       ▼
7. Build context block
   — Mode=history: sort results chronologically
   — Format each source with provenance (author, date, source, kind)
       │
       ▼
8. chatWithContext (gpt-4o-mini)
   — System prompt varies by mode:
     · qa          → plain RAG answer with citations
     · decision    → decision archaeology (who, what, alternatives, dissent)
     · onboarding  → step-by-step with file paths and module names
     · history     → chronological prior occurrences
       │
       ▼
9. Save assistant message (content + sources JSONB)
       │
       ▼
10. Fire-and-forget: update session updated_at + auto-title on turn 1
       │
       ▼
Return { userMessage, assistantMessage, mode }
```

---

## Ingest Workflows

### Manual / Seed
```
POST /documents/seed  →  DocumentsService.create()
                      →  OpenAI.processDocument()   (clean & distil text)
                      →  OpenAI.generateEmbedding() (text-embedding-3-small)
                      →  INSERT documents + embeddings
```

### Meetings
```
POST /integrations/meetings/ingest
  Per transcript entry → documents.create() → embed & store
  source = "meeting", kind = "note"
```

### GitHub (bulk ingest)
```
POST /integrations/github/ingest  { owner, repo, type, limit, state }
  Fetches from GitHub REST API → commits / pulls / issues
  Each item → documents.create() → embed & store
  source = "github", kind = "code" | "pr" | "issue"
```

### GitHub (live events)
```
POST /github/events  X-GitHub-Event: push | pull_request | issue_comment
  GithubWebhookService → documents.create() per commit/PR/comment
```

### Slack (bulk ingest)
```
POST /integrations/slack/ingest  { channelId, limit }
  Fetches channel history via Slack Web API
  Each message → documents.create() with LLM relevance pre-filter
  source = "slack", kind = "message" | "thread"
```

### Slack (live events)
```
POST /slack/events  { type: "event_callback", event: { type: "message", ... } }
  SlackWebhookService → documents.create() per message
```

### Notion (bulk ingest)
```
POST /integrations/notion/ingest  { databaseId | pageId }
  NotionService fetches pages → documents.create()
  source = "notion", kind = "doc"
```

### Notion (scheduled poll)
```
Cron every 30 minutes → NotionPollService.pollAll()
  Reads NOTION_POLL_DATABASES env var (comma-separated database IDs)
  Tracks last poll time in meta table → only ingests new/updated pages
  Manual trigger: POST /webhooks/notion/poll
```

---

## Document Classification

Every stored document is tagged with `source`, `module`, and `kind`:

| `source` | `kind` values |
|---|---|
| `meeting` | `note` |
| `github` | `code` (commit), `pr`, `issue` |
| `slack` | `message`, `thread` |
| `notion` | `doc` |
| `manual` / `seed` | `note`, `decision` (if title contains ADR/RFC/decision) |

`module` is derived from `metadata.repo`, `metadata.channel`, `metadata.database_id`, or set explicitly by the caller. Used for filtered search.

---

## Chat Modes

| Mode | Trigger keywords | Response shape |
|---|---|---|
| `qa` | _(default)_ | RAG answer with `[Source N]` citations |
| `decision` | "why did we…", "decision", "alternatives", "trade-offs" | Decision archaeology: what, who, alternatives, dissent, trade-offs |
| `onboarding` | "how does", "how do I", "where is", "walk me through" | Step-by-step with file paths and module names |
| `history` | "has anyone", "ever seen", "previously", "in the past" | Chronological list of prior occurrences |

Mode can also be set explicitly via `dto.mode` in the request body.

---

## API Reference (summary)

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/health` | — | Health check |
| POST | `/auth/register` | — | Register user |
| POST | `/auth/login` | — | Login, returns JWT |
| GET | `/auth/me` | ✓ | Current user |
| GET | `/documents` | — | List all documents |
| POST | `/documents` | — | Create document manually |
| POST | `/documents/seed` | — | Seed raw text (embed & store) |
| POST | `/documents/seed/bulk` | — | Bulk seed array |
| DELETE | `/documents/:id` | — | Delete document |
| POST | `/search` | — | Semantic search |
| POST | `/summary` | — | Summarise document or raw text |
| GET | `/chat/sessions` | ✓ | List sessions |
| GET | `/chat/sessions/list` | ✓ | Sessions with message count + preview |
| POST | `/chat/sessions` | ✓ | Create session |
| DELETE | `/chat/sessions/:id` | ✓ | Delete session |
| GET | `/chat/sessions/:id/messages` | ✓ | Raw message list |
| GET | `/chat/sessions/:id/history` | ✓ | Paired turn history |
| POST | `/chat/sessions/:id/messages` | ✓ | Send message (RAG pipeline) |
| POST | `/integrations/meetings/ingest` | — | Ingest meeting transcript |
| POST | `/integrations/slack/ingest` | — | Ingest Slack channel history |
| POST | `/integrations/github/ingest` | — | Ingest GitHub repo |
| POST | `/integrations/notion/ingest` | — | Ingest Notion database or page |
| POST | `/github/events` | — | GitHub live webhook |
| POST | `/slack/events` | — | Slack Events API |
| POST | `/webhooks/notion/poll` | — | Manually trigger Notion poll |

---

## Environment Variables

```env
# Database
DATABASE_URL=postgres://user:pass@localhost:5432/project_memory

# OpenAI
OPENAI_API_KEY=sk-...

# Auth
JWT_SECRET=your-secret-here

# GitHub (optional — for private repo ingest)
GITHUB_TOKEN=ghp_...

# Slack (optional — for Slack ingest)
SLACK_BOT_TOKEN=xoxb-...

# Notion (optional)
NOTION_TOKEN=secret_...
NOTION_POLL_DATABASES=db-id-1,db-id-2   # comma-separated, polled every 30 min

# Server
PORT=3002
FRONTEND_URL=http://localhost:5173
```

---

## Running Locally

```bash
# Install dependencies
npm install

# Run DB migrations (creates all tables)
npm run migrate

# Start in watch mode
npm run start:dev

# Build for production
npm run build
npm run start:prod
```
