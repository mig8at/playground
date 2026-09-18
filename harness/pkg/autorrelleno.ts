// autorrelleno.ts — «llená lo que puedas en esta pantalla y decime qué tocaste».
//
// POR QUÉ EXISTE COMO MÓDULO APARTE (2026-09-03): esta máquina la escribió el caminador del canal QR y
// resolvía cinco cosas que NINGÚN caminador se puede ahorrar —hidratación, inputs con máscara, selects
// nativos, combos de Radix (que no son `<select>` y una pasada genérica no ve), radios y checkboxes de
// Radix (que son BUTTON y guardan el estado en `data-state`)—. Al agregar el motor de navegador al
// caminador del wizard hacía falta exactamente lo mismo con OTRO mapa de campos, y copiarla habría dejado
// dos implementaciones divergiendo: la trampa que `harness/CLAUDE.md` prohíbe explícitamente.
//
// Ahora es una sola implementación con dos mapas: `CAMPOS_QR` en `pkg/qr-steps.ts` y `CAMPOS_WIZARD` en
// `pkg/wizard-navegador.ts`. Lo específico de cada canal es QUÉ campos hay y qué valor va; lo genérico
// —cómo se llena y cómo se verifica que quedó— vive acá.
import type { Page } from '@playwright/test';
import { MESES, esTrioDeFecha, fechaDeLaPantalla, fechasSinteticas, parteDeCombo, valorBuscado, yaMuestra } from './fecha-trio.ts';

/** Un campo de la pantalla, con el valor YA resuelto. Se busca por testid, por etiqueta y por `name`,
 *  en ese orden: los tres existen en este front y ninguno solo alcanza para todas las pantallas. */
export type Campo = {
    /** `data-testid`, que es lo más estable donde el front lo pone. */
    testId?: string;
    /** Etiqueta visible. Es el fallback preferido: el input controlado suele NO tener `name`. */
    label?: RegExp;
    /** Atributo `name`, último recurso. Se excluye el hidden espejo. */
    name?: string;
    /** El valor. `undefined` = este campo no aplica a este caso y se saltea. */
    valor?: string;
    /** Escribir tecla por tecla en vez de `fill()`. Obligatorio en los inputs con máscara
     *  (`react-hook-form` con `onChange` que reformatea): `fill()` salta el transformer y pierde chars. */
    tecleado?: boolean;
};

/**
 * Espera a que React haya HIDRATADO. Sin esto, un `fill()` reporta éxito y React lo pisa al montar, así
 * que el campo queda vacío y el fallo aparece dos pantallas después.
 *
 * La sonda es un checkbox de Radix: se le hace click hasta que su `data-state` responde `checked`. Si la
 * pantalla no tiene ninguno no hay sonda posible y se devuelve `true` (no se puede afirmar, no se bloquea).
 */
export async function esperarHidratacion(page: Page, timeout = 15_000): Promise<boolean> {
    const cajas = page.locator('button[role="checkbox"]');
    await cajas.first().waitFor({ state: 'visible', timeout }).catch(() => {});
    if (!(await cajas.count().catch(() => 0))) return true;
    const hasta = Date.now() + timeout;
    while (Date.now() < hasta) {
        await cajas.first().click({ timeout: 2_000 }).catch(() => {});
        if ((await cajas.first().getAttribute('data-state').catch(() => null)) === 'checked') return true;
        await page.waitForTimeout(250);
    }
    return false;
}

/**
 * Llena todo lo que reconozca en la pantalla actual. Devuelve la lista de lo que tocó (vacía si no había
 * nada, que es lo normal en las pantallas de sólo lectura del recorrido).
 *
 * ⚠ VERIFICA QUE EL VALOR QUEDÓ, y esa es la mitad del valor de esta función: un `fill()` exitoso no
 * garantiza que el valor sobreviva —hidratación, o una máscara que rechaza el formato—. Si no quedó,
 * reintenta una vez y si tampoco, lo reporta con `⚠no quedó` en vez de dar por hecho que se llenó.
 */
