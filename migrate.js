const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

(async () => {
  const sql = fs.readFileSync(
    path.join(__dirname, 'src', 'database', 'schema.sql'),
    'utf8',
  );
  try {
    await pool.query(sql);
    console.log('Schema migrated successfully');
  } catch (err) {
    console.error('Migration error:', err.message);
  } finally {
    await pool.end();
  }
})();
