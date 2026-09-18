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
import { mkdirSync } from 'node:fs';
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

/** El escenario tal como estaba ANTES de que esta corrida lo tocara, para poder devolverlo entero. */
let escenarioOriginal: Record<string, unknown> | null = null;

const fotografiarEscenario = async () => {
    escenarioOriginal = await fetch(`${MOCK}/`)
        .then((x) => x.json()).then((j) => j.escenario ?? null).catch(() => null);
};

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

await fotografiarEscenario();
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
/** Un nombre de archivo legible a partir de la ruta: `/bancolombia/consumo/loan-summary/X` → `loan-summary`. */
const mote = (ruta: string) =>
    (ruta.split('/').filter((t) => t && !/^[A-Z0-9]{8,}$/.test(t)).pop() ?? 'pantalla')
        .replace(/[^a-zA-Z0-9-]/g, '-').slice(0, 40) || 'pantalla';

const CARPETA = `.runs/caminar-${PRODUCTO}`;
mkdirSync(CARPETA, { recursive: true });

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
type Sospecha = { pantalla: string; que: string; detalle: string };
const sospechas: Sospecha[] = [];
let pantallaActual = '(arranque)';

// La basura que delata un render roto. NO se incluye «null» a secas: aparece dentro de payloads
// legítimos embebidos en el HTML y ahogaría la señal con falsos positivos.
const BASURA = /\bundefined\b|\bNaN\b|Invalid Date|\[object Object\]|\{\{|\$\{/;

page.on('console', (m) => {
    if (m.type() !== 'error') return;
    // ⚠ SE FILTRA SOBRE EL MENSAJE COMPLETO Y SE RECORTA DESPUÉS, no al revés. Recortar primero hacía
    // que el filtro del `nonce` no mordiera nunca —el diff de React aparece pasado el carácter 400—, y
    // un filtro que no filtra no falla: deja pasar el ruido y parece que la regla no sirve.
    const completo = m.text().replace(/\s+/g, ' ');
    // El ruido conocido de local no cuenta: no es del producto y taparía lo que sí importa.
    if (/favicon|DevTools|React Router.*devtools|Download the React/i.test(completo)) return;
    // ⚠ EL MISMATCH DE HIDRATACIÓN DEL `nonce` ES RUIDO DE LOCAL, y sólo de local — medido el
    // 2026-09-18, y averiguarlo costó un rato, así que queda escrito con su porqué:
    //   · `applySecurityHeaders` hace `if (!import.meta.env.PROD) return`, o sea que `react-router dev`
    //     NO manda ninguna cabecera CSP;
    //   · el navegador sólo vacía el atributo `nonce` del DOM cuando hay una CSP entregada POR CABECERA
    //     (Report-Only incluida), así que en local no lo vacía;
    //   · y el cliente renderiza `nonce=""` porque `useNonce()` no tiene proveedor fuera del servidor.
    // Desplegado no pasa. ⚠ El filtro pide `nonce` A PROPÓSITO: un mismatch de hidratación de CUALQUIER
    // otro atributo sí tiene que verse — es la trampa nº1 de este canal (el form que nunca se habilita).
    if (/hydrated/i.test(completo) && /nonce/.test(completo)) return;

    // 400 y no 160: los avisos de hidratación traen el diff DESPUÉS del encabezado, y cortarlos deja el
    // mensaje genérico sin el dato que sirve («qué atributo, en qué componente»).
    const t = completo.slice(0, 400);
    sospechas.push({ pantalla: pantallaActual, que: 'consola', detalle: t });
});

page.on('response', (r) => {
    if (r.status() < 400) return;
    const u = r.url();
    if (/favicon|__manifest|\.map$/.test(u)) return;
    sospechas.push({ pantalla: pantallaActual, que: `HTTP ${r.status()}`, detalle: u.replace(/^https?:\/\/[^/]+/, '').slice(0, 110) });
});

const T0 = new Date();
const uReqBase = (await latestUserRequestId(suc.hash)) ?? 0;
await page.goto(qrEntryUrl(suc.hash), { waitUntil: 'domcontentloaded' });

for (let paso = 1; paso <= MAX; paso++) {
    await page.waitForTimeout(1200);
    const url = new URL(page.url()).pathname;
    recorrido.push(url);

    // ⚠ UNA CAPTURA POR PANTALLA, y no es un lujo. Hasta el 2026-09-17 sólo se guardaba la ÚLTIMA, así
    // que de un recorrido de 14 pantallas se podían mirar 1. F-227 —el «vence hoy» que contradecía a su
    // propio contador— vivió meses justamente porque estaba en la única que se veía; las otras trece
    // nadie las había mirado nunca. Un caminador que no deja mirar sólo prueba que la pantalla CARGA.
    pantallaActual = mote(url);
    await page.screenshot({ path: `${CARPETA}/${String(paso).padStart(2, '0')}-${pantallaActual}.png`, fullPage: true })
        .catch(() => {});

    // El texto VISIBLE, no el HTML: lo que el HTML trae embebido (payloads, estado del router) no es lo
    // que el cliente lee, y buscarlo ahí da falsos positivos a montones.
    const textoVisible = await page.locator('body').innerText().catch(() => '');
    for (const linea of textoVisible.split('\n')) {
        if (BASURA.test(linea)) {
            sospechas.push({ pantalla: pantallaActual, que: 'texto', detalle: linea.trim().slice(0, 110) });
        }
    }

    // Imágenes que no llegaron: `naturalWidth === 0` ya cargada es el único chequeo fiable — un `src`
    // presente no dice nada. Es lo que delata un `codeImageUrl` apuntando a un bucket vacío (F-174).
    const rotas = await page.evaluate(() => Array.from(document.images)
        .filter((i) => i.complete && i.naturalWidth === 0)
        .map((i) => i.currentSrc || i.src)).catch(() => [] as string[]);
    for (const src of rotas) {
        sospechas.push({ pantalla: pantallaActual, que: 'imagen', detalle: String(src).slice(0, 110) });
    }

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
console.log(`   una captura por pantalla en ${CARPETA}/ — miralas, no alcanza con que hayan cargado`);

if (sospechas.length) {
    console.log(`\n  ── REVISIÓN · ${sospechas.length} cosa(s) con pinta de estar rotas ──`);
    console.log('     (descriptivo, no veredicto: andá a mirar esas capturas)');
    const porPantalla = new Map<string, Sospecha[]>();
    for (const s of sospechas) porPantalla.set(s.pantalla, [...(porPantalla.get(s.pantalla) ?? []), s]);
    for (const [pantalla, lista] of porPantalla) {
        console.log(`\n     ${pantalla}`);
        // Deduplicado: un error de consola que se repite en cada render es UN problema, no veinte.
        const vistas = new Set<string>();
        for (const s of lista) {
            const clave = `${s.que}|${s.detalle}`;
            if (vistas.has(clave)) continue;
            vistas.add(clave);
            const repes = lista.filter((x) => `${x.que}|${x.detalle}` === clave).length;
            console.log(`       ${s.que.padEnd(9)} ${s.detalle}${repes > 1 ? `  ×${repes}` : ''}`);
        }
    }
} else {
    console.log('  ✓ revisión: ninguna pantalla mostró basura, imágenes rotas ni errores de consola');
}
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
// SE DEJA EL MOCK COMO ESTABA. Un mock con estado pegado es un falso negativo esperando.
//
// ⚠ Antes acá había una lista a mano —`producto`, `errorCode`, `errorEn`— y se quedó vieja: no incluía
// `hasQuota`, así que una corrida con `--escenario '{"hasQuota":false}'` dejaba al mock SIN CUPO y la
// siguiente moría en `no-preapproved` a los 3 pasos. Medido el 2026-09-17, y se lee como «BNPL perdió el
// cupo», que manda a depurar el producto en vez del harness.
//
// Por eso ahora se restaura la FOTO completa: una perilla nueva queda cubierta sola, sin que nadie se
// acuerde de agregarla acá. Si la foto falló, se cae a los valores por defecto, que es mejor que nada.
await escenario(escenarioOriginal ?? { producto: 'ambos', errorCode: null, errorEn: null, hasQuota: true });
await close();
