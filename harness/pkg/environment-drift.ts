// ¿El AMBIENTE remoto está al día con su propia rama? Dos desfases que no son del flujo y se depuran como si lo fueran.
//
// 1. MIGRACIONES. dev, qa y staging comparten UNA base, y mergear no corre migraciones (F-77). Si el código desplegado
//    usa una tabla o columna nueva y su migración no corrió, el flujo muere tarde y con un mensaje que no dice eso.
//    Medido el 2026-10-08: la firma del pagaré en qa fallaba con «No pudimos validar el código» porque faltaba
//    `2026_10_07_200000_rename_creditopx_quota_events_to_creditop_x_quota_events` (la autorización se deshacía).
// 2. RUTAS DEL MOCK DE CENTRALES. El backend le pide al lambda rutas que el lambda puede no tener; con un 404 cae a su
//    reporte de respaldo SIN avisar. Medido el mismo día: `/experian/cs/credit-history/v1/hdcplus/acierta-quanto`
//    respondía 404 y Experian salía con score 707 e ingreso 2.320.000, dijera lo que dijera el dictado.
//
// Las dos cosas se leen de la RAMA desplegada (`git` sobre el repo local de legacy-backend, con un fetch) y se comparan
// contra lo vivo (la tabla `migrations` y el lambda). Sólo lectura.
import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { COMPANY_LAMBDA } from './risk-lambda.ts';

const run = promisify(execFile);
const BACKEND_REPO = join(homedir(), 'Desktop/CREDITOP/github/legacy-backend');

/** La rama que despliega cada ambiente remoto (los workflows de deploy de legacy-backend). */
export const DEPLOYED_BRANCH: Record<string, string> = { dev: 'develop', qa: 'qa', staging: 'staging' };

const git = async (args: string[], timeout = 20_000) =>
    (await run('git', ['-C', BACKEND_REPO, ...args], { timeout, maxBuffer: 32 * 1024 * 1024 })).stdout;

/** Trae la rama desplegada. Sin red (o sin VPN de GitHub) se usa la ref que haya, y se dice. */
export async function fetchDeployedBranch(branch: string): Promise<{ fetched: boolean; sha: string | null }> {
    const fetched = await git(['fetch', '-q', 'origin', branch]).then(() => true).catch(() => false);
    const sha = await git(['rev-parse', '--short', `origin/${branch}`]).then((s) => s.trim()).catch(() => null);
    return { fetched, sha };
}

/** Los nombres de migración (sin `.php`) que trae la rama: los de `database/migrations` y los de los módulos. */
export async function branchMigrations(branch: string): Promise<string[]> {
    const files = await git(['ls-tree', '-r', '--name-only', `origin/${branch}`, '--', 'database/migrations', 'Modules']);
    return files.split('\n')
        .filter((f) => /^database\/migrations\/[^/]+\.php$/.test(f) || /^Modules\/[^/]+\/[Dd]atabase\/[Mm]igrations\/[^/]+\.php$/.test(f))
        .map((f) => f.split('/').pop()!.replace(/\.php$/, ''));
}

export interface MockRoute { method: 'GET' | 'POST'; path: string; source: string }

/**
 * Las rutas que el backend de esa rama le pide al lambda de centrales: los literales que empiezan con
 * `/experian/`, `/agildata/`, `/mareigua/` o `/tusdatos/` en `app/Actions/RiskCentrals/*.php` — así se escriben las
 * llamadas al `mock_host` (las llamadas al proveedor real van sin ese prefijo). El método sale de la línea: `->get(` es
 * GET, el resto POST (los `match` de Experian arman la ruta y la usan con `->post`).
 */
export async function branchMockRoutes(branch: string): Promise<MockRoute[]> {
    const files = (await git(['ls-tree', '--name-only', `origin/${branch}`, '--', 'app/Actions/RiskCentrals/']))
        .split('\n').filter((f) => f.endsWith('.php'));
    const seen = new Map<string, MockRoute>();
    for (const file of files) {
        const src = await git(['show', `origin/${branch}:${file}`]);
        for (const line of src.split('\n')) {
            for (const m of line.matchAll(/'(\/(?:experian|agildata|mareigua|tusdatos)\/[^'\s]*)'/g)) {
                const method = /->get\(/.test(line) ? 'GET' : 'POST';
                const key = `${method} ${m[1]}`;
                if (!seen.has(key)) seen.set(key, { method, path: m[1], source: file.split('/').pop()! });
            }
        }
    }
    return [...seen.values()];
}

/** ¿El lambda tiene la ruta? Mockoon contesta 404 cuando ninguna ruta coincide; cualquier otra respuesta es que existe. */
export async function probeMockRoute(base: string, route: MockRoute): Promise<{ status: number | null }> {
    const path = route.path.replace(/\{type\}/g, 'CC').replace(/\{number\}/g, '1000000000').replace(/\{[^}]+\}/g, 'x');
    const r = await fetch(base.replace(/\/+$/, '') + path, {
        method: route.method,
        headers: { 'Content-Type': 'application/json' },
        body: route.method === 'POST' ? '{}' : undefined,
        signal: AbortSignal.timeout(10_000),
    }).catch(() => null);
    await r?.body?.cancel().catch(() => { });
    return { status: r ? r.status : null };
}

export interface EnvironmentDrift {
    target: string;
    branch: string;
    sha: string | null;
    fetched: boolean;
    migrations: { inBranch: number; missing: string[] } | { error: string };
    mock: { base: string; checked: number; missing: MockRoute[]; unreachable: number } | { skipped: string };
}

/**
 * El desfase de un ambiente remoto. `appliedMigrations` lo pasa quien tiene la base abierta (bin/dbops), para que este
 * módulo no dependa del target con el que se importó `pkg/db.ts`.
 */
export async function environmentDrift(target: string, appliedMigrations: () => Promise<string[]>): Promise<EnvironmentDrift> {
    const branch = DEPLOYED_BRANCH[target];
    if (!branch) throw new Error(`sin rama desplegada conocida para «${target}» (dev, qa o staging)`);
    const { fetched, sha } = await fetchDeployedBranch(branch);

    let migrations: EnvironmentDrift['migrations'];
    try {
        const [inBranch, applied] = await Promise.all([branchMigrations(branch), appliedMigrations()]);
        const done = new Set(applied);
        migrations = { inBranch: inBranch.length, missing: inBranch.filter((m) => !done.has(m)).sort() };
    } catch (e) {
        migrations = { error: (e as Error).message.split('\n')[0] };
    }

    let mock: EnvironmentDrift['mock'];
    const base = COMPANY_LAMBDA[target];
    if (!base) {
        mock = { skipped: `no se conoce el lambda de centrales de ${target} (sólo qa apunta a uno con dictado, F-149)` };
    } else {
        const routes = await branchMockRoutes(branch).catch(() => [] as MockRoute[]);
        const probes = await Promise.all(routes.map(async (route) => ({ route, ...(await probeMockRoute(base, route)) })));
        mock = {
            base, checked: routes.length,
            missing: probes.filter((p) => p.status === 404).map((p) => p.route),
            unreachable: probes.filter((p) => p.status === null).length,
        };
    }
    return { target, branch, sha, fetched, migrations, mock };
}
