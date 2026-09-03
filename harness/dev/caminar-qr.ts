/**
 * CAMINADOR del canal QR — recorre las pantallas CLICKEANDO y dice dónde se para.
 *
 * Es la pata que faltaba del harness. Los otros dos caminos no ven lo mismo:
 *   · `dev/qr-corbeta.ts`  → pega contra el BACKEND: verifica estados y BD, **no** los esquemas del front.
 *   · el panel (`npm run dev`) → recorrido VISUAL, pero lo conduce una persona clickeando.
 *   · éste                 → recorrido visual AUTOMÁTICO: descubre qué pantallas existen de verdad y en
 *                            qué orden, sin que nadie mire. Es lo que detecta un muro a mitad de camino
 *                            (F-88: el runner por consola estaba verde con el visual roto).
 *
 * NO reemplaza al panel: no valida negocio ni afirma que la pantalla esté BIEN, sólo que carga y avanza.
 *
 * USO
 *   E2E_TARGET=local npx tsx dev/caminar-qr.ts [--producto bnpl|consumo|pendiente|ninguno]
 *                                              [--escenario '{"errorCode":"BP20790"}'] [--tel 3131010101]
 *                                              [--doc 2912637830] [--monto 2000000] [--max 20] [--headed]
 *
 * Requiere la flota: `bin/mock-bancolombia start` y `bin/mock-corbeta start` (y el wizard en :5174).
 * El producto NO es cosmético: lo resuelve el OTP y con las dos compuertas prendidas arranca siempre en
 * BNPL, así que las 11 pantallas de Consumo no se alcanzan (ver la perilla `producto` del mock).
 */
import { chromium, type Page } from '@playwright/test';
import { qrEntryUrl, corbetaBranch, sucursalUsable } from '../pkg/qr.ts';
import { autorrellenarQr } from '../pkg/qr-steps.ts';
import { scrubphone } from '../pkg/asesor.ts';
import { close } from '../pkg/db.ts';
import { latestUserRequestId } from '../pkg/inject.ts';
import { posthogConfig, porQueNo } from '../pkg/posthog.ts';

const arg = (n: string, def = '') => {
    const i = process.argv.indexOf(`--${n}`);
    return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : def;
};
const flag = (n: string) => process.argv.includes(`--${n}`);

const PRODUCTO = arg('producto', 'bnpl');
const TEL = arg('tel', '3131010101');
const DOC = arg('doc', '2912637830');
const MONTO = Number(arg('monto', '2000000'));
const MAX = Number(arg('max', '20'));
const MOCK = process.env.MOCK_BC_URL || 'http://localhost:8104';

/** Botones que hacen AVANZAR. Se listan por texto porque cada pantalla del recorrido nombra el suyo
 *  distinto (Solicitar, Firmar documento, Autenticarme y volver…) y no hay un `data-testid` común. */
const AVANZAR = /continuar|siguiente|aceptar|validar|verificar|confirmar|firmar|autenticarme|solicitar|entendido|finalizar|ver mi|empezar|comenzar/i;
/** Pantallas de ESPERA: no tienen botón, POSTean y navegan solas. Buscarles botón parece un muro. */
const ESPERA = /processing|procesando|espera/;
/** Fin del recorrido (los dos productos y el canal ecommerce). */
const FINAL = /purchase-code|payment-success|response|no-preapproved|no-quota|business-error|Error$/i;

const escenario = async (cambios: Record<string, unknown>) => {
    const r = await fetch(`${MOCK}/_control/escenario`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cambios),
    }).then((x) => x.json()).catch(() => null);
    if (!r) throw new Error(`el mock no responde en ${MOCK} — corré  bin/mock-bancolombia start`);
    return r;
};

/** El regreso del banco: UNA sola URL, el despachador que rutea por el paso de la sesión (F-89). */
const registrarRetorno = async (page: Page, puesto: { url: string }) => {
    const m = page.url().match(/\/bancolombia\/(bnpl|consumo)\//);
    if (!m) return;
    const d = new URL(page.url());
    d.pathname = `/bancolombia/${m[1]}/redirect`;
    d.search = '';
    d.searchParams.set('code', 'mock-auth-code');
    if (d.toString() === puesto.url) return;
    puesto.url = d.toString();
    await fetch(`${MOCK}/_control/retorno`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: puesto.url }),
    }).catch(() => {});
};

const suc = await corbetaBranch();
if (!suc) throw new Error('no hay sucursal Corbeta con los dos lenders (68/100) habilitados en este target');
if (!(await sucursalUsable(suc.hash))) throw new Error(`la sucursal ${suc.id} no sirve para este canal`);
console.log(`▶ CAMINADOR QR · sucursal ${suc.id} (allied ${suc.alliedId}) · producto ${PRODUCTO} · target ${process.env.E2E_TARGET ?? 'dev'}`);

await escenario({ producto: PRODUCTO, ...(arg('escenario') ? JSON.parse(arg('escenario')) : {}) });
console.log(`  escenario del mock: producto=${PRODUCTO}${arg('escenario') ? ` + ${arg('escenario')}` : ''}`);
console.log(`  scrub ${TEL}: ${JSON.stringify(await scrubphone(TEL))}`);

const browser = await chromium.launch({ headless: !flag('headed') });
const page = await browser.newPage();
const puesto = { url: '' };
const errores: string[] = [];
page.on('pageerror', (e) => errores.push(e.message.slice(0, 140)));
page.on('framenavigated', (f) => { if (f === page.mainFrame()) void registrarRetorno(page, puesto); });

