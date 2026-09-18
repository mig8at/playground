// loki-trace.ts — POST-MORTEM de una solicitud: ¿por qué terminó así?
//
// Es la tercera categoría del harness, la misma de `experian-check.ts`: FORENSE. No corre nada y no
// decide nada — el veredicto de "pasó / no pasó" es de `trace.ts` (front + BD). Acá se contesta el POR
// QUÉ, que es lo único que la BD no puede dar: una regla que excluyó un lender no mueve ningún estado,
// y un reintento de KYC que agotó el rate limit tampoco.
//
// USO
//   node dev/loki-trace.ts <uReq> [--since 12h] [--ramal creditopx|agregador|redirect] [--full] [--json]
//
//   --since   ventana hacia atrás (default 12h). Una solicitud vieja necesita más.
//   --ramal   si se omite, se resuelve del `response_type` del lender en la BD (como pkg/close.ts).
//   --full    además del resumen, volcar TODAS las líneas a .runs/ (el resumen ya se imprime siempre).
//   --json    salida estructurada, para encadenar con otra herramienta.
//
// EXIT CODE — el contrato de la casa, pero acá NO es un veredicto de negocio: solo dice si se pudo mirar.
//   0  se consultó y hay líneas
//   2  no concluyente (Loki apagado, sin credenciales, o cero anclas para ese uReq)
// Nunca 1: este comando no falla una corrida. Si los logs muestran un error, el 0 igual sale — porque
// "encontré la causa" es un éxito de la herramienta, no un fallo.

import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { forense, imprimirForense, lokiConfig, porQueNo, ramalDeRt, resumir, type Ramal } from '../pkg/loki.ts';
import { one } from '../pkg/db.ts';
import { TARGET } from '../pkg/env.ts';

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(`--${n}`);
const valor = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const ureq = args.find((a) => /^\d+$/.test(a));

if (!ureq) {
    console.error('uso: node dev/loki-trace.ts <uReq> [--since 12h] [--ramal x] [--full] [--json]');
    process.exit(2);
}

/** "12h" · "90m" · "3d" → ms. Default 12h: cubre una jornada sin traer ruido de ayer. */
function ventana(s = '12h'): number {
    const m = /^(\d+)([smhd])$/.exec(s.trim());
    if (!m) return 12 * 3600_000;
    const n = Number(m[1]);
    return n * ({ s: 1000, m: 60_000, h: 3600_000, d: 86_400_000 })[m[2] as 's' | 'm' | 'h' | 'd'];
}

/** El comando de la OTRA forense de la casa, y por qué.
 *
 * Las dos contestan «¿qué le pasó a esta solicitud?» y hasta ahora se elegía por accidente. La
 * diferencia es dónde ANCLA cada una: ésta arranca en los LOGS (el uReq como valor de un campo del
 * context, y de ahí expande por trace), así que su fuerte es la regla con la que se evaluó cada
 * entidad y el `timeline.ndjson` completo — pero si no hay líneas no puede decir nada. El trazador
 * arranca en la BD: las etapas son hechos, salen igual con cero logs, y encima trae qué VIO el
 * cliente y qué archivos dejaron rastro.
 *
 * ⚠ Los defaults son OPUESTOS —éste cae a `local`, el trazador a `prod`—, así que el target va
 * SIEMPRE escrito: cambiar de herramienta sin ponerlo te cambia de ambiente sin avisar (F-234).
 *
 * ⚠ Y el trazador no tiene target `qa`: su `dev` comparte la base Y el stack de logs con qa, así que
 * es el que corresponde.
 */
function trazadorUreq(): string {
    const destino = TARGET === 'qa' ? 'dev' : TARGET;
    return `make trazador-ureq UREQ=${ureq} TARGET=${destino}`;
}

const cfg = lokiConfig();
const no = porQueNo(cfg);
if (no) {
    console.error(`\n  ▸ forense no disponible para target '${TARGET}': ${no}`);
    console.error('  ▸ (no es un fallo de la corrida — es que no hay de dónde leer)\n');
    process.exit(2);
}

// El ramal sale de la BD, no de un mapa nuevo: `lenders.response_type` es la fuente, igual que en
// pkg/close.ts. Si la BD no responde, se sigue sin ramal — el forense no depende de eso.
async function resolverRamal(): Promise<Ramal | undefined> {
    const pedido = valor('ramal');
    if (pedido === 'creditopx' || pedido === 'agregador' || pedido === 'redirect') return pedido;
    try {
        const r = await one<{ rt: number }>(
            `SELECT l.response_type AS rt FROM user_requests ur
               JOIN lenders l ON l.id = ur.lender_id WHERE ur.id = ?`, [Number(ureq)]);
        return r ? ramalDeRt(Number(r.rt)) : undefined;
    } catch {
        return undefined;   // sin BD el forense igual sirve; solo se pierde la nota del ramal
    }
}

