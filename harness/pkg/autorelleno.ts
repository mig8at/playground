// autorelleno.ts — RELLENA LOS INPUTS DE LA PANTALLA para que manejar el wizard a mano sea dar
// «Continuar» y nada más.
//
// POR QUÉ EXISTE, y por qué no alcanzaba con lo que ya había. El guiado (`bin/asesor <m> auto`) siembra
// las pantallas del tronco, pero lo hace **por fuera del navegador**: monto y teléfono por `fill()`, y
// personal-info/employment-info ni se ven —`synthFill` escribe en la base y el spec salta derecho a
// `/lenders`—. O sea que las pantallas que un seeder SÍ cubre ya no se escriben a mano, y las que
// ningún seeder cubre —el formulario dinámico que sirve `form-service`, el del vehículo de BCP, Ábaco,
// las fechas de pago, cualquier pantalla nueva— se escriben ENTERAS. Eso es lo cansón, y es justo lo
// que un seeder por pantalla no puede resolver: habría que escribir uno cada vez.
//
// Por eso esto es HEURÍSTICO y no un mapa de campos. Lee la pista de cada campo (su `name`, `id`,
// `placeholder`, `autocomplete`, `aria-label` y el texto de su `<label>`) y decide qué poner. Un
// formulario que nadie anticipó se llena igual, que es la única forma de que la herramienta no caduque
// con la próxima pantalla.
//
// ⚠ Y SIGUE SIENDO HEURÍSTICO aunque desde el 2026-09-09 el front ya trae `data-testid` propios (los
// siete del wizard: monto, teléfono, OTP y el toggle de las tarjetas). El motivo cambió: antes era que
// vivían en un PARCHE LOCAL (`bin/testids on`) que no estaba aplicado en todas las ramas, así que
// apoyarse en ellos hacía que el autorrelleno funcionara o no según el working tree. Ahora el motivo
// es otro: son SIETE, y este motor llena formularios que nadie anticipó —el de un país nuevo, el de un
// lender nuevo—. Usarlos donde existan sería más preciso; abandonar la heurística dejaría mudo todo lo
// demás.
//
// LOS DATOS SON LOS MISMOS QUE USA EL HARNESS, y esto es lo que lo vuelve utilizable: el teléfono sale
// de `E2E_OTP_BYPASS_PHONE` (el que bypasea el OTP), el OTP son sus últimos 4 y el de firma sus últimos
// 6, y la cédula y el correo de `E2E_SYNTH_DOC`/`E2E_SYNTH_EMAIL`. Si el autorelleno inventara una
// identidad propia, la persona de la pantalla no sería la de la solicitud sembrada y la corrida dejaría
// de ser una sola historia.
//
// DOS REGLAS QUE LO HACEN PREDECIBLE, y no son negociables:
//   · **nunca pisa lo que ya está escrito** — si tocaste un campo, es tuyo;
//   · **nunca aprieta un botón de avanzar** — el «Continuar» lo das vos. Es lo que separa «me ahorra
//     el tipeo» de «se me fue solo y no vi la pantalla».
//
// LO QUE ESTO NO HACE, y conviene saberlo antes de esperarlo. Rellena la pantalla; no hace que un
// usuario sintético PASE la validación de identidad. Medido el 2026-09-09 recorriendo el self-service a
// mano: monto, teléfono, OTP y las dos mitades de personal-info quedan completas y correctas —el
// «Continuar» habilitado, cero errores de validación y cero respuestas 4xx/5xx— y el flujo igual no sale
// de `personal-info`, porque de ahí en adelante manda el KYC. Para eso está el guiado, que saltea esa
// pantalla con `synthFill` a propósito. Los dos se complementan: el guiado te lleva hasta el
// marketplace, y esto te ahorra el tipeo en todo lo que el guiado no cubre.
//
// Se apaga con `E2E_AUTORELLENO=0`.
import { readFileSync } from 'node:fs';
import type { BrowserContext, Page } from '@playwright/test';
import { fechasSinteticas, fuenteInyectable } from './fecha-trio.ts';

export interface DatosAutorelleno {
    telefono: string; otp: string; otpFirma: string; documento: string; email: string;
    nombre: string; segundoNombre: string; apellido: string; segundoApellido: string;
    nacimiento: string; expedicion: string; ingreso: string; monto: string;
    direccion: string; empresa: string; placa: string; serie: string;
    /** hash de sucursal → nombre del comercio, para que la ventana diga a cuál entró. */
    comercios: Record<string, string>;
}

