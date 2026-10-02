import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * Llamar a un conector por `bin/pg`: el harness ya no tiene su propio cliente de cada servicio, le pregunta al conector, que es el
 * único que lo sabe hablar (y donde viven sus credenciales). `bin/pg` lo compila la primera vez y cada vez que cambia su código.
 */

const PLAYGROUND = fileURLToPath(new URL('../../', import.meta.url));
const PG = `${PLAYGROUND}bin/pg`;

export interface PgResult {
    status: number;
    stdout: string;
    stderr: string;
}

/** Corre `pg <args>` desde la raíz del playground (los conectores buscan `connectors/` subiendo desde ahí). */
export function runPg(args: string[], opts: { timeoutMs?: number } = {}): PgResult {
    const r = spawnSync(PG, args, { cwd: PLAYGROUND, encoding: 'utf8', timeout: opts.timeoutMs ?? 5 * 60_000, env: process.env });
    return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

/** La última línea útil del error de un comando, para un mensaje de una línea. */
export function lastLine(text: string): string {
    return text.trim().split('\n').filter(Boolean).pop()?.replace(/^pg:\s*/, '') ?? '';
}
