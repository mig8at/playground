import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TARGET } from './env.ts';

/**
 * ¿El wizard local que está respondiendo en :5174 es el que CREEMOS, y si no, volver a levantarlo?
 *
 * POR QUÉ EXISTE. El 2026-10-02 se cambió el `.env` del wizard (otro login de Cognito) y el wizard siguió
 * sirviendo el viejo: Vite lee el `.env` UNA vez, al arrancar. Todo parecía en orden —respondía 200, era el
 * proceso de `bin/advisor`, apuntaba al backend correcto y no era más viejo que la rama—, así que ninguna de
 * las cuatro comprobaciones de `bin/advisor` lo reinició, y lo detectó una persona al ver que el login que
 * aparecía era el equivocado. Faltaba una comprobación que compare el wizard con SU PROPIA configuración.
 *
 * Acá van los juicios (puros, con prueba) y los dos efectos: mirar quién escucha y reiniciar. El arranque
 * en sí NO se reimplementa: es `bin/advisor <comercio> preboot`, que el panel ya usa y que sabe levantar el
 * wizard con las variables de cada target.
 */

export const WIZARD_PORT = 5174;

const HARNESS = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HOME = process.env.HOME ?? '';
const FRONT = process.env.CFE_FRONT_PATH ?? join(HOME, 'Desktop/CREDITOP/github/frontend-monorepo');
export const WIZARD_DIR = join(FRONT, 'apps/loan-request-wizard');

/** `ps -o lstart` → segundos desde la época. `null` si no se entiende. Pura. */
export function parseLstart(lstart: string): number | null {
    const t = Date.parse(lstart.trim().replace(/\s+/g, ' '));
    return Number.isNaN(t) ? null : Math.floor(t / 1000);
}

