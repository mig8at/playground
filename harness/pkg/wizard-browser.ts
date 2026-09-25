// wizard-browser.ts — operar el wizard con NAVEGADOR, pantalla por pantalla, sin ventana.
//
// Es el segundo motor del caminador (`dev/walk-wizard.ts --motor navegador`). El primero habla el
// protocolo del front por HTTP y corre todo el lado servidor; éste abre Chromium sin ventana y clickea,
// así que además corre **el JavaScript del cliente**: hidratación, estado de React, validaciones del
// componente, máscaras de input. Ahí viven los bugs que el otro motor no puede ver (F-88: el runner por
// consola en verde con el visual roto).
//
// NO HAY UN SELECTOR POR PANTALLA, y es a propósito. Las pantallas del cierre del wizard
// —confirmación, fecha de pago, plan, firma, OTP— **no tienen `data-testid`**: verificado el 2026-09-03
// contra la rama de qa. Así que la estrategia es la que ya probó el caminador del canal QR en nueve
// pantallas: llenar todo lo que se reconozca y clickear el primer botón de avance habilitado. Eso lo
// hace `pkg/autofill-qr.ts`, compartido por los dos caminadores.
//
// Lo único que SÍ necesita puntería es elegir una entidad concreta del listado, porque ahí el caminador
// no puede tomar «la primera»: el caso pide una. Se resuelve por el NOMBRE de la entidad, que se lee de
// la base — el listado lo muestra y es lo único estable sin testids.
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { autofill, clickAdvance, validationErrors, readToEnd, type Field } from './autofill-qr.ts';
import { installWompiWidget } from './wompi-widget.ts';

export type WizardData = {
    tel: string; doc: string; amount: number; income: number;
    nombre?: string; apellido?: string; email?: string; direccion?: string;
    /** La cuota inicial que pide el caso (`--cuota-inicial`). Sin ella se cae al 20 % — ver el campo. */
    cuotaInicial?: number;
};

/** El mapa de campos del wizard. Lo específico del canal; el motor de llenado es compartido.
 *  Los `tecleado: true` son los inputs con máscara: `fill()` salta el transformer y pierde caracteres
 *  (la convención está documentada en `pkg/wizard-steps.ts`, que usa el mismo criterio). */
