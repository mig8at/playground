import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Las credenciales de login viven en `connectors/`, como las de los demás servicios: UN lugar, fuera de git.
 *
 * Este lector es el espejo en TypeScript de `connectors/env/env.go`, con la MISMA regla de prioridad:
 *   el proceso (si no está vacío)  >  `connectors/.env.<ambiente>`  >  `connectors/.env`.
 * Se escribió acá y no se llama a `bin/pg` porque sacar una clave por un proceso hijo por cada lectura costaría
 * más que el login mismo, y la regla cabe en veinte líneas. Si la de Go cambia, cambia esta (hay prueba).
 *
 * Las claves de login, por ambiente (una cuenta por PERSONA: cada quien pone la suya en su máquina):
 *   ADMIN_USER / ADMIN_PASS      el admin de legacy-application (Laravel, Fortify)
 *   ADVISOR_USER / ADVISOR_PASS  el asesor del wizard (Cognito)
 */

const PLAYGROUND = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const CONNECTORS_DIR = join(PLAYGROUND, 'connectors');

/** `KEY=VALUE` por línea, sin interpolación ni multilínea: un `.env` nunca se ejecuta. Pura. */
export function parseEnvText(text: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const raw of text.split('\n')) {
        let line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        line = line.replace(/^export\s+/, '');
        const eq = line.indexOf('=');
        if (eq < 0) continue;
        out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim().replace(/^["']+|["']+$/g, '');
    }
    return out;
}

function readEnvFile(path: string): Record<string, string> {
    return existsSync(path) ? parseEnvText(readFileSync(path, 'utf8')) : {};
}

export interface EnvSources {
    /** Lo que hay en el proceso. */
    proc: Record<string, string | undefined>;
    /** `connectors/.env.<ambiente>`. */
    target: Record<string, string>;
    /** `connectors/.env`. */
    shared: Record<string, string>;
}

/**
 * La primera clave de `keys` que tenga valor, y de dónde salió. Pura: las fuentes se inyectan, así la
 * prioridad se fija con pruebas sin tocar disco. Un valor vacío en el proceso NO tapa el del archivo.
 */
export function resolveKey(keys: string[], sources: EnvSources): { value: string; from: 'proceso' | 'ambiente' | 'compartido' } | null {
    const layers: Array<[Record<string, string | undefined>, 'proceso' | 'ambiente' | 'compartido']> = [
        [sources.proc, 'proceso'], [sources.target, 'ambiente'], [sources.shared, 'compartido'],
    ];
    for (const [layer, from] of layers) {
        for (const k of keys) {
            const v = (layer[k] ?? '').trim();
            if (v) return { value: v, from };
        }
    }
    return null;
}

export function loadSources(target: string): EnvSources {
    return {
        proc: process.env,
        target: readEnvFile(join(CONNECTORS_DIR, `.env.${target}`)),
        shared: readEnvFile(join(CONNECTORS_DIR, '.env')),
    };
}

export type CredentialKind = 'admin' | 'advisor';

export interface Credentials {
    user: string;
    pass: string;
    /** De dónde salió, para decirlo en voz alta: una credencial de un archivo viejo no debe pasar desapercibida. */
    source: string;
    /** `true` si vino de un lugar que ya no es el canónico (`.admin.json`, `.cognito.json`, `E2E_*`). */
    legacy: boolean;
}

const KEYS: Record<CredentialKind, { user: string; pass: string }> = {
    admin: { user: 'ADMIN_USER', pass: 'ADMIN_PASS' },
    advisor: { user: 'ADVISOR_USER', pass: 'ADVISOR_PASS' },
};

/** Los nombres de las claves de un tipo de login, para los mensajes. */
export const credentialKeys = (kind: CredentialKind) => KEYS[kind];

/** Las credenciales viejas: archivos del harness y variables `E2E_*`. Se siguen leyendo, avisando, mientras se mudan. */
function legacyCredentials(kind: CredentialKind, target: string): Credentials | null {
    const T = target.toUpperCase();
    const pick = (user?: string, pass?: string, source = ''): Credentials | null => (user && pass ? { user, pass, source, legacy: true } : null);
    if (kind === 'admin') {
        const byEnv = pick(process.env[`E2E_ADMIN_USER_${T}`] || process.env.E2E_ADMIN_USER, process.env[`E2E_ADMIN_PASS_${T}`] || process.env.E2E_ADMIN_PASS, 'variables E2E_ADMIN_*');
        if (byEnv) return byEnv;
        const file = join(dirname(CONNECTORS_DIR), 'harness', '.admin.json');
        if (existsSync(file)) {
            try {
                const raw = JSON.parse(readFileSync(file, 'utf8'));
                const c = raw?.[target] ?? raw ?? {};
                return pick(c.user, c.pass, 'harness/.admin.json');
            } catch { /* archivo roto = como si no existiera */ }
        }
        return null;
    }
    const byEnv = pick(process.env.E2E_COGNITO_USER, process.env.E2E_COGNITO_PASS, 'variables E2E_COGNITO_*');
    if (byEnv) return byEnv;
    const file = join(dirname(CONNECTORS_DIR), 'harness', '.cognito.json');
    if (existsSync(file)) {
        try {
            const raw = JSON.parse(readFileSync(file, 'utf8'));
            return pick(raw.user, raw.pass, 'harness/.cognito.json');
        } catch { /* idem */ }
    }
    return null;
}

/**
 * La credencial de ese tipo de login para ese ambiente, o `null`. SÓLO sale del lugar canónico (`connectors/`).
 *
 * ⚠ Lo viejo (`.admin.json`, `.cognito.json`, `E2E_*`) NO se usa nunca por su cuenta. Se probó el 2026-10-02 y es
 * peligroso: el `.admin.json` de esta máquina guarda la cuenta de OTRA persona (Duncan), y un `signin` que cae a
 * ella entra a un ambiente compartido con una identidad que nadie eligió. Se lo detecta (`legacyCredentials`) sólo
 * para avisar que hay que mudarlo.
 */
export function credentialsFor(kind: CredentialKind, target: string, sources: EnvSources = loadSources(target)): Credentials | null {
    const user = resolveKey([KEYS[kind].user], sources);
    const pass = resolveKey([KEYS[kind].pass], sources);
    if (user && pass) return { user: user.value, pass: pass.value, source: `connectors (${user.from})`, legacy: false };
    return null;
}

/** ¿Hay una credencial en un lugar viejo? Devuelve de quién, SIN la clave, para avisar. Nunca se usa para entrar. */
export function legacyCredentialHint(kind: CredentialKind, target: string): { user: string; source: string } | null {
    const c = legacyCredentials(kind, target);
    return c ? { user: c.user, source: c.source } : null;
}
