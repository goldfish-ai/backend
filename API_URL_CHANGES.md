# API URL Changes — Multi-Project Migration

All routes are prefixed with `/api` (NestJS global prefix).

**Auth:** All project-scoped routes require `Authorization: Bearer <jwt>` + project membership, unless noted.  
**Notation:** `(R)` = Required, `(O)` = Optional

---

## New Project-Scoped Routes

### Project Management

#### `POST /api/projects`
```json
{ "name": "My Project" }
```
| Field | Type | |
|-------|------|-|
| `name` | `string` max 200 | **(R)** |

---

#### `GET /api/projects`
No body.

---

#### `GET /api/projects/:projectId`
No body.

---

#### `PATCH /api/projects/:projectId`
```json
{ "name": "Renamed Project" }
```
| Field | Type | |
|-------|------|-|
| `name` | `string` max 200 | **(O)** |

---

#### `DELETE /api/projects/:projectId`
No body.

---

#### `GET /api/projects/:projectId/members`
No body.

---

#### `POST /api/projects/:projectId/members`
```json
{ "userId": 42 }
```
| Field | Type | |
|-------|------|-|
| `userId` | `integer` positive | **(R)** |

---

#### `DELETE /api/projects/:projectId/members/:userId`
No body.

---

#### `GET /api/projects/:projectId/integrations`
No body.

---

#### `PUT /api/projects/:projectId/integrations/:provider`
`:provider` — one of `github`, `slack`, `notion`
```json
{ "config": { "token": "ghp_xxx", "webhookSecret": "abc123" } }
```
| Field | Type | |
|-------|------|-|
| `config` | `object` (provider-specific key/value pairs) | **(R)** |

---

#### `DELETE /api/projects/:projectId/integrations/:provider`
No body.

---

### Documents

#### `POST /api/projects/:projectId/documents`
*(Old: `POST /api/documents`)*
```json
{
  "title": "Architecture Decision Record",
  "content": "We decided to use PostgreSQL because...",
  "source": "confluence",
  "author": "Jane Doe",
  "module": "backend",
  "kind": "adr",
  "decision_type": "technology",
  "dataCreatedAt": "2024-03-15T10:00:00Z",
  "metadata": { "tags": ["database", "infra"] }
}
```
| Field | Type | |
|-------|------|-|
| `title` | `string` min 1, max 500 | **(R)** |
| `content` | `string` min 1 | **(R)** |
| `source` | `string` | **(O)** |
| `author` | `string` max 200 | **(O)** |
| `module` | `string` max 200 | **(O)** |
| `kind` | `string` max 50 | **(O)** |
| `decision_type` | `string` max 50 | **(O)** |
| `dataCreatedAt` | `string` ISO 8601 | **(O)** |
| `metadata` | `object` | **(O)** |

---

#### `POST /api/projects/:projectId/documents/seed`
*(Old: `POST /api/documents/seed`)*
```json
{
  "text": "Onboarding Guide\nWelcome to the team. Here's what you need to know...",
  "source": "notion",
  "author": "HR Team"
}
```
| Field | Type | |
|-------|------|-|
| `text` | `string` min 1 (first line auto-used as title) | **(R)** |
| `title` | `string` max 500 (overrides auto-title) | **(O)** |
| `source` | `string` max 100 | **(O)** |
| `author` | `string` max 200 | **(O)** |
| `metadata` | `object` | **(O)** |

---

#### `POST /api/projects/:projectId/documents/seed/bulk`
*(Old: `POST /api/documents/seed/bulk`)*
```json
{
  "documents": [
    { "text": "Deployment Guide\nRun npm run deploy...", "source": "wiki" },
    { "text": "API Conventions\nAll responses use camelCase...", "author": "Tech Lead" }
  ]
}
```
| Field | Type | |
|-------|------|-|
| `documents` | `array` min 1 item | **(R)** |
| `documents[].text` | `string` min 1 | **(R)** |
| `documents[].title` | `string` max 500 | **(O)** |
| `documents[].source` | `string` max 100 | **(O)** |
| `documents[].author` | `string` max 200 | **(O)** |
| `documents[].metadata` | `object` | **(O)** |

---

#### `GET /api/projects/:projectId/documents`
*(Old: `GET /api/documents`)*
No body.

---

#### `GET /api/projects/:projectId/documents/:id`
*(Old: `GET /api/documents/:id`)*
No body.

---

#### `DELETE /api/projects/:projectId/documents/:id`
*(Old: `DELETE /api/documents/:id`)*
No body.

---

### Search