export const WIZARD_FIELDS = (d: WizardData, sheet = ''): Field[] => [
    { testId: 'amount-input', label: /monto|cu[aá]nto/i, valor: String(d.amount), tecleado: true },
    { testId: 'phone-input', label: /celular|tel[eé]fono/i, name: 'phoneNumber', valor: d.tel },
    // ⚠ SON DOS OTP DISTINTOS Y NO SE PARECEN EN NADA SALVO EL NOMBRE DEL CAMPO. El del onboarding son
    // los ÚLTIMOS 4 del teléfono; el de la FIRMA del pagaré son los últimos 6 (`case.ts` usa el mismo
    // criterio en su cierre). Con 4 dígitos en la pantalla de firma el campo se llena, no da error, y el
    // botón simplemente nunca se habilita: se lee como «pantalla trabada» (2026-09-03).
    { testId: 'otp-input', name: 'otp', valor: sheet === 'otp-validation' ? d.tel.slice(-6) : d.tel.slice(-4) },
    /* ⚠ El documento NO se llama igual en todos lados: Colombia dice «Número de documento» y el funnel
     * dinámico de RD dice «Número de identidad». Con el patrón atado a «documento», el recorrido de
     * CeluRD moría en `request-personal-info` repitiendo «Ingresa tu número de identidad para
     * continuar» — un mensaje del producto para un hueco del harness. Medido el 2026-09-18. */
    { testId: 'docnum-input', label: /n[uú]mero de (documento|identidad)|c[eé]dula/i, name: 'documentNumber', valor: d.doc, tecleado: true },
    { testId: 'name-input', label: /^nombre/i, name: 'name', valor: d.nombre ?? 'CARLOS' },
    { testId: 'surname-input', label: /apellido/i, name: 'surname', valor: d.apellido ?? 'RUIZ' },
    { testId: 'email-input', label: /correo|email/i, name: 'email', valor: d.email ?? `qa${d.doc}@gmail.com` },
    { label: /direcci[oó]n/i, name: 'address', valor: d.direccion ?? 'Calle 1 # 2-3' },
    { testId: 'monthly-income-input', label: /ingreso/i, name: 'monthlyIncome', valor: String(d.income), tecleado: true },
    /* La CUOTA INICIAL del formulario del vehículo (BCP). Va un 20 % del valor — el runner por HTTP usa
     * 10.000 absolutos sobre 60.000, que es del mismo orden; acá tiene que escalar porque el caminador
     * corre con el monto que le pidan.
     *
     * ⚠ NO se llena «Monto a financiar» a propósito: `bcp-return.ts` anota que ese campo lo calcula el
     * JAVASCRIPT DEL CUSTOMER, que es justo lo que el camino HTTP no puede ver. Dejarlo vacío convierte
     * al caminador en la prueba de si de verdad se autocalcula — llenarlo a mano taparía la respuesta. */
    /* ⚠ EL 20 % ES UN RESPALDO, NO LA REGLA — y cuando el caso pide un valor, MANDA EL CASO.
     * `--cuota-inicial` existía y este motor la ignoraba en silencio: la bandera sólo alimentaba el
     * payload que arma el camino HTTP, así que con navegador se tecleaba igual el 20 % pasara lo que
     * pasara. Medido el 2026-09-18 contra Motai C (168): sobre $2.000.000 la entidad exige **36 %**, el
     * caminador escribía $400.000 y la pantalla repetía «La cuota inicial mínima es $ 720.000» hasta
     * agotar los intentos — con `CUOTA=720000` puesto en la línea de comandos. Una perilla documentada
     * que no mueve nada es peor que no tenerla: manda a buscar el problema en el producto.
     * El respaldo se queda porque el vehicular de BCP no declara mínimo y ahí cualquier valor sirve. */
    { label: /cuota inicial/i, name: 'down_payment', valor: String(d.cuotaInicial ?? Math.round(d.amount * 0.2)), tecleado: true },
    /* Los dos campos del SEGUNDO formulario del vehículo de BCP (`bcp-vehiculo-paso-2`), el que va
     * DESPUÉS del gate manual. Su esquema los declara `text` sin regex y con `minLength: 1`, así que
     * cualquier cadena sirve; se les da igual la FORMA de un chasis y un motor de verdad —17 caracteres
     * el primero— porque una captura con «CARLOS RUIZ» en el número de chasis no se puede mirar y
     * decir si la pantalla está bien. Derivados del documento: distintos por caso y reproducibles. */
    { label: /n[uú]mero de chasis/i, name: 'chassis_number', valor: `9BWZZZ377VT${d.doc.slice(-6)}`, tecleado: true },
    { label: /n[uú]mero de motor/i, name: 'engine_number', valor: `ABC${d.doc.slice(-9)}`, tecleado: true },
];

/** Un navegador para toda la tanda; UN CONTEXTO POR CASO.
 *  El contexto es el perfil aislado (cookies, storage), o sea «un cliente distinto», y cuesta ~50-100 MB
 *  contra los cientos de un navegador entero: es lo que hace viable correr varios a la vez. */
export async function openBrowser(opts: { headed?: boolean } = {}): Promise<Browser> {
    return chromium.launch({ headless: !opts.headed });
}

const UA_MOBILE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 '
    + '(KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1';

/** Lo que el navegador vio y un log de consola no cuenta: los errores del cliente y las llamadas que
 *  fallaron. Se recolecta SIEMPRE (cuesta nada) y se imprime sólo si el caso sale mal. */
export type Evidence = { consola: string[]; red: string[] };

/**
 * ¿Es ruido conocido del ambiente LOCAL, y por lo tanto no es evidencia de nada?
 *
 * Vive acá y se exporta porque **la usan los dos caminadores con navegador** (éste y `walk-qr.ts`).
 * Tener dos listas era la forma segura de que una aprendiera algo que la otra no: pasó: la del canal QR
 * no conocía `ws.credito` y tapaba su informe con cuatro líneas de WebSocket.
 *
 * ⚠ Recibe el mensaje COMPLETO, nunca uno recortado — ver el comentario del handler de consola.
 *
 * ⚠ Y la hidratación va ACOTADA AL `nonce`, no entera. Antes el patrón era `hydrat` a secas y se comía
 * TODOS los avisos de hidratación, que es justo el modo de falla nº1 de este canal: si el DOM del
 * servidor y el del cliente no coinciden, react-hook-form monta con sus defaults, el formulario queda
 * inválido y **el botón nunca se habilita, sin un solo mensaje de error**. Lo único que de verdad es
 * ruido es el `nonce`, y está medido por qué (2026-09-18): `applySecurityHeaders` hace
 * `if (!import.meta.env.PROD) return`, así que `react-router dev` no manda cabecera CSP; el navegador
 * sólo vacía el atributo `nonce` cuando hay una CSP entregada por cabecera; y el cliente renderiza
 * `nonce=""` porque `useNonce()` no tiene proveedor fuera del servidor. Desplegado no pasa.
 */
