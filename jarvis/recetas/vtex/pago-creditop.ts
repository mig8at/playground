// RECETA DE SÓLO LECTURA · ¿cómo está configurado Creditop como medio de pago en esta cuenta de VTEX?
//
//   make jarvis-receta APP=vtex RECETA=pago-creditop [JSON=1]
//
// En el admin son tres pantallas de Store Settings que nadie cruza: Providers (las AFILIACIONES: cada una, un comercio
// de CreditOp con su versión del conector y su workspace), Settings de pagos (las REGLAS o condiciones de pago: cuál
// afiliación cobra de verdad) y My Apps (qué versión de la app de Creditop hay en cada workspace). Acá, junto:
//   GET /api/payments/pvt/affiliations     las afiliaciones (sin el appToken: VTEX lo devuelve enmascarado)
//   GET /api/payments/pvt/rules            las reglas
//   infra.io.vtex.com …/apps               la versión de creditop.creditop por workspace (`connectorVersions` del harness)
//   y el `appKey` de cada afiliación —el hash de la sucursal de CreditOp, el mismo del link del wizard— buscado en
//   qa y en prod (`bin/pg sql`, sólo lectura) para decir qué comercio y sucursal es.
// Avisa lo que se ve raro: una regla activa a una afiliación «[NO USAR]», una afiliación a un workspace sin la app, un
// hash que no aparece en ningún ambiente o una sucursal inactiva.
//
// ⚠ La regla puede estar apuntando a otra afiliación POR UN RATO: `make harness-vtex CASES=rotativo` la cambia a
// «Mario Hernández (qa)» mientras dura y la devuelve (`withAffiliationFor`, harness/pkg/vtex.ts).
import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { must, hosts } from './api.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const { connectorVersions } = await import(path.join(ROOT, 'harness/pkg/vtex.ts'));
const JSON_OUT = process.argv.includes('--json');
const out = (s = '') => { if (!JSON_OUT) console.log(s ? `  ${s}` : ''); };
const base = `${hosts.store}/api/payments/pvt`;

const affiliations = await must<any[]>('leer las afiliaciones', 'GET', `${base}/affiliations`);
const rules = await must<any[]>('leer las reglas de pago', 'GET', `${base}/rules`);

const conf = (a: any, name: string) => (a.configuration ?? []).find((c: any) => c.name === name)?.value ?? '';
const creditop = affiliations
    .filter((a) => /creditop/i.test(`${a.implementation} ${conf(a, 'connectorName')}`))
    .map((a) => ({
        id: a.id, nombre: a.name, conector: conf(a, 'connectorName'), workspace: conf(a, 'workspace'),
        produccion: conf(a, 'isProduction') === 'true', hash: conf(a, 'appKey'),
        reglas: rules.filter((r) => r.connector?.affiliationId === a.id).map((r) => ({ nombre: r.name, activa: r.enabled, canales: (r.salesChannels ?? []).map((s: any) => s.id) })),
    }));

// ── el comercio de cada hash, en qa y en prod (sólo lectura) ──
const run = promisify(execFile);
async function branches(target: string, hashes: string[]): Promise<Record<string, any>> {
    if (!hashes.length) return {};
    const sql = `SELECT ab.hash, ab.id AS sucursal, ab.name AS sucursal_nombre, a.id AS comercio, a.name AS comercio_nombre, ab.status
                   FROM allied_branches ab JOIN allieds a ON a.id = ab.allied_id WHERE ab.hash IN (${hashes.map((h) => `'${h.replace(/[^\w-]/g, '')}'`).join(',')})`;
    try {
        const { stdout } = await run(path.join(ROOT, 'bin/pg'), ['sql', '--target', target, '-json', '--query', sql], { timeout: 90_000 });
        return Object.fromEntries((JSON.parse(stdout).rows ?? []).map((r: any) => [r.hash, r]));
    } catch (e) {
        return { __error: String((e as Error).message).split('\n')[0] };
    }
}
const hashes = [...new Set(creditop.map((a) => a.hash).filter(Boolean))];
const [qa, prod] = await Promise.all([branches('qa', hashes), branches('prod', hashes)]);

