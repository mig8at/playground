#!/usr/bin/env node
// merchants — los comercios del harness (`harness.json`) por consola. Es el ÚNICO camino para agregarlos o asociarlos: el
// panel sólo lee el registro y muestra cada comercio en todos los ambientes, apagado donde no tiene sucursal.
//
//   node bin/merchants.ts list                                   los de la barra, con su sucursal y su asesor en cada base
//   node bin/merchants.ts check [ambiente]                       ¿lo guardado sigue siendo cierto en cada base? (sin ambiente, las tres)
//   node bin/merchants.ts refresh [clave] [--all]                vuelve a leer de cada base lo guardado (sin cambiar la sucursal)
//   node bin/merchants.ts add <comercio> [--name N] [--key K] [--note T]
//                                                                lo busca en las tres bases (slug, id o nombre exacto), toma la
//                                                                sucursal del asesor de prueba en cada una y lo pone en la barra
//   node bin/merchants.ts associate <clave> <ambiente> <hash|comercio>
//                                                                fija la sucursal de esa base (cuando el comercio se llama distinto)
//   node bin/merchants.ts remove <clave> [--purge]               lo saca de la barra (`--purge`: también del registro)
//
// <comercio> es el slug de `allieds` (`sonria`), su id o su nombre exacto; si no hay uno exacto, sugiere. <ambiente> es
// local, dev, qa, staging o prod: dev, qa y staging comparten base, así que asociar en uno vale para los tres.
// De cada base se guarda lo que IDENTIFICA al comercio ahí (sucursal, su id, el id y el slug del comercio, el correo del
// asesor de prueba); lo que cambia (entidades, cuenta de Cognito) lo mide el panel al abrir. Ver `pkg/flows.ts`.
// Todo lo que lee de las bases es LECTURA; lo único que escribe es `harness.json`.
import { readFlows, writeFlows, baseOf, type Base, type BaseEntry, type MerchantEntry } from '../pkg/flows.ts';
import { findIn, suggest, factsIn, baseEntryFrom, countryOf, BASE_TARGET, type Found, type BranchFacts } from '../pkg/merchant-registry.ts';

const BASES: Base[] = ['local', 'shared', 'prod'];
const BASE_LABEL: Record<Base, string> = { local: 'local', shared: 'dev/qa/staging', prod: 'prod' };
const TARGETS = new Set(['local', 'dev', 'qa', 'staging', 'prod']);

// Los flags se sacan ANTES de leer los argumentos: `refresh --all` tomaba `--all` como la clave.
const argv = process.argv.slice(2);
const flag = (name: string) => { const i = argv.indexOf('--' + name); if (i < 0) return undefined; const v = argv[i + 1]; argv.splice(i, 2); return v; };
const has = (name: string) => { const i = argv.indexOf('--' + name); if (i < 0) return false; argv.splice(i, 1); return true; };
const OPTS = { name: flag('name'), key: flag('key'), note: flag('note'), all: has('all'), purge: has('purge') };
function die(msg: string): never { console.error('✗ ' + msg); process.exit(1); }
const slugify = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
const pad = (s: string, n: number) => s.padEnd(n);

/** Sin asesor de prueba en esa base: el canal asesor no entra hasta crearlo (y cómo). */
const advisorHint = (b: Base, alliedId?: number) => `sin asesor de prueba en ${BASE_LABEL[b]}: el canal asesor no entra hasta crearlo`
    + (b === 'prod' ? ' (en prod se crea desde el admin de prod)' : ` (bin/pg admin test-advisor --target ${BASE_TARGET[b]} --allied ${alliedId ?? '<id>'})`);

/** Qué cambió entre lo guardado y lo que dice la base: `changed` lo que era otra cosa, `missing` lo que no se había
 *  guardado todavía. */
function diffFacts(saved: BaseEntry, now: BranchFacts): { changed: string[]; missing: string[] } {
    const changed: string[] = [], missing: string[] = [];
    for (const k of ['branch_id', 'allied_id', 'allied_slug', 'advisor'] as const) {
        const a = String(saved[k] ?? ''), b = String((now as any)[k] ?? '');
        if (a === b) continue;
        if (!a) missing.push(k); else changed.push(`${k}: ${a} → ${b || '—'}`);
    }
    return { changed, missing };
}

