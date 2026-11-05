// env.ts — resuelve la configuración por TARGET. Vive aparte de `db.ts` para que quien solo necesita
// leer una URL no arrastre el driver de MySQL.
//
// Cada `harness/.env.<target>` es AUTOSUFICIENTE: trae los HECHOS del entorno (BD, API, APP_KEY)
// y las perillas (Cognito, mocks, SEED). Ya NO existe la capa compartida `playground/env/` — se
// eliminó el 2026-07-22 porque solo la usaba harness (backend-e2e/backend-mcp, que la compartían,
// fueron borrados). Sin plantillas versionadas desde el 2026-10-19; la última: `git show bda2b796:harness/.env.<target>.example`.
//
// PRIORIDAD (gana el primero):  process.env  >  harness/.env.<target>
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

/** Un `harness/.env.<nombre>` que no es de un ambiente (p. ej. `.env.vtex`, la llave de la cuenta VTEX de pruebas),
 *  con process.env ganando igual que en `env()`. */
export function envFrom(name: string, key: string, fallback = ''): string {
    return process.env[key] ?? parseEnv(resolve(ROOT, `.env.${name}`))[key] ?? fallback;
}

/** Los nombres VIEJOS (en español) de algunas variables, que pasaron a inglés el 2026-09-25. Si sólo está
 *  el viejo —en un `.env.<target>` que nadie tocó, o exportado en la shell—, se copia al nuevo en
 *  `process.env`, así lo ven también los que lo leen directo y los procesos hijos. */
const OLD_ENV: Readonly<Record<string, string>> = {
    E2E_ADVISOR_HASH: 'E2E_ASESOR_HASH',
    E2E_ALLIED_URL: 'E2E_ALIADOS_URL',
    E2E_LENDER_NAME: 'E2E_LENDER_NOMBRE',
    E2E_SYNTH_DELINQUENCIES: 'E2E_SYNTH_MORA',
};
for (const [current, old] of Object.entries(OLD_ENV)) {
    if (process.env[current] !== undefined || fileEnv[current] !== undefined) continue;
    const v = process.env[old] ?? fileEnv[old];
    if (v !== undefined) process.env[current] = v;
}

/** Prioridad: process.env > harness/.env.<target>. */
export function env(key: string, fallback = ''): string {
    return process.env[key] ?? fileEnv[key] ?? fallback;
}

/** Ya no hay herencia entre targets (cada `.env.<target>` es autosuficiente). Se conserva el export
 *  vacío por compatibilidad con quien lo lea (p. ej. `bin/preflight.ts`, que lo muestra). */
export const INHERITS = '';

// La regla de qué puede hacer el harness en cada ambiente (prod de sólo lectura, nada de backend local
// con otro target) se instala acá porque casi todo el harness importa este archivo: `pkg/target-policy.ts`.
import { installFetchGuard, policyFor } from './target-policy.ts';
installFetchGuard(TARGET, env('E2E_TARGET_READONLY'));

/** Para los runners que CREAN solicitudes: en un ambiente de sólo lectura no arrancan (salida 2). El guard de
 *  `fetch` ya frenaría cada llamada, pero el aviso quedaba enterrado entre los errores que eso causa. */
export function refuseReadOnlyTarget(runner: string): void {
    if (policyFor(TARGET, env('E2E_TARGET_READONLY')).apiWrites) return;
    console.error(`  ✗ ${runner} crea solicitudes y ${TARGET} es de SÓLO LECTURA: no corre.`
        + `\n    Para leer ${TARGET}: bin/pg sql · request timeline · client state (pkg/target-policy.ts).`);
    process.exit(2);
}