// ── la app de Creditop en cada workspace que nombran las afiliaciones ──
const workspaces = [...new Set(creditop.map((a) => a.workspace).filter(Boolean))];
const apps: { workspace: string; version: string; source: string }[] = await connectorVersions(workspaces).catch(() => []);
const appIn = (ws: string) => apps.find((x) => x.workspace === ws);

const warnings: string[] = [];
const rows = creditop.map((a) => {
    const where = [qa[a.hash] && { ambiente: 'qa', ...qa[a.hash] }, prod[a.hash] && { ambiente: 'prod', ...prod[a.hash] }].filter(Boolean) as any[];
    const app = appIn(a.workspace);
    const active = a.reglas.some((r) => r.activa);
    if (active && /no usar/i.test(a.nombre)) warnings.push(`la regla activa usa «${a.nombre}», marcada NO USAR`);
    if (active && (!app || app.version === '—')) warnings.push(`la afiliación activa «${a.nombre}» apunta al workspace ${a.workspace}, que no tiene la app de Creditop (${app?.source ?? 'no se pudo leer'})`);
    if (active && !where.length) warnings.push(`el hash ${a.hash} de la afiliación activa no aparece ni en qa ni en prod`);
    if (active && where.some((w) => Number(w.status) !== 1)) warnings.push(`la sucursal ${a.hash} de la afiliación activa está inactiva`);
    return { ...a, app: app ? `${app.version}${app.source && app.source !== 'no está' ? '' : ''}` : '?', comercio: where };
});
const activeRules = rules.filter((r) => r.enabled && creditop.some((a) => a.id === r.connector?.affiliationId));
if (!activeRules.length) warnings.push('ninguna regla de pago activa usa una afiliación de Creditop: la tienda no ofrece Creditop');
if (activeRules.length > 1) warnings.push(`hay ${activeRules.length} reglas activas con Creditop: cuál cobra depende de la condición de cada una`);
for (const k of ['__error']) { if (qa[k]) warnings.push(`no pude buscar en qa: ${qa[k]}`); if (prod[k]) warnings.push(`no pude buscar en prod: ${prod[k]}`); }

if (JSON_OUT) { console.log(JSON.stringify({ afiliaciones: rows, apps, avisos: warnings })); process.exit(0); }

const active = rows.filter((r) => r.reglas.some((x) => x.activa));
out('QUIÉN COBRA HOY');
for (const a of active) {
    const c = a.comercio[0];
    out(`  regla «${a.reglas.find((r) => r.activa)!.nombre}» → afiliación «${a.nombre}»`);
    out(`  ${a.conector} · workspace ${a.workspace} (app ${a.app}) · ${a.produccion ? 'isProduction' : 'no producción'}`);
    out(`  → ${c ? `${c.ambiente}: comercio ${c.comercio} «${c.comercio_nombre}», sucursal ${c.sucursal} «${c.sucursal_nombre}» (${a.hash})` : `hash ${a.hash}: no aparece en qa ni en prod`}`);
}
if (!active.length) out('  nadie: ninguna regla activa usa Creditop');
out();
out('TODAS LAS AFILIACIONES DE CREDITOP');
for (const a of rows) {
    const c = a.comercio.map((x: any) => `${x.ambiente} ${x.comercio}/${x.sucursal}${Number(x.status) === 1 ? '' : ' (inactiva)'} «${x.comercio_nombre}»`).join(' · ') || 'no aparece en qa ni en prod';
    const r = a.reglas.length ? ` · regla ${a.reglas.map((x) => `«${x.nombre}»${x.activa ? ' ACTIVA' : ' apagada'}`).join(', ')}` : '';
    out(`  ${a.reglas.some((x) => x.activa) ? '●' : '○'} ${a.nombre.padEnd(34)} ${a.conector.padEnd(22)} ${a.workspace.padEnd(10)} ${a.hash.padEnd(10)} ${c}${r}`);
}
out();
out(`APP DE CREDITOP POR WORKSPACE: ${apps.map((x) => `${x.workspace} ${x.version}`).join(' · ') || 'no se pudo leer'}`);
out();
if (warnings.length) { out('AVISOS'); for (const w of warnings) out(`  ⚠ ${w}`); } else out('sin avisos');
out();
out(`admin: ${hosts.admin}/affiliations · ${hosts.admin}/pci-gateway#/rules`);