/**
 * Bloquea las herramientas de DEPURACIÓN que el front carga sólo en dev.
 *
 * ⚠ NO ES COSMÉTICO: `react-scan` monta un `<div id="react-scan-root">` que cubre el viewport y
 * **INTERCEPTA LOS CLICKS**. Medido el 2026-09-18 en `entidad/simulador` con viewport de 420×900: el
 * botón estaba visible, habilitado y estable, y Playwright reintentó 15 veces hasta el timeout con
 * «<div id="react-scan-root"></div> intercepts pointer events». A ancho de escritorio el mismo click
 * funcionaba, así que parecía un defecto de MÓVIL del producto — y no lo era.
 *
 * Y el argumento de fondo: `entry.client.tsx` lo inyecta bajo `import.meta.env.DEV`, o sea que **en
 * producción ese script no existe**. Caminar con él cargado es probar una pantalla que ningún cliente
 * ve. Bloquearlo no es hacerle trampa al test: es acercarlo a lo real.
 */
/**
 * Lo que el caminador aborta A PROPÓSITO. Una sola definición para las dos cosas que la usan —el
 * bloqueo y el filtro del informe de red—, porque tenerla escrita dos veces es exactamente como
 * empiezan a derivar: se agrega una herramienta al bloqueo y su aborto reaparece como «falla».
 */
const DEV_TOOLS = /react-scan|react-grab/;

export async function blockDevTools(page: Page): Promise<void> {
    await page.route(DEV_TOOLS, (path) => path.abort()).catch(() => {});
}

export function isLocalNoise(fullMessage: string): boolean {
    if (/hydrat/i.test(fullMessage)) return /nonce/.test(fullMessage);
    return /React DevTools|PostHog|Lit is in dev|react-scan|react-grab|Download the React|Select is changing|ws\.credito|WebSocket connection|ERR_NAME_NOT_RESOLVED|ERR_FAILED|favicon/i
        .test(fullMessage);
}

/**
 * Las líneas que se imprimen cuando un caso **cerró bien pero el navegador registró errores**.
 *
 * Existe como función aparte —y pura— porque es la rama más difícil de alcanzar corriendo: hace falta un
 * caso que cierre Y que además haya ensuciado la consola, y en local los casos que ensucian suelen ser
 * justo los que no cierran. Sin esta costura la rama quedaba escrita y sin ejercitar, que es como se
 * cuelan los errores que nadie ve hasta que importan.
 *
 * Devuelve `[]` cuando no hay nada que decir, así el caso feliz no imprime ruido.
 */
export function evidenceNotice(consoleOut: string[], red: string[], maximum = 3): string[] {
    if (!consoleOut.length && !red.length) return [];

    const account = [
        consoleOut.length ? `${consoleOut.length} de consola` : '',
        red.length ? `${red.length} de red` : '',
    ].filter(Boolean).join(' y ');

    // ⚠ NO dice «falló» ni cambia el veredicto: el caso cerró. Es una invitación a mirar, no un
    // resultado — si fuera un volcado entero en cada caso feliz, la tanda se volvería ilegible y se
    // aprendería a saltearlo, que es exactamente como muere una señal.
    return [
        `⚠ cerró, pero el navegador registró ${account} — no cambia el veredicto, pero mirá:`,
        ...[...consoleOut, ...red].slice(0, maximum).map((l) => `   ${l}`),
    ];
}