const panelRows = () => Object.entries(readFlows().merchants).filter(([, e]) => e.panel);

async function list() {
    const rows = panelRows();
    if (!rows.length) return console.log('La barra está vacía: `make harness-merchants A="add <comercio>"`.');
    for (const [k, e] of rows) {
        console.log(`${pad(k, 24)} ${pad(e.name || k, 26)} ${e.country || 'sin país'}`);
        for (const b of BASES) {
            const x = e.bases[b];
            console.log(`    ${pad(BASE_LABEL[b], 15)} ${x ? `${x.branch}${x.allied_id ? ` · #${x.allied_id}` : ''}${x.allied_slug ? ` ${x.allied_slug}` : ''} · ${x.advisor || 'sin asesor de prueba'}` : '—'}`);
        }
    }
    const rest = Object.keys(readFlows().merchants).length - rows.length;
    if (rest) console.log(`\n(+${rest} en el registro fuera de la barra: se corren por consola con su clave)`);
}

async function check(only?: string) {
    if (only && !TARGETS.has(only)) die(`no conozco el ambiente «${only}»: local · dev · qa · staging · prod`);
    const rows = panelRows();
    let stale = 0;
    for (const b of only ? [baseOf(only)] : BASES) {
        const got = await factsIn(b, rows.map(([, e]) => e.bases[b]?.branch ?? ''));
        console.log(`\n■ ${BASE_LABEL[b]}`);
        if (!got) { console.log('  no contestó (¿VPN? ¿Docker?): no se sabe'); continue; }
        for (const [k, e] of rows) {
            const saved = e.bases[b];
            let line: string;
            if (!saved) line = `— sin sucursal: \`make harness-merchants A="associate ${k} ${BASE_TARGET[b]} <hash|comercio>"\``;
            else if (!got[saved.branch]) { line = `✗ ${saved.branch} no existe en esta base`; stale++; }
            else {
                const f = got[saved.branch], d = diffFacts(saved, f);
                line = `${d.changed.length ? '≠' : '✓'} ${saved.branch} · ${f.allied_name}${f.status !== 1 ? ' · ⚠ sucursal apagada' : ''}${f.advisor ? '' : ' · ⚠ sin asesor de prueba'}`
                    + (d.changed.length ? `\n${' '.repeat(29)}cambió: ${d.changed.join(' · ')}` : '')
                    + (d.missing.length ? `\n${' '.repeat(29)}sin guardar: ${d.missing.join(', ')}` : '');
                if (d.changed.length || d.missing.length) stale++;
            }
            console.log(`  ${pad(k, 24)} ${line}`);
        }
    }
    if (stale) console.log(`\n${stale} con datos que cambiaron o sin guardar: \`make harness-merchants A=refresh\` los vuelve a leer (la sucursal no se toca).`);
}

async function refresh(only?: string) {
    const all = OPTS.all;
    const flows = readFlows();
    const keys = only ? [only] : Object.entries(flows.merchants).filter(([, e]) => all || e.panel).map(([k]) => k);
    if (only && !flows.merchants[only]) die(`no conozco «${only}» en el registro (\`list\`)`);
    let changed = 0;
    for (const b of BASES) {
        const got = await factsIn(b, keys.map((k) => flows.merchants[k].bases[b]?.branch ?? ''));
        if (!got) { console.log(`  ${BASE_LABEL[b]}: no contestó, queda como estaba`); continue; }
        for (const k of keys) {
            const saved = flows.merchants[k].bases[b];
            if (!saved) continue;
            const f = got[saved.branch];
            if (!f) { console.log(`  ✗ ${k} · ${BASE_LABEL[b]}: ${saved.branch} no existe; se deja (asociala de nuevo)`); continue; }
            const d = diffFacts(saved, f);
            if (d.changed.length || d.missing.length) {
                flows.merchants[k].bases[b] = baseEntryFrom(f); changed++;
                console.log(`  ↻ ${pad(k, 24)} ${pad(BASE_LABEL[b], 15)} ${[...d.changed, ...(d.missing.length ? [`guardado: ${d.missing.join(', ')}`] : [])].join(' · ')}`);
            }
        }
    }
    writeFlows(flows);
    console.log(changed ? `✓ ${changed} base(s) actualizadas` : '✓ todo como estaba');
}

