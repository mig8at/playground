// SÓLO LECTURA · ¿en qué estado están las apps de Shopify de CreditOp? Por cada app de la organización Partner: cómo
// se distribuye (personalizada, pública o sin elegir) y, si es de pagos, su estado (Development, Hidden, Generally
// Available). Es lo que se miraba entrando a Partners → la app → Distribución, una por una.
//
//   make jarvis-recipe APP=shopify RECIPE=payments-app-status
//   make jarvis-recipe APP=shopify RECIPE=payments-app-status ARGS='--app 447249776641'
//
// Para qué: saber si la app de pagos ya pasó la revisión de Shopify (Development → Hidden: ya cobra de verdad). Una app
// de pagos en distribución PERSONALIZADA no sale nunca de Development (no tiene revisión); la que va a revisión es la
// pública. Contexto: tarea integracion-shopify, 2026-11-13.
//
// Parámetros: --app <id de Partners> (sólo esa) · --org 4296643 · --json
// Necesita: Jarvis conectado en Chrome y la sesión de Partners abierta en Chrome (la cuenta dueña: Juan).
// Sólo lectura: navega y mira, no guarda nada.
import '../args.ts';
import { openChrome } from '../recorder.ts';
import { listApps, readDistribution, PARTNER_ORG, type PartnerApp } from './partners.ts';

const argv = process.argv.slice(2);
const flag = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const JSON_OUT = argv.includes('--json');
const say = (s: string) => { if (!JSON_OUT) console.log(`  ${s}`); };
const org = flag('org') || PARTNER_ORG;
const only = flag('app');

const { page, close } = await openChrome();
const apps: PartnerApp[] = [];
try {
    const list = only ? [{ id: only, name: '' }] : await listApps(page, org);
    say(`${list.length} app(s) en la organización ${org}`);
    for (const a of list) apps.push(await readDistribution(page, a.id, a.name, org));
} finally {
    await close();
}
if (JSON_OUT) console.log(JSON.stringify({ recipe: 'shopify/payments-app-status', org, apps }));
else {
    for (const a of apps) {
        const pay = a.paymentsStatus ? ` · app de pagos: ${a.paymentsStatus}` : '';
        say(`${a.name || a.id} (${a.id}) · distribución ${a.distribution}${pay}`);
        say(`   ${a.url}`);
    }
    const stuck = apps.find((a) => a.distribution === 'personalizada' && a.paymentsStatus === 'Development');
    if (stuck) say(`ⓘ ${stuck.name}: app de pagos personalizada, queda en Development (sin revisión): sirve para QA, no para cobrar.`);
}