export async function openContext(browser: Browser, baseURL: string, opts: { traza?: string; storageState?: string } = {})
: Promise<{ ctx: BrowserContext; page: Page; evidencia: Evidence }> {
    const ctx = await browser.newContext({
        baseURL, userAgent: UA_MOBILE, viewport: { width: 420, height: 900 },
        ...(opts.storageState ? { storageState: opts.storageState } : {}),
    });
    // La TRAZA de Playwright: DOM por acción, red y consola, en un zip que se abre con
    // `npx playwright show-trace`. Es la evidencia que un log no puede dar, y se guarda SÓLO si el caso
    // falla (quien llama decide en `closeContext`).
    if (opts.traza) await ctx.tracing.start({ screenshots: true, snapshots: true, sources: false }).catch(() => {});
    // La cuota inicial: el widget de Wompi simulado, que acá paga solo (`pkg/wompi-widget.ts`). Sin esto la
    // compra con cuota inicial se quedaba en `/down-payment`, frente al checkout real de Wompi.
    await installWompiWidget(ctx, { auto: true });
    const page = await ctx.newPage();
    await blockDevTools(page);

    // ⚠ ESTO FALTABA Y SE NOTÓ EN LA PRIMERA CORRIDA REAL (2026-09-03): el caminador reportó «Error al
    // cargar los documentos» —un muro que el motor HTTP no ve— y no pudo decir POR QUÉ, porque no
    // miraba ni la consola ni la red. Un caminador con navegador que no recoge las dos cosas tira a la
    // basura la mitad de lo que el navegador sabe.
    // Se DEDUPLICA con contador: el mismo error repetido cuatro veces gasta el cupo y tapa el que
    // aparece una sola vez, que suele ser el importante (así casi se perdió el «No routes matched»).
    const evidence: Evidence = { consola: [], red: [] };
    const seen = new Map<string, number>();
    const annotate = (where: 'consola' | 'red', line: string) => {
        const n = (seen.get(line) ?? 0) + 1;
        seen.set(line, n);
        if (n === 1) evidence[where].push(line);
        else {
            const i = evidence[where].findIndex((l) => l.startsWith(line));
            if (i >= 0) evidence[where][i] = `${line}   ×${n}`;
        }
    };
    page.on('console', (m) => {
        if (m.type() !== 'error' && m.type() !== 'warning') return;
        // ⚠ SE DECIDE SOBRE EL TEXTO COMPLETO Y SE RECORTA DESPUÉS. Antes se recortaba a 220 y se
        // filtraba sobre eso: funcionaba de casualidad porque los patrones caían al principio, pero
        // cualquier regla que mire más adentro del mensaje —como la del `nonce`, que aparece en el diff
        // de React pasado el carácter 400— no mordería nunca. Y un filtro que no filtra no falla: deja
        // pasar el ruido y parece que la regla no sirve.
        const complete = m.text();
        if (isLocalNoise(complete)) return;
        // ⚠ 600 Y NO 220. Los errores de React que MÁS sirven —«cannot contain a nested», los avisos de
        // hidratación— ponen la pila de componentes DESPUÉS del encabezado, así que 220 daba el título y
        // se comía el único dato que ubica el problema. Medido el 2026-09-18: un `<button>` anidado en la
        // tarjeta de entidad se pudo ver pero no localizar. No hay riesgo de volumen: esto deduplica con
        // contador y corta a 40 entradas.
        if (evidence.consola.length < 40) annotate('consola', `${m.type()}: ${complete.slice(0, 600)}`);
    });
    page.on('pageerror', (e) => {
        if (evidence.consola.length < 40) annotate('consola', `pageerror: ${String(e.message).slice(0, 220)}`);
    });
    page.on('requestfailed', (r) => {
        // ⚠ LO QUE ABORTAMOS NOSOTROS NO ES UNA FALLA, y reportarlo cuesta caro: el informe de la
        // corrida del 2026-09-18 encabezaba «llamadas que FALLARON» con
        // `falló GET /react-scan/dist/auto.global.js — net::ERR_FAILED`, que es el bloqueo del arreglo
        // de F-233 haciendo su trabajo. Un caminador que denuncia su propia decisión como un fallo del
        // producto gasta la atención justo donde se mira primero.
        if (DEV_TOOLS.test(r.url())) return;
        if (evidence.red.length < 40) annotate('red', `falló ${r.method()} ${shorten(r.url())} — ${r.failure()?.errorText ?? '?'}`);
    });
    page.on('response', (r) => {
        if (r.status() < 400) return;
        if (evidence.red.length < 40) annotate('red', `HTTP ${r.status()} ${r.request().method()} ${shorten(r.url())}`);
    });
    return { ctx, page, evidencia: evidence };
}

const shorten = (u: string) => { try { const x = new URL(u); return x.pathname.slice(0, 90) + (x.search ? '?…' : ''); } catch { return u.slice(0, 90); } };

/** Cierra el contexto y, sólo si el caso salió mal, deja la traza en disco. */
export async function closeContext(ctx: BrowserContext, saveTo: string | null): Promise<void> {
    if (saveTo) await ctx.tracing.stop({ path: saveTo }).catch(() => {});
    else await ctx.tracing.stop().catch(() => {});
    await ctx.close().catch(() => {});
}