#### `POST /api/projects/:projectId/search`
*(Old: `POST /api/search`)*
```json
{
  "query": "how do we handle authentication",
  "limit": 10,
  "threshold": 0.3
}
```
| Field | Type | |
|-------|------|-|
| `query` | `string` min 1 | **(R)** |
| `limit` | `integer` min 1, max 50 | **(O)** default `5` |
| `threshold` | `float` 0.0–1.0 | **(O)** default `0.2` |

---

### Chat

#### `POST /api/projects/:projectId/chat/sessions`
*(Old: `POST /api/chat/sessions`)*
```json
{ "title": "Q4 Planning Discussion" }
```
| Field | Type | |
|-------|------|-|
| `title` | `string` max 200 | **(O)** |

---

#### `GET /api/projects/:projectId/chat/sessions`
*(Old: `GET /api/chat/sessions`)*
No body.

---

#### `GET /api/projects/:projectId/chat/sessions/list`
*(Old: `GET /api/chat/sessions/list`)*
No body.

---

#### `GET /api/projects/:projectId/chat/sessions/:id/history`
*(Old: `GET /api/chat/sessions/:id/history`)*
No body.

---

#### `GET /api/projects/:projectId/chat/sessions/:id/messages`
*(Old: `GET /api/chat/sessions/:id/messages`)*
No body.

---

#### `POST /api/projects/:projectId/chat/sessions/:id/messages`
*(Old: `POST /api/chat/sessions/:id/messages`)*
```json
{
  "content": "What decisions were made about the payment system?",
  "mode": "decision",
  "limit": 8,
  "threshold": 0.2,
  "filters": {
    "modules": ["payments"],
    "kinds": ["adr"],
    "dateFrom": "2024-01-01T00:00:00Z",
    "dateTo": "2024-12-31T23:59:59Z"
  }
}
```
| Field | Type | |
|-------|------|-|
| `content` | `string` min 1 | **(R)** |
| `mode` | `enum`: `"qa"` \| `"decision"` \| `"onboarding"` \| `"history"` | **(O)** |
| `limit` | `integer` min 1 | **(O)** default `5` |
| `threshold` | `float` | **(O)** default `0.15` |
| `filters.sources` | `string[]` | **(O)** |
| `filters.modules` | `string[]` | **(O)** |
| `filters.authors` | `string[]` | **(O)** |
| `filters.kinds` | `string[]` | **(O)** |
| `filters.dateFrom` | `string` ISO 8601 | **(O)** |
| `filters.dateTo` | `string` ISO 8601 | **(O)** |

---

#### `DELETE /api/projects/:projectId/chat/sessions/:id`
*(Old: `DELETE /api/chat/sessions/:id`)*
No body.

---

#### `GET /api/projects/:projectId/chat/sessions/:sid/messages/:mid/sources/:idx`
*(Old: `GET /api/chat/sessions/:sid/messages/:mid/sources/:idx`)*
No body.

---

#### `GET /api/projects/:projectId/chat/timeline`
*(Old: `GET /api/chat/timeline`)*
No body.

---

#### `GET /api/projects/:projectId/chat/experts`
*(Old: `GET /api/chat/experts`)*
No body.

---

### Summary

#### `POST /api/projects/:projectId/summary`
*(Old: `POST /api/summary`)*

Either `documentId` OR `text` must be provided.
```json
{ "documentId": 7, "maxWords": 100 }
```
```json
{ "text": "Long document content here...", "maxWords": 50 }
```
| Field | Type | |
|-------|------|-|
| `documentId` | `integer` | **(R if `text` absent)** |
| `text` | `string` | **(R if `documentId` absent)** |
| `maxWords` | `integer` min 20 | **(O)** |

---

### Integrations (Manual Ingest)

#### `POST /api/projects/:projectId/integrations/github/ingest`
*(Old: `POST /api/integrations/github/ingest`)*
```json
{
  "owner": "acme-corp",
  "repo": "backend-api",
  "type": "all",
  "limit": 100,
  "state": "closed",
  "branch": "main"
}
```
| Field | Type | |
|-------|------|-|
| `owner` | `string` | **(R)** GitHub org or username |
| `repo` | `string` | **(R)** Repository name |
| `type` | `enum`: `"commits"` \| `"pulls"` \| `"issues"` \| `"files"` \| `"all"` | **(O)** default `"all"` |
| `limit` | `integer` min 1 | **(O)** |
| `state` | `enum`: `"open"` \| `"closed"` \| `"all"` | **(O)** default `"all"` |
| `branch` | `string` | **(O)** defaults to repo default branch |
| `filePaths` | `string[]` | **(O)** specific paths for `type="files"` |
| `token` | `string` | **(O)** overrides `GITHUB_TOKEN` env var |

---

