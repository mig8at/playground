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
 *   E2E_TARGET=local npx tsx dev/walk-qr.ts [--producto bnpl|consumo|pendiente|ninguno]
 *                                              [--escenario '{"errorCode":"BP20790"}'] [--tel 3131010101]
 *                                              [--doc 2912637830] [--monto 2000000] [--max 20] [--headed]
 *
 * Requiere la flota: `bin/mock-bancolombia start` y `bin/mock-corbeta start` (y el wizard en :5174).
 * El producto NO es cosmético: lo resuelve el OTP y con las dos compuertas prendidas arranca siempre en
 * BNPL, así que las 11 pantallas de Consumo no se alcanzan (ver la perilla `producto` del mock).
 */
import { chromium, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { qrEntryUrl, corbetaBranch, usableBranch } from '../pkg/qr.ts';
import { autofillQr } from '../pkg/qr-steps.ts';
import { blockDevTools, isLocalNoise } from '../pkg/wizard-browser.ts';
import { scrubphone } from '../pkg/advisor.ts';
import { close } from '../pkg/db.ts';
import { latestUserRequestId } from '../pkg/inject.ts';
import { posthogConfig, whyNot } from '../pkg/posthog.ts';

const arg = (n: string, def = '') => {
    const i = process.argv.indexOf(`--${n}`);
    return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : def;
};
const flag = (n: string) => process.argv.includes(`--${n}`);

const PRODUCT = arg('producto', 'bnpl');
const TEL = arg('tel', '3131010101');
const DOC = arg('doc', '2912637830');
const AMOUNT = Number(arg('monto', '2000000'));
const MAX = Number(arg('max', '20'));
const MOCK = process.env.MOCK_BC_URL || 'http://localhost:8104';

/** Botones que hacen ADVANCE. Se listan por texto porque cada pantalla del recorrido nombra el suyo
 *  distinto (Solicitar, Firmar documento, Autenticarme y volver…) y no hay un `data-testid` común. */
const ADVANCE = /continuar|siguiente|aceptar|validar|verificar|confirmar|firmar|autenticarme|solicitar|entendido|finalizar|ver mi|empezar|comenzar/i;
/** Pantallas de WAIT: no tienen botón, POSTean y navegan solas. Buscarles botón parece un muro. */
const WAIT = /processing|procesando|espera/;
/** Fin del recorrido (los dos productos y el canal ecommerce). */
const FINAL = /purchase-code|payment-success|response|no-preapproved|no-quota|business-error|Error$/i;

/** El escenario tal como estaba ANTES de que esta corrida lo tocara, para poder devolverlo entero. */
let originalScenario: Record<string, unknown> | null = null;

const snapshotScenario = async () => {
    originalScenario = await fetch(`${MOCK}/`)
        .then((x) => x.json()).then((j) => j.escenario ?? null).catch(() => null);
};

const scenario = async (changes: Record<string, unknown>) => {
    const r = await fetch(`${MOCK}/_control/escenario`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(changes),
    }).then((x) => x.json()).catch(() => null);
    if (!r) throw new Error(`el mock no responde en ${MOCK} — corré  bin/mock-bancolombia start`);
    return r;
};

/** El regreso del banco: UNA sola URL, el despachador que rutea por el paso de la sesión (F-89). */
const registerReturn = async (page: Page, set: { url: string }) => {
    const m = page.url().match(/\/bancolombia\/(bnpl|consumo)\//);
    if (!m) return;
    const d = new URL(page.url());
    d.pathname = `/bancolombia/${m[1]}/redirect`;
    d.search = '';
    d.searchParams.set('code', 'mock-auth-code');
    if (d.toString() === set.url) return;
    set.url = d.toString();
    await fetch(`${MOCK}/_control/retorno`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ url: set.url }),
    }).catch(() => {});
};

const br = await corbetaBranch();
if (!br) throw new Error('no hay sucursal Corbeta con los dos lenders (68/100) habilitados en este target');
if (!(await usableBranch(br.hash))) throw new Error(`la sucursal ${br.id} no sirve para este canal`);
console.log(`▶ CAMINADOR QR · sucursal ${br.id} (allied ${br.alliedId}) · producto ${PRODUCT} · target ${process.env.E2E_TARGET ?? 'dev'}`);

await snapshotScenario();
await scenario({ producto: PRODUCT, ...(arg('escenario') ? JSON.parse(arg('escenario')) : {}) });
console.log(`  escenario del mock: producto=${PRODUCT}${arg('escenario') ? ` + ${arg('escenario')}` : ''}`);
console.log(`  scrub ${TEL}: ${JSON.stringify(await scrubphone(TEL))}`);

