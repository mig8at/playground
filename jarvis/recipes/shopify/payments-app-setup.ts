// SÓLO LECTURA · la guía para dejar la app PÚBLICA de pagos de Shopify lista para cobrar, y en qué paso está. Una app
// de pagos en distribución personalizada no pasa nunca por la revisión de Shopify (queda en Development: sólo modo de
// prueba); la que va a revisión y a los comercios es una copia pública (Shopify Support, ticket 72090155). Así se armó
// «Creditop» (Partners 447249776641) el 2026-11-13, en la tarea integracion-shopify.
//
//   make jarvis-recipe APP=shopify RECIPE=payments-app-setup
//   make jarvis-recipe APP=shopify RECIPE=payments-app-setup ARGS='--repo ~/Desktop/CREDITOP/github/shopify --app 447249776641'
//
// Los pasos, y cómo se sabe que cada uno está hecho:
//   1. Crear la app con la CLI (`npx shopify app config link --config production` → «Create a new app»): el .toml de
//      producción del repo tiene su client_id.
//   2. Elegir «Distribución pública» en el Partner Dashboard (no se deshace): su página de Distribución lo dice.
//   3. Que Shopify habilite los permisos de pagos para la app nueva y desplegar (`npm run deploy:production`): la app
//      tiene al menos una versión. Sin los permisos, el deploy se rechaza («app_access · scopes»): se piden en el caso
//      de Shopify Support.
//   4. Cargar la llave y el secreto de la app en el secreto de producción del servidor (`prod/shopify-app`) y
//      reiniciar el servicio: lo hace infra; esta receta no lo puede comprobar.
//   5. Pedir la revisión desde la app pública, con el acuerdo de reparto confirmado por Shopify. Aprobada, el estado de
//      la app de pagos pasa de Development a Hidden: ya cobra de verdad.
//
// Parámetros: --repo <carpeta del repo shopify> (por defecto ~/Desktop/CREDITOP/github/shopify-produccion) ·
// --config shopify.app.production.toml · --app <id de Partners> (por defecto 447249776641) · --json
// Necesita: Jarvis conectado en Chrome con la sesión de Partners (paso 2 y 5) y la sesión de la CLI de Shopify (paso 3).
// Sólo lectura: mira el repo, Partners y las versiones; no crea, no despliega, no elige nada.
import '../args.ts';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openChrome } from '../recorder.ts';
import { readDistribution, type PartnerApp } from './partners.ts';

const argv = process.argv.slice(2);
const flag = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const JSON_OUT = argv.includes('--json');
const say = (s: string) => { if (!JSON_OUT) console.log(`  ${s}`); };
const home = (p: string) => p.replace(/^~(?=\/)/, os.homedir());
const repo = path.resolve(home(flag('repo') || '~/Desktop/CREDITOP/github/shopify-produccion'));
const config = flag('config') || 'shopify.app.production.toml';
const appId = flag('app') || '447249776641';

type Check = { step: string; state: 'hecho' | 'falta' | 'no sé'; detail: string; next?: string };
const checks: Check[] = [];

// 1 · la app creada con la CLI
const toml = path.join(repo, config);
const clientId = fs.existsSync(toml) ? (/^client_id\s*=\s*"([^"]+)"/m.exec(fs.readFileSync(toml, 'utf8')) || [])[1] : undefined;
checks.push(clientId
    ? { step: '1 · app creada con la CLI', state: 'hecho', detail: `${config} con client_id ${clientId.slice(0, 8)}…` }
    : { step: '1 · app creada con la CLI', state: 'falta', detail: `no hay ${config} con client_id en ${repo}`,
        next: `cd ${repo} && npx shopify app config link --config ${config.replace(/^shopify\.app\.|\.toml$/g, '')} (crear una app nueva, en la organización CREDITOP)` });

