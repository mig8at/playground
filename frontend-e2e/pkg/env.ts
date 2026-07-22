// env.ts — resuelve la configuración por TARGET. Vive aparte de `db.ts` para que quien solo necesita
// leer una URL no arrastre el driver de MySQL.
//
// Cada `frontend-e2e/.env.<target>` es AUTOSUFICIENTE: trae los HECHOS del entorno (BD, API, APP_KEY)
// y las perillas (Cognito, mocks, SEED). Ya NO existe la capa compartida `playground/env/` — se
// eliminó el 2026-07-22 porque solo la usaba frontend-e2e (backend-e2e/backend-mcp, que la compartían,
// fueron borrados). La plantilla documentada de cada target es `.env.<target>.example` (versionada).
//
// PRIORIDAD (gana el primero):  process.env  >  frontend-e2e/.env.<target>
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

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

const fileEnv: Record<string, string> = parseEnv(resolve(ROOT, `.env.${TARGET}`));

/** Prioridad: process.env > frontend-e2e/.env.<target>. */
export function env(key: string, fallback = ''): string {
    return process.env[key] ?? fileEnv[key] ?? fallback;
}

/** Ya no hay herencia entre targets (cada `.env.<target>` es autosuficiente). Se conserva el export
 *  vacío por compatibilidad con quien lo lea (p. ej. `bin/preflight.ts`, que lo muestra). */
export const INHERITS = '';
