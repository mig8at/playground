// wizard-navegador.ts — operar el wizard con NAVEGADOR, pantalla por pantalla, sin ventana.
//
// Es el segundo motor del caminador (`dev/caminar-wizard.ts --motor navegador`). El primero habla el
// protocolo del front por HTTP y corre todo el lado servidor; éste abre Chromium sin ventana y clickea,
// así que además corre **el JavaScript del cliente**: hidratación, estado de React, validaciones del
// componente, máscaras de input. Ahí viven los bugs que el otro motor no puede ver (F-88: el runner por
// consola en verde con el visual roto).
//
// NO HAY UN SELECTOR POR PANTALLA, y es a propósito. Las pantallas del cierre del wizard
// —confirmación, fecha de pago, plan, firma, OTP— **no tienen `data-testid`**: verificado el 2026-09-03
// contra la rama de qa. Así que la estrategia es la que ya probó el caminador del canal QR en nueve
// pantallas: llenar todo lo que se reconozca y clickear el primer botón de avance habilitado. Eso lo
// hace `pkg/autorrelleno.ts`, compartido por los dos caminadores.
//
// Lo único que SÍ necesita puntería es elegir una entidad concreta del listado, porque ahí el caminador
// no puede tomar «la primera»: el caso pide una. Se resuelve por el NOMBRE de la entidad, que se lee de
// la base — el listado lo muestra y es lo único estable sin testids.
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { autorrellenar, clickearAvanzar, erroresDeValidacion, leerHastaElFinal, type Campo } from './autorrelleno.ts';

export type DatosWizard = {
    tel: string; doc: string; amount: number; income: number;
    nombre?: string; apellido?: string; email?: string; direccion?: string;
};

/** El mapa de campos del wizard. Lo específico del canal; el motor de llenado es compartido.
 *  Los `tecleado: true` son los inputs con máscara: `fill()` salta el transformer y pierde caracteres
 *  (la convención está documentada en `pkg/wizard-steps.ts`, que usa el mismo criterio). */
export const CAMPOS_WIZARD = (d: DatosWizard, hoja = ''): Campo[] => [
    { testId: 'amount-input', label: /monto|cu[aá]nto/i, valor: String(d.amount), tecleado: true },
    { testId: 'phone-input', label: /celular|tel[eé]fono/i, name: 'phoneNumber', valor: d.tel },
    // ⚠ SON DOS OTP DISTINTOS Y NO SE PARECEN EN NADA SALVO EL NOMBRE DEL CAMPO. El del onboarding son
    // los ÚLTIMOS 4 del teléfono; el de la FIRMA del pagaré son los últimos 6 (`caso.ts` usa el mismo
    // criterio en su cierre). Con 4 dígitos en la pantalla de firma el campo se llena, no da error, y el
    // botón simplemente nunca se habilita: se lee como «pantalla trabada» (2026-09-03).
    { testId: 'otp-input', name: 'otp', valor: hoja === 'otp-validation' ? d.tel.slice(-6) : d.tel.slice(-4) },
    { testId: 'docnum-input', label: /n[uú]mero de documento/i, name: 'documentNumber', valor: d.doc, tecleado: true },
    { testId: 'name-input', label: /^nombre/i, name: 'name', valor: d.nombre ?? 'CARLOS' },
    { testId: 'surname-input', label: /apellido/i, name: 'surname', valor: d.apellido ?? 'RUIZ' },
    { testId: 'email-input', label: /correo|email/i, name: 'email', valor: d.email ?? `qa${d.doc}@gmail.com` },
    { label: /direcci[oó]n/i, name: 'address', valor: d.direccion ?? 'Calle 1 # 2-3' },
    { testId: 'monthly-income-input', label: /ingreso/i, name: 'monthlyIncome', valor: String(d.income), tecleado: true },
    /* La CUOTA INICIAL del formulario del vehículo (BCP). Va un 20 % del valor — el runner por HTTP usa
     * 10.000 absolutos sobre 60.000, que es del mismo orden; acá tiene que escalar porque el caminador
     * corre con el monto que le pidan.
     *
     * ⚠ NO se llena «Monto a financiar» a propósito: `bcp-volver.ts` anota que ese campo lo calcula el
     * JAVASCRIPT DEL CLIENTE, que es justo lo que el camino HTTP no puede ver. Dejarlo vacío convierte
     * al caminador en la prueba de si de verdad se autocalcula — llenarlo a mano taparía la respuesta. */
    { label: /cuota inicial/i, name: 'down_payment', valor: String(Math.round(d.amount * 0.2)), tecleado: true },
];

