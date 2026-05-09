import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

const steps: { name: string; sql: string }[] = [
  {
    name: 'Create projects table',
    sql: `
      CREATE TABLE IF NOT EXISTS projects (
        id         SERIAL PRIMARY KEY,
        name       VARCHAR(200) NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `,
  },
  {
    name: 'Seed default project (id=1)',
    sql: `
      INSERT INTO projects (id, name)
      VALUES (1, 'Project 1')
      ON CONFLICT (id) DO NOTHING;
    `,
  },
  {
    name: 'Reset projects sequence',
    sql: `
      SELECT setval('projects_id_seq', GREATEST((SELECT MAX(id) FROM projects), 1));
    `,
  },
  {
    name: 'Create project_members table',
    sql: `
      CREATE TABLE IF NOT EXISTS project_members (
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        user_id    INTEGER NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        PRIMARY KEY (project_id, user_id)
      );
    `,
  },
  {
    name: 'Create project_integrations table',
    sql: `
      CREATE TABLE IF NOT EXISTS project_integrations (
        id         SERIAL PRIMARY KEY,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        provider   VARCHAR(50) NOT NULL,
        config     JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (project_id, provider)
      );
    `,
  },
  {
    name: 'Add project_id to documents',
    sql: `ALTER TABLE documents ADD COLUMN IF NOT EXISTS project_id INTEGER REFERENCES projects(id);`,
  },
  {
    name: 'Backfill documents.project_id = 1',
    sql: `UPDATE documents SET project_id = 1 WHERE project_id IS NULL;`,
  },
  {
    name: 'Set documents.project_id NOT NULL',
    sql: `ALTER TABLE documents ALTER COLUMN project_id SET NOT NULL;`,
  },
  {
    name: 'Index documents.project_id',
    sql: `CREATE INDEX IF NOT EXISTS idx_documents_project ON documents (project_id);`,
  },
  {
    name: 'Add project_id to embeddings',
    sql: `ALTER TABLE embeddings ADD COLUMN IF NOT EXISTS project_id INTEGER REFERENCES projects(id);`,
  },
  {
    name: 'Backfill embeddings.project_id from parent document',
    sql: `
      UPDATE embeddings e
         SET project_id = d.project_id
        FROM documents d
       WHERE e.document_id = d.id
         AND e.project_id IS NULL;
    `,
  },
  {
    name: 'Set embeddings.project_id NOT NULL',
    sql: `ALTER TABLE embeddings ALTER COLUMN project_id SET NOT NULL;`,
  },
  {
    name: 'Index embeddings.project_id',
    sql: `CREATE INDEX IF NOT EXISTS idx_embeddings_project ON embeddings (project_id);`,
  },
  {
    name: 'Add project_id to chat_sessions',
    sql: `ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS project_id INTEGER REFERENCES projects(id);`,
  },
  {
    name: 'Backfill chat_sessions.project_id = 1',
    sql: `UPDATE chat_sessions SET project_id = 1 WHERE project_id IS NULL;`,
  },
  {
    name: 'Set chat_sessions.project_id NOT NULL',
    sql: `ALTER TABLE chat_sessions ALTER COLUMN project_id SET NOT NULL;`,
  },
  {
    name: 'Index chat_sessions.project_id',
    sql: `CREATE INDEX IF NOT EXISTS idx_chat_sessions_project ON chat_sessions (project_id);`,
  },
  {
    name: 'Add all existing users to project 1',
    sql: `
      INSERT INTO project_members (project_id, user_id)
      SELECT 1, id FROM users
      ON CONFLICT DO NOTHING;
    `,
  },
];

async function migrate() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('❌  DATABASE_URL is not set in .env');
    process.exit(1);
  }

  const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });

  const client = await pool.connect();
  console.log('🔌 Connected to database\n');

  try {
    for (const step of steps) {
      process.stdout.write(`  ⏳  ${step.name} ... `);
      await client.query(step.sql);
      console.log('✅');
    }
    console.log('\n🎉  Multi-project migration completed successfully.');
  } catch (err: any) {
    console.log('❌');
    console.error(`\n❌  Migration failed: ${err?.message ?? err}`);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
