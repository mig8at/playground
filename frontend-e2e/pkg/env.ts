// env.ts — resuelve la configuración por TARGET. Vive aparte de `db.ts` para que quien solo necesita
// leer una URL no arrastre el driver de MySQL.
//
// PRIORIDAD (gana el primero):
//   process.env  >  <herramienta>/.env.<target>  >  env/<target>.env  >  env/<heredado>.env
//
// HERENCIA (`E2E_INHERITS`): un target puede declarar que hereda los hechos de otro y redefinir solo lo
// que cambia. Existe por **staging**: en legacy-backend la API y la BD de staging son LAS MISMAS que las
// de dev — el único que tiene ambiente propio es el frontend. Duplicar host/usuario/clave en un segundo
// archivo sería copiar secretos y garantizar que deriven el día que roten. Así `staging.env` son dos
// líneas: de quién hereda, y su URL de front.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SHARED = resolve(ROOT, '..', 'env');

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

/** Hechos compartidos del target, con la cadena de herencia resuelta primero. */
function sharedFor(target: string, seen = new Set<string>()): Record<string, string> {
    if (seen.has(target)) return {}; // ciclo A→B→A: cortamos en vez de colgarnos
    seen.add(target);
    const own = parseEnv(resolve(SHARED, `${target}.env`));
    const parent = own.E2E_INHERITS?.trim().toLowerCase();
    return parent ? { ...sharedFor(parent, seen), ...own } : own;
}

// El `.env.<target>` propio de la herramienta (perillas: Cognito, mocks, SEED) pisa a los compartidos.
const fileEnv: Record<string, string> = {
    ...sharedFor(TARGET),
    ...parseEnv(resolve(ROOT, `.env.${TARGET}`)),
};

/** Prioridad: process.env > .env.<target> de la herramienta > env/<target>.env (y sus heredados). */
export function env(key: string, fallback = ''): string {
    return process.env[key] ?? fileEnv[key] ?? fallback;
}

/** De qué target hereda este (vacío si no hereda). Útil para mostrarlo en el panel. */
export const INHERITS = (sharedFor(TARGET).E2E_INHERITS || '').trim().toLowerCase();
