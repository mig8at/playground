// run-plan.ts — EL PLAN DE CORRIDA: una corrida del panel armada de antemano (por un agente o a mano), que el panel
// muestra lista para darle play.
//
// Es la versión VISUAL de un caso de suite (`suites/*.json`): las mismas claves del caso (`amount`, `income`,
// `score`…) y de la entidad (`lender`), sin el `espera`. Una suite corre por consola y da veredicto; un plan prepara el
// panel para que una persona lo mire o lo maneje. Si un plan sirvió, pasarlo a suite es agregarle lo que se espera.
//
// Vive en `.runs/plan.json` (fuera de git, como lo demás de `.runs/`): hay UNO por máquina, el que está por correrse.
// Lo escriben `bin/plan.ts` y `POST /api/plan`, y los dos validan acá: una sola definición de qué es un plan válido.
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const PLAN_FILE = join(ROOT, '.runs', 'plan.json');

/** Los ambientes del panel. Producción no está: tiene su propia vista, con sus comprobaciones. */
const TARGETS = ['local', 'dev', 'staging', 'qa'];
/** Los canales que el panel sabe abrir en el celular a partir de un plan. Autogestión, auto y QR todavía no. */
const CHANNELS = ['asesor', 'ecommerce'];
/** Cómo se corre: `manual` abre los celulares y la persona avanza; `auto` avanza solo (todavía no implementado). */
const PLAYS = ['manual', 'auto'];
/** Los campos del caso que el plan puede fijar, con el nombre del campo del panel. Lo que falte queda como esté. */
export const CASE_KEYS = ['amount', 'income', 'occupation', 'age', 'dob', 'expedition', 'name', 'document', 'email',
    'score', 'negatives', 'consulted', 'delinquencies'] as const;

export interface RunPlan {
    nombre: string;
    target: string;
    /** El slug de un comercio del panel (`pullman`) o el hash de 8 hex de una sucursal. */
    comercio: string;
    canal: string;
    /** La entidad a elegir en el listado: id (`77`) o nombre (`CrediPullman`). Opcional. */
    lender?: number | string | null;
    caso?: Partial<Record<(typeof CASE_KEYS)[number], string | number>>;
    play: string;
    /** Quién lo armó y cuándo: lo pone quien lo guarda. */
    creado?: string;
}

/** Valida un plan. Devuelve los errores (vacío = válido) y el plan normalizado. */
export function validatePlan(raw: unknown): { ok: boolean; errors: string[]; plan?: RunPlan } {
    const errors: string[] = [];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, errors: ['el plan tiene que ser un objeto JSON'] };
    const p = raw as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');
    const nombre = str(p.nombre);
    const target = str(p.target) || 'local';
    const comercio = str(p.comercio);
    const canal = str(p.canal) || 'asesor';
    const play = str(p.play) || 'manual';
    if (!nombre) errors.push('falta `nombre`');
    if (!comercio) errors.push('falta `comercio` (slug del panel o hash de sucursal)');
    if (!TARGETS.includes(target)) errors.push(`\`target\` «${target}» no es uno del panel (${TARGETS.join(', ')})`);
    if (!CHANNELS.includes(canal)) errors.push(`\`canal\` «${canal}»: un plan abre ${CHANNELS.join(' o ')} por ahora`);
    if (!PLAYS.includes(play)) errors.push(`\`play\` «${play}» no es ${PLAYS.join(' ni ')}`);
    const caso: RunPlan['caso'] = {};
    if (p.caso !== undefined) {
        if (!p.caso || typeof p.caso !== 'object' || Array.isArray(p.caso)) errors.push('`caso` tiene que ser un objeto');
        else for (const [k, v] of Object.entries(p.caso as Record<string, unknown>)) {
            if (!(CASE_KEYS as readonly string[]).includes(k)) { errors.push(`\`caso.${k}\` no es un campo del panel (${CASE_KEYS.join(', ')})`); continue; }
            if (typeof v !== 'string' && typeof v !== 'number') { errors.push(`\`caso.${k}\` tiene que ser texto o número`); continue; }
            caso[k as (typeof CASE_KEYS)[number]] = v;
        }
    }
    const lender = p.lender === undefined || p.lender === null || p.lender === '' ? null
        : typeof p.lender === 'number' || typeof p.lender === 'string' ? p.lender : undefined;
    if (lender === undefined) errors.push('`lender` tiene que ser el id o el nombre de la entidad');
    if (errors.length) return { ok: false, errors };
    return { ok: true, errors, plan: { nombre, target, comercio, canal, lender, caso, play, creado: str(p.creado) || new Date().toISOString() } };
}

export function readPlan(): RunPlan | null {
    if (!existsSync(PLAN_FILE)) return null;
    try { return validatePlan(JSON.parse(readFileSync(PLAN_FILE, 'utf8'))).plan ?? null; } catch { return null; }
}

export function writePlan(plan: RunPlan): void {
    mkdirSync(dirname(PLAN_FILE), { recursive: true });
    writeFileSync(PLAN_FILE, JSON.stringify(plan, null, 2) + '\n');
}

export function clearPlan(): void { rmSync(PLAN_FILE, { force: true }); }