export async function autorrellenar(page: Page, campos: Campo[],
    opts: {
        hidratar?: boolean; t?: number; preferirRadio?: RegExp;
        /** Las dos fechas sintéticas. Ausente → las del entorno (`fechasSinteticas()`). */
        fechas?: { nacimiento: string; expedicion: string };
    } = {}): Promise<string[]> {
    const hechos: string[] = [];
    const t = opts.t ?? 3_000;
    if (opts.hidratar !== false) await esperarHidratacion(page, 10_000);

    for (const c of campos) {
        if (!c.valor) continue;
        // ⚠ El nombre que se reporta es el de la estrategia que MATCHEÓ, no el primero de la lista. La
        // primera versión reportaba siempre el testid y decía `docnum-input=…` cuando en realidad había
        // encontrado el campo por etiqueta — y ese testid **no existe en el front** (medido 2026-09-03:
        // de los nueve que usa `pkg/wizard-steps.ts` sobreviven dos). Un log que nombra un selector
        // inexistente manda a buscar el problema donde no está.
        let loc = c.testId ? page.getByTestId(c.testId).first() : null;
        let via = c.testId ?? '';
        if (!loc || !(await loc.count().catch(() => 0))) {
            loc = c.label ? page.getByLabel(c.label).first() : null;
            via = c.label ? `label:${String(c.label).replace(/[/\\^$]|i$/g, '').slice(0, 18)}` : via;
        }
        if ((!loc || !(await loc.count().catch(() => 0))) && c.name) {
            loc = page.locator(`input[name="${c.name}"]:not([type=hidden]), textarea[name="${c.name}"]`).first();
            via = `name:${c.name}`;
        }
        if (!loc || !(await loc.count().catch(() => 0))) continue;
        if (!(await loc.isVisible().catch(() => false))) continue;
        if (await loc.inputValue().catch(() => '')) continue;      // ya tenía valor: no se pisa

        const escribir = async () => {
            if (c.tecleado) {
                await loc!.click({ timeout: t }).catch(() => {});
                await loc!.pressSequentially(c.valor!, { delay: 40, timeout: t }).catch(() => {});
            } else {
                await loc!.fill(c.valor!, { timeout: t }).catch(() => {});
            }
        };
        await escribir();
        let quedo = (await loc.inputValue().catch(() => '')) !== '';
        if (!quedo) { await page.waitForTimeout(400); await escribir(); quedo = (await loc.inputValue().catch(() => '')) !== ''; }
        hechos.push(`${via || 'campo'}=${c.valor}${quedo ? '' : ' ⚠no quedó'}`);
    }

    // Selects sin elegir → primera opción real (la 0 suele ser el placeholder «Selecciona…»).
    const selects = page.locator('select:visible');
    for (let i = 0; i < (await selects.count().catch(() => 0)); i += 1) {
        const s = selects.nth(i);
        if (await s.inputValue().catch(() => '')) continue;
        const opciones = await s.locator('option').evaluateAll((els) =>
            els.map((e) => (e as HTMLOptionElement).value).filter((v) => v && v !== '0')).catch(() => []);
        if (opciones.length) await s.selectOption(opciones[0]).then(() => hechos.push(`select→${opciones[0]}`)).catch(() => {});
    }

    // SELECTS DE RADIX (`Select`/`SelectTrigger` del UI kit) — no son `<select>` y el bloque de arriba no
    // los ve. Es el muro de `consumo/loan-summary`: «Duración del crédito» y «¿Qué día quieres pagar?» son
    // los dos de este tipo, quedan vacíos, el form no valida y **el botón Continuar nunca se habilita**, sin
    // un mensaje de error. El trigger es un `button[role=combobox]` y las opciones se renderizan en un
    // PORTAL (fuera del form) como `[role=option]`, así que hay que abrir y clickear, no `selectOption`.
    const combos = page.locator('button[role="combobox"]:visible');
    const cuantosCombos = await combos.count().catch(() => 0);

    /* ── EL TRÍO DE FECHA, PRIMERO Y CON LA REGLA COMPARTIDA ──────────────────────────────────────
     * ⚠ Sin esto, el bloque genérico de abajo elegía `[role=option].first()` en cada combo y armaba
     * `1 / Enero / <año actual>` — el día de hoy. Como fecha de expedición de un documento eso es una
     * fecha que ninguna validación de negocio acepta, y quedaba escrita en la base sin que nada
     * avisara: medido el 2026-09-10, el usuario de la uReq 502193 terminó con
     * `expedition_date = 2026-01-01`. La regla la sabía el OTRO autorrelleno del harness y este no;
     * ahora los dos la leen de `pkg/fecha-trio.ts`.
     *
     * Se resuelve ANTES que el loop genérico y marca sus índices para que aquél no los repise. */
    const indicesDeFecha = new Set<number>();
    if (cuantosCombos >= 3) {
        const textos: string[] = [];
        for (let i = 0; i < cuantosCombos; i += 1) {
            textos.push(((await combos.nth(i).textContent().catch(() => '')) ?? '').trim());
        }
        /* La ETIQUETA es la misma señal que el texto acá: un combo de Radix vacío muestra su
           placeholder («Día*»), que es exactamente lo que `parteDeCombo` sabe leer. */
        const partes = textos.map((txt, i) => parteDeCombo(txt, txt, i, MESES));
        const candidatos = partes.map((p, i) => ({ p, i })).filter((x) => x.p !== null);

        if (esTrioDeFecha(candidatos.map((x) => x.p))) {
            const arriba = ((await page.locator('body').innerText().catch(() => '')) ?? '').slice(0, 400);
            const { nacimiento, expedicion } = opts.fechas ?? fechasSinteticas();
            const fecha = fechaDeLaPantalla(arriba, nacimiento, expedicion);

            /* EN ORDEN, y no en paralelo: en este trío el siguiente combo se habilita al elegir el
               anterior (día → mes → año), así que saltárselo deja los dos últimos deshabilitados. */
            for (const { p, i } of candidatos) {
                const buscado = valorBuscado(p!, fecha, MESES);
                if (yaMuestra(textos[i], buscado)) { indicesDeFecha.add(i); continue; }   // idempotente: ya está elegido
                const cb = combos.nth(i);
                if (!(await cb.isEnabled().catch(() => false))) continue;
                await cb.click({ timeout: t }).catch(() => {});
                /* ⚠ SE PRUEBAN TODOS LOS CANDIDATOS, no sólo el primero. El mismo día se escribe `5` o
                   `05` y el mes por nombre o por número según la pantalla; quedarse con `buscado[0]`
                   dejaba sin elegir a la mitad de las variantes — y el match es ANCLADO a propósito,
                   porque `hasText` sin anclar haría que «5» matcheara «15» y «25». */
                let elegido: string | null = null;
                for (const cand of buscado) {
                    const escapado = cand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                    const opcion = page.locator('[role="option"]:visible')
                        .filter({ hasText: new RegExp(`^\\s*${escapado}\\s*$`, 'i') }).first();
                    if (!(await opcion.count().catch(() => 0))) continue;
                    const ok = await opcion.click({ timeout: t }).then(() => true).catch(() => false);
                    if (ok) { elegido = cand; break; }
                }
                if (elegido) { hechos.push(`fecha ${p}→${elegido}`); indicesDeFecha.add(i); }
                else {
                    // No se inventa otro valor: se cierra y se reporta, que es lo que deja ver el hueco.
                    await page.keyboard.press('Escape').catch(() => {});
                    hechos.push(`⚠fecha ${p}: no encontré ninguno de «${buscado.join('» «')}»`);
                    /* ⚠ Y NO SE MARCA COMO PROPIO. Antes `indicesDeFecha.add(i)` estaba arriba del todo,
                     * o sea que este trío reclamaba el combo ANTES de saber si podía llenarlo — y el
                     * bucle genérico de abajo lo salteaba para siempre.
                     *
                     * Medido el 2026-09-18 en el formulario del vehículo de BCP: sus cuatro selects en
                     * cascada (marca → modelo → versión → año) fueron detectados como un trío de fecha
                     * —«Selecciona el año» matchea `anio`—, el trío no encontró «14/mayo/1990» en ellos,
                     * y como ya los había reclamado, nadie más los tocó. Los cuatro quedaban vacíos, la
                     * pantalla decía «Selecciona una opción» y el recorrido moría ahí. Esa pantalla nunca
                     * se había caminado con navegador, y ésta era una de las dos razones.
                     *
                     * La detección se deja como está —sirve a las pantallas de fecha de verdad— y lo que
                     * se arregla es que FALLAR NO ABSORBA: si el trío no pudo, que lo intente el genérico. */
                }
                await page.waitForTimeout(150).catch(() => {});
            }
        }
    }

    /* ── LOS COMBOS, EN VARIAS PASADAS — y la repetición es lo que los hace servir ────────────────
     * Una sola pasada ya conocía las cascadas («el siguiente se habilita al elegir el anterior») pero
     * no alcanzaba, porque el dependiente no se habilita al instante: sus opciones salen de una
     * llamada a la API. Al elegir «Marca», el bucle llegaba a «Modelo» un milisegundo después, lo
     * encontraba deshabilitado, lo salteaba — y ya no volvía nunca.
     *
     * Medido el 2026-09-18 en el formulario del vehículo de BCP (marca → modelo → versión → año):
     * quedaban los cuatro vacíos, la pantalla decía «Selecciona una opción» y el recorrido moría ahí.
     * Es la razón por la que esa pantalla nunca se había caminado con navegador.
     *
     * Se corta cuando una pasada no llena nada: sin progreso no hay cascada que esperar, y así un
     * formulario sin dependencias sigue costando una sola vuelta. */
    for (let pasada = 0; pasada < 4; pasada += 1) {
        let llenados = 0;
        const cuantos = await combos.count().catch(() => 0);
        for (let i = 0; i < cuantos; i += 1) {
            // El trío de fecha ya está resuelto; sus índices sólo son fiables mientras la lista no cambie
            // de tamaño (una cascada puede agregar combos y correrlos). Después manda el chequeo de vacío,
            // que es el que de verdad decide.
            if (cuantos === cuantosCombos && indicesDeFecha.has(i)) continue;
            const cb = combos.nth(i);
            // Con valor elegido, Radix pone `data-placeholder` sólo cuando está VACÍO: es la señal de "sin elegir".
            const vacio = (await cb.getAttribute('data-placeholder').catch(() => null)) !== null
                || !(await cb.textContent().catch(() => ''))?.trim();
            if (!vacio) continue;
            if (!(await cb.isEnabled().catch(() => false))) continue;
            await cb.click({ timeout: t }).catch(() => {});
            const opcion = page.locator('[role="option"]:visible').first();
            if (await opcion.count().catch(() => 0)) {
                const etiqueta = (await opcion.textContent().catch(() => '')) ?? '';
                await opcion.click({ timeout: t })
                    .then(() => { hechos.push(`combo→${etiqueta.trim().slice(0, 18)}`); llenados += 1; })
                    .catch(() => {});
            } else {
                await page.keyboard.press('Escape').catch(() => {});   // no dejar el listbox abierto tapando el resto
            }
        }
        if (!llenados) break;
        // Lo que tarda el dependiente en traer sus opciones de la API.
        await page.waitForTimeout(700).catch(() => {});
    }

    // Radios NATIVOS: el primero de cada grupo.
    const grupos = new Set(await page.locator('input[type=radio]:visible').evaluateAll((els) =>
        els.map((e) => (e as HTMLInputElement).name).filter(Boolean)).catch(() => []));
    for (const g of grupos) {
        const r = page.locator(`input[type=radio][name="${g}"]:visible`).first();
        if (!(await r.isChecked().catch(() => true))) await r.check({ timeout: t }).then(() => hechos.push(`radio ${g}`)).catch(() => {});
    }

    // RADIOS DE RADIX. Son `button[role=radio]` con el estado en `aria-checked`, y el `<input>` nativo que
    // los espeja está OCULTO — así que la pasada de arriba no los ve y el grupo queda sin elegir. En el
    // wizard eso deja el submit deshabilitado sin ningún mensaje: es el muro de la primera pantalla.
    //
    // ⚠ Y CUÁL SE ELIGE IMPORTA, no es cosmético: la primera pantalla pregunta «¿el cliente tiene cupo
    // disponible?» y contestar «Sí» firma el flujo `already-confirmed-pre-approval`, que SALTA el buró y
    // recorta el listado a las rt=0. Con `preferirRadio` el canal dice qué quiere; el default es el primero.
    const gruposRadix = page.locator('[role="radiogroup"]:visible');
    for (let i = 0; i < (await gruposRadix.count().catch(() => 0)); i += 1) {
        const g = gruposRadix.nth(i);
        const radios = g.locator('[role="radio"]');
        const n = await radios.count().catch(() => 0);
        if (!n) continue;
        let yaElegido = false;
        for (let j = 0; j < n; j++) {
            if ((await radios.nth(j).getAttribute('aria-checked').catch(() => null)) === 'true') { yaElegido = true; break; }
        }
        if (yaElegido) continue;
        // ⚠ POR NOMBRE ACCESIBLE, no por `textContent`. En Radix la etiqueta («Sí» / «No») es un `<label>`
        // HERMANO, así que el `textContent` del botón viene VACÍO y el fallback caía al primero: eligió
        // «Sí» a la pregunta de confirmación de cupo, que firma otro flujo. Se vio el 2026-09-03: el log
        // decía `radio→1`, un valor que no es ninguna de las dos respuestas.
        let elegido = null as null | typeof radios;
        let nom = '';
        if (opts.preferirRadio) {
            const porNombre = g.getByRole('radio', { name: opts.preferirRadio });
            if (await porNombre.count().catch(() => 0)) { elegido = porNombre.first() as any; nom = String(opts.preferirRadio); }
        }
        if (!elegido) { elegido = radios.first() as any; nom = '(el primero)'; }
        await (elegido as any).click({ timeout: t }).then(() => hechos.push(`radio→${nom}`)).catch(() => {});
    }

    // Checkboxes de Radix (términos, políticas, «acepto»). Son BUTTON, viven fuera del `<form>`, y su
    // estado está en `data-state`.
    const cajas = page.locator('button[role="checkbox"]');
    for (let i = 0; i < (await cajas.count().catch(() => 0)); i += 1) {
        const c = cajas.nth(i);
        if ((await c.getAttribute('data-state').catch(() => null)) !== 'checked') {
            await c.click({ timeout: t }).then(() => hechos.push('checkbox')).catch(() => {});
        }
    }
    return hechos;
}

