// dev/wizard-ensure.ts — ¿el wizard local (:5174) está al día? Si no, lo reinicia.
//
//   make harness-wizard                      diagnostica y, si hace falta, lo reinicia
//   make harness-wizard CHECK=1              sólo diagnostica
//   make harness-wizard MERCHANT=motai       el comercio con que `bin/advisor … preboot` lo levanta
//
// El juicio vive en `pkg/wizard-health.ts`; el arranque, en `bin/advisor <comercio> preboot`, el mismo que usa
// el panel. Exit code: 0 sano o reiniciado · 1 falló · 3 hay motivos y no se pidió reiniciar.
import { parseArgs } from 'node:util';
import { ensureWizard } from '../pkg/wizard-health.ts';
import { TARGET } from '../pkg/env.ts';

const { values: args } = parseArgs({ options: { check: { type: 'boolean', default: false }, merchant: { type: 'string' } } });

const r = await ensureWizard({ merchant: args.merchant, restart: !args.check, out: 'inherit' });
const mark = { sano: '✅', reiniciado: '🔄', 'no reiniciado': '⚠ ', falló: '✖ ' }[r.estado];
console.log(`\n  ${mark} wizard (${TARGET}) · ${r.estado} — ${r.detalle}`);
for (const reason of r.reasons) console.log(`     · ${reason}`);
console.log('');
process.exit(r.estado === 'falló' ? 1 : r.estado === 'no reiniciado' ? 3 : 0);