const browser = await chromium.launch({ headless: !flag('headed') });
const page = await browser.newPage();
// El overlay de `react-scan` intercepta clicks en viewport angosto — ver `blockDevTools`.
await blockDevTools(page);
const set = { url: '' };
const errorsList: string[] = [];
page.on('pageerror', (e) => errorsList.push(e.message.slice(0, 140)));
page.on('framenavigated', (f) => { if (f === page.mainFrame()) void registerReturn(page, set); });

const route: string[] = [];
// La solicitud de ESTA corrida y su hora de arranque: las dos hacen falta para poder preguntarle
// después a PostHog por ella. El id no se conoce de antemano (lo crea el canal), así que se toma la
// línea base de la sucursal y al final se pide el primero que apareció por encima.
/** Un nombre de archivo legible a partir de la ruta: `/bancolombia/consumo/loan-summary/X` → `loan-summary`. */
const nickname = (path: string) =>
    (path.split('/').filter((t) => t && !/^[A-Z0-9]{8,}$/.test(t)).pop() ?? 'pantalla')
        .replace(/[^a-zA-Z0-9-]/g, '-').slice(0, 40) || 'pantalla';

const FOLDER = `.runs/caminar-${PRODUCT}`;
mkdirSync(FOLDER, { recursive: true });

// ── LA REVISIÓN DE CADA PANTALLA ──────────────────────────────────────────────────────────────────
// Hasta acá el caminador probaba que las pantallas CARGAN y avanzan. Eso deja pasar todo lo que se
// renderiza mal sin romperse: un `undefined` en medio de una frase, una imagen que no llega, un error de
// JavaScript que el usuario no ve pero que apagó media pantalla. F-227 se encontró con un humano mirando
// un PNG — esto es lo que se puede mirar SOLO. No reemplaza mirar: reduce lo que hay que mirar.
//
// ⚠ Es DESCRIPTIVO, no un oráculo: no sabe si el texto de la pantalla es correcto, sólo si tiene la
// pinta de estar roto. Un hallazgo acá es «andá a mirar esa captura», no «esto está mal».
//
// ⚠ LA PANTALLA QUE SE LE ATRIBUYE A UN ERROR DE CONSOLA ES APROXIMADA. Los eventos de consola y de red
// llegan de forma asíncrona, así que uno disparado al final de una pantalla puede contarse en la
// siguiente. Sirve para saber POR DÓNDE mirar, no como evidencia de en cuál ocurrió — medido: un aviso
// de hidratación de React apareció atribuido a `_autenticacion`, que es una página del mock y no tiene
// React. Para fijar la pantalla de verdad hay que reproducir el paso a mano.
type Suspicion = { pantalla: string; que: string; detalle: string };
const suspicions: Suspicion[] = [];
let currentScreen = '(arranque)';