/**
 * Desplaza hasta el final cualquier contenedor con scroll dentro de un diálogo abierto, y devuelve
 * cuántos movió.
 *
 * POR QUÉ ES UN PASO Y NO UN DETALLE: la pantalla de firma **no habilita el botón hasta que el cliente
 * leyó los documentos**. El gate es literal — `disabled={isBusy || (!haveAllDocumentsFailed &&
 * !hasScrolledDocumentsToBottom)}` en `SignDocuments.tsx`, y ese estado sólo se prende desde el
 * `onScroll` del contenedor. Un caminador que no desplaza se queda mirando un botón apagado y reporta
 * «sin botón para avanzar» sobre una pantalla que está bien: es el usuario el que no leyó (2026-09-03).
 *
 * Se hace con `scrollTop = scrollHeight` desde el DOM: eso dispara el `scroll` que React escucha. Y es
 * genérico a propósito — cualquier modal que exija leer antes de aceptar se satisface igual.
 */
export async function leerHastaElFinal(page: Page): Promise<number> {
    return page.evaluate(() => {
        const dialogos = Array.from(document.querySelectorAll('[role="dialog"]'))
            .filter((d) => (d as HTMLElement).offsetParent !== null || d.getClientRects().length > 0);
        let movidos = 0;
        for (const d of dialogos) {
            const candidatos = [d, ...Array.from(d.querySelectorAll('*'))] as HTMLElement[];
            for (const el of candidatos) {
                if (el.scrollHeight > el.clientHeight + 1) {
                    el.scrollTop = el.scrollHeight;
                    el.dispatchEvent(new Event('scroll', { bubbles: true }));
                    movidos += 1;
                }
            }
        }
        return movidos;
    }).catch(() => 0);
}

