// dev/prod-advisor-check.ts — ¿el asesor de prueba de un comercio de PRODUCCIÓN está bien armado para entrar al wizard? SIN entrar.
//
//   make harness-prod-advisor ALLIED=363                      el asesor de prueba (c…-fake@) de ese comercio
//   make harness-prod-advisor EMAIL=c9aa92333-fake@creditop.com
//   make harness-prod-advisor ALLIED=363 BLOQUE=98            …y la corrida queda en la pila de la tarea
//
// SOLO LECTURA, y sin clave: lee la base de prod por el conector `sql` (Redash, que impone el solo lectura), la cuenta en el pool de comercios de
// prod con el perfil de AWS `prod` (`admin-get-user`) y a qué login manda el wizard de prod (un fetch sin sesión). No abre navegador, no escribe
// y no prueba el login: probar el login en prod no se hace (prod es solo lectura y el primer ingreso de un asesor puede completar su
// `cognito_id`). La parte «entrar» de verdad se hace a mano, con el navegador de quien prueba.
//
// Pide la sesión de AWS de prod al día (`aws sso login --profile prod`) y la VPN de prod. Sin ellas dice qué falta y sale con 2.
//
// Exit code: 0 todo bien · 1 algo está mal · 2 algo no se pudo comprobar.
import { parseArgs } from 'node:util';
import { discoverHostedUi } from '../pkg/login-probe.ts';
import {
    buildChecks, exitCodeOf, findAdvisor, hintsOf, poolAccount, PROD_FRONT, PROD_POOL_ID, renderChecks, verdictOf, safeEmail, safeId,
    type HostedSeen, type PoolState,
} from '../pkg/prod-advisor.ts';

const { values: args } = parseArgs({
    options: { allied: { type: 'string' }, email: { type: 'string' }, json: { type: 'boolean', default: false } },
});

function fail(msg: string): never {
    console.error(`\n  ✖ ${msg}\n`);
    process.exit(2);
}

if (!!args.allied === !!args.email) fail('pasa UNO: ALLIED=<id del comercio> o EMAIL=<correo exacto del asesor>');

let by: { allied?: number; email?: string };
try {
    by = args.email ? { email: safeEmail(args.email) } : { allied: safeId(String(args.allied)) };
} catch (e) {
    fail((e as Error).message);
}

console.log(`\n  harness-prod-advisor · producción (solo lectura) · pool ${PROD_POOL_ID}\n`);

const found = findAdvisor(by);
if (found.error) fail(`no se pudo leer la base de prod: ${found.error}\n    (¿VPN de prod? ¿el conector sql en prod responde?: bin/pg sql --target prod --query 'SELECT 1')`);
if (found.count > 1) console.log(`  ⚠ el comercio tiene ${found.count} asesores de prueba; se revisa el más reciente (usuario ${found.advisor?.id})\n`);

const pool: PoolState | null = found.advisor ? poolAccount(found.advisor.email) : null;

let hosted: HostedSeen | null = null;
const seen = await discoverHostedUi(PROD_FRONT);
if (seen.hosted) hosted = { host: seen.hosted.host, clientId: seen.hosted.clientId };

const checks = buildChecks(found.advisor, pool, hosted);
const verdict = verdictOf(checks);
const hints = hintsOf(found.advisor, pool);

if (args.json) {
    console.log(JSON.stringify({ target: 'prod', poolId: PROD_POOL_ID, advisor: found.advisor, pool, hosted, checks, verdict, hints }, null, 2));
} else {
    console.log(renderChecks(checks));
    console.log(`\n  veredicto: ${verdict === 'lista' ? '✔ lista para entrar' : verdict === 'con-problemas' ? '✖ con problemas' : '– no se pudo comprobar todo'}`);
    for (const h of hints) console.log(`  → ${h}`);
    console.log('  (esto no prueba el login: entrar al wizard de prod se hace a mano)\n');
}

// La corrida como bloque de la tarea, igual que las demás herramientas (BLOQUE=<tarea>).
if (process.env.MD === '1' || process.env.BLOQUE) {
    const { emit, cmdMake } = await import('../pkg/annotation.ts');
    emit(
        `el asesor de prueba de producción ${found.advisor ? found.advisor.email : '(no existe)'} quedó ${verdict === 'lista' ? 'listo para entrar' : verdict === 'con-problemas' ? 'con problemas' : 'sin comprobar del todo'}`,
        cmdMake('harness-prod-advisor', 'prod', { ALLIED: args.allied, EMAIL: args.email }),
        [...checks.map((c) => `${c.ok === true ? 'bien' : c.ok === false ? 'mal' : 'sin ver'}: ${c.label} — ${c.detalle}`), ...hints.map((h) => `qué hacer: ${h}`)],
    );
}

process.exit(exitCodeOf(verdict));