/**
 * El mapa hash → comercio, desde `.flows.json`.
 *
 * Existe por una confusión que costó una tarde: el modo manual **deja el browser abierto** y la ventana
 * de la corrida siguiente se acomoda en la MISMA columna, así que aterriza encima de la anterior y las
 * dos son indistinguibles — misma app, mismo tamaño, mismo lugar. Se ve como «cambié de comercio y se
 * quedó pegado el anterior», y no lo está: es la ventana vieja. Con el nombre a la vista, una ventana
 * sobreviviente se reconoce de un vistazo.
 */
function comerciosDeFlows(): Record<string, string> {
    try {
        const flows = JSON.parse(readFileSync(new URL('../.flows.json', import.meta.url), 'utf8'));
        const mapa: Record<string, string> = {};
        for (const [slug, m] of Object.entries<any>(flows?.merchants ?? {})) {
            for (const h of [m?.branch_hash, ...Object.values<any>(m?.por_target ?? {})]) {
                if (typeof h === 'string' && h) mapa[h] = m?.name || slug;
            }
        }
        return mapa;
    } catch { return {}; }
}

/** Los datos, de la misma cadena de env que usa `bin/asesor`. */
export function datosDeEnv(): DatosAutorelleno {
    const tel = process.env.E2E_OTP_BYPASS_PHONE || '3131010101';
    return {
        telefono: tel,
        otp: tel.slice(-4),
        otpFirma: tel.slice(-6),
        documento: process.env.E2E_SYNTH_DOC || '1096734490',
        email: process.env.E2E_SYNTH_EMAIL || 'qa.harness@creditop.com',
        nombre: 'CARLOS', segundoNombre: 'ANDRES', apellido: 'RAMIREZ', segundoApellido: 'GOMEZ',
        // Las dos fechas, del módulo que también las usa del lado de Playwright (ahí está el porqué
        // de que sean años plausibles y no «hoy»).
        ...fechasSinteticas(),
        ingreso: '2500000', monto: '2000000',
        direccion: 'CALLE 90 # 15 - 20', empresa: 'HARNESS QA SAS',
        placa: 'ABC12D', serie: '9C2KC0810JR000001',
        comercios: comerciosDeFlows(),
    };
}

/**
 * Deja el autorelleno instalado en TODAS las páginas de este contexto, presentes y futuras.
 *
 * Va como `addInitScript` sobre el CONTEXTO y no sobre la página: el wizard navega entre pantallas y
 * abre pestañas (el checkout de la entidad, la ventana del cliente), y un script atado a una página se
 * pierde en la primera navegación.
 */
/* ⚠ DOS `addInitScript`, EN ESTE ORDEN, y no es un detalle de estilo. El primero deja
 * `window.__trioFecha` —la regla de fecha COMPARTIDA con el autorrelleno de Playwright
 * (`pkg/fecha-trio.ts`)—; el segundo es el guion, que la usa. Van separados porque `addInitScript(fn)`
 * SERIALIZA la función: el guion no puede importar nada, así que la regla tiene que llegar por el
 * único canal que hay, que es otro script. Al revés no funciona: el guion correría sin la regla. */
export async function instalarAutorelleno(context: BrowserContext, datos = datosDeEnv()): Promise<void> {
    if (process.env.E2E_AUTORELLENO === '0') return;
    await context.addInitScript({ content: fuenteInyectable() });
    await context.addInitScript(guion, datos);
}

/** Para un `Page` suelto (specs que no pasan por `openWindow`). */
export async function instalarAutorellenoEnPagina(page: Page, datos = datosDeEnv()): Promise<void> {
    if (process.env.E2E_AUTORELLENO === '0') return;
    await page.addInitScript({ content: fuenteInyectable() });
    await page.addInitScript(guion, datos);
}

/* ── EL GUION QUE CORRE EN LA PÁGINA ────────────────────────────────────────────────────────────────
 * Se declara como función y se pasa a `addInitScript`, que la serializa: no puede cerrar sobre nada de
 * este módulo, así que todo lo que necesita entra por `datos`. */
