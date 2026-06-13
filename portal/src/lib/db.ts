// MariaDB access (mysql2/promise). Server-only.
import mysql from "mysql2/promise";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { env } from "./env";

let pool: mysql.Pool | null = null;

export function getPool(): mysql.Pool {
  if (!pool) {
    pool = mysql.createPool({
      host: env.db.host,
      port: env.db.port,
      user: env.db.user,
      password: env.db.password,
      database: env.db.database,
      connectionLimit: 8,
      namedPlaceholders: false,
      charset: "utf8mb4",
    });
  }
  return pool;
}

// Generic query helper. Returns rows as plain objects.
export async function query<T = any>(sql: string, params: any[] = []): Promise<T[]> {
  const [rows] = await getPool().execute(sql, params);
  return rows as T[];
}

export async function exec(sql: string, params: any[] = []): Promise<mysql.ResultSetHeader> {
  const [res] = await getPool().execute(sql, params);
  return res as mysql.ResultSetHeader;
}

export async function one<T = any>(sql: string, params: any[] = []): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

// Apply schema.sql. Idempotent (CREATE TABLE IF NOT EXISTS). Worker calls this on start.
export async function bootstrap(): Promise<void> {
  const schema = readFileSync(join(process.cwd(), "db", "schema.sql"), "utf8");
  // A dedicated connection with multipleStatements to run the whole file at once.
  const conn = await mysql.createConnection({
    host: env.db.host,
    port: env.db.port,
    user: env.db.user,
    password: env.db.password,
    database: env.db.database,
    multipleStatements: true,
  });
  try {
    await conn.query(schema);
  } finally {
    await conn.end();
  }
}