/** Los nombres de botón que hacen avanzar el wizard. Compartido por los dos caminadores. */
// ⚠ `solicit` y no `solicitar`: el botón de entrada del wizard dice «Iniciar soliciTUD» y con `solicitar`
// no matcheaba — el caminador se paraba en la PRIMERA pantalla diciendo «ningún botón de avance», que es
// exactamente el mensaje que manda a buscar el problema en el front (2026-09-03).
// ⚠ Y `enviar`, por lo MISMO y dos semanas después: el formulario del vehículo de BCP —el G2, que se
// arma desde el esquema que manda el backend— cierra con «Enviar», así que el caminador se paraba ahí
// diciendo «ningún botón de avance». Esa pantalla nunca se había caminado con navegador, y el motivo
// era esta palabra. Medido el 2026-09-18.
export const AVANZAR = /continuar|siguiente|aceptar|validar|verificar|confirmar|firmar|autenticarme|solicit|entendido|finalizar|ver mi|empezar|comenzar|activar|iniciar|enviar/i;

/**
 * El botón para avanzar: el primero VISIBLE y HABILITADO de verdad.
 *
 * ⚠ No es `.first()` con un filtro de `disabled`: `filter({hasNot: '[disabled]'})` pregunta por un
 * DESCENDIENTE deshabilitado, no por el botón mismo, así que devolvía botones deshabilitados y el click
 * moría por timeout con el nombre ya leído — parecía un muro de la pantalla cuando era el caminador
 * eligiendo mal. Devuelve el nombre del botón clickeado, o los candidatos que encontró si ninguno servía.
 */