const recorrido: string[] = [];
// La solicitud de ESTA corrida y su hora de arranque: las dos hacen falta para poder preguntarle
// después a PostHog por ella. El id no se conoce de antemano (lo crea el canal), así que se toma la
// línea base de la sucursal y al final se pide el primero que apareció por encima.
const T0 = new Date();
const uReqBase = (await latestUserRequestId(suc.hash)) ?? 0;
await page.goto(qrEntryUrl(suc.hash), { waitUntil: 'domcontentloaded' });

for (let paso = 1; paso <= MAX; paso++) {
    await page.waitForTimeout(1200);
    const url = new URL(page.url()).pathname;
    recorrido.push(url);

    const banner = await page.getByText(/Error al cargar|no pudimos|hubo un problema|intenta de nuevo/i)
        .first().textContent({ timeout: 500 }).catch(() => null);
    console.log(`${String(paso).padStart(2, '0')} ${url}${banner ? `   ⛔ ${banner.trim().slice(0, 70)}` : ''}`);
    if (banner) break;
    if (FINAL.test(url)) { console.log('   ✓ pantalla final del recorrido'); break; }

    if (ESPERA.test(url)) {
        console.log('   ⏳ pantalla de espera: navega sola');
        await page.waitForURL((u) => !ESPERA.test(u.pathname), { timeout: 45_000 })
            .catch(() => console.log('   ⚠ no navegó en 45s'));
        continue;
    }

    const hechos = await autorrellenarQr(page, {
        phone: TEL, document: DOC, amount: MONTO,
        firstName: 'SYNTH', lastName: 'TEST USER', email: `synth-${DOC}@creditop.com`,
        address: 'Cal 123 # 12-122', income: 2_500_000,
    }).catch(() => [] as string[]);
    if (hechos.length) console.log(`   ▸ autorrelleno: ${hechos.join(' · ')}`);

    // ⚠ Elegir el botón NO es `.first()` con un filtro de `disabled`: `filter({hasNot: '[disabled]'})`
    // pregunta por un DESCENDIENTE deshabilitado, no por el botón mismo, así que devolvía botones
    // deshabilitados y el click moría por timeout con el nombre ya leído — parecía un muro de la pantalla
    // cuando era el harness eligiendo mal. Se recorren los candidatos y se toma el primero **visible y
    // habilitado** de verdad.
    const cand = page.getByRole('button', { name: AVANZAR });
    const n = await cand.count();
    let elegido = null as null | { i: number; nombre: string };
    for (let i = 0; i < n; i++) {
        const c = cand.nth(i);
        if (!(await c.isVisible().catch(() => false))) continue;
        if (!(await c.isEnabled().catch(() => false))) continue;
        elegido = { i, nombre: (await c.textContent().catch(() => '')) ?? '' };
        break;
    }
    if (!elegido) {
        const nombres = await cand.allTextContents().catch(() => []);
        console.log(`   ⚠ sin botón habilitado para avanzar — se detiene acá${nombres.length ? ` (candidatos: ${nombres.map((x) => x.trim()).join(' · ')})` : ''}`);
        break;
    }
    console.log(`   ↳ click «${elegido.nombre.trim().slice(0, 40)}»`);
    await cand.nth(elegido.i).click({ timeout: 4000 })
        .catch((e) => console.log(`   ⚠ no pudo clickear: ${String(e).split('\n')[0].slice(0, 90)}`));
}

const shot = `.runs/caminar-${PRODUCTO}.png`;
await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
console.log(`\n${recorrido.length} pantalla(s) · última: ${recorrido.at(-1)} · 📸 ${shot}`);
if (errores.length) console.log(`⚠ ${errores.length} error(es) de página:\n   ${[...new Set(errores)].join('\n   ')}`);

// LA TERCERA FUENTE, como pista y no como consulta. Este caminador usa navegador de verdad, así que
// contra un front DESPLEGADO deja en PostHog más rastro que ningún otro runner: los eventos del
// servidor, los del cliente (`$pageview`, autocapture) y la grabación de sesión. Acá no se consulta
// —la ingesta tarda minutos y esta herramienta es de a un caso— pero sí se imprime el comando con la
// solicitud y la hora ya puestas, que es lo que costaba armar a mano.
// ⚠ En LOCAL no hay nada que mirar: `APP_ENV=local` apaga el cliente de PostHog en el front.
const uReqCorrida = await latestUserRequestId(suc.hash, uReqBase).catch(() => null);
const noPostHog = porQueNo(posthogConfig());
if (noPostHog) {
    console.log(`\nPostHog: nada que mirar — ${noPostHog}`);
} else if (uReqCorrida) {
    console.log(`\nPostHog · qué registró el FRONT de esta corrida (eventos del embudo + logs con pantalla y error):`
        + `\n   make harness-posthog UREQ=${uReqCorrida} DESDE=${new Date(T0.getTime() - 60_000).toISOString()}`);
} else {
    console.log('\nPostHog: el canal no creó una solicitud nueva en esta sucursal, así que no hay por dónde preguntar.');
}

await browser.close();
// SE DEJA EL MOCK LIMPIO, y eso incluye el `errorCode`: restaurar sólo `producto` dejaba el error forzado
// vivo en el mock y la siguiente corrida (o `npm run contrato:bancolombia`) fallaba por un escenario que
// nadie pidió. Un mock con estado pegado es un falso negativo esperando.
await escenario({ producto: 'ambos', errorCode: null, errorEn: null });
await close();
