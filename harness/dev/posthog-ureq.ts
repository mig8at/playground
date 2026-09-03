// posthog-ureq.ts — ¿qué VIO el cliente en ESTA solicitud, según PostHog? La tercera fuente, a mano.
//
//   E2E_TARGET=qa node dev/posthog-ureq.ts 502060                      # desde hace 6 h
//   E2E_TARGET=qa node dev/posthog-ureq.ts 502060 --desde 2026-09-03T01:40:00Z
//   E2E_TARGET=qa node dev/posthog-ureq.ts 502060 --pantallas otp,personal-info,lenders,confirmation
//
// POR QUÉ EXISTE APARTE DEL CAMINADOR. La ingesta de PostHog tarda MINUTOS (medido 2026-09-02: dos
// minutos después de cerrar faltaban los eventos de la firma), y esperarla dentro de cada corrida la
// alarga sin necesidad. El caminador espera un rato acotado y, si no llegó todo, lo dice y manda acá:
// se vuelve a mirar después, con la misma consulta y el mismo cruce.
//
// ⚠ `--desde` importa por la trampa de la cabecera de `pkg/posthog.ts`: prod y dev comparten ids, así que
// sin hora una solicitud homónima de prod contamina la respuesta. Sin `--desde` se toman 6 horas.
process.env.E2E_TARGET ||= 'dev';
export {};
const { posthogConfig, porQueNo, eventosDe, imprimirEventos, cruzar, imprimirCruce, RAMA_DEL_FRONT,
        logsDe, imprimirLogs } = await import('../pkg/posthog.ts');
const { TARGET } = await import('../pkg/env.ts');

const arg = (n: string, d = ''): string => {
    const i = process.argv.indexOf(`--${n}`);
    return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d;
};
const ureq = process.argv.slice(2).find((a) => /^\d+$/.test(a));
if (!ureq) { console.error('uso: node dev/posthog-ureq.ts <ureq> [--desde ISO] [--pantallas a,b,c]'); process.exit(2); }

const c = posthogConfig();
const no = porQueNo(c);
if (no) { console.log(`  PostHog: no se consulta — ${no}`); process.exit(2); }

const desde = arg('desde') ? new Date(arg('desde')) : new Date(Date.now() - 6 * 3600_000);
console.log(`\n  POSTHOG · uReq ${ureq} · target ${TARGET} · environment=${c.env} · desde ${desde.toISOString()}\n`);
const ev = await eventosDe(c, ureq, desde);
const srv = ev.filter((e) => /posthog-node/.test(e.lib)).length;
console.log(`  ▸ ── EVENTOS · ${ev.length} · ${srv} del servidor · ${ev.length - srv} del navegador ──`);
if (ev.length) imprimirEventos(ev);
else console.log('  ▸ ninguno: o la ingesta sigue atrasada, o esta solicitud no pasó por el front en este ambiente/ventana.');

const pantallas = arg('pantallas').split(',').map((s) => s.trim()).filter(Boolean);
if (pantallas.length && ev.length) {
    console.log(`\n  ▸ ── el cruce con ${pantallas.length} pantalla(s) (eventos esperados: derivados de ${RAMA_DEL_FRONT[TARGET] ?? 'main'}) ──`);
    imprimirCruce(cruzar(pantallas.map((p) => `/x/y/0/${p}`), ev));
}

// El segundo canal, que es el que dice EN QUÉ PANTALLA se rompió. Va entero (no sólo los errores):
// preguntando por una solicitud puntual, las líneas de info son el recorrido del servidor y ubican el
// error en su contexto. Para ver sólo lo roto de un ambiente: `dev/posthog-errores.ts`.
const ls = await logsDe(c, ureq, desde);
const malos = ls.filter((l) => l.nivel === 'error' || l.nivel === 'warn');
console.log(`\n  ▸ ── LOGS del front · ${ls.length} línea(s) · ${malos.length} de nivel error/warn ──`);
if (!ls.length) console.log('  ▸ ninguna. warn y error no se muestrean, así que «sin errores» sí vale; las de info sí pueden faltar.');
else imprimirLogs(ls);
if (!ev.length && !ls.length) process.exit(1);
console.log();