/** Un navegador para toda la tanda; UN CONTEXTO POR CASO.
 *  El contexto es el perfil aislado (cookies, storage), o sea «un cliente distinto», y cuesta ~50-100 MB
 *  contra los cientos de un navegador entero: es lo que hace viable correr varios a la vez. */
export async function abrirNavegador(opts: { headed?: boolean } = {}): Promise<Browser> {
    return chromium.launch({ headless: !opts.headed });
}

const UA_MOVIL = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 '
    + '(KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1';

/** Lo que el navegador vio y un log de consola no cuenta: los errores del cliente y las llamadas que
 *  fallaron. Se recolecta SIEMPRE (cuesta nada) y se imprime sólo si el caso sale mal. */
export type Evidencia = { consola: string[]; red: string[] };

/**
 * ¿Es ruido conocido del ambiente LOCAL, y por lo tanto no es evidencia de nada?
 *
 * Vive acá y se exporta porque **la usan los dos caminadores con navegador** (éste y `caminar-qr.ts`).
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
export async function bloquearHerramientasDeDev(page: Page): Promise<void> {
    await page.route(/react-scan|react-grab/, (ruta) => ruta.abort()).catch(() => {});
}

export function esRuidoDeLocal(mensajeCompleto: string): boolean {
    if (/hydrat/i.test(mensajeCompleto)) return /nonce/.test(mensajeCompleto);
    return /React DevTools|PostHog|Lit is in dev|react-scan|react-grab|Download the React|Select is changing|ws\.credito|WebSocket connection|ERR_NAME_NOT_RESOLVED|ERR_FAILED|favicon/i
        .test(mensajeCompleto);
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
export function avisoDeEvidencia(consola: string[], red: string[], maximo = 3): string[] {
    if (!consola.length && !red.length) return [];

    const cuenta = [
        consola.length ? `${consola.length} de consola` : '',
        red.length ? `${red.length} de red` : '',
    ].filter(Boolean).join(' y ');

    // ⚠ NO dice «falló» ni cambia el veredicto: el caso cerró. Es una invitación a mirar, no un
    // resultado — si fuera un volcado entero en cada caso feliz, la tanda se volvería ilegible y se
    // aprendería a saltearlo, que es exactamente como muere una señal.
    return [
        `⚠ cerró, pero el navegador registró ${cuenta} — no cambia el veredicto, pero mirá:`,
        ...[...consola, ...red].slice(0, maximo).map((l) => `   ${l}`),
    ];
}

export async function abrirContexto(browser: Browser, baseURL: string, opts: { traza?: string; storageState?: string } = {})
: Promise<{ ctx: BrowserContext; page: Page; evidencia: Evidencia }> {
    const ctx = await browser.newContext({
        baseURL, userAgent: UA_MOVIL, viewport: { width: 420, height: 900 },
        ...(opts.storageState ? { storageState: opts.storageState } : {}),
    });
    // La TRAZA de Playwright: DOM por acción, red y consola, en un zip que se abre con
    // `npx playwright show-trace`. Es la evidencia que un log no puede dar, y se guarda SÓLO si el caso
    // falla (quien llama decide en `cerrarContexto`).
    if (opts.traza) await ctx.tracing.start({ screenshots: true, snapshots: true, sources: false }).catch(() => {});
    const page = await ctx.newPage();
    await bloquearHerramientasDeDev(page);

    // ⚠ ESTO FALTABA Y SE NOTÓ EN LA PRIMERA CORRIDA REAL (2026-09-03): el caminador reportó «Error al
    // cargar los documentos» —un muro que el motor HTTP no ve— y no pudo decir POR QUÉ, porque no
    // miraba ni la consola ni la red. Un caminador con navegador que no recoge las dos cosas tira a la
    // basura la mitad de lo que el navegador sabe.
    // Se DEDUPLICA con contador: el mismo error repetido cuatro veces gasta el cupo y tapa el que
    // aparece una sola vez, que suele ser el importante (así casi se perdió el «No routes matched»).
    const evidencia: Evidencia = { consola: [], red: [] };
    const vistos = new Map<string, number>();
    const anotar = (donde: 'consola' | 'red', linea: string) => {
        const n = (vistos.get(linea) ?? 0) + 1;
        vistos.set(linea, n);
        if (n === 1) evidencia[donde].push(linea);
        else {
            const i = evidencia[donde].findIndex((l) => l.startsWith(linea));
            if (i >= 0) evidencia[donde][i] = `${linea}   ×${n}`;
        }
    };
    page.on('console', (m) => {
        if (m.type() !== 'error' && m.type() !== 'warning') return;
        // ⚠ SE DECIDE SOBRE EL TEXTO COMPLETO Y SE RECORTA DESPUÉS. Antes se recortaba a 220 y se
        // filtraba sobre eso: funcionaba de casualidad porque los patrones caían al principio, pero
        // cualquier regla que mire más adentro del mensaje —como la del `nonce`, que aparece en el diff
        // de React pasado el carácter 400— no mordería nunca. Y un filtro que no filtra no falla: deja
        // pasar el ruido y parece que la regla no sirve.
        const completo = m.text();
        if (esRuidoDeLocal(completo)) return;
        // ⚠ 600 Y NO 220. Los errores de React que MÁS sirven —«cannot contain a nested», los avisos de
        // hidratación— ponen la pila de componentes DESPUÉS del encabezado, así que 220 daba el título y
        // se comía el único dato que ubica el problema. Medido el 2026-09-18: un `<button>` anidado en la
        // tarjeta de entidad se pudo ver pero no localizar. No hay riesgo de volumen: esto deduplica con
        // contador y corta a 40 entradas.
        if (evidencia.consola.length < 40) anotar('consola', `${m.type()}: ${completo.slice(0, 600)}`);
    });
    page.on('pageerror', (e) => {
        if (evidencia.consola.length < 40) anotar('consola', `pageerror: ${String(e.message).slice(0, 220)}`);
    });
    page.on('requestfailed', (r) => {
        if (evidencia.red.length < 40) anotar('red', `falló ${r.method()} ${acortar(r.url())} — ${r.failure()?.errorText ?? '?'}`);
    });
    page.on('response', (r) => {
        if (r.status() < 400) return;
        if (evidencia.red.length < 40) anotar('red', `HTTP ${r.status()} ${r.request().method()} ${acortar(r.url())}`);
    });
    return { ctx, page, evidencia };
}

const acortar = (u: string) => { try { const x = new URL(u); return x.pathname.slice(0, 90) + (x.search ? '?…' : ''); } catch { return u.slice(0, 90); } };

/** Cierra el contexto y, sólo si el caso salió mal, deja la traza en disco. */
export async function cerrarContexto(ctx: BrowserContext, guardarEn: string | null): Promise<void> {
    if (guardarEn) await ctx.tracing.stop({ path: guardarEn }).catch(() => {});
    else await ctx.tracing.stop().catch(() => {});
    await ctx.close().catch(() => {});
}

