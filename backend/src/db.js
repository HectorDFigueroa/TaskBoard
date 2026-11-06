import pg from 'pg';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// NUMERIC llega como string por defecto; lo convertimos a número
pg.types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)));
// DATE llega como string 'YYYY-MM-DD' (evita corrimientos por zona horaria)
pg.types.setTypeParser(1082, (v) => v);

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

export async function initDb() {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const sql = await readFile(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  await pool.query(sql);
}
