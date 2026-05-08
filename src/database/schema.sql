-- pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Documents table
CREATE TABLE IF NOT EXISTS documents (
  id SERIAL PRIMARY KEY,
  title VARCHAR(500) NOT NULL,
  content TEXT NOT NULL,
  summary TEXT,
  source VARCHAR(100) DEFAULT 'manual',
  author VARCHAR(200),
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Embeddings table (1536 dim for text-embedding-3-small)
CREATE TABLE IF NOT EXISTS embeddings (
  id SERIAL PRIMARY KEY,
  document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  embedding vector(1536) NOT NULL,
  model_name VARCHAR(100) DEFAULT 'text-embedding-3-small',
  chunk_index INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- processed_text: the clean text that was actually embedded (vs raw content).
-- NULL means the raw title+content was used (pre-processing or irrelevant Slack).
ALTER TABLE embeddings ADD COLUMN IF NOT EXISTS processed_text TEXT;

-- Add data_created_at column (idempotent - safe to re-run)
ALTER TABLE documents ADD COLUMN IF NOT EXISTS data_created_at TIMESTAMPTZ;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_documents_created_at ON documents (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_documents_data_created_at ON documents (data_created_at DESC);
CREATE INDEX IF NOT EXISTS idx_embeddings_document_id ON embeddings (document_id);
CREATE INDEX IF NOT EXISTS idx_embeddings_vector
  ON embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(100),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Chat sessions
CREATE TABLE IF NOT EXISTS chat_sessions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(500) DEFAULT 'New Chat',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Chat messages
CREATE TABLE IF NOT EXISTS chat_messages (
  id SERIAL PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  sources JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Metadata / polling state
CREATE TABLE IF NOT EXISTS meta (
  key VARCHAR(255) PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chat_sessions_user ON chat_sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages (session_id);

-- =====================================================================
-- Chatbot enhancements: module / kind / decision_type
-- Idempotent ALTERs (safe on re-run).
-- =====================================================================
ALTER TABLE documents
  ADD COLUMN IF NOT EXISTS module VARCHAR(200),
  ADD COLUMN IF NOT EXISTS kind VARCHAR(50) DEFAULT 'note',
  ADD COLUMN IF NOT EXISTS decision_type VARCHAR(50);

CREATE INDEX IF NOT EXISTS idx_documents_module ON documents (module);
CREATE INDEX IF NOT EXISTS idx_documents_kind   ON documents (kind);
CREATE INDEX IF NOT EXISTS idx_documents_author ON documents (author);
CREATE INDEX IF NOT EXISTS idx_documents_metadata_gin ON documents USING GIN (metadata);

-- Backfill module/kind for rows missing them, derived from existing metadata.
UPDATE documents
SET module = COALESCE(
      module,
      metadata->>'module',
      metadata->>'repo',
      metadata->>'channel',
      metadata->>'database_id'
    )
WHERE module IS NULL;

UPDATE documents
SET kind = CASE
    WHEN metadata->>'type' = 'pull_request' THEN 'pr'
    WHEN metadata->>'type' = 'commit'       THEN 'code'
    WHEN metadata->>'type' = 'issue'        THEN 'issue'
    WHEN metadata->>'type' = 'thread'       THEN 'thread'
    WHEN metadata->>'type' = 'message'      THEN 'message'
    WHEN source = 'notion'                  THEN 'doc'
    WHEN title ILIKE '%ADR%' OR title ILIKE '%decision%' OR title ILIKE '%RFC%'
                                            THEN 'decision'
    ELSE 'note'
  END
WHERE kind IS NULL OR kind = 'note';

-- =====================================================================
-- Multi-project support
-- =====================================================================

-- Projects table
CREATE TABLE IF NOT EXISTS projects (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR(200) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed the default project with id=1
INSERT INTO projects (id, name)
VALUES (1, 'Project 1')
ON CONFLICT (id) DO NOTHING;

-- Reset the sequence so the next auto-generated id starts at 2
SELECT setval('projects_id_seq', GREATEST((SELECT MAX(id) FROM projects), 1));

-- User <-> Project membership (many-to-many, no roles)
CREATE TABLE IF NOT EXISTS project_members (
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (project_id, user_id)
);

-- Per-project integration config (replaces .env tokens)
CREATE TABLE IF NOT EXISTS project_integrations (
  id         SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  provider   VARCHAR(50) NOT NULL,   -- 'github' | 'slack' | 'notion'
  config     JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (project_id, provider)
);

-- Add project_id to documents
ALTER TABLE documents ADD COLUMN IF NOT EXISTS project_id INTEGER REFERENCES projects(id);
UPDATE documents SET project_id = 1 WHERE project_id IS NULL;
ALTER TABLE documents ALTER COLUMN project_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_documents_project ON documents (project_id);

-- Add project_id to embeddings
ALTER TABLE embeddings ADD COLUMN IF NOT EXISTS project_id INTEGER REFERENCES projects(id);
UPDATE embeddings e
   SET project_id = d.project_id
  FROM documents d
 WHERE e.document_id = d.id
   AND e.project_id IS NULL;
ALTER TABLE embeddings ALTER COLUMN project_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_embeddings_project ON embeddings (project_id);

-- Add project_id to chat_sessions
ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS project_id INTEGER REFERENCES projects(id);
UPDATE chat_sessions SET project_id = 1 WHERE project_id IS NULL;
ALTER TABLE chat_sessions ALTER COLUMN project_id SET NOT NULL;
CREATE INDEX IF NOT EXISTS idx_chat_sessions_project ON chat_sessions (project_id);