/** Un banner de error a la vista. Es el muro que el motor HTTP no ve: el front puede responder 200 y
 *  pintar «Error al cargar la información» (F-88). */
export async function bannerDeError(page: Page): Promise<string | null> {
    const t = await page.getByText(/Error al cargar|no pudimos|hubo un problema|intenta de nuevo|algo sali[oó] mal/i)
        .first().textContent({ timeout: 400 }).catch(() => null);
    return t ? t.trim().slice(0, 90) : null;
}

/**
 * Elige una entidad del listado por su NOMBRE (el caso pide una concreta, no «la primera»).
 * Devuelve lo que encontró: la lista de nombres visibles sirve para reportar por qué no estaba.
 */
export async function elegirEntidad(page: Page, nombre: string): Promise<{ ok: boolean; visibles: string[] }> {
    // El listado se arma con las tarjetas ya resueltas: se espera a que aparezca alguna antes de mirar.
    await page.getByRole('button', { name: /continuar|solicitar|elegir|seleccionar/i }).first()
        .waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {});
    const botones = page.getByRole('button');
    const n = await botones.count().catch(() => 0);
    const visibles: string[] = [];
    for (let i = 0; i < n; i++) {
        const b = botones.nth(i);
        if (!(await b.isVisible().catch(() => false))) continue;
        const txt = ((await b.textContent().catch(() => '')) ?? '').replace(/\s+/g, ' ').trim();
        if (txt) visibles.push(txt.slice(0, 40));
        if (txt.toLowerCase().includes(nombre.toLowerCase()) && (await b.isEnabled().catch(() => false))) {
            await b.click({ timeout: 15_000 }).catch(() => {});
            return { ok: true, visibles };
        }
    }
    // La tarjeta puede no ser un `button`: se prueba por texto y se clickea su botón de avance.
    const tarjeta = page.getByText(new RegExp(nombre.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')).first();
    if (await tarjeta.count().catch(() => 0)) {
        await tarjeta.click({ timeout: 5_000 }).catch(() => {});
        const av = await clickearAvanzar(page);
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
export async function avanzar(page: Page, d: DatosWizard, hoja = ''): Promise<{ ok: boolean; hechos: string[]; boton?: string; candidatos?: string[]; errores?: string[]; motivo?: string }> {
    // `preferirRadio: /^no$/i` — la pregunta de «confirmación de cupo» se contesta NO, que es el flujo
    // estándar y lo mismo que manda el motor HTTP (`confirmQuota: 'no'`). Contestar «Sí» sería probar otro
    // flujo sin haberlo pedido: firma `already-confirmed-pre-approval`, salta el buró y recorta el listado.
    const hechos = await autorrellenar(page, CAMPOS_WIZARD(d, hoja), { preferirRadio: /^no$/i }).catch(() => [] as string[]);
    let av = await clickearAvanzar(page);
    if (!av.ok) {
        // Antes de darlo por trabado: puede estar enviando (botón deshabilitado un instante) o puede
        // haber un modal que exige LEER hasta el final para habilitar el botón — el caso de la firma.
        await page.waitForTimeout(2_500);
        const leidos = await leerHastaElFinal(page);
        if (leidos) { hechos.push(`leí ${leidos} documento(s) hasta el final`); await page.waitForTimeout(600); }
        av = await clickearAvanzar(page);
    }
    if (av.ok) return { ok: true, hechos, boton: av.nombre };
    return { ok: false, hechos, candidatos: av.candidatos, motivo: av.motivo, errores: await erroresDeValidacion(page).catch(() => []) };
}

/** Espera a que la pantalla cambie después de un click. Devuelve la URL nueva, o null si no se movió
 *  (que es legítimo: varias pantallas del wizard tienen PASOS INTERNOS con la misma URL). */
export async function esperarCambio(page: Page, desde: string, timeout = 25_000): Promise<string | null> {
    const ok = await page.waitForURL((u) => u.href !== desde, { timeout }).then(() => true).catch(() => false);
    return ok ? page.url() : null;
}