function guion(datos: DatosAutorelleno) {
    if ((window as any).__autorelleno) return;
    (window as any).__autorelleno = true;

    /** Sin acentos y en minúsculas: la pista de un campo llega escrita de las dos formas. */
    const norm = (s: string) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

    /**
     * ESCRIBIR DE FORMA QUE REACT SE ENTERE. Asignar `el.value` no alcanza: React guarda el último
     * valor que él escribió en el nodo y, al ver que coincide, se traga el evento — el campo se ve
     * lleno y el estado del formulario sigue vacío, así que «Continuar» se queja de un campo que en la
     * pantalla está escrito. Por eso se usa el setter NATIVO del prototipo (que saltea el tracker) y se
     * despachan `input` y `change` burbujeando.
     *
     * Es el mismo problema que el `seedField` del spec resuelve reintentando tecla por tecla contra el
     * `MoneyInput`; acá se ataca por la otra punta, que desde dentro de la página es la barata.
     */
    function escribir(el: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, valor: string) {
        const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
            : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype
                : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        if (setter) setter.call(el, valor); else (el as any).value = valor;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
    }

    const visible = (el: Element) => {
        const r = (el as HTMLElement).getBoundingClientRect();
        return r.width > 0 && r.height > 0 && getComputedStyle(el as HTMLElement).visibility !== 'hidden';
    };

    /** La pista de un campo: todo lo que lo describe, junto. Incluye el `<label>` asociado. */
    function pista(el: HTMLElement): string {
        const partes = [el.getAttribute('name'), el.id, el.getAttribute('placeholder'),
            el.getAttribute('autocomplete'), el.getAttribute('aria-label'), el.getAttribute('inputmode')];
        if (el.id) {
            const lab = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
            if (lab) partes.push(lab.textContent);
        }
        const envuelto = el.closest('label');
        if (envuelto) partes.push(envuelto.textContent);
        const grupo = el.closest('[class*="field"],[class*="form-item"],[data-slot="form-item"]');
        if (grupo) partes.push(grupo.querySelector('label,legend')?.textContent ?? '');
        return norm(partes.filter(Boolean).join(' | '));
    }

    /**
     * La pista AMPLIADA con el texto de los ancestros cercanos.
     *
     * Existe SÓLO para los controles de radix, que no tienen metadata propia: un
     * `button[role=checkbox]` no trae `name`, ni `placeholder`, ni `<label for>` — su pregunta
     * («¿Confirmás que sos X, titular del documento N?») vive en un HERMANO dentro de la misma tarjeta.
     *
     * ⚠ Y ESTÁ SEPARADA DE `pista()` A PROPÓSITO, porque mezclarlas rompió el relleno entero y vale
     * saber cómo: al meter el texto de los ancestros en la pista de TODOS los campos, el formulario
     * completo entraba en la pista de cada uno, así que la palabra «apellidos» —que está en la pantalla—
     * matcheaba primero en todos y «Nombres», «Correo electrónico» y «Número de identificación»
     * terminaban con el apellido adentro. Visto en una captura: tres campos con «RAMIREZ» y dos errores
     * de validación. La regla que queda: **para decidir QUÉ dato va, sólo la metadata del campo; el
     * texto de alrededor únicamente para controles que no tienen metadata.**
     */
    function pistaConContexto(el: HTMLElement): string {
        const partes = [pista(el)];
        let sube: HTMLElement | null = el.parentElement;
        for (let i = 0; i < 3 && sube; i++, sube = sube.parentElement) {
            const t = (sube.textContent || '').trim();
            if (t && t.length < 400) partes.push(norm(t));
        }
        return partes.filter(Boolean).join(' | ');
    }

    /* LAS REGLAS, EN ORDEN: la primera que matchea gana, así que van de lo más específico a lo más
     * genérico. El orden no es cosmético — «segundo apellido» tiene que probarse antes que «apellido»,
     * y «fecha de expedicion» antes que cualquier `date`. */
    const REGLAS: [RegExp, string][] = [
        [/otp|codigo de verificacion|codigo sms|verification/, datos.otp],
        [/segundo nombre|middle/, datos.segundoNombre],
        [/segundo apellido|second last|apellido materno/, datos.segundoApellido],
        [/primer apellido|apellido paterno|last ?name|apellidos?/, datos.apellido],
        [/primer nombre|first ?name|nombres?(?! de la)/, datos.nombre],
        [/fecha de expedicion|expedicion|issue ?date/, datos.expedicion],
        [/fecha de nacimiento|nacimiento|birth/, datos.nacimiento],
        [/celular|telefono|movil|phone|\btel\b/, datos.telefono],
        [/correo|email|\bmail\b/, datos.email],
        /* ⚠ LOS TOKENS CORTOS VAN ANCLADOS, y costó una captura entender por qué. Sin `\b`, `nit`
         * matchea DENTRO de `initialFee` —«i-nit-ialFee»— así que el campo «Cuota inicial» del
         * marketplace recibía el NÚMERO DE DOCUMENTO. Y eso no quedaba en un campo raro: con una cuota
         * inicial de 1.096.734.490 el monto financiado se va a negativo y la tarjeta de la entidad
         * muestra «el monto solicitado es inferior al mínimo requerido», o sea que el autorelleno
         * fabricaba un error de NEGOCIO que se lee como un problema de la entidad.
         * La regla general: un token de tres letras se ancla o no se usa. */
        [/documento|cedula|identificacion|\bdni\b|\bnit\b|document/, datos.documento],
        [/ingreso|salario|income|salary|remuneracion/, datos.ingreso],
        [/monto|valor a financiar|amount|financiar/, datos.monto],
        [/direccion|address|residencia/, datos.direccion],
        [/empresa|empleador|company|employer|razon social/, datos.empresa],
        [/placa|patente|plate/, datos.placa],
        [/chasis|motor|serial|vin|serie/, datos.serie],
        [/anio|ano de|year|modelo/, '2024'],
    ];

    /**
     * CAMPOS QUE NO SE TOCAN, aunque estén vacíos y aunque una regla los matchee.
     *
     * No es lo mismo «ahorrar tipeo» que «elegir por el que prueba». La CUOTA INICIAL cambia la oferta:
     * mueve el monto financiado, la cuota y hasta si la entidad aplica —con un valor inventado la
     * tarjeta mostraba «el monto solicitado es inferior al mínimo requerido», que se lee como un
     * problema de la entidad y no como un relleno mal puesto—.
     *
     * Pero dejarla VACÍA tampoco alcanza: hay entidades que exigen un mínimo, y hasta que no hay valor
     * la tarjeta no se puede elegir. Así que no se inventa NI se deja vacía: **se obedece el número que
     * la propia pantalla declara** («La cuota inicial mínima es $ 720.000»). Ese dato lo puso el
     * backend con la config de la entidad, así que usarlo no es adivinar — y si la pantalla no dice
     * ningún mínimo, el campo se queda vacío, que es su estado válido.
     */
    const ES_CUOTA_INICIAL = /cuota inicial|initial ?fee|enganche|down ?payment/;

    /** El mínimo que la pantalla declara para la cuota inicial, en dígitos. `null` si no dice ninguno. */
    function minimoDeclarado(): string | null {
        const m = (document.body.innerText || '')
            .match(/cuota inicial m[ií]nima (?:es|de)\s*\$?\s*([\d.,]+)/i);
        const digitos = m?.[1]?.replace(/\D/g, '') ?? '';
        return digitos ? digitos : null;
    }

    /** Qué poner en un campo de texto, por su pista y, si no dice nada, por su `type`. */
    function valorPara(el: HTMLInputElement | HTMLTextAreaElement): string | null {
        const p = pista(el);
        if (ES_CUOTA_INICIAL.test(p)) return minimoDeclarado();
        for (const [re, valor] of REGLAS) if (re.test(p)) return valor;
        const tipo = (el as HTMLInputElement).type || 'text';
        if (tipo === 'email') return datos.email;
        if (tipo === 'tel') return datos.telefono;
        if (tipo === 'date') return datos.nacimiento;
        if (tipo === 'number') return datos.ingreso;
        if (tipo === 'password') return null;   // no se adivinan credenciales
        // Un texto sin pista: el maxLength delata a los códigos cortos (OTP partido en casillas).
        const max = Number(el.getAttribute('maxlength') || 0);
        if (max > 0 && max <= 2) return datos.otp.slice(0, max);
        if (max === 4) return datos.otp;
        if (max === 6) return datos.otpFirma;
        return null;
    }

    /**
     * ¿Este checkbox es de los que hay que aceptar para avanzar?
     *
     * ⚠ Incluye la CONFIRMACIÓN DE IDENTIDAD («¿Confirmás que sos X, titular del documento N?»), y no
     * estaba: es un checkbox sin `required` y sin la palabra «acepto», así que quedaba sin tildar y el
     * «Continuar» seguía deshabilitado con la pantalla entera llena — el peor final posible para una
     * ayuda de tipeo, porque parece que no hizo nada. Medido con una captura en la pantalla de fecha de
     * expedición.
     */
    const esAceptacion = (p: string) =>
        /acepto|autorizo|terminos|condiciones|politic|declaro|habeas|tratamiento|consentimiento|agree/.test(p)
        || /confirm|titular|es correcto|son correctos|corresponde/.test(p);

    /* LA REGLA DE FECHA VIENE DEL MÓDULO COMPARTIDO (`pkg/fecha-trio.ts`), inyectado como
     * `window.__trioFecha` por el `addInitScript` de más arriba. Antes vivía acá —`MESES`,
     * `fechaDelContexto` y la deducción por texto—, y el otro autorrelleno del harness no la tenía:
     * escribía `1 / Enero / <año actual>` como fecha de expedición, o sea el día de hoy. Tener la
     * regla en un solo lugar es lo que arregla eso sin que los dos archivos se fundan.
     *
     * ⚠ Se lee de `window` y no se importa PORQUE ESTE GUION SE SERIALIZA. Si el global no está, la
     * fecha se saltea en vez de inventarse una: un trío mal puesto es peor que un trío vacío, que al
     * menos se ve. */
    const TRIO = (window as any).__trioFecha as {
        MESES: string[];
        parteDeCombo: (t: string, e: string, i: number, m: string[]) => 'dia' | 'mes' | 'anio' | null;
        valorBuscado: (p: 'dia' | 'mes' | 'anio', f: string, m: string[]) => string[];
        fechaDeLaPantalla: (arriba: string, nac: string, exp: string) => string;
        yaMuestra: (t: string, buscado: string[]) => boolean;
        esTrioDeFecha: (partes: Array<'dia' | 'mes' | 'anio' | null>) => boolean;
    } | undefined;

    /** La fecha que pide ESTA pantalla, según el texto de arriba. */
    const fechaDeAca = () => TRIO
        ? TRIO.fechaDeLaPantalla((document.body.innerText || '').slice(0, 400), datos.nacimiento, datos.expedicion)
        : '';

    async function rellenar(): Promise<number> {
        let n = 0;

        // 1 · texto, número, fecha, textarea. Sólo VACÍOS: lo que escribiste es tuyo.
        for (const el of Array.from(document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea'))) {
            if (el.disabled || el.readOnly || !visible(el)) continue;
            const tipo = (el as HTMLInputElement).type;
            if (['checkbox', 'radio', 'hidden', 'file', 'submit', 'button', 'password'].includes(tipo)) continue;
            if (el.value) continue;
            const v = valorPara(el);
            if (v == null) continue;
            escribir(el, v);
            n++;
        }

        /* 2 · SELECTS NATIVOS. Dos casos, y el segundo costó una captura para verlo.
         *
         *   · Un select cualquiera: la primera opción REAL (saltando el placeholder, que suele venir con
         *     `value` vacío o con el texto «Seleccione»).
         *
         *   · ⚠ Un select que es PARTE DE UNA FECHA (el trío día / mes / año): ahí «la primera opción de
         *     cada uno» no es un relleno, es una fecha INVENTADA — daba `2026-01-01` como fecha de
         *     expedición del documento, o sea el día de hoy en el futuro, que ninguna validación de
         *     negocio acepta. Se resuelven JUNTOS, desde la fecha que corresponde a la pantalla.
         *
         * Y por eso los de fecha se escriben AUNQUE YA TENGAN VALOR: el trío nace con un default propio
         * (1 / Enero / el año actual) que no lo eligió nadie, así que respetarlo sería respetar un
         * relleno del componente y no una decisión humana. Se tocan UNA vez —`tocados` lo recuerda—, así
         * que si después elegís otra fecha, es tuya y no se vuelve a pisar. */
        /** Elige la opción que representa `texto`, comparando por value y por etiqueta. */
        function elegirOpcion(sel: HTMLSelectElement, candidatos: string[]): boolean {
            for (const c of candidatos) {
                const opt = Array.from(sel.options).find((o) =>
                    o.value === c || norm(o.textContent || '') === norm(c)
                    || (/^\d+$/.test(c) && Number(o.value) === Number(c)));
                if (opt) { escribir(sel, opt.value); return true; }
            }
            return false;
        }

        for (const sel of Array.from(document.querySelectorAll<HTMLSelectElement>('select'))) {
            if (sel.disabled || !visible(sel)) continue;
            const p = pista(sel);
            const esFecha = /\bdia\b|\bday\b|\bmes\b|\bmonth\b|\banio\b|\bano\b|\byear\b/.test(p);

            if (esFecha) {
                if (!TRIO) continue;
                // La parte sale de la PISTA del select (tiene `name`/`label`, a diferencia de los de
                // Radix), y el valor de la regla compartida.
                const parte = TRIO.parteDeCombo('', p, 9, TRIO.MESES);
                if (!parte) continue;
                const cand = TRIO.valorBuscado(parte, fechaDeAca(), TRIO.MESES);
                // Idempotente igual que el trío de Radix: si ya está elegido, no se vuelve a tocar.
                const actual = sel.options[sel.selectedIndex]?.textContent ?? sel.value;
                if (TRIO.yaMuestra(actual, cand)) continue;
                if (elegirOpcion(sel, cand)) n++;
                continue;
            }

            if (sel.value) continue;
            const opt = Array.from(sel.options).find((o) => o.value && !/seleccion|elegi|choose|select/i.test(o.textContent || ''));
            if (!opt) continue;
            escribir(sel, opt.value);
            n++;
        }

        // 3 · aceptaciones. Se tildan las de términos/autorizaciones y las `required`, no todas: un
        //     checkbox suelto puede ser una opción de producto, y tildarla cambiaría lo que se prueba.
        for (const el of Array.from(document.querySelectorAll<HTMLInputElement>('input[type=checkbox]'))) {
            if (el.disabled || el.checked || !visible(el)) continue;
            const p = pistaConContexto(el);
            if (!esAceptacion(p) && !el.required && el.getAttribute('aria-required') !== 'true') continue;
            el.click();
            n++;
        }

        /* 3b · LOS CHECKBOX DE RADIX, que no son `input[type=checkbox]` sino
         *      `button[role=checkbox][aria-checked=false]`. Es el caso que dejaba el «Continuar»
         *      deshabilitado con la pantalla entera llena: la confirmación de identidad
         *      (`#confirmIdentity`) es uno de éstos, y ningún selector nativo lo ve. Se aplica el mismo
         *      criterio que a los nativos —sólo aceptaciones, no cualquier checkbox—, y por eso hizo
         *      falta que `pista` mire los ancestros: acá la pregunta no está en un `label`. */
        for (const el of Array.from(document.querySelectorAll<HTMLElement>('[role=checkbox]'))) {
            if (!visible(el) || el.getAttribute('aria-checked') !== 'false') continue;
            if (el.getAttribute('aria-disabled') === 'true') continue;
            const p = pistaConContexto(el);
            if (!esAceptacion(p) && el.getAttribute('aria-required') !== 'true') continue;
            el.click();
            n++;
        }

        // 4 · radios: el primero de cada grupo que no tenga nada elegido.
        const grupos = new Set<string>();
        for (const el of Array.from(document.querySelectorAll<HTMLInputElement>('input[type=radio]'))) {
            if (el.disabled || !visible(el) || !el.name || grupos.has(el.name)) continue;
            grupos.add(el.name);
            if (document.querySelector<HTMLInputElement>(`input[type=radio][name="${CSS.escape(el.name)}"]:checked`)) continue;
            el.click();
            n++;
        }

        /* 5 · LOS COMBOBOX QUE NO SON `<select>`. El wizard usa los de shadcn/radix —un botón con un
         *     popover—, y son justo los peores de llenar a mano (departamento, ciudad, ocupación). No
         *     se les puede escribir el valor: hay que abrir y elegir, así que esto CLICKEA. Va último y
         *     de a uno, esperando que el listado aparezca, porque cada elección puede cambiar el
         *     siguiente (el clásico departamento → ciudad).
         *     Se elige la PRIMERA opción: alcanza para avanzar, y si la prueba necesita una ciudad
         *     concreta la cambiás vos — el autorelleno no la vuelve a pisar. */
        const espera = (ms: number) => new Promise((r) => setTimeout(r, ms));

        /** Cierra el popover de un trigger de radix DE VERDAD, y lo comprueba.
         *
         *  ⚠ Antes se cerraba con un segundo `trigger.click()`, y eso NO alcanza: con el contenido
         *  abierto radix atrapa el foco, y un click sintetico sobre el trigger no siempre le llega.
         *  El popover quedaba colgado — y como la busqueda de opciones era global (ver abajo), el
         *  siguiente trigger abria el suyo y quedaban DOS listas abiertas, una encima de la otra.
         *  Escape es la salida que radix si escucha siempre. */
        async function cerrarPopover(trigger: HTMLElement): Promise<void> {
            for (const intento of [0, 1]) {
                if (trigger.getAttribute('aria-expanded') !== 'true') return;
                const ev = { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true } as KeyboardEventInit;
                (document.activeElement ?? trigger).dispatchEvent(new KeyboardEvent('keydown', ev));
                await espera(intento === 0 ? 80 : 200);
            }
            // Ultimo recurso: un pointerdown afuera, que es la otra forma en que radix cierra.
            if (trigger.getAttribute('aria-expanded') === 'true') {
                document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
                await espera(80);
            }
        }

        /** Abre un trigger de radix y clickea la opción que matchee, o la primera si no se pide ninguna. */
        async function elegirEnPopover(trigger: HTMLElement, buscado?: string[]): Promise<boolean> {
            trigger.click();
            await espera(200);
            /* ⚠ LAS OPCIONES SE BUSCAN DENTRO DEL POPOVER DE **ESTE** TRIGGER, no en el documento.
             * Era `document.querySelectorAll('[role=option]')`, global: con dos popovers abiertos
             * juntaba las opciones de los dos y `opciones[0]` podía ser de OTRA tarjeta. En
             * `/lenders`, donde hay un selector de plazo por entidad, eso es elegir en la lista
             * equivocada. Radix pone el id del contenido en `aria-controls` del trigger. */
            const panelId = trigger.getAttribute('aria-controls');
            const panel = panelId ? document.getElementById(panelId) : null;
            const raiz: ParentNode = panel ?? document;
            const opciones = Array.from(raiz.querySelectorAll<HTMLElement>('[role=option]:not([aria-disabled=true])'));
            if (!opciones.length) { await cerrarPopover(trigger); return false; }
            const elegida = buscado
                ? opciones.find((o) => buscado.some((b) => norm(o.textContent || '') === norm(b)))
                : opciones[0];
            if (!elegida) { await cerrarPopover(trigger); return false; }
            elegida.click();
            await espera(180);
            // Elegir CIERRA el popover en radix; si no cerro, el click no se registro como seleccion
            // y dejarlo abierto es lo que se ve como «el select quedo pegado».
            await cerrarPopover(trigger);
            return true;
        }

        /* ⚠ EL TRÍO DE FECHA DE RADIX es el caso que costó dos capturas. Son
         * `button[role=combobox]` sin `name` ni `id`, así que la única señal de qué parte es cada uno
         * está en lo que MUESTRAN — y eso lo decide ahora la regla compartida (`pkg/fecha-trio.ts`),
         * que además cubre el caso que este archivo no veía: el combo VACÍO, que en vez de un valor
         * muestra su placeholder («Día*»). El resto de acá es sólo la mecánica del popover. */
        const triggers = Array.from(document.querySelectorAll<HTMLElement>('[role=combobox],[aria-haspopup=listbox]'))
            .filter((t) => visible(t) && t.getAttribute('aria-disabled') !== 'true');

        /* Se pregunta por el subconjunto que PARECE fecha, no por todos los combos de la pantalla: un
           selector de cuotas también cae en «uno o dos dígitos» y no es un día. */
        const textos = triggers.map((t) => (t.textContent || '').trim());
        const candidatos = TRIO
            ? triggers.map((t, i) => ({ p: TRIO.parteDeCombo(textos[i], pista(t), i, TRIO.MESES), i }))
                .filter((x) => x.p !== null)
            : [];
        const esFechaCompleta = TRIO ? TRIO.esTrioDeFecha(candidatos.map((x) => x.p)) : false;
        const indicesDeFecha = new Set(esFechaCompleta ? candidatos.map((x) => x.i) : []);

        if (TRIO && esFechaCompleta) {
            {
                const fecha = fechaDeAca();
                for (const { p, i } of candidatos) {
                    const buscado = TRIO.valorBuscado(p!, fecha, TRIO.MESES);
                    /* ⚠ SI YA MUESTRA LO QUE QUEREMOS, NO SE TOCA. Esto reemplazó a `tocados`, que NO
                       alcanzaba: era un WeakSet keyeado por el ELEMENTO, y Radix REEMPLAZA el nodo del
                       trigger cuando cambia su valor — en la pasada siguiente el nodo es otro,
                       `tocados.has(t)` da falso y la fecha se volvía a elegir. Eso es lo que se veía
                       como «la fecha de expedición cambia dos veces». */
                    if (TRIO.yaMuestra(textos[i], buscado)) continue;
                    if (await elegirEnPopover(triggers[i], buscado)) n++;
                }
            }
        }

        for (let i = 0; i < triggers.length; i++) {
            const trigger = triggers[i];
            if (indicesDeFecha.has(i)) continue;   // ya lo resolvió el trío
            // `data-placeholder` (o un texto que diga «Seleccion…») delata que todavía no eligió nada.
            const vacio = trigger.hasAttribute('data-placeholder')
                || /seleccion|elegi|choose|select/i.test(trigger.textContent || '');
            if (!vacio) continue;
            if (await elegirEnPopover(trigger)) n++;
        }

        return n;
    }

    // ── LA CHAPITA ──────────────────────────────────────────────────────────────────────────────────
    // Existe para que el autorelleno sea VISIBLE y apagable. Una ayuda invisible que toca el formulario
    // es indistinguible de un bug del front: al ver un campo lleno que nadie escribió, lo primero que
    // se piensa es que la app lo trajo de algún lado.
    function chapita() {
        if (document.getElementById('__autorelleno_chip')) return;
        const box = document.createElement('div');
        box.id = '__autorelleno_chip';
        /* LA ETIQUETA DEL COMERCIO. El hash de la sucursal está en la URL (`/merchant/<hash>/…` o
           `/self-service/<hash>/…`), y `.flows.json` sabe de quién es. Se dibuja aunque no lo conozca:
           el hash solo ya alcanza para ver que estás en OTRA ventana. */
        const hashEnUrl = location.pathname.match(/\/(?:merchant|self-service|ecommerce)\/([0-9a-f]{6,})/i)?.[1];
        if (hashEnUrl) {
            const et = document.createElement('span');
            et.textContent = `${datos.comercios?.[hashEnUrl] ?? '?'} · ${hashEnUrl}`;
            et.title = 'El comercio de ESTA ventana. Si no es el que elegiste en el panel, estás mirando la ventana de una corrida anterior.';
            et.style.cssText = 'background:#161b22;padding:7px 9px;border-radius:6px;color:#8b949e;font-weight:500';
            box.appendChild(et);
        }
        /* ABAJO A LA IZQUIERDA, y no a la derecha: ahí vive el overlay de React Scan del wizard en dev
           (el contador de FPS), y las dos cosas se tapaban — medido con una captura. La derecha es de
           la app; la izquierda está libre. */
        box.style.cssText = 'position:fixed;z-index:2147483647;left:10px;bottom:10px;display:flex;gap:6px;'
            + 'align-items:center;font:600 11px/1 ui-sans-serif,system-ui;color:#fff';
        const btn = document.createElement('button');
        btn.textContent = '⌨ Rellenar';
        btn.title = 'Rellena los campos VACÍOS de esta pantalla (⌥R). Nunca aprieta Continuar.';
        btn.style.cssText = 'all:unset;cursor:pointer;background:#1f6feb;padding:7px 10px;border-radius:6px';
        const auto = document.createElement('button');
        auto.style.cssText = btn.style.cssText + ';background:#30363d';
        let encendido = true;
        const pintar = () => { auto.textContent = encendido ? 'auto: sí' : 'auto: no'; };
        pintar();
        auto.onclick = () => { encendido = !encendido; pintar(); };
        auto.title = 'Con auto, cada pantalla nueva se rellena sola. Sin auto, sólo cuando apretás Rellenar.';
        const cuantos = (n: number) => { btn.textContent = n ? `⌨ ${n} campo${n === 1 ? '' : 's'}` : '⌨ nada que llenar';
            setTimeout(() => { btn.textContent = '⌨ Rellenar'; }, 1400); };
        // `disparar` existe aparte del handler para poder llamarlo desde el atajo de teclado: invocar
        // `btn.onclick` a mano obliga a fabricar un PointerEvent que a nadie le importa.
        const disparar = async () => cuantos(await rellenar());   // manual: SIEMPRE corre, aunque el auto esté apagado
        btn.onclick = disparar;
        box.append(btn, auto);
        document.body.appendChild(box);

        window.addEventListener('keydown', (e) => {
            if (e.altKey && (e.key === 'r' || e.key === 'R')) { e.preventDefault(); void disparar(); }
        });

        /* AUTO: se rellena cuando aparece un formulario nuevo. Va con `debounce` y no en cada mutación
         * porque React monta la pantalla en varias tandas, y rellenar a mitad del montaje escribe en
         * campos que se van a re-crear. Se relee el DOM cada vez, así que un paso que agrega campos
         * (el formulario dinámico, el condicional de una ciudad) también queda cubierto. */
        let t: number | undefined;
        /* ⚠ EL OBSERVER SE ALIMENTABA DE SÍ MISMO, y era la otra mitad de «la fecha cambia dos veces».
         * `rellenar()` MUTA el DOM —abre y cierra popovers de Radix, escribe en inputs—, y este
         * observer mira `document.body` con `subtree`: cada relleno agendaba el siguiente, 420 ms
         * después de su propia última mutación. Con la fecha se notaba porque el trío es lo único que
         * se re-escribe aunque ya tenga valor.
         * `corriendo` corta el lazo: mientras rellena, las mutaciones que él produce no cuentan. El
         * `finally` es lo que evita que una excepción deje el autorrelleno apagado para siempre. */
        let corriendo = false;
        const rellenarUnaVez = async () => {
            if (corriendo) return;
            corriendo = true;
            try { await rellenar(); } finally { corriendo = false; }
        };
        const obs = new MutationObserver(() => {
            if (!encendido || corriendo) return;
            clearTimeout(t);
            t = window.setTimeout(() => { void rellenarUnaVez(); }, 420);
        });
        obs.observe(document.body, { childList: true, subtree: true });
        if (encendido) setTimeout(() => { void rellenarUnaVez(); }, 700);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', chapita);
    else chapita();
}