async function add(q: string) {
    if (!q) die('falta el comercio: `add <slug|id|nombre>`');
    const { name, key, note } = OPTS;
    // ⚠ UN ID NO ES EL MISMO COMERCIO EN PROD (Alta Fleet es el 527 en local y el 346 en prod): por id se busca sólo en
    // local o en la compartida (local es un volcado de dev), y en las demás con el slug que salió de ahí.
    if (/^\d+$/.test(q.trim())) {
        const f = (await findIn('local', q)) || (await findIn('shared', q));
        if (f?.slug) { console.log(`  #${q} es «${f.slug}» (${f.name}): se busca por ese slug`); q = f.slug; }
        else if (f) die(`#${q} (${f.name}) no tiene slug: pasalo por su nombre exacto`);
    }
    const found: Partial<Record<Base, Found>> = {};
    for (const b of BASES) {
        const f = await findIn(b, q);
        if (f === undefined) console.log(`  ${pad(BASE_LABEL[b], 15)} no contestó (¿VPN? ¿Docker?): queda sin sucursal ahí`);
        else if (!f) console.log(`  ${pad(BASE_LABEL[b], 15)} no está`);
        else { found[b] = f; console.log(`  ${pad(BASE_LABEL[b], 15)} #${f.allied_id} ${f.name} → ${f.branch || '(sin sucursal activa)'}${f.test ? ' (la del asesor de prueba)' : ''}`); }
    }
    const any = found.local ?? found.shared ?? found.prod;
    if (!any) {
        const near = [...new Map([...(await suggest('local', q)), ...(await suggest('shared', q))].map((r) => [r.slug || r.name, r])).values()];
        die(`«${q}» no está en ninguna base (por slug, id o nombre exacto).`
            + (near.length ? `\n  Parecidos: ${near.map((r) => `${r.slug || r.name} (#${r.allied_id} ${r.name})`).join(' · ')}` : ''));
    }
    const flows = readFlows();
    // ¿Ya está en el registro? Por el slug del comercio en alguna base o por alguna de sus sucursales: se completa, no se duplica.
    const same = Object.entries(flows.merchants).find(([k, e]) => (key && k === key)
        || (!key && BASES.some((b) => (found[b]?.branch && e.bases[b]?.branch === found[b]!.branch) || (found[b]?.slug && e.bases[b]?.allied_slug === found[b]!.slug))));
    const k = same?.[0] ?? key ?? slugify(name || any.name);
    if (!same && flows.merchants[k]) die(`la clave «${k}» ya es de otro comercio: pasá otra con --key`);
    const cur: MerchantEntry = same?.[1] ?? { bases: {} };
    // Lo que ya tenía sucursal la conserva (pudo asociarse a mano) y se le refrescan los datos; las vacías se completan.
    const bases = { ...cur.bases };
    const wrote = new Set<Base>();
    for (const b of BASES) {
        const branch = bases[b]?.branch || found[b]?.branch;
        if (!branch) continue;
        const f = (await factsIn(b, [branch]))?.[branch];
        if (!bases[b]) wrote.add(b);
        bases[b] = f ? baseEntryFrom(f) : (bases[b] ?? { branch });
    }
    const country = cur.country || (bases.local ? await countryOf('local', bases.local.branch) : '') || (bases.shared ? await countryOf('shared', bases.shared.branch) : '');
    flows.merchants[k] = {
        ...cur, name: name || cur.name || any.name, panel: true,
        ...(country ? { country } : {}), ...(note ? { note } : {}),
        allied_name: cur.allied_name || any.name,
        bases,
    };
    writeFlows(flows);
    console.log(`\n✓ ${same ? 'actualizado' : 'agregado'} «${k}» (${flows.merchants[k].name}${country ? ' · ' + country : ''})`);
    for (const b of BASES) {
        const x = bases[b], f = found[b];
        if (!x) console.log(`  ${BASE_LABEL[b]}: sin sucursal; en el panel sale apagado. Si ahí se llama distinto: associate ${k} ${BASE_TARGET[b]} <hash|comercio>`);
        else if (!wrote.has(b) && f && f.branch !== x.branch) console.log(`  ${BASE_LABEL[b]}: se queda con ${x.branch}, la que ya tenía (encontré ${f.branch}; para cambiarla: associate ${k} ${BASE_TARGET[b]} ${f.branch})`);
        if (x && !x.advisor) console.log(`  ⚠ ${advisorHint(b, x.allied_id)}`);
    }
}

async function associate(k: string, target: string, what: string) {
    if (!k || !target || !what) die('uso: associate <clave> <ambiente> <hash|comercio>');
    if (!TARGETS.has(target)) die(`no conozco el ambiente «${target}»: local · dev · qa · staging · prod`);
    const flows = readFlows();
    const cur = flows.merchants[k] ?? die(`no conozco «${k}» en el registro (\`list\`)`);
    const b = baseOf(target);
    let hash = what.toLowerCase();
    if (!/^[0-9a-f]{8}$/.test(hash)) {
        const f = await findIn(b, what);
        if (f === undefined) die(`${BASE_LABEL[b]} no contestó (¿VPN? ¿Docker?)`);
        if (!f) {
            const near = await suggest(b, what);
            die(`«${what}» no está en ${BASE_LABEL[b]}` + (near.length ? `\n  Parecidos: ${near.map((r) => `${r.slug || r.name} (#${r.allied_id} ${r.name})`).join(' · ')}` : ''));
        }
        if (!f.branch) die(`#${f.allied_id} ${f.name} no tiene sucursales activas en ${BASE_LABEL[b]}`);
        hash = f.branch;
    }
    const got = await factsIn(b, [hash]);
    if (got && !got[hash]) die(`la sucursal ${hash} no existe en ${BASE_LABEL[b]}`);
    const f = got?.[hash];
    if (!f) console.log(`  ⚠ ${BASE_LABEL[b]} no contestó: la anoto sin comprobar y sin sus datos (\`refresh\` los trae)`);
    else console.log(`  ${hash} · #${f.allied_id} ${f.allied_name}${f.status !== 1 ? ' · ⚠ sucursal apagada' : ''} · ${f.advisor || 'sin asesor de prueba'}`);
    flows.merchants[k] = { ...cur, bases: { ...cur.bases, [b]: f ? baseEntryFrom(f) : { branch: hash } } };
    writeFlows(flows);
    console.log(`✓ «${k}» en ${BASE_LABEL[b]} → ${hash}`);
    if (f && !f.advisor) console.log(`  ⚠ ${advisorHint(b, f.allied_id)}`);
}

function remove(k: string) {
    const purge = OPTS.purge;
    const flows = readFlows();
    const cur = flows.merchants[k] ?? die(`no conozco «${k}» en el registro (\`list\`)`);
    if (purge) delete flows.merchants[k]; else flows.merchants[k] = { ...cur, panel: undefined };
    writeFlows(flows);
    console.log(purge ? `✓ «${k}» borrado del registro` : `✓ «${k}» fuera de la barra (sigue en el registro: se corre por consola con su clave)`);
}

const [cmd = 'list', a, b, c] = argv;
if (cmd === 'list') await list();
else if (cmd === 'check') await check(a);
else if (cmd === 'refresh') await refresh(a);
else if (cmd === 'add') await add(a ?? '');
else if (cmd === 'associate') await associate(a ?? '', b ?? '', c ?? '');
else if (cmd === 'remove') remove(a ?? '');
else die(`no conozco «${cmd}»: list · check · refresh · add · associate · remove`);
