// db.ts — acceso a MySQL para que frontend-e2e sea autosuficiente (sin shellear a backend-mcp).
// target = E2E_TARGET (default "dev"). Las credenciales (E2E_DB_HOST/PORT/NAME/USER/PASS + APP_KEY)
// son HECHOS del entorno y viven COMPARTIDAS en `playground/env/<target>.env`, junto con backend-e2e y
// backend-mcp. El `.env.<target>` propio de frontend-e2e queda para sus perillas (Cognito, mocks…) y
// PISA lo compartido si redefine una clave. Prioridad: process.env > .env.<target> > env/<target>.env.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import mysql from 'mysql2/promise';
import type { Pool, PoolConnection, RowDataPacket, ResultSetHeader } from 'mysql2/promise';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const TARGET = (process.env.E2E_TARGET || 'dev').toLowerCase();

function parseEnv(p: string): Record<string, string> {
    const m: Record<string, string> = {};
    if (!existsSync(p)) return m;
    for (const line of readFileSync(p, 'utf8').split('\n')) {
        const s = line.trim();
        if (!s || s.startsWith('#')) continue;
        const i = s.indexOf('=');
        if (i < 0) continue;
        let v = s.slice(i + 1).trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        m[s.slice(0, i).trim()] = v;
    }
    return m;
}

// Hechos del entorno COMPARTIDOS con backend-e2e y backend-mcp (BD, API, APP_KEY). El `.env.<target>`
// propio tiene prioridad: los compartidos entran solo como fallback (por eso van segundos en el spread).
const fileEnv: Record<string, string> = {
    ...parseEnv(resolve(ROOT, '..', 'env', `${TARGET}.env`)),
    ...parseEnv(resolve(ROOT, `.env.${TARGET}`)),
};

/** Prioridad: process.env > .env.<target> de la herramienta > ../env/<target>.env compartido. */
export function env(key: string, fallback = ''): string {
    return process.env[key] ?? fileEnv[key] ?? fallback;
}

export function appKey(): string {
    const k = env('APP_KEY');
    if (!k) throw new Error(`APP_KEY ausente en .env.${TARGET} (necesario para encriptar la fila Experian)`);
    return k;
}

/** Guarda para escrituras: en dev (o host no-local) exige I_KNOW_THIS_TOUCHES_SHARED_DEV=1. */
export function assertWriteAllowed(): void {
    const host = env('E2E_DB_HOST', '127.0.0.1');
    const isLocal = TARGET === 'local' || host === '127.0.0.1' || host === 'localhost' || host === '::1';
    if (isLocal) return;
    if (env('I_KNOW_THIS_TOUCHES_SHARED_DEV') !== '1') {
        throw new Error(`escritura a DB compartida (${TARGET}, ${host}) bloqueada: exportá I_KNOW_THIS_TOUCHES_SHARED_DEV=1`);
    }
}

let _pool: Pool | null = null;

export function pool(): Pool {
    if (_pool) return _pool;
    _pool = mysql.createPool({
        host: env('E2E_DB_HOST', '127.0.0.1'),
        port: Number(env('E2E_DB_PORT', '3306')),
        user: env('E2E_DB_USER', 'root'),
        password: env('E2E_DB_PASS', ''),
        database: env('E2E_DB_NAME', ''),
        connectionLimit: 5,
        charset: 'utf8mb4',
        dateStrings: true,
    });
    return _pool;
}

/** SELECT → filas tipadas (loose). */
export async function query<T = Record<string, any>>(sql: string, params: any[] = []): Promise<T[]> {
    const [rows] = await pool().query<RowDataPacket[]>(sql, params);
    return rows as unknown as T[];
}

/** Primera fila o null. */
export async function one<T = Record<string, any>>(sql: string, params: any[] = []): Promise<T | null> {
    const rows = await query<T>(sql, params);
    return rows.length ? rows[0] : null;
}

/** Primer valor de la primera fila (o null). */
export async function scalar<T = any>(sql: string, params: any[] = []): Promise<T | null> {
    const row = await one<Record<string, any>>(sql, params);
    if (!row) return null;
    const k = Object.keys(row)[0];
    return (row[k] ?? null) as T;
}

/** INSERT/UPDATE/DELETE → { affectedRows, insertId }. */
export async function exec(sql: string, params: any[] = []): Promise<{ affectedRows: number; insertId: number }> {
    const [res] = await pool().query<ResultSetHeader>(sql, params);
    return { affectedRows: res.affectedRows ?? 0, insertId: res.insertId ?? 0 };
}

/** Corre `fn` sobre UNA conexión dedicada (necesario para SET FOREIGN_KEY_CHECKS / sesiones). */
export async function withConnection<T>(fn: (c: PoolConnection) => Promise<T>): Promise<T> {
    const c = await pool().getConnection();
    try {
        return await fn(c);
    } finally {
        c.release();
    }
}

export async function close(): Promise<void> {
    if (_pool) {
        await _pool.end();
        _pool = null;
    }
}
