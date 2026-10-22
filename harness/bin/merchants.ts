#!/usr/bin/env node
// merchants — los comercios del harness (`harness.json`) por consola. Es el ÚNICO camino para agregarlos o asociarlos: el
// panel sólo lee el registro y muestra cada comercio en todos los ambientes, apagado donde no tiene sucursal.
//
//   node bin/merchants.ts list                                   los de la barra, con su sucursal en cada base
//   node bin/merchants.ts check [ambiente]                       ¿existe cada sucursal en su base? (local, dev, prod; sin ambiente, las tres)
//   node bin/merchants.ts add <comercio> [--name N] [--key K] [--note T]
//                                                                lo busca en las tres bases (slug, id o nombre exacto), toma la
//                                                                sucursal del asesor de prueba en cada una y lo pone en la barra
//   node bin/merchants.ts associate <clave> <ambiente> <hash|comercio>
//                                                                fija la sucursal de esa base (cuando el comercio se llama distinto)
//   node bin/merchants.ts remove <clave> [--purge]               lo saca de la barra (`--purge`: también del registro)
//
// <comercio> es el slug de `allieds` (`sonria`), su id o su nombre exacto; si no hay uno exacto, sugiere. <ambiente> es
// local, dev, qa, staging o prod: dev, qa y staging comparten base, así que asociar en uno vale para los tres.
// Todo lo que lee de las bases es LECTURA; lo único que escribe es `harness.json`.
import { readFlows, writeFlows, baseOf, type Base, type MerchantEntry } from '../pkg/flows.ts';
import { findIn, suggest, branchesIn, countryOf, BASE_TARGET, type Found } from '../pkg/merchant-registry.ts';

const BASES: Base[] = ['local', 'shared', 'prod'];
const BASE_LABEL: Record<Base, string> = { local: 'local', shared: 'dev/qa/staging', prod: 'prod' };
const TARGETS = new Set(['local', 'dev', 'qa', 'staging', 'prod']);

const argv = process.argv.slice(2);
const flag = (name: string) => { const i = argv.indexOf('--' + name); if (i < 0) return undefined; const v = argv[i + 1]; argv.splice(i, 2); return v; };
const has = (name: string) => { const i = argv.indexOf('--' + name); if (i < 0) return false; argv.splice(i, 1); return true; };
function die(msg: string): never { console.error('✗ ' + msg); process.exit(1); }
const slugify = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);

const advisorHint = (f: Found) => `sin asesor de prueba en ${BASE_LABEL[f.base]}: se corre contra ${f.branch || 'ninguna sucursal'}, y el canal asesor no entra hasta crearlo`
    + (f.base === 'prod' ? ' (en prod se crea desde el admin de prod)' : ` (bin/pg admin test-advisor --target ${BASE_TARGET[f.base]} --allied ${f.allied_id})`);

async function list() {
    const { merchants } = readFlows();
    const rows = Object.entries(merchants).filter(([, e]) => e.panel);
    if (!rows.length) return console.log('La barra está vacía: `make harness-merchants A="add <comercio>"`.');
    for (const [k, e] of rows) {
        console.log(`${k.padEnd(24)} ${(e.name || k).padEnd(26)} ${(e.country || 'sin país').padEnd(19)} `
            + BASES.map((b) => `${b}=${e.bases[b]?.branch || '—'}`).join('  '));
    }
    const rest = Object.keys(merchants).length - rows.length;
    if (rest) console.log(`\n(+${rest} en el registro fuera de la barra: se corren por consola con su clave)`);
}

async function check(only?: string) {
    if (only && !TARGETS.has(only)) die(`no conozco el ambiente «${only}»: local · dev · qa · staging · prod`);
    const { merchants } = readFlows();
    const rows = Object.entries(merchants).filter(([, e]) => e.panel);
    const bases = only ? [baseOf(only)] : BASES;
    for (const b of bases) {
        const want = rows.map(([, e]) => e.bases[b]?.branch).filter(Boolean) as string[];
        const got = await branchesIn(b, want);
        console.log(`\n■ ${BASE_LABEL[b]}`);
        if (!got) { console.log('  no contestó (¿VPN? ¿Docker?): no se sabe'); continue; }
        for (const [k, e] of rows) {
            const h = e.bases[b]?.branch;
            const line = !h ? `— sin sucursal: \`make harness-merchants A="associate ${k} ${BASE_TARGET[b]} <hash|comercio>"\``
                : got[h] ? `✓ ${h} · ${got[h].allied_name}` : `✗ ${h} no existe en esta base`;
            console.log(`  ${k.padEnd(24)} ${line}`);
        }
    }
}