export async function clickearAvanzar(page: Page, patron = AVANZAR): Promise<{ ok: true; nombre: string } | { ok: false; candidatos: string[]; motivo?: string }> {
    const cand = page.getByRole('button', { name: patron });
    const n = await cand.count().catch(() => 0);
    for (let i = 0; i < n; i++) {
        const c = cand.nth(i);
        if (!(await c.isVisible().catch(() => false))) continue;
        if (!(await c.isEnabled().catch(() => false))) continue;
        const nombre = ((await c.textContent().catch(() => '')) ?? '').trim();
        /* ⚠ EL CLICK NO PUEDE FALLAR EN SILENCIO. Acá había `.catch(() => {})` y un `ok: true` fijo
         * debajo: si el click se caía por timeout —el botón tapado, la pantalla repintándose, un
         * overlay— la función contestaba que TODO BIEN y con el nombre del botón puesto. El caminador
         * imprimía `↳ click «X»` sin haber clickeado nada, y el síntoma quedaba en «la pantalla no
         * avanza», que manda a buscar un bug del producto.
         *
         * Medido el 2026-09-18 en `entidad/simulador` del vehicular de BCP: cuatro «clicks» seguidos en
         * el log, ninguno real, 480 s hasta el tope — y el botón, clickeado a mano en un navegador,
         * navegaba a la primera. Es F-03 otra vez: el `.catch` vacío en el paso que da sentido a la
         * corrida. */
        const falla = await c.click({ timeout: 15_000 }).then(() => null)
            // 300 y no 110: cuando Playwright no puede clickear, el dato que sirve —«<div …> intercepts
            // pointer events», «element is not stable»— viene DESPUÉS de «Timeout exceeded», así que
            // recortar corto deja el síntoma sin la causa. Es el mismo error que ya se cometió con los
            // mensajes de consola.
            .catch((e) => String(e?.message ?? e).replace(/\s+/g, ' ').slice(0, 300));
        if (falla) return { ok: false, candidatos: [nombre], motivo: `el click sobre «${nombre}» falló: ${falla}` };
        return { ok: true, nombre };
    }
    // ⚠ CUANDO NO MATCHEA NADA, LOS BOTONES DE LA PANTALLA — no los que pasaron el patrón, que por
    // definición son cero. Antes se reportaba `cand.allTextContents()`, o sea el resultado del MISMO
    // filtro que acababa de fallar: el mensaje quedaba en «ningún botón de avance en la pantalla», que
    // suena a pantalla rota y manda a buscar un bug del front. Con la lista de verdad, el diagnóstico
    // se lee solo: «los botones eran: Enviar» dice que falta una palabra en `AVANZAR`, no que el
    // producto esté mal. Es lo que costó descubrir por qué el formulario de BCP nunca se caminó.
    const delPatron = (await cand.allTextContents().catch(() => [])).map((x) => x.trim()).filter(Boolean);
    if (delPatron.length) return { ok: false, candidatos: delPatron };

    const todos = page.getByRole('button');
    const n2 = await todos.count().catch(() => 0);
    const visibles: string[] = [];
    for (let i = 0; i < n2 && visibles.length < 8; i++) {
        const b = todos.nth(i);
        if (!(await b.isVisible().catch(() => false))) continue;
        const t = ((await b.textContent().catch(() => '')) ?? '').trim();
        const apagado = !(await b.isEnabled().catch(() => true));
        if (t) visibles.push(apagado ? `${t} (deshabilitado)` : t);
    }
    return { ok: false, candidatos: visibles };
}