/** Un banner de error a la vista. Es el muro que el motor HTTP no ve: el front puede responder 200 y
 *  pintar «Error al cargar la información» (F-88). */
export async function errorBanner(page: Page): Promise<string | null> {
    const t = await page.getByText(/Error al cargar|no pudimos|hubo un problema|intenta de nuevo|algo sali[oó] mal/i)
        .first().textContent({ timeout: 400 }).catch(() => null);
    return t ? t.trim().slice(0, 90) : null;
}

/**
 * Elige una entidad del listado por su NOMBRE (el caso pide una concreta, no «la primera»).
 * Devuelve lo que encontró: la lista de nombres visibles sirve para reportar por qué no estaba.
 */
/** ¿El botón se puede clickear de verdad? `isVisible` no alcanza: una tarjeta CERRADA deja su botón en
 *  el DOM, con tamaño, recortado por el `overflow-hidden` de la tarjeta — Playwright lo da por visible y
 *  el click se queda 15 s esperando porque «la tarjeta intercepta el puntero». Se mira qué elemento hay
 *  en el centro del botón: si no es él, no está a la vista. */
async function reachable(btn: ReturnType<Page['getByRole']>): Promise<boolean> {
    // Al CENTRO de la pantalla y no «a la vista»: en el front local la barra flotante de desarrollo
    // («120 FPS», abajo a la derecha) tapa justo el borde inferior, donde `scrollIntoViewIfNeeded` deja
    // el botón. Medido el 2026-09-25 con «Validar Pre aprobado» de Creditop X.
    await btn.evaluate((b) => b.scrollIntoView({ block: 'center' })).catch(() => {});
    return btn.evaluate((b) => {
        const r = b.getBoundingClientRect();
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return !!top && (top === b || b.contains(top));
    }).catch(() => false);
}

/** El botón que ELIGE la entidad dentro de su tarjeta desplegada: el más cercano por debajo del
 *  encabezado. Por posición y no por el DOM, porque la tarjeta no tiene un contenedor con nombre. */
const CARD_CTA = /validar pre ?aprobado|activar mi cr[eé]dito|continuar|solicitar|elegir|seleccionar/i;
async function ctaInCard(page: Page, header: ReturnType<Page['getByRole']>) {
    const cands = page.getByRole('button', { name: CARD_CTA });
    const n = await cands.count().catch(() => 0);
    let best: ReturnType<Page['getByRole']> | null = null;
    let bestDy = Infinity;
    for (let i = 0; i < n; i++) {
        const c = cands.nth(i);
        if (!(await c.isVisible().catch(() => false)) || !(await c.isEnabled().catch(() => false))) continue;
        if (!(await reachable(c))) continue;
        // El encabezado se mide DESPUÉS de `reachable`, que mueve la página: medido antes, la distancia
        // comparaba dos coordenadas de pantallas distintas y el botón de la tarjeta quedaba descartado.
        const hb = await header.boundingBox().catch(() => null);
        const box = await c.boundingBox().catch(() => null);
        if (!hb || !box) continue;
        const dy = box.y - (hb.y + hb.height);
        // Hasta 600 px: lo que mide una tarjeta abierta con su aviso de cuota inicial. Más lejos ya es
        // otra tarjeta.
        if (dy >= 0 && dy <= 600 && dy < bestDy) { best = c; bestDy = dy; }
    }
    return best;
}

