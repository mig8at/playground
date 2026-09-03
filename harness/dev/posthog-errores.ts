// posthog-errores.ts — ¿QUÉ PANTALLAS se están rompiendo en este ambiente, y con qué error?
//
//   E2E_TARGET=qa   node dev/posthog-errores.ts            # staging (los deploys de qa y de staging)
//   E2E_TARGET=prod node dev/posthog-errores.ts --dias 3
//
// Es la vista agregada del canal de LOGS (ver `pkg/posthog.ts` §«EL SEGUNDO CANAL»): el front del
// wizard registra por OpenTelemetry cada fallo con el ARCHIVO de la pantalla, la etapa (`loader` /
// `action`) y el error, así que esto contesta sin abrir un stack qué está roto y dónde.
//
// Dos cortes, porque contestan preguntas distintas y hay que leer los dos:
//   · por PANTALLA  → DÓNDE se rompe. Es lo que dice qué archivo abrir.
//   · por PATRÓN    → QUÉ se rompe. Usa el `pattern` que calcula PostHog (`… returned <N>`), o sea que
//     cincuenta mensajes con distinto id cuentan como UN problema y no como cincuenta.
//
// ⚠ Ambientes: sólo `staging` y `production` escriben. Ni `dev` ni `local` tienen front desplegado, así
// que ahí esto no aplica y lo dice. Retención observada: ~7 días.
// ⚠ Y esto NO es un ranking de gravedad. Un `ZodError` repetido en el loader de una pantalla muy
// visitada suma más que una caída de firma que le pasó a tres personas, y la segunda es peor. El conteo
// dice frecuencia; la gravedad la pone quien lee.
process.env.E2E_TARGET ||= 'qa';
export {};
const { posthogConfig, porQueNo, erroresPorPantalla, patronesDeError } = await import('../pkg/posthog.ts');
const { TARGET } = await import('../pkg/env.ts');

const arg = (n: string, d = ''): string => {
    const i = process.argv.indexOf(`--${n}`);
    return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d;
};

const c = posthogConfig();
const no = porQueNo(c);
if (no) { console.log(`\n  PostHog: no se consulta — ${no}\n`); process.exit(2); }

const dias = Number(arg('dias', '7')) || 7;
console.log(`\n  ERRORES DEL FRONT · target ${TARGET} · environment=${c.env} · últimos ${dias} día(s)\n`);

const porPantalla = await erroresPorPantalla(c, dias);
if (!porPantalla.length) {
    console.log('  ▸ ni un error en la ventana. warn y error no se muestrean, así que el silencio vale.\n');
    process.exit(0);
}
const total = porPantalla.reduce((a, x) => a + x.n, 0);
console.log(`  ▸ ── DÓNDE · ${total} error(es) en ${porPantalla.length} combinación(es) de pantalla · etapa · error ──`);
for (const r of porPantalla.slice(0, 20)) {
    const donde = `${r.pantalla.replace(/^routes\//, '')}${r.etapa !== '—' ? ` ${r.etapa}` : ''}`;
    console.log(`  ${String(r.n).padStart(5)}  ${donde.padEnd(52)} ${r.err.padEnd(12)} ${r.tipo.padEnd(32)} último ${r.ultimo.slice(0, 16)}`);
}

const patrones = await patronesDeError(c, dias);
console.log(`\n  ▸ ── QUÉ · los mensajes agrupados por patrón ──`);
for (const p of patrones.slice(0, 15)) console.log(`  ${String(p.n).padStart(5)}  ${p.patron.slice(0, 120)}`);
console.log(`\n  para una solicitud concreta: make harness-posthog UREQ=<n>\n`);
