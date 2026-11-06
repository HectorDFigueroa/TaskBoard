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

/** Ejecuta fn(cliente) en una transacción: si lanza un error, se deshace todo. */
export async function enTransaccion(fn) {
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    const resultado = await fn(cliente);
    await cliente.query('COMMIT');
    return resultado;
  } catch (err) {
    await cliente.query('ROLLBACK');
    throw err;
  } finally {
    cliente.release();
  }
}

export async function initDb() {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const sql = await readFile(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  await pool.query(sql);
}