#### `POST /api/projects/:projectId/integrations/slack/ingest`
*(Old: `POST /api/integrations/slack/ingest`)*
```json
{
  "channelId": "C04XYZ1234",
  "limit": 500
}
```
| Field | Type | |
|-------|------|-|
| `channelId` | `string` | **(R)** e.g. `C01234ABC` |
| `limit` | `integer` min 1, max 1000 | **(O)** default `200` |
| `token` | `string` | **(O)** overrides `SLACK_TOKEN` env var |

---

#### `POST /api/projects/:projectId/integrations/notion/ingest`
*(Old: `POST /api/integrations/notion/ingest`)*
```json
{ "databaseId": "a1b2c3d4e5f6..." }
```
```json
{ "pageId": "9f8e7d6c5b4a..." }
```
| Field | Type | |
|-------|------|-|
| `databaseId` | `string` | **(O)** ingests all pages in database |
| `pageId` | `string` | **(O)** ingests a single page |
| `token` | `string` | **(O)** overrides `NOTION_TOKEN` env var |

---

#### `POST /api/projects/:projectId/integrations/meetings/ingest`
*(Old: `POST /api/integrations/meetings/ingest`)*
```json
{
  "title": "Sprint Planning - Week 42",
  "date": "2024-10-14T09:00:00Z",
  "duration": "1h 15m",
  "transcript": [
    {
      "speaker": "Alice",
      "timestamp": "2024-10-14T09:01:00Z",
      "text": ["Let's start with the backlog review.", "We have 12 items to prioritize."]
    },
    {
      "speaker": "Bob",
      "timestamp": "2024-10-14T09:05:00Z",
      "text": ["I think the auth refactor should be top priority."]
    }
  ]
}
```
| Field | Type | |
|-------|------|-|
| `title` | `string` | **(R)** |
| `date` | `string` ISO 8601 | **(O)** |
| `duration` | `string` e.g. `"1h 30m"` | **(O)** |
| `transcript` | `array` min 1 item | **(R)** |
| `transcript[].speaker` | `string` | **(R)** |
| `transcript[].timestamp` | `string` ISO 8601 | **(R)** |
| `transcript[].text` | `string[]` | **(R)** |

---

### Webhooks

#### `POST /api/projects/:projectId/webhooks/github`
*(Old: `POST /api/webhooks/github` / `POST /api/github/events`)*

Raw GitHub webhook payload. No DTO validation. No JWT required — uses HMAC signature verification.

**Required headers:**
| Header | Description |
|--------|-------------|
| `x-github-event` | Event type: `push`, `pull_request`, `issue_comment` |
| `x-hub-signature-256` | HMAC-SHA256 signature (optional but validated if present) |

| `x-github-event` | `action` | Effect |
|------------------|----------|--------|
| `push` | — | Ingests pushed commits |
| `pull_request` | `opened`, `closed`, `synchronize` | Ingests PR data |
| `issue_comment` | `created` | Ingests the comment |

---

#### `POST /api/projects/:projectId/webhooks/slack`
*(Old: `POST /api/webhooks/slack` / `POST /api/slack/events`)*

Raw Slack Events API payload. No DTO validation. No JWT required — uses HMAC signature verification.

**Required headers:**
| Header | Description |
|--------|-------------|
| `x-slack-request-timestamp` | Unix timestamp for signature verification |
| `x-slack-signature` | HMAC signature (optional but validated if present) |

| `body.type` | Effect |
|-------------|--------|
| `url_verification` | Returns `{ challenge }` for Slack app setup |
| `event_callback` | Processes event; bot messages are ignored |

---

#### `POST /api/projects/:projectId/webhooks/notion/poll`
*(Old: `POST /api/webhooks/notion/poll`)*

No body. Triggers a Notion poll using the stored integration config for the project.

```
POST /api/projects/1/webhooks/notion/poll
Content-Length: 0
```

---

## Legacy Shims (kept for backward compatibility → project 1)

These routes still exist and silently route to **project 1**. Deprecate once all clients are migrated.

| Method | Legacy Route | Routes To |
|--------|-------------|-----------|
| `POST` | `/api/webhooks/github` | project 1 |
| `POST` | `/api/webhooks/slack` | project 1 |
| `POST` | `/api/webhooks/notion/poll` | project 1 |
| `POST` | `/api/github/events` | project 1 |
| `POST` | `/api/slack/events` | project 1 |

---

## Authentication

All project-scoped routes require:
1. `Authorization: Bearer <jwt>` header (`JwtAuthGuard`)
2. The authenticated user must be a member of `:projectId` (`ProjectMemberGuard`)

Webhook routes do **not** require JWT — they use HMAC signature verification only (same as before).