export async function chooseEntity(page: Page, name: string): Promise<{ ok: boolean; visibles: string[]; motivo?: string }> {
    // El listado se arma con las tarjetas ya resueltas: se espera a que aparezca alguna antes de mirar.
    await page.getByRole('button', { name: /continuar|solicitar|elegir|seleccionar/i }).first()
        .waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {});
    const buttons = page.getByRole('button');
    const n = await buttons.count().catch(() => 0);
    const visibles: string[] = [];
    for (let i = 0; i < n; i++) {
        const b = buttons.nth(i);
        if (!(await b.isVisible().catch(() => false))) continue;
        const txt = ((await b.textContent().catch(() => '')) ?? '').replace(/\s+/g, ' ').trim();
        if (txt) visibles.push(txt.slice(0, 40));
        if (txt.toLowerCase().includes(name.toLowerCase()) && (await b.isEnabled().catch(() => false))) {
            /* ⚠ UNA TARJETA QUE SE DESPLIEGA: el botón con el nombre sólo la ABRE, y el que elige la
             * entidad es otro botón, debajo, adentro de la tarjeta («Validar Pre aprobado», «Activar mi
             * crédito»). Clickear sólo el encabezado decía «elegí X» sin elegir nada, y la vuelta siguiente
             * la cerraba: cinco intentos y «la pantalla no avanza». Medido el 2026-09-25 con Compucredit,
             * Creditop X y Credifamilia por la tienda.
             * Se decide por lo que SE VE y no por `aria-expanded`, que esta tarjeta no tiene: si ya hay un
             * botón de elegir pegado debajo, está abierta y no se vuelve a clickear (la cerraría). */
            let cta = await ctaInCard(page, b);
            if (!cta) {
                const before = page.url();
                await b.click({ timeout: 15_000 }).catch(() => {});
                await page.waitForTimeout(700);   // la animación de apertura
                if (page.url() !== before) return { ok: true, visibles };   // la tarjeta misma navegó
                cta = await ctaInCard(page, b);
            }
            if (cta) {
                // Que el click falle NO puede quedar en silencio (ver `clickAdvance`): se devuelve el motivo.
                const failure = await cta.click({ timeout: 15_000 }).then(() => null)
                    .catch((e) => String(e?.message ?? e).replace(/\s+/g, ' ').slice(0, 300));
                if (failure) return { ok: true, visibles, motivo: `el click sobre el botón de la tarjeta falló: ${failure}` };
            }
            return { ok: true, visibles };
        }
    }
    // La tarjeta puede no ser un `button`: se prueba por texto y se clickea su botón de avance.
    const card = page.getByText(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')).first();
    if (await card.count().catch(() => 0)) {
        await card.click({ timeout: 5_000 }).catch(() => {});
        const av = await clickAdvance(page);
        if (av.ok) return { ok: true, visibles };
    }
    return { ok: false, visibles };
}

/** Llena lo que haya y clickea para avanzar. Devuelve qué llenó y qué botón apretó.
 *
 *  ⚠ REINTENTA UNA VEZ si no hay botón habilitado, y no es por las dudas: mientras el formulario se
 *  está enviando el botón queda deshabilitado, así que un caminador que mira una sola vez concluye
 *  «sin botón para avanzar» sobre una pantalla que está funcionando. Y si tras el reintento sigue sin
 *  haberlo, devuelve los MENSAJES DE VALIDACIÓN, que es lo que dice qué campo falta. */
export async function advance(page: Page, d: WizardData, sheet = ''): Promise<{ ok: boolean; hechos: string[]; boton?: string; candidatos?: string[]; errores?: string[]; motivo?: string }> {
    // `preferirRadio: /^no$/i` — la pregunta de «confirmación de cupo» se contesta NO, que es el flujo
    // estándar y lo mismo que manda el motor HTTP (`confirmQuota: 'no'`). Contestar «Sí» sería probar otro
    // flujo sin haberlo pedido: firma `already-confirmed-pre-approval`, salta el buró y recorta el listado.
    const facts = await autofill(page, WIZARD_FIELDS(d, sheet), { preferirRadio: /^no$/i }).catch(() => [] as string[]);
    let av = await clickAdvance(page);
    if (!av.ok) {
        // Antes de darlo por trabado: puede estar enviando (botón deshabilitado un instante) o puede
        // haber un modal que exige LEER hasta el final para habilitar el botón — el caso de la firma.
        await page.waitForTimeout(2_500);
        const readOnes = await readToEnd(page);
        if (readOnes) { facts.push(`leí ${readOnes} documento(s) hasta el final`); await page.waitForTimeout(600); }
        av = await clickAdvance(page);
    }
    if (av.ok) return { ok: true, hechos: facts, boton: av.nombre };
    return { ok: false, hechos: facts, candidatos: av.candidatos, motivo: av.motivo, errores: await validationErrors(page).catch(() => []) };
}

/** Espera a que la pantalla cambie después de un click. Devuelve la URL nueva, o null si no se movió
 *  (que es legítimo: varias pantallas del wizard tienen PASOS INTERNOS con la misma URL). */
export async function waitForChange(page: Page, since: string, timeout = 25_000): Promise<string | null> {
    const ok = await page.waitForURL((u) => u.href !== since, { timeout }).then(() => true).catch(() => false);
    return ok ? page.url() : null;
}
