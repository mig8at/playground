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
    // El ruido conocido de LOCAL, el mismo que filtra el runner visual: sin esto cuatro errores de
    // WebSocket a `ws.credito` (Echo/Pusher, que en local no resuelve) copan el cupo y tapan la línea
    // que sí importa — pasó en la primera corrida real y por poco no vemos el «No routes matched».
    const RUIDO = /React DevTools|PostHog|Lit is in dev|react-scan|react-grab|Download the React|hydrat|nonce|Select is changing|ws\.credito|WebSocket connection|ERR_NAME_NOT_RESOLVED|ERR_FAILED/i;
    page.on('console', (m) => {
        if (m.type() !== 'error' && m.type() !== 'warning') return;
        const txt = m.text().slice(0, 220);
        if (RUIDO.test(txt)) return;                       // el ruido conocido de local no es evidencia
        if (evidencia.consola.length < 40) anotar('consola', `${m.type()}: ${txt}`);
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
export async function avanzar(page: Page, d: DatosWizard, hoja = ''): Promise<{ ok: boolean; hechos: string[]; boton?: string; candidatos?: string[]; errores?: string[] }> {
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
    return { ok: false, hechos, candidatos: av.candidatos, errores: await erroresDeValidacion(page).catch(() => []) };
}

/** Espera a que la pantalla cambie después de un click. Devuelve la URL nueva, o null si no se movió
 *  (que es legítimo: varias pantallas del wizard tienen PASOS INTERNOS con la misma URL). */
export async function esperarCambio(page: Page, desde: string, timeout = 25_000): Promise<string | null> {
    const ok = await page.waitForURL((u) => u.href !== desde, { timeout }).then(() => true).catch(() => false);
    return ok ? page.url() : null;
}
