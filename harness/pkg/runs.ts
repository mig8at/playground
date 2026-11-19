// LAS CORRIDAS CON NOMBRE (`harness/runs.json`, en git): «Finandina», «Pullman»… Cada una es un comercio del registro
// (`harness.json`), un canal, la entidad a elegir y el caso (monto, ingreso…), y sirve para las dos cosas:
//
//   - por consola, `make harness-run RUN=finandina [TARGET=qa]`: el caminador la corre sola y deja el video;
//   - en el panel, la vista «Corridas»: abre la pestaña del comercio con su canal y le carga el caso. Se le da ▶, el
//     autorrelleno llena cada pantalla y la persona sólo toca «Continuar» (y la entidad, que el panel le dice cuál).
//
// Reemplaza al plan de corrida (`.runs/plan.json`, `make harness-plan`, 2026-10-20): era UNO por máquina, fuera de git, y
// salió de la interfaz al día siguiente. Una corrida que además sabe qué esperar es una suite (`suites/*.json`).
// Una sola definición de qué es válido: la usan `dev/run.ts`, el panel (`/api/runs`) y la prueba del archivo.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { readFlows, branchFor } from './flows.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const RUNS_FILE = process.env.HARNESS_RUNS_FILE || join(ROOT, 'runs.json');

/** Los ambientes donde una corrida puede ir. Producción no: ahí no se corre nada armado. */
export const TARGETS = ['local', 'dev', 'qa', 'staging'] as const;
/** Los canales, con el nombre del panel. El caminador los llama de otra forma (`FLOW`). */
export const CHANNELS = { asesor: 'merchant', autogestion: 'self-service', ecommerce: 'ecommerce' } as const;
/** Los campos del caso: los ids de los campos del panel, que son también los argumentos del caminador que los toma. */
export const CASE_KEYS = ['amount', 'income', 'occupation', 'age', 'dob', 'expedition', 'name', 'document', 'email',
    'score', 'negatives', 'consulted', 'delinquencies'] as const;
export type CaseKey = (typeof CASE_KEYS)[number];

export interface NamedRun {
    /** Cómo se muestra (`Finandina`). La clave del archivo (`finandina`) es la que se pide. */
    name: string;
    description: string;
    /** La clave del comercio en `harness.json`: de ahí sale la sucursal de cada base. */
    merchant: string;
    channel: keyof typeof CHANNELS;
    /** El id de la entidad a elegir en el listado. */
    lender: number;
    /** El nombre con que sale en el listado (para decírselo a la persona y para elegirla sola). */
    lenderName?: string;
    /** El caso: lo que no esté queda como el panel lo tenga. */
    case?: Partial<Record<CaseKey, string | number>>;
    /** Dónde corre. El primero es el de por defecto de `make harness-run`. */
    targets: string[];
    /** Hasta dónde llega por consola: `true` hasta el desenlace (aprueba la identidad a mano y dicta el buró). */
    close?: boolean;
    /** Cuándo cerró por última vez con estas perillas, y cómo. */
    measured?: string;
}

/** Valida el archivo entero: los errores (vacío = válido) y las corridas. `merchants` son las claves del registro. */
export function validateRuns(raw: unknown, merchants: string[]): { errors: string[]; runs: Record<string, NamedRun> } {
    const errors: string[] = [];
    const runs: Record<string, NamedRun> = {};
    const all = (raw as any)?.runs;
    if (!all || typeof all !== 'object' || Array.isArray(all)) return { errors: ['falta `runs` (un objeto con una corrida por clave)'], runs };
    for (const [key, r] of Object.entries<any>(all)) {
        const err = (m: string) => errors.push(`${key}: ${m}`);
        if (!/^[a-z0-9-]+$/.test(key)) err('la clave va en minúsculas con guiones (es la que se escribe en RUN=)');
        if (!r?.name) err('falta `name`');
        if (!r?.description) err('falta `description`');
        if (!merchants.includes(r?.merchant)) err(`\`merchant\` «${r?.merchant}» no está en harness.json`);
        if (!(r?.channel in CHANNELS)) err(`\`channel\` «${r?.channel}» no es ${Object.keys(CHANNELS).join(', ')}`);
        if (!Number.isInteger(r?.lender) || r.lender <= 0) err('`lender` es el id de la entidad (un número)');
        if (!Array.isArray(r?.targets) || !r.targets.length) err('`targets` dice dónde corre (al menos uno)');
        else for (const t of r.targets) if (!(TARGETS as readonly string[]).includes(t)) err(`\`targets\`: «${t}» no es ${TARGETS.join(', ')}`);
        for (const [k, v] of Object.entries<any>(r?.case ?? {})) {
            if (!(CASE_KEYS as readonly string[]).includes(k)) err(`\`case.${k}\` no es un campo del panel (${CASE_KEYS.join(', ')})`);
            else if (typeof v !== 'string' && typeof v !== 'number') err(`\`case.${k}\` es texto o número`);
        }
        runs[key] = r as NamedRun;
    }
    return { errors, runs };
}

export function readRuns(file = RUNS_FILE): { errors: string[]; runs: Record<string, NamedRun> } {
    let raw: unknown;
    try { raw = JSON.parse(readFileSync(file, 'utf8')); } catch (e) { return { errors: [`no se lee ${file}: ${(e as Error).message}`], runs: {} }; }
    return validateRuns(raw, Object.keys(readFlows().merchants));
}

/** El caso del caminador para ESTE ambiente: `#<sucursal>:<entidad>`. Null si el comercio no tiene sucursal ahí. */
export function runCase(run: NamedRun, target: string): string | null {
    const branch = branchFor(run.merchant, target);
    return branch ? `#${branch}:${run.lender}` : null;
}