const { lineas, cobertura } = await forense(cfg, ureq, ventana(valor('since')));
const resumen = resumir(ureq, lineas, cobertura);
const ramal = await resolverRamal();

if (flag('json')) {
    console.log(JSON.stringify({ target: TARGET, ramal, ...resumen }, null, 2));
    process.exit(lineas.length ? 0 : 2);
}

// Vacío tiene DOS causas y decir la equivocada manda a buscar donde no es. Se distinguen por si hubo
// traces anclados: si los hubo y no quedaron líneas, no falta data — la filtró el ambiente de este target.
if (!lineas.length) {
    if (cobertura.traces.length) {
        const otros = Object.entries(cobertura.ambientes).map(([k, v]) => `${k} (${v} líneas)`).join(', ');
        console.error(`\n  ▸ el uReq ${ureq} SÍ tiene logs, pero no en el ambiente de este target.`);
        console.error(`  ▸ target '${TARGET}' filtra E2E_LOKI_ENV=${cobertura.filtroEnv} · encontrado: ${otros}`);
        console.error(`  ▸ dev y staging comparten la BD, así que la solicitud existe en los dos pero la`);
        console.error(`  ▸ atendió otra rama de código. Probá con el target que corresponda:`);
        console.error(`  ▸   E2E_TARGET=dev node dev/loki-trace.ts ${ureq} --since ${valor('since') ?? '12h'}\n`);
        console.error(`  ▸ o preguntale a la BD, que no depende del ambiente de los logs:`);
        console.error(`  ▸   ${trazadorUreq()}\n`);
    } else {
        console.error(`\n  ▸ cero anclas para uReq ${ureq} en la ventana pedida.`);
        console.error(`  ▸ ${cobertura.lineasConTexto} líneas contenían el texto «${ureq}» pero ninguna lo traía`);
        console.error('  ▸ como VALOR de un campo del context (ese filtro evita anclar la solicitud de otro).');
        console.error('  ▸ Probá una ventana más ancha: --since 3d\n');
        // Y el cruce: sin logs esta herramienta no puede decir NADA, y la de al lado sí — sus etapas
        // salen de la BD, que es un hecho. «Cero anclas» no es «no se sabe hasta dónde llegó».
        console.error(`  ▸ Sin logs acá no hay nada que leer, pero hasta dónde LLEGÓ lo dice la BD:`);
        console.error(`  ▸   ${trazadorUreq()}\n`);
    }
    process.exit(2);
}

imprimirForense(resumen, ramal, { pii: flag('pii') });

// ── sidecar: la consola resume, el archivo guarda todo ──
// Mismo hogar forense que usa el scrub (.runs/), porque es donde ya se busca cuando algo salió mal. El
// NDJSON existe para que un agente lea el context COMPLETO (headers, payloads) sin re-consultar Loki.
const dir = resolve(import.meta.dirname, '..', '.runs', `forense-${ureq}`);
mkdirSync(dir, { recursive: true });
writeFileSync(resolve(dir, 'resumen.json'), JSON.stringify({ target: TARGET, ramal, ...resumen }, null, 2));
writeFileSync(resolve(dir, 'timeline.ndjson'), lineas.map((l) => JSON.stringify(l)).join('\n') + '\n');
writeFileSync(resolve(dir, 'queries.logql'),
    [`# anclas`, `{service_name=~".+"} |= "${ureq}"`, ``,
     `# expansión`, `{trace_id=~"${cobertura.traces.join('|')}"}`, ``].join('\n'));
// El color se decide igual que en pkg/loki.ts y trace.ts: escapes crudos al pipear ensucian el archivo
// de quien redirige la salida, que es justo lo que un agente hace para leerla.
const gris = (s: string) => (process.env.FORCE_COLOR !== '0' && (process.stdout.isTTY || process.env.FORCE_COLOR)
    ? `\x1b[90m${s}\x1b[0m` : s);
console.log('');
console.log(`  ▸ ${gris(`detalle completo: ${dir.replace(process.cwd() + '/', '')}/`)}`);
console.log(`  ▸ ${gris(`  resumen.json · timeline.ndjson (${lineas.length} líneas, context completo) · queries.logql`)}`);
console.log(`  ▸ ${gris(`↔ las etapas, qué vio el cliente y qué archivos dejaron rastro: ${trazadorUreq()}`)}`);
if (flag('full')) {
    console.log('');
    for (const l of lineas) console.log(`${new Date(l.ts).toISOString()} ${l.level.padEnd(5)} ${l.msg}`);
}
process.exit(0);