// 2 y 5 · Partners: distribución y estado de la app de pagos
let partner: PartnerApp | null = null;
try {
    const { page, close } = await openChrome();
    try { partner = await readDistribution(page, appId); } finally { await close(); }
} catch (e) { say(`no pude mirar Partners: ${(e as Error).message}`); }
checks.push(!partner
    ? { step: '2 · distribución pública', state: 'no sé', detail: 'sin Jarvis o sin sesión de Partners en Chrome' }
    : partner.distribution === 'pública'
        ? { step: '2 · distribución pública', state: 'hecho', detail: `${partner.name} (${appId})` }
        : { step: '2 · distribución pública', state: 'falta', detail: `${partner.name}: distribución ${partner.distribution}`,
            next: partner.distribution === 'sin elegir' ? `elegir «Distribución pública» en ${partner.url} (no se deshace)` : 'esta app no puede ir a revisión: hace falta una copia pública' });

// 3 · permisos de pagos y versión desplegada (la CLI lista las versiones; sin sesión, no se sabe)
let versions = -1;
if (clientId) {
    try {
        const out = execFileSync('npx', ['--yes', 'shopify', 'app', 'versions', 'list', '--config', config, '--json'], { cwd: repo, encoding: 'utf8', timeout: 120_000, stdio: ['ignore', 'pipe', 'pipe'] });
        const data = JSON.parse(out.slice(out.indexOf('[') >= 0 && out.indexOf('[') < (out.indexOf('{') + 1 || Infinity) ? out.indexOf('[') : out.indexOf('{')));
        versions = Array.isArray(data) ? data.length : Array.isArray(data?.appVersions) ? data.appVersions.length : -1;
    } catch { versions = -1; }
}
// ⚠ Una versión no alcanza: crear la app con la CLI ya deja una (`creditop-1`, con la configuración por defecto). Lo que
// dice que se desplegó la extensión de pago es que Partners la muestre como app de pagos, con su estado.
const deployed = !!partner?.paymentsStatus;
checks.push(deployed
    ? { step: '3 · permisos de pagos y deploy', state: 'hecho', detail: `extensión de pago desplegada (${versions >= 0 ? `${versions} versión(es)` : 'versiones sin leer'})` }
    : partner
        ? { step: '3 · permisos de pagos y deploy', state: 'falta', detail: `Partners no la muestra como app de pagos todavía${versions >= 0 ? ` (${versions} versión(es): la primera la deja la CLI al crearla)` : ''}`,
            next: `cd ${repo} && SHOPIFY_APP_URL=https://shopify-app.creditop.com SHOPIFY_PAYMENTS_URL=https://shopify-app.creditop.com:8443 npm run deploy:production (si dice «app_access · scopes», pedirle a Shopify los permisos de pagos en el caso de soporte)` }
        : { step: '3 · permisos de pagos y deploy', state: 'no sé', detail: 'sin datos de Partners' });

// 4 · las llaves en producción: no se puede comprobar desde acá
checks.push({ step: '4 · llaves en el secreto de producción', state: 'no sé', detail: 'SHOPIFY_API_KEY y SHOPIFY_API_SECRET de la app en prod/shopify-app',
    next: 'pedírselo a infra (Dani), con el client_id del paso 1; el secreto se copia del Dev Dashboard → la app → Configuración' });

// 5 · revisión
checks.push(!partner ? { step: '5 · revisión de Shopify', state: 'no sé', detail: 'sin datos de Partners' }
    : partner.paymentsStatus && /hidden|generally/i.test(partner.paymentsStatus)
        ? { step: '5 · revisión de Shopify', state: 'hecho', detail: `app de pagos: ${partner.paymentsStatus}` }
        : { step: '5 · revisión de Shopify', state: 'falta', detail: `app de pagos: ${partner.paymentsStatus || 'todavía no (falta el paso 3)'}`,
            next: 'con el acuerdo de reparto confirmado, enviar la app a revisión desde su página de Distribución' });

if (JSON_OUT) console.log(JSON.stringify({ recipe: 'shopify/payments-app-setup', repo, appId, checks }));
else {
    const mark = { hecho: '✓', falta: '✗', 'no sé': '?' } as const;
    for (const c of checks) say(`${mark[c.state]} ${c.step} · ${c.detail}`);
    const next = checks.find((c) => c.state !== 'hecho' && c.next);
    if (next) say(`\n  sigue: ${next.next}`);
}