async function add(q: string) {
    if (!q) die('falta el comercio: `add <slug|id|nombre>`');
    const name = flag('name'), key = flag('key'), note = flag('note');
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
        if (f === undefined) console.log(`  ${BASE_LABEL[b].padEnd(15)} no contestó (¿VPN? ¿Docker?): queda sin sucursal ahí`);
        else if (!f) console.log(`  ${BASE_LABEL[b].padEnd(15)} no está`);
        else { found[b] = f; console.log(`  ${BASE_LABEL[b].padEnd(15)} #${f.allied_id} ${f.name} → ${f.branch || '(sin sucursal activa)'}${f.test ? ' (la del asesor de prueba)' : ''}`); }
    }
    const any = found.local ?? found.shared ?? found.prod;
    if (!any) {
        const near = [...new Map([...(await suggest('local', q)), ...(await suggest('shared', q))].map((r) => [r.slug || r.name, r])).values()];
        die(`«${q}» no está en ninguna base (por slug, id o nombre exacto).`
            + (near.length ? `\n  Parecidos: ${near.map((r) => `${r.slug || r.name} (#${r.allied_id} ${r.name})`).join(' · ')}` : ''));
    }
    const flows = readFlows();
    // ¿Ya está en el registro? Por el slug del comercio o por alguna de sus sucursales: se completa, no se duplica.
    const same = Object.entries(flows.merchants).find(([k, e]) => (key && k === key)
        || (!key && ((any.slug && e.allied_slug === any.slug) || BASES.some((b) => found[b]?.branch && e.bases[b]?.branch === found[b]!.branch))));
    const k = same?.[0] ?? key ?? slugify(name || any.name);
    if (!same && flows.merchants[k]) die(`la clave «${k}» ya es de otro comercio: pasá otra con --key`);
    const cur: MerchantEntry = same?.[1] ?? { bases: {} };
    const bases = { ...cur.bases };
    // Lo que ya tenía sucursal la conserva (pudo asociarse a mano): sólo se completan las bases vacías.
    const wrote = new Set<Base>();
    for (const b of BASES) if (found[b]?.branch && !bases[b]) { bases[b] = { branch: found[b]!.branch }; wrote.add(b); }
    const country = cur.country || (found.local ? await countryOf('local', found.local.branch) : '') || (found.shared ? await countryOf('shared', found.shared.branch) : '');
    flows.merchants[k] = {
        ...cur, name: name || cur.name || any.name, panel: true,
        ...(country ? { country } : {}), ...(note ? { note } : {}),
        allied_slug: cur.allied_slug || any.slug || undefined,
        allied_id: cur.allied_id || (found.local ?? found.shared)?.allied_id || undefined,
        allied_name: cur.allied_name || any.name,
        bases,
    };
    writeFlows(flows);
    console.log(`\n✓ ${same ? 'actualizado' : 'agregado'} «${k}» (${flows.merchants[k].name}${country ? ' · ' + country : ''})`);
    for (const b of BASES) {
        const f = found[b];
        if (!bases[b]) console.log(`  ${BASE_LABEL[b]}: sin sucursal; en el panel sale apagado. Si ahí se llama distinto: associate ${k} ${BASE_TARGET[b]} <hash|comercio>`);
        else if (!wrote.has(b)) console.log(`  ${BASE_LABEL[b]}: se queda con ${bases[b]!.branch}, la que ya tenía${f && f.branch !== bases[b]!.branch ? ` (encontré ${f.branch}; para cambiarla: associate ${k} ${BASE_TARGET[b]} ${f.branch})` : ''}`);
        else if (f && !f.test) console.log(`  ⚠ ${advisorHint(f)}`);
    }
}

async function associate(k: string, target: string, what: string) {
    if (!k || !target || !what) die('uso: associate <clave> <ambiente> <hash|comercio>');
    if (!TARGETS.has(target)) die(`no conozco el ambiente «${target}»: local · dev · qa · staging · prod`);
    const flows = readFlows();
    const cur = flows.merchants[k] ?? die(`no conozco «${k}» en el registro (\`list\`)`);
    const b = baseOf(target);
    let hash = '';
    if (/^[0-9a-f]{8}$/i.test(what)) {
        const got = await branchesIn(b, [what]);
        if (!got) console.log(`  ⚠ ${BASE_LABEL[b]} no contestó: la anoto sin comprobar`);
        else if (!got[what.toLowerCase()]) die(`la sucursal ${what} no existe en ${BASE_LABEL[b]}`);
        else console.log(`  ${what} · #${got[what.toLowerCase()].allied_id} ${got[what.toLowerCase()].allied_name}`);
        hash = what.toLowerCase();
    } else {
        const f = await findIn(b, what);
        if (f === undefined) die(`${BASE_LABEL[b]} no contestó (¿VPN? ¿Docker?)`);
        if (!f) {
            const near = await suggest(b, what);
            die(`«${what}» no está en ${BASE_LABEL[b]}` + (near.length ? `\n  Parecidos: ${near.map((r) => `${r.slug || r.name} (#${r.allied_id} ${r.name})`).join(' · ')}` : ''));
        }
        if (!f.branch) die(`#${f.allied_id} ${f.name} no tiene sucursales activas en ${BASE_LABEL[b]}`);
        console.log(`  #${f.allied_id} ${f.name} → ${f.branch}${f.test ? ' (la del asesor de prueba)' : ''}`);
        if (!f.test) console.log(`  ⚠ ${advisorHint(f)}`);
        hash = f.branch;
    }
    flows.merchants[k] = { ...cur, bases: { ...cur.bases, [b]: { branch: hash } } };
    writeFlows(flows);
    console.log(`✓ «${k}» en ${BASE_LABEL[b]} → ${hash}`);
}

function remove(k: string) {
    const purge = has('purge');
    const flows = readFlows();
    const cur = flows.merchants[k] ?? die(`no conozco «${k}» en el registro (\`list\`)`);
    if (purge) delete flows.merchants[k]; else flows.merchants[k] = { ...cur, panel: undefined };
    writeFlows(flows);
    console.log(purge ? `✓ «${k}» borrado del registro` : `✓ «${k}» fuera de la barra (sigue en el registro: se corre por consola con su clave)`);
}

const [cmd = 'list', a, b, c] = argv;
if (cmd === 'list') await list();
else if (cmd === 'check') await check(a);
else if (cmd === 'add') await add(a ?? '');
else if (cmd === 'associate') await associate(a ?? '', b ?? '', c ?? '');
else if (cmd === 'remove') remove(a ?? '');
else die(`no conozco «${cmd}»: list · check · add · associate · remove`);