/** El valor de una clave en el texto de un `.env`, sin comillas. Pura. */
export function envValue(text: string, key: string): string | null {
    for (const line of text.split('\n')) {
        const m = new RegExp(`^\\s*${key}\\s*=\\s*(.*)$`).exec(line);
        if (m) return m[1].trim().replace(/^["']|["']$/g, '');
    }
    return null;
}

export interface WizardFacts {
    /** ¿alguien escucha y contesta HTTP? */
    up: boolean;
    /** Por qué no contestó, si no lo hizo (rechazo de conexión, tiempo agotado…). */
    downBecause?: string;
    /** Segundos de época en que arrancó el proceso que escucha, si se pudo leer. */
    startedAt: number | null;
    /** Última modificación (segundos) de cada archivo de configuración del wizard que existe. */
    envMtimes: Record<string, number>;
    /** Login de Cognito que el wizard DICE usar en su `.env`... */
    configuredAuthHost: string | null;
    /** ...y al que de verdad manda al pedir una ruta protegida. */
    servedAuthHost: string | null;
}

export interface Staleness {
    ok: boolean;
    /** Cada motivo en una línea, listo para imprimir. Vacío si está sano. */
    reasons: string[];
}

/**
 * ¿Hay que reiniciarlo? Cada motivo es una razón independiente y medida.
 *
 *  - caído: no contesta.
 *  - configuración editada después de arrancar: Vite no relee el `.env`, así que lo que sirve es lo viejo.
 *  - el login que sirve no es el que dice su `.env`: la prueba directa del caso de arriba. No depende de
 *    fechas, así que atrapa también un `.env` restaurado con un `mtime` anterior.
 */
export function stalenessOf(f: WizardFacts): Staleness {
    const reasons: string[] = [];
    if (!f.up) {
        reasons.push(`no contesta en :${WIZARD_PORT}${f.downBecause ? ` (${f.downBecause})` : ''}`);
        return { ok: false, reasons };
    }
    if (f.startedAt !== null) {
        for (const [name, mtime] of Object.entries(f.envMtimes)) {
            if (mtime > f.startedAt) reasons.push(`${name} se editó después de que arrancó el wizard`);
        }
    }
    if (f.configuredAuthHost && f.servedAuthHost && f.configuredAuthHost !== f.servedAuthHost) {
        reasons.push(`su .env dice login ${f.configuredAuthHost} pero el wizard manda a ${f.servedAuthHost}`);
    }
    return { ok: reasons.length === 0, reasons };
}

/** Quién escucha en el puerto: pid y arranque. Efecto: llama a `lsof` y `ps`. */
export function listener(): { pid: number; startedAt: number | null } | null {
    try {
        const out = execFileSync('lsof', ['-nP', `-iTCP:${WIZARD_PORT}`, '-sTCP:LISTEN', '-t'], { encoding: 'utf8' }).trim();
        const pid = Number(out.split('\n')[0]);
        if (!pid) return null;
        const lstart = execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8' });
        return { pid, startedAt: parseLstart(lstart) };
    } catch {
        return null;
    }
}

/** Reúne los hechos. Efecto: lee archivos, pregunta al proceso y al propio wizard. */
export async function gatherFacts(): Promise<WizardFacts> {
    const proc = listener();
    let up = false;
    let downBecause: string | undefined;
    try {
        // 30 s y no 4: recién arrancado, la PRIMERA petición compila el servidor y tarda (medido el 2026-10-02,
        // justo tras un reinicio) — con 4 s un wizard sano se leía como caído. Uno vivo contesta en ~40 ms.
        await fetch(`http://127.0.0.1:${WIZARD_PORT}`, { signal: AbortSignal.timeout(30_000), redirect: 'manual' });
        up = true;
    } catch (e) {
        const err = e as Error & { cause?: { code?: string } };
        downBecause = err.cause?.code ?? err.message;
    }

    const envMtimes: Record<string, number> = {};
    let configuredAuthHost: string | null = null;
    for (const name of ['.env', '.env.local']) {
        const path = join(WIZARD_DIR, name);
        if (!existsSync(path)) continue;
        envMtimes[name] = Math.floor(statSync(path).mtimeMs / 1000);
        // Vite carga `.env.local` por encima de `.env`: gana el último que lo defina.
        configuredAuthHost = envValue(readFileSync(path, 'utf8'), 'COGNITO_DOMAIN') ?? configuredAuthHost;
    }

    let servedAuthHost: string | null = null;
    if (up) {
        const { discoverHostedUi } = await import('./login-probe.ts');
        servedAuthHost = (await discoverHostedUi(`http://localhost:${WIZARD_PORT}`)).hosted?.host ?? null;
    }
    return { up, downBecause, startedAt: proc?.startedAt ?? null, envMtimes, configuredAuthHost, servedAuthHost };
}

/** Baja lo que escucha en el puerto: primero con SIGTERM y, si no cede, con SIGKILL. Sólo ese PID y su `pnpm`. */
export function stopWizard(): void {
    const proc = listener();
    if (!proc) return;
    let parent = 0;
    try { parent = Number(execFileSync('ps', ['-o', 'ppid=', '-p', String(proc.pid)], { encoding: 'utf8' }).trim()); } catch { /* sin padre */ }
    for (const signal of ['SIGTERM', 'SIGKILL'] as const) {
        for (const pid of [proc.pid, parent]) {
            // No tocar el shell ni el launcher: sólo el padre si es el `pnpm dev` del wizard.
            if (pid > 1 && (pid === proc.pid || isPnpmDev(pid))) { try { process.kill(pid, signal); } catch { /* ya salió */ } }
        }
        const until = Date.now() + 4000;
        while (Date.now() < until && listener()) spawnSync('sleep', ['0.3']);
        if (!listener()) return;
    }
}

function isPnpmDev(pid: number): boolean {
    try { return /pnpm.* dev/.test(execFileSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8' })); } catch { return false; }
}

export interface EnsureResult {
    /** `sano` · `reiniciado` · `no reiniciado` (había motivos y no se pidió) · `falló`. */
    estado: 'sano' | 'reiniciado' | 'no reiniciado' | 'falló';
    reasons: string[];
    detalle: string;
}

/**
 * Deja el wizard sano: si hay motivos para reiniciarlo, lo baja y lo vuelve a levantar con
 * `bin/advisor <comercio> preboot`, que le pone las variables del target. `restart: false` sólo diagnostica.
 * La salida del arranque va a `out` (stderr por defecto) para no ensuciar el stdout de quien lo llama.
 */
export async function ensureWizard(opts: { merchant?: string; restart?: boolean; out?: number | 'inherit' } = {}): Promise<EnsureResult> {
    const stale = stalenessOf(await gatherFacts());
    if (stale.ok) return { estado: 'sano', reasons: [], detalle: 'el wizard responde y está al día con su configuración' };
    if (opts.restart === false) return { estado: 'no reiniciado', reasons: stale.reasons, detalle: 'hay motivos para reiniciarlo; no se pidió' };

    const merchant = opts.merchant ?? 'pullman';
    stopWizard();
    const run = spawnSync(join(HARNESS, 'bin/advisor'), [merchant, 'preboot'], {
        cwd: HARNESS,
        env: { ...process.env, CFE_TARGET: TARGET },
        stdio: ['ignore', opts.out ?? 2, 'inherit'],
        timeout: 10 * 60_000,
    });
    if (run.status !== 0) return { estado: 'falló', reasons: stale.reasons, detalle: `bin/advisor ${merchant} preboot salió con código ${run.status ?? 'sin código'}` };

    // Recién arrancado, el wizard puede estar un rato sin contestar (Vite se reinicia solo cuando cambian sus
    // archivos de configuración): se espera a que se asiente antes de juzgarlo, y se dice el último motivo.
    const after = await settle(async () => stalenessOf(await gatherFacts()), { tries: 12, gapMs: 5000 });
    return after.ok
        ? { estado: 'reiniciado', reasons: stale.reasons, detalle: 'reiniciado y al día' }
        : { estado: 'falló', reasons: after.reasons, detalle: 'se reinició pero sigue con motivos' };
}

/**
 * Repite un juicio hasta que dé sano o se acaben los intentos, y devuelve el último. Pura en lo que importa:
 * el juicio y la espera se inyectan, así se prueba sin esperar de verdad.
 */
export async function settle(
    judge: () => Promise<Staleness>,
    opts: { tries: number; gapMs: number; sleep?: (ms: number) => Promise<void> },
): Promise<Staleness> {
    const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    let last: Staleness = { ok: false, reasons: ['sin intentos'] };
    for (let i = 0; i < opts.tries; i += 1) {
        last = await judge();
        if (last.ok) return last;
        if (i < opts.tries - 1) await sleep(opts.gapMs);
    }
    return last;
}
