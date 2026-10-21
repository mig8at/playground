// prod-catalog.ts — lo que el panel muestra de PRODUCCIÓN, y sólo para mirar: el catálogo de comercios con su asesor de
// prueba y la ficha de un comercio (su sucursal falsa y las entidades que tiene).
//
// Todo pasa por el conector (`bin/pg sql --target prod`, que en prod va por Redash con un usuario de sólo lectura): el
// panel no tiene otro camino a la base de producción, y éste no puede escribir. Es asíncrono a propósito —`runPg` es
// sincrónico y cada consulta a Redash tarda ~2 s, que congelarían el servidor del panel—.
//
// ⚠ Medido el 2026-10-20: la consulta del catálogo de local (una subconsulta por comercio sobre `users`) NO termina en
// 60 s en prod. Partida en dos (los comercios por un lado, los asesores de prueba por otro) son ~2 s cada una.
// ⚠ Los ids y los hashes se validan antes de entrar al SQL: el conector no acepta parámetros, recibe el texto.
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PLAYGROUND = fileURLToPath(new URL('../../', import.meta.url));
const PG = `${PLAYGROUND}bin/pg`;
type Row = Record<string, any>;

/** Una consulta de sólo lectura a prod; tira con la última línea del conector si falla. */
function prodSql(query: string): Promise<Row[]> {
    return new Promise((ok, fail) => execFile(PG, ['sql', '--target', 'prod', '--json', '--query', query],
        { cwd: PLAYGROUND, encoding: 'utf8', timeout: 90_000 }, (err, stdout, stderr) => {
            if (err) return fail(new Error(String(stderr || stdout || err.message).trim().split('\n').filter(Boolean).pop()?.replace(/^pg:\s*/, '') || 'el conector falló'));
            try { ok(JSON.parse(stdout).rows ?? []); } catch { fail(new Error('el conector no devolvió JSON')); }
        }));
}

/** El asesor de prueba: el patrón de `findTestAdvisor` (`pkg/login-probe.ts`). */
const TEST_ADVISOR = "u.email LIKE 'c%-fake@creditop.com'";

export interface ProdCatalogRow { allied_id: number; name: string; slug: string; branches: number; test_branch: string | null; has_sub: boolean }

/** Todos los comercios de prod con alguna sucursal activa, y cuál tiene asesor de prueba (con su sucursal). */
export async function prodCatalog(): Promise<ProdCatalogRow[]> {
    const [merchants, advisors] = await Promise.all([
        prodSql(`SELECT a.id AS allied_id, a.name, COALESCE(a.slug,'') AS slug, COUNT(*) AS branches
                   FROM allieds a JOIN allied_branches ab ON ab.allied_id = a.id AND ab.status = 1
                  GROUP BY a.id, a.name, a.slug ORDER BY a.name`),
        prodSql(`SELECT u.allied_id, u.id, b.hash AS test_branch, (u.cognito_id IS NOT NULL) AS has_sub
                   FROM users u JOIN allied_branches b ON b.id = u.allied_branch_id
                  WHERE ${TEST_ADVISOR} AND u.allied_id IS NOT NULL ORDER BY u.id DESC`),
    ]);
    const byAllied = new Map<number, Row>();
    for (const a of advisors) if (!byAllied.has(Number(a.allied_id))) byAllied.set(Number(a.allied_id), a);   // el más reciente
    return merchants.map((m) => {
        const a = byAllied.get(Number(m.allied_id));
        return { allied_id: Number(m.allied_id), name: String(m.name), slug: String(m.slug || ''), branches: Number(m.branches),
            test_branch: a ? String(a.test_branch) : null, has_sub: !!a && Number(a.has_sub) === 1 };
    });
}

export interface ProdMerchant {
    merchant: Row | null;
    branches: { total: number; active: number };
    advisor: { email: string; hasSub: boolean; branchHash: string | null; branchName: string | null; branchStatus: number | null } | null;
    lenders: Row[];
    notes: string[];
}

/** La ficha de un comercio de prod: su asesor de prueba, la sucursal falsa y las entidades de esa sucursal. */
export async function prodMerchant(alliedId: number): Promise<ProdMerchant> {
    if (!Number.isInteger(alliedId) || alliedId <= 0) throw new Error('el id del comercio tiene que ser un entero');
    const [m, br, adv] = await Promise.all([
        prodSql(`SELECT a.id, a.name, COALESCE(a.slug,'') AS slug FROM allieds a WHERE a.id = ${alliedId}`),
        prodSql(`SELECT COUNT(*) AS total, SUM(ab.status = 1) AS active FROM allied_branches ab WHERE ab.allied_id = ${alliedId}`),
        prodSql(`SELECT u.email, (u.cognito_id IS NOT NULL) AS has_sub, b.hash, COALESCE(b.name,'') AS branch_name, b.status AS branch_status
                   FROM users u LEFT JOIN allied_branches b ON b.id = u.allied_branch_id
                  WHERE u.allied_id = ${alliedId} AND ${TEST_ADVISOR} ORDER BY u.id DESC LIMIT 1`),
    ]);
    const a = adv[0];
    const advisor = a ? { email: String(a.email), hasSub: Number(a.has_sub) === 1, branchHash: a.hash ? String(a.hash) : null,
        branchName: a.branch_name ? String(a.branch_name) : null, branchStatus: a.branch_status === null || a.branch_status === undefined ? null : Number(a.branch_status) } : null;
    const hash = advisor?.branchHash && /^[0-9a-f]{8}$/i.test(advisor.branchHash) ? advisor.branchHash : null;
    const lenders = hash ? await prodSql(`SELECT l.id, l.name, l.response_type, l.status
                                            FROM lenders_by_allied_branches x
                                            JOIN lenders l ON l.id = x.lender_id
                                            JOIN allied_branches b ON b.id = x.allied_branch_id
                                           WHERE b.hash = '${hash}' ORDER BY l.status DESC, l.name`) : [];
    const notes: string[] = [];
    if (!advisor) notes.push('el comercio no tiene asesor de prueba en prod (c<hash>-fake@): se crea desde la edición del comercio en el admin de prod');
    else {
        if (!advisor.hasSub) notes.push('el asesor de prueba no tiene cognito_id: su cuenta en el pool de comercios no está enlazada');
        if (!advisor.branchHash) notes.push('el asesor de prueba no tiene sucursal');
        else if (advisor.branchStatus !== 1) notes.push('la sucursal del asesor de prueba está apagada');
        else if (!lenders.some((l) => Number(l.status) === 1)) notes.push('la sucursal del asesor de prueba no tiene entidades encendidas: su listado saldría vacío');
    }
    return { merchant: m[0] ?? null, branches: { total: Number(br[0]?.total ?? 0), active: Number(br[0]?.active ?? 0) }, advisor, lenders, notes };
}
