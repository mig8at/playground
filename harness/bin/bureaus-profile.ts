#!/usr/bin/env node
// UN PERFIL COMPLETO EN LAS CENTRALES, ANTES DE LANZAR UNA PRUEBA — para que las centrales contesten la persona
// que va a escribir el cliente (su nombre, su empleo y su buró) y la identidad no falle por la persona por
// defecto del mock (JUAN CARLOS PEREZ GOMEZ). Lo usa el botón «Cargar mis datos en las centrales» de tests.
//
//   node bin/bureaus-profile.ts <local|qa> <cédula> --name "NOMBRE COMPLETO" [--income 2500000] [--occupation Empleado]
//                               [--months 13] [--score 700] [--json]
//
// En qa le dicta al lambda de la empresa con `dictateCompanyLambda` (Ágil Data y Experian, y confirma leyendo),
// lo mismo que hace el panel antes de abrir un checkout. En local, al mock del harness (:8105) con
// `applyBureauConfig`. dev y staging consultan un lambda sin dictado (F-149): se dice, no se finge.
//
// ⚠ En qa lo dictado vive en la memoria de UN contenedor del lambda (F-245): el ✓ dice que ese contenedor lo
// tiene, no que la consulta del backend vaya a caer ahí. Conviene cargarlo justo antes de lanzar la compra.

import { COMPANY_LAMBDA, applyBureauConfig, dictateCompanyLambda } from '../pkg/risk-lambda.ts';

const args = process.argv.slice(2);
const json = args.includes('--json');
const flag = (name: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
const num = (name: string, def: number) => { const n = Number(flag(name)); return Number.isFinite(n) && n > 0 ? n : def; };
const [target, doc] = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));

function out(ok: boolean, lines: string[], code = ok ? 0 : 1): never {
    if (json) console.log(JSON.stringify({ ok, target, doc, lines }));
    else for (const l of lines) console.log(`  ${l}`);
    process.exit(code);
}

if (!target || !/^\d{5,15}$/.test(doc || '')) out(false, ['uso: bureaus-profile.ts <local|qa> <cédula> --name "NOMBRE" [--income …]'], 2);
const name = String(flag('name') || '').trim().toUpperCase();
if (!name) out(false, ['falta --name: es lo que compara la identidad contra lo que escribe el cliente'], 2);
const income = num('income', 2_500_000);
const occupation = flag('occupation') || 'Empleado';
const months = Math.min(num('months', 13), 24);
const score = num('score', 700);

if (target === 'local') {
    // El mock local entiende el perfil por central; el nombre va en Ágil Data, que es la que lo compara.
    // ⚠ `LAMBDA` se resuelve al IMPORTAR, con E2E_TARGET: se exige que quien lanza este proceso lo pase (F-187).
    if ((process.env.E2E_TARGET || '').toLowerCase() !== 'local') out(false, ['para local, lanzalo con E2E_TARGET=local: si no, se dicta a otro mock'], 2);
    const r = await applyBureauConfig(doc, {
        agildata: { mode: 'ok', income, occupation, months, name },
        mareigua: { mode: 'ok', income, months },
        tusdatos: { mode: 'ok' },
        experian: { mode: 'ok', score },
    });
    out(r.ok, r.lines);
} else if (COMPANY_LAMBDA[target]) {
    const r = await dictateCompanyLambda(target, doc, {
        name, income, occupation, months,
        score, consulted: 1, creditCards: 1, delinquencies: 0, negatives: 0, maturationSince: '2015-03-26',
    });
    out(r.ok, r.lines);
} else {
    out(false, [`en ${target} el backend consulta un lambda sin dictado (F-149): las centrales contestan su default`]);
}
