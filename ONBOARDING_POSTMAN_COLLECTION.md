# Postman Collection: User Project Onboarding

## Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `{{baseUrl}}` | API base URL | `http://localhost:3000` |
| `{{token}}` | JWT access token | `eyJhbGci...` |
| `{{projectId}}` | Set from Create Project response | `1` |
| `{{sessionId}}` | Set from Create Chat Session response | `5` |

**Default Headers (all requests except webhook):**
```
Authorization: Bearer {{token}}
Content-Type: application/json
```

---

## Step 1 — Create Project

```
POST {{baseUrl}}/api/projects
```

**Body:**
```json
{
  "name": "My Project"
}
```

| Field | Type | |
|-------|------|-|
| `name` | `string` max 200 | **(R)** |

**Postman Test (auto-extract projectId):**
```js
pm.environment.set("projectId", pm.response.json().id);
```

---

## Step 2 — Add GitHub Integration

```
PUT {{baseUrl}}/api/projects/{{projectId}}/integrations/github
```

**Body:**
```json
{
  "config": {
    "token": "ghp_xxx",
    "webhookSecret": "abc123"
  }
}
```

| Field | Type | |
|-------|------|-|
| `config` | `object` | **(R)** |
| `config.token` | `string` GitHub personal access token | **(R)** |
| `config.webhookSecret` | `string` HMAC secret for webhook verification | **(O)** |

---

## Step 3 — Ingest GitHub Repo (Manual Pull)

```
POST {{baseUrl}}/api/projects/{{projectId}}/integrations/github/ingest
```

**Body:**
```json
{
  "owner": "acme-corp",
  "repo": "backend-api",
  "type": "all",
  "state": "closed",
  "branch": "main"
}
```

| Field | Type | |
|-------|------|-|
| `owner` | `string` GitHub org or username | **(R)** |
| `repo` | `string` repository name | **(R)** |
| `type` | `enum`: `"commits"` \| `"pulls"` \| `"issues"` \| `"files"` \| `"all"` | **(O)** default `"all"` |
| `limit` | `integer` min 1 | **(O)** |
| `state` | `enum`: `"open"` \| `"closed"` \| `"all"` | **(O)** default `"all"` |
| `branch` | `string` | **(O)** defaults to repo default branch |
| `filePaths` | `string[]` specific paths for `type="files"` | **(O)** |
| `token` | `string` overrides `GITHUB_TOKEN` env var | **(O)** |

---

## Step 4 — Register GitHub Webhook

> **No JWT required** — uses HMAC signature verification only.

```
POST {{baseUrl}}/api/projects/{{projectId}}/webhooks/github
```

**Required Headers (sent by GitHub):**
```
x-github-event: push
x-hub-signature-256: sha256=<hmac>
```

**Body:** Raw GitHub webhook payload (JSON)

**Example push event body:**
```json
{
  "ref": "refs/heads/main",
  "commits": [
    {
      "id": "abc123",
      "message": "feat: add payment module",
      "author": { "name": "Jane Doe" }
    }
  ]
}
```

| `x-github-event` | `action` | Effect |
|------------------|----------|--------|
| `push` | — | Ingests pushed commits |
| `pull_request` | `opened`, `closed`, `synchronize` | Ingests PR data |
| `issue_comment` | `created` | Ingests the comment |

---

## Step 5 — Add User to Project

```
POST {{baseUrl}}/api/projects/{{projectId}}/members
```

**Body:**
```json
{
  "userId": 42
}
```

| Field | Type | |
|-------|------|-|
| `userId` | `integer` positive | **(R)** |

---

## Step 6 — Create Chat Session

```
POST {{baseUrl}}/api/projects/{{projectId}}/chat/sessions
```

**Body:**
```json
{
  "title": "Onboarding Discussion"
}
```

| Field | Type | |
|-------|------|-|
| `title` | `string` max 200 | **(O)** |

**Postman Test (auto-extract sessionId):**
```js
pm.environment.set("sessionId", pm.response.json().id);
```

---

## Step 7 — Send First Chat Message

```
POST {{baseUrl}}/api/projects/{{projectId}}/chat/sessions/{{sessionId}}/messages
```

**Body:**
```json
{
  "content": "What do I need to know to get started with this project?",
  "mode": "onboarding"
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

## Collection Order Summary

| # | Name | Method | URL | Auth |
|---|------|--------|-----|------|
| 1 | Create Project | `POST` | `/api/projects` | JWT |
| 2 | Add GitHub Integration | `PUT` | `/api/projects/{{projectId}}/integrations/github` | JWT |
| 3 | Ingest GitHub Repo | `POST` | `/api/projects/{{projectId}}/integrations/github/ingest` | JWT |
| 4 | Register GitHub Webhook | `POST` | `/api/projects/{{projectId}}/webhooks/github` | HMAC only |
| 5 | Add User to Project | `POST` | `/api/projects/{{projectId}}/members` | JWT |
| 6 | Create Chat Session | `POST` | `/api/projects/{{projectId}}/chat/sessions` | JWT |
| 7 | Send Chat Message | `POST` | `/api/projects/{{projectId}}/chat/sessions/{{sessionId}}/messages` | JWT |
