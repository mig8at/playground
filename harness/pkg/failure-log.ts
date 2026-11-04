// failure-log.ts — el REGISTRO de lo que corrió y lo que falló, caso por caso, en todas las corridas de esta máquina.
//
// POR QUÉ. Cada corrida sabía ambiente, comercio, entidad, solicitud, veredicto y desvíos, y todo eso se perdía en la
// terminal: `regression-last.json` guarda sólo la ÚLTIMA. Sin la historia no se puede contestar lo que importa al
// mirar un rojo: ¿falla siempre o fue intermitente? ¿sólo en qa, o sólo con este comercio? ¿desde cuándo?
//
// QUÉ GUARDA. Una línea por CASO y por corrida (también los verdes: sin ellos no hay «desde cuándo» ni «intermitente»),
// en `.runs/registry/cases.ndjson`, sólo agregando. Es un registro de DATOS, sin curar: lo que alguien confirmó y
// explicó es una incidencia, y vive en el tablero (`tablero/tasks/incidencias`), que puede citar estas corridas.
//
// ⚠ No escribe nada en ninguna base ni sale a la red: un archivo de esta máquina, fuera de git (`.runs/`).
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';

export const REGISTRY_DIR = join(import.meta.dirname, '..', '.runs', 'registry');
export const REGISTRY_FILE = join(REGISTRY_DIR, 'cases.ndjson');

/** Un caso de una corrida. `ok` es el veredicto ENTERO del caso: cerró como se pidió y no se desvió de lo declarado. */
export type CaseRecord = {
    v: 1;
    at: string;               // ISO, hora de esta máquina
    run: string;              // id de la corrida: todas las líneas de una corrida lo comparten
    runner: 'case' | 'walk';  // el runner de casos (API) o el caminador del wizard
    target: string;           // local · dev · qa · staging
    suite: string | null;     // archivo de la suite, sin carpeta; null si fue CASES=
    caso: string | null;      // el nombre del caso en la suite
    comercio: string;         // como lo pidió la suite (slug, #hash o nombre)
    lender: number | string | null;
    canal: string;            // por dónde entró: `api` para el runner de casos
    ur: number | null;        // la solicitud que quedó
    ok: boolean;
    sinVeredicto?: boolean;   // la corrida no llegó a decidir (prevuelo, suite inválida, error)
    detalle: string | null;   // por qué no cerró, si no cerró
    desvios: string[];        // lo que no cumplió de lo que declara
    comando: string;          // cómo repetirlo
    backend: string | null;   // rama y commit de legacy-backend con que corrió (lo medido es ESA rama)
};

/** Dónde está el clon de un repo: de `tools/repos.json`, la misma fuente que usa `dev/doctor.ts`. */
export function repoPath(alias: string): string | null {
    try {
        const repos = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../tools/repos.json'), 'utf8'));
        const p = repos.indexed?.[alias] ?? repos.citable_only?.[alias];
        return p ? String(p).replace(/^~\//, homedir() + '/') : null;
    } catch { return null; }
}

/** La rama y el commit de un clon, o null si no se puede leer. Barato: dos `git` locales, sin red. */
export function repoRef(repoPath: string): string | null {
    try {
        const branch = execFileSync('git', ['-C', repoPath, 'rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' }).trim();
        const sha = execFileSync('git', ['-C', repoPath, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim();
        return `${branch}@${sha}`;
    } catch { return null; }
}

/** Agrega las líneas de una corrida. Nunca tira: un registro que no se pudo escribir no le cambia el veredicto a nadie. */
export function appendCases(records: CaseRecord[]): string | null {
    if (!records.length) return null;
    try {
        mkdirSync(REGISTRY_DIR, { recursive: true });
        appendFileSync(REGISTRY_FILE, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
        return REGISTRY_FILE;
    } catch (e) {
        console.error(`  ⚠ no pude escribir el registro de fallas (${(e as Error).message}): la corrida vale igual`);
        return null;
    }
}

/** Lee el registro entero. Una línea rota se salta y se cuenta, no tira: el archivo se escribe agregando. */
export function readCases(file = REGISTRY_FILE): { cases: CaseRecord[]; broken: number } {
    if (!existsSync(file)) return { cases: [], broken: 0 };
    const cases: CaseRecord[] = [];
    let broken = 0;
    for (const line of readFileSync(file, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        try { cases.push(JSON.parse(line)); } catch { broken++; }
    }
    return { cases, broken };
}

/** La identidad de un caso a través de corridas: la suite y el nombre si los hay; si no, comercio y entidad. */
export function caseKey(c: Pick<CaseRecord, 'runner' | 'suite' | 'caso' | 'comercio' | 'lender' | 'canal'>): string {
    return c.suite && c.caso
        ? `${c.runner}|${c.suite}|${c.caso}`
        : `${c.runner}|${c.comercio}|${c.lender ?? '-'}|${c.canal}`;
}

export type CaseSummary = {
    key: string; target: string; runner: string; suite: string | null; caso: string | null; comercio: string;
    lender: number | string | null; canal: string;
    corridas: number; fallas: number;
    estado: 'rojo' | 'verde' | 'intermitente' | 'sin-veredicto';
    ultima: CaseRecord; ultimaFalla: CaseRecord | null; ultimoVerde: CaseRecord | null;
    rojoDesde: string | null;     // desde cuándo falla SEGUIDO (la primera falla después del último verde)
    historia: Array<{ at: string; ok: boolean; ur: number | null; run: string }>;
};

/**
 * Agrupa por caso y AMBIENTE (el mismo caso en local y en qa son dos filas: es justo la pregunta).
 * «intermitente» = en las últimas `window` corridas hubo verde y rojo: no es lo mismo que roto, y repetir antes de
 * concluir es la regla del harness.
 */
export function summarize(cases: CaseRecord[], window = 10): CaseSummary[] {
    const groups = new Map<string, CaseRecord[]>();
    for (const c of cases) {
        const k = `${c.target}|${caseKey(c)}`;
        (groups.get(k) ?? groups.set(k, []).get(k)!).push(c);
    }
    const out: CaseSummary[] = [];
    for (const [k, list] of groups) {
        list.sort((a, b) => a.at.localeCompare(b.at));
        const last = list[list.length - 1];
        const recent = list.slice(-window);
        const fails = list.filter((c) => !c.ok);
        const lastGreen = [...list].reverse().find((c) => c.ok) ?? null;
        const lastFail = fails.length ? fails[fails.length - 1] : null;
        const firstRedAfterGreen = list.find((c) => !c.ok && (!lastGreen || c.at > lastGreen.at)) ?? null;
        const estado: CaseSummary['estado'] = last.sinVeredicto ? 'sin-veredicto'
            : recent.some((c) => c.ok) && recent.some((c) => !c.ok) ? 'intermitente'
            : last.ok ? 'verde' : 'rojo';
        out.push({
            key: k, target: last.target, runner: last.runner, suite: last.suite, caso: last.caso, comercio: last.comercio,
            lender: last.lender, canal: last.canal, corridas: list.length, fallas: fails.length, estado,
            ultima: last, ultimaFalla: lastFail, ultimoVerde: lastGreen,
            rojoDesde: last.ok ? null : firstRedAfterGreen?.at ?? null,
            historia: list.slice(-30).map((c) => ({ at: c.at, ok: c.ok, ur: c.ur, run: c.run })),
        });
    }
    const rank = { rojo: 0, intermitente: 1, 'sin-veredicto': 2, verde: 3 } as const;
    return out.sort((a, b) => rank[a.estado] - rank[b.estado] || b.ultima.at.localeCompare(a.ultima.at));
}