/**
 * Los mensajes de validación visibles. Es la mitad útil de un «botón deshabilitado»: sin esto el
 * caminador dice que no puede avanzar y no dice POR QUÉ, y el que lee sale a buscar un bug del front
 * cuando lo que falta es un campo que el caminador no supo llenar.
 */
export async function erroresDeValidacion(page: Page): Promise<string[]> {
    // ⚠ Los marcadores de «campo obligatorio» comparten clase con los mensajes de error, así que un `*`
    // suelto entraba a la lista y a veces era lo ÚNICO que se reportaba: el caminador decía
    // «lo que dice: *» teniendo «Cuota Inicial es requerido» en la misma pantalla. Medido el 2026-09-18.
    const trivial = (t: string) => t.replace(/[\s*·.:-]/g, '').length < 3;
    const vistos = new Set<string>();
    for (const sel of ['[role="alert"]', '[aria-invalid="true"]', '[data-slot="form-message"]', '.text-destructive', 'p.text-red-500']) {
        const loc = page.locator(`${sel}:visible`);
        for (let i = 0; i < Math.min(await loc.count().catch(() => 0), 8); i++) {
            const txt = ((await loc.nth(i).textContent().catch(() => '')) ?? '').replace(/\s+/g, ' ').trim();
            if (txt && txt.length < 120 && !trivial(txt)) vistos.add(txt);
        }
    }
    return [...vistos];
}