// La basura que delata un render roto. NO se incluye «null» a secas: aparece dentro de payloads
// legítimos embebidos en el HTML y ahogaría la señal con falsos positivos.
const JUNK = /\bundefined\b|\bNaN\b|Invalid Date|\[object Object\]|\{\{|\$\{/;

page.on('console', (m) => {
    if (m.type() !== 'error') return;
    // ⚠ EL FILTRO ES EL COMPARTIDO (`pkg/wizard-browser.ts`), no una copia. Acá había una lista propia
    // y duró exactamente una sesión: no conocía `ws.credito` —el WebSocket de Echo que en local no
    // resuelve— y cuatro líneas suyas tapaban el informe entero, mientras el OTRO caminador ya lo
    // filtraba desde hacía semanas. Dos listas es la forma segura de que una aprenda lo que la otra no.
    //
    // ⚠ Recibe el mensaje COMPLETO: decidir sobre el texto ya recortado hacía que la regla del `nonce`
    // no mordiera nunca, porque el diff de React aparece pasado el carácter 400.
    const complete = m.text().replace(/\s+/g, ' ');
    if (isLocalNoise(complete)) return;
    // 400 y no 160: los avisos de hidratación traen el diff DESPUÉS del encabezado, y cortarlos deja el
    // mensaje genérico sin el dato que sirve («qué atributo, en qué componente»).
    const t = complete.slice(0, 400);
    suspicions.push({ pantalla: currentScreen, que: 'consola', detalle: t });
});

page.on('response', (r) => {
    if (r.status() < 400) return;
    const u = r.url();
    if (/favicon|__manifest|\.map$/.test(u)) return;
    suspicions.push({ pantalla: currentScreen, que: `HTTP ${r.status()}`, detalle: u.replace(/^https?:\/\/[^/]+/, '').slice(0, 110) });
});

const T0 = new Date();
const uReqBase = (await latestUserRequestId(br.hash)) ?? 0;
await page.goto(qrEntryUrl(br.hash), { waitUntil: 'domcontentloaded' });

for (let step = 1; step <= MAX; step++) {
    await page.waitForTimeout(1200);
    const url = new URL(page.url()).pathname;
    route.push(url);

    // ⚠ UNA CAPTURA POR PANTALLA, y no es un lujo. Hasta el 2026-09-17 sólo se guardaba la ÚLTIMA, así
    // que de un recorrido de 14 pantallas se podían mirar 1. F-227 —el «vence hoy» que contradecía a su
    // propio contador— vivió meses justamente porque estaba en la única que se veía; las otras trece
    // nadie las había mirado nunca. Un caminador que no deja mirar sólo prueba que la pantalla CARGA.
    currentScreen = nickname(url);
    await page.screenshot({ path: `${FOLDER}/${String(step).padStart(2, '0')}-${currentScreen}.png`, fullPage: true })
        .catch(() => {});

    // El texto VISIBLE, no el HTML: lo que el HTML trae embebido (payloads, estado del router) no es lo
    // que el cliente lee, y buscarlo ahí da falsos positivos a montones.
    const visibleText = await page.locator('body').innerText().catch(() => '');
    for (const line of visibleText.split('\n')) {
        if (JUNK.test(line)) {
            suspicions.push({ pantalla: currentScreen, que: 'texto', detalle: line.trim().slice(0, 110) });
        }
    }

    // Imágenes que no llegaron: `naturalWidth === 0` ya cargada es el único chequeo fiable — un `src`
    // presente no dice nada. Es lo que delata un `codeImageUrl` apuntando a un bucket vacío (F-174).
    const broken = await page.evaluate(() => Array.from(document.images)
        .filter((i) => i.complete && i.naturalWidth === 0)
        .map((i) => i.currentSrc || i.src)).catch(() => [] as string[]);
    for (const src of broken) {
        suspicions.push({ pantalla: currentScreen, que: 'imagen', detalle: String(src).slice(0, 110) });
    }

    const banner = await page.getByText(/Error al cargar|no pudimos|hubo un problema|intenta de nuevo/i)
        .first().textContent({ timeout: 500 }).catch(() => null);
    console.log(`${String(step).padStart(2, '0')} ${url}${banner ? `   ⛔ ${banner.trim().slice(0, 70)}` : ''}`);
    if (banner) break;
    if (FINAL.test(url)) { console.log('   ✓ pantalla final del recorrido'); break; }

    if (WAIT.test(url)) {
        console.log('   ⏳ pantalla de espera: navega sola');
        await page.waitForURL((u) => !WAIT.test(u.pathname), { timeout: 45_000 })
            .catch(() => console.log('   ⚠ no navegó en 45s'));
        continue;
    }

    const facts = await autofillQr(page, {
        phone: TEL, document: DOC, amount: AMOUNT,
        firstName: 'SYNTH', lastName: 'TEST USER', email: `synth-${DOC}@creditop.com`,
        address: 'Cal 123 # 12-122', income: 2_500_000,
    }).catch(() => [] as string[]);
    if (facts.length) console.log(`   ▸ autorrelleno: ${facts.join(' · ')}`);

    // ⚠ Elegir el botón NO es `.first()` con un filtro de `disabled`: `filter({hasNot: '[disabled]'})`
    // pregunta por un DESCENDIENTE deshabilitado, no por el botón mismo, así que devolvía botones
    // deshabilitados y el click moría por timeout con el nombre ya leído — parecía un muro de la pantalla
    // cuando era el harness eligiendo mal. Se recorren los candidatos y se toma el primero **visible y
    // habilitado** de verdad.
    const cand = page.getByRole('button', { name: ADVANCE });
    const n = await cand.count();
    let chosen = null as null | { i: number; nombre: string };
    for (let i = 0; i < n; i++) {
        const c = cand.nth(i);
        if (!(await c.isVisible().catch(() => false))) continue;
        if (!(await c.isEnabled().catch(() => false))) continue;
        chosen = { i, nombre: (await c.textContent().catch(() => '')) ?? '' };
        break;
    }
    if (!chosen) {
        const names = await cand.allTextContents().catch(() => []);
        console.log(`   ⚠ sin botón habilitado para avanzar — se detiene acá${names.length ? ` (candidatos: ${names.map((x) => x.trim()).join(' · ')})` : ''}`);
        break;
    }
    console.log(`   ↳ click «${chosen.nombre.trim().slice(0, 40)}»`);
    await cand.nth(chosen.i).click({ timeout: 4000 })
        .catch((e) => console.log(`   ⚠ no pudo clickear: ${String(e).split('\n')[0].slice(0, 90)}`));
}

const shot = `.runs/caminar-${PRODUCT}.png`;
await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
console.log(`\n${route.length} pantalla(s) · última: ${route.at(-1)} · 📸 ${shot}`);
console.log(`   una captura por pantalla en ${FOLDER}/ — miralas, no alcanza con que hayan cargado`);

if (suspicions.length) {
    console.log(`\n  ── REVISIÓN · ${suspicions.length} cosa(s) con pinta de estar rotas ──`);
    console.log('     (descriptivo, no veredicto: andá a mirar esas capturas)');
    const byScreen = new Map<string, Suspicion[]>();
    for (const s of suspicions) byScreen.set(s.pantalla, [...(byScreen.get(s.pantalla) ?? []), s]);
    for (const [screen, list] of byScreen) {
        console.log(`\n     ${screen}`);
        // Deduplicado: un error de consola que se repite en cada render es UN problema, no veinte.
        const vistas = new Set<string>();
        for (const s of list) {
            const key = `${s.que}|${s.detalle}`;
            if (vistas.has(key)) continue;
            vistas.add(key);
            const repeats = list.filter((x) => `${x.que}|${x.detalle}` === key).length;
            console.log(`       ${s.que.padEnd(9)} ${s.detalle}${repeats > 1 ? `  ×${repeats}` : ''}`);
        }
    }
} else {
    console.log('  ✓ revisión: ninguna pantalla mostró basura, imágenes rotas ni errores de consola');
}
if (errorsList.length) console.log(`⚠ ${errorsList.length} error(es) de página:\n   ${[...new Set(errorsList)].join('\n   ')}`);

// LA TERCERA FUENTE, como pista y no como consulta. Este caminador usa navegador de verdad, así que
// contra un front DESPLEGADO deja en PostHog más rastro que ningún otro runner: los eventos del
// servidor, los del cliente (`$pageview`, autocapture) y la grabación de sesión. Acá no se consulta
// —la ingesta tarda minutos y esta herramienta es de a un caso— pero sí se imprime el comando con la
// solicitud y la hora ya puestas, que es lo que costaba armar a mano.
// ⚠ En LOCAL no hay nada que mirar: `APP_ENV=local` apaga el cliente de PostHog en el front.
const runUReq = await latestUserRequestId(br.hash, uReqBase).catch(() => null);
const noPostHog = whyNot(posthogConfig());
if (noPostHog) {
    console.log(`\nPostHog: nada que mirar — ${noPostHog}`);
} else if (runUReq) {
    console.log(`\nPostHog · qué registró el FRONT de esta corrida (eventos del embudo + logs con pantalla y error):`
        + `\n   make harness-posthog UREQ=${runUReq} DESDE=${new Date(T0.getTime() - 60_000).toISOString()}`);
} else {
    console.log('\nPostHog: el canal no creó una solicitud nueva en esta sucursal, así que no hay por dónde preguntar.');
}

await browser.close();
// SE DEJA EL MOCK COMO ESTABA. Un mock con estado pegado es un falso negativo esperando.
//
// ⚠ Antes acá había una lista a mano —`producto`, `errorCode`, `errorEn`— y se quedó vieja: no incluía
// `hasQuota`, así que una corrida con `--escenario '{"hasQuota":false}'` dejaba al mock SIN CUPO y la
// siguiente moría en `no-preapproved` a los 3 pasos. Medido el 2026-09-17, y se lee como «BNPL perdió el
// cupo», que manda a depurar el producto en vez del harness.
//
// Por eso ahora se restaura la FOTO completa: una perilla nueva queda cubierta sola, sin que nadie se
// acuerde de agregarla acá. Si la foto falló, se cae a los valores por defecto, que es mejor que nada.
await scenario(originalScenario ?? { producto: 'ambos', errorCode: null, errorEn: null, hasQuota: true });
await close();
