#!/usr/bin/env node
// plan — deja una corrida ARMADA para el panel: el panel la muestra arriba de los celulares y se le da play.
//
//   node bin/plan.ts set <archivo.json>     valida el plan y lo deja como el plan de la máquina
//   node bin/plan.ts set -                  …leyéndolo de la entrada estándar (lo que usa un agente)
//   node bin/plan.ts show                   el plan que está esperando, o «sin plan»
//   node bin/plan.ts clear                  lo descarta
//
// El formato y por qué se parece a una suite: `pkg/run-plan.ts`. Sale 1 si el plan no es válido, con cada error.
import { readFileSync } from 'node:fs';
import { validatePlan, readPlan, writePlan, clearPlan, PLAN_FILE } from '../pkg/run-plan.ts';

const [cmd = 'show', src] = process.argv.slice(2);

if (cmd === 'show') {
    const plan = readPlan();
    console.log(plan ? JSON.stringify(plan, null, 2) : 'sin plan');
} else if (cmd === 'clear') {
    clearPlan();
    console.log('plan descartado');
} else if (cmd === 'set') {
    if (!src) { console.error('falta el archivo del plan (o «-» para leerlo de la entrada estándar)'); process.exit(1); }
    let raw: unknown;
    try { raw = JSON.parse(readFileSync(src === '-' ? 0 : src, 'utf8')); } catch (e) {
        console.error('el plan no es JSON: ' + (e as Error).message); process.exit(1);
    }
    const r = validatePlan(raw);
    if (!r.ok || !r.plan) { for (const e of r.errors) console.error('✗ ' + e); process.exit(1); }
    writePlan(r.plan);
    console.log(`✓ plan listo: ${r.plan.nombre} · ${r.plan.comercio} · ${r.plan.canal} · ${r.plan.target} (${PLAN_FILE})`);
    console.log('  abrí el panel (:5195): aparece arriba de los celulares, con su play');
} else {
    console.error(`no conozco «${cmd}»: set <archivo|-> · show · clear`); process.exit(1);
}
