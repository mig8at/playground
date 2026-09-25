// walk-wizard.ts — el WIZARD de punta a punta POR HTTP: pasa por todas las pantallas, sin navegador.
//
//   node dev/walk-wizard.ts --casos '#e9409aff:77' --cerrar --manual
//   node dev/walk-wizard.ts --casos 'pullman:77;pullman:77;pullman:77' --paralelo --cerrar --manual
//   node dev/walk-wizard.ts --comercio pullman --lender 77 --amount 2000000 --income 2500000 --score 700
//
// ES EL TERCER CAMINO, y contesta otra pregunta que los dos que ya había:
//   · `dev/case.ts`     → pega contra el BACKEND: dice si el backend decide bien. No ve el front.
//   · el panel          → recorrido VISUAL por el front, pero lo conduce una persona.
//   · éste              → recorre el FRONT por sus endpoints `.data` (ver `pkg/front.ts`): corre los
//                         loaders, los actions, el middleware y las validaciones zod de cada pantalla,
//                         en segundos y en paralelo. Lo que no corre es el JavaScript del cliente.
// Por qué hace falta el tercero: el bug de F-50 —un tipo de validación que el front no contempla y
// que termina cancelando el crédito— vive en un `action`. `case.ts` no pasa por ahí, y el panel
// necesita a alguien clickeando. Medido el 2026-09-02 con la uReq 502039 en qa.
//
// LA REGLA QUE LO HACE SEGURO: sólo se siguen las redirecciones que la app emite. Acá NO se adivina
// ninguna URL, porque en este wizard hay loaders que ESCRIBEN (`request-canceled` cancela con sólo
// cargarse). Si el front redirige a una ruta prohibida, el caminador NO la pide: lo reporta como
// desenlace y contrasta la BD. Ver `FORBIDDEN` en `pkg/front.ts`.
//
// LA ÚNICA URL QUE ESTE RUNNER ARMA SOLO ES EL HANDOFF. Al elegir una entidad CreditopX (rt=2/3/4),
// el backend arma `/self-service/<hash>/<ureq>/confirmation` y se lo manda al CUSTOMER por WhatsApp
// (`UserRequestService`: `standBy=true` + `sendSelfManagement`); el front del que eligió sólo muestra
// «se envió un mensaje». El caminador hace lo que haría el cliente al tocar el link: abre esa
// pantalla. Es el mismo salto A→B que hace el panel (`guided.spec.ts`), y se imprime como tal.
//
// CANAL (`--flow`): `self-service` por defecto (autogestión, sin sesión) · `merchant` (asesor: carga la
// sesión Cognito que cacheó el panel, ver `correr`) · `ecommerce` (entra por el CHECKOUT de la tienda con
// un contrato base64 armado con la identidad del caso, sigue el 302 con `?erId=`, y comprueba lo único
// que ese canal promete: que la solicitud quede ATADA al pedido y que personal-info llegue con los
// campos del comercio prellenados y bloqueados — `lockedFields`, la decisión del propio loader). El
// motor navegador cubre los dos primeros; ecommerce sólo el HTTP.
//
// QUÉ SEED: lo mismo que `case.ts` y el panel, y por la misma razón —el buró no lo contesta el
// proveedor en local/dev— (`synthFill` al llegar a personal-info) y, con `--manual`, la validación
// manual de identidad (`manualValidation`, ver su cabecera). El teléfono y la cédula se DERIVAN por
// caso, igual que en `case.ts`: así dos casos en paralelo nunca comparten usuario.
// Con `--lambda` además se le DICTAN el empleo y el buró al mock de centrales para esa cédula, antes de
// arrancar: sin eso, al enviar personal-info Agildata contesta su default —una persona sin empleo— y
// Experian su reporte fijo, y el perfilamiento evalúa las categorías con eso (ver `employmentFor`).
//
// LAS TRES FUENTES: cada pantalla se contrasta con la BD en el momento (la columna de la derecha), y si
// el caso termina MAL se consulta además PostHog —qué eventos dejó y en qué pantalla registró el error—.
// Si cerró bien no se consulta nada, la misma regla que el forense de Loki. `FORENSE=1` lo fuerza.
//
// SALIDA: por caso, la lista de pantallas «NN /ruta │ BD estado», como el panel, y al final si cerró.
// Sin `--cerrar` se detiene al LISTAR (rápido, para barrer comercios); con `--cerrar` sigue hasta
// `loan-approved` y comprueba el estado 11 en la BD.
process.env.E2E_TARGET ||= 'local';
export {};

const { FrontSession } = await import('../pkg/front.ts');
const { one, exec, close, TARGET, writeLines, dumpWrites } = await import('../pkg/db.ts');
const { synthFill, manualValidation } = await import('../pkg/inject.ts');
const { dictateEmployment, dictateBureauProfile, LAMBDA: RISK_LAMBDA } = await import('../pkg/risk-lambda.ts');
const { payDownPayment } = await import('../pkg/wompi-down-payment.ts');
const { config, docGenNotice, backendLogsNotice } = await import('../pkg/config.ts');
const { env } = await import('../pkg/env.ts');
const { branchDocument, branchPhone, syntheticPhone } = await import('../pkg/phones.ts');
const { findBranch: findBranchIn, merchantDocumentType: documentType } = await import('../pkg/merchants.ts');
const { postHogForensic } = await import('../pkg/posthog.ts');
const { createTrace, EXPECTED_STATUS } = await import('../pkg/trace.ts');
const { openBrowser, openContext, evidenceNotice, closeContext, advance, chooseEntity, errorBanner, waitForChange } =
    await import('../pkg/wizard-browser.ts');
const { validationErrors: screenErrors } = await import('../pkg/autofill-qr.ts');
const { mkdirSync, readFileSync, statSync } = await import('node:fs');
const { cognitoStorageState, COGNITO_STATE_PATH, sessionHealth, howToRenewSession, renewSession } = await import('../pkg/cognito.ts');
const { branchToken, ecommerceContract } = await import('../pkg/ecommerce.ts');
const { registerBypass, restoreBypass } = await import('../pkg/otp-bypass.ts');

type Form = Record<string, string | number | null | undefined>;

// ─── argumentos ──────────────────────────────────────────────────────────────────────────────────
const arg = (n: string, d = ''): string => {
    const i = process.argv.indexOf(`--${n}`);
    return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d;
};
const flag = (n: string) => process.argv.includes(`--${n}`);

const FLOW = arg('flow', 'self-service');
/**
 * ¿HAY UN SOLO DISPOSITIVO EN ESTE CANAL? Sin asesor —autogestión y ecommerce— el que está frente a la
 * pantalla ES el cliente, en su propio navegador: no hay «celular del cliente» al que entregarle nada.
 * Acá no hay ventanas (esto va por HTTP), pero el rastro las NOMBRABA igual —«B (celular): handoff»— y
 * un nombre que no corresponde se lee como si el producto pidiera dos pantallas. Medido el 2026-09-15:
 * el front manda a `/continue` en los dos canales, así que el desajuste se veía en los dos.
 */
const SINGLE_DEVICE = FLOW === 'self-service' || FLOW === 'ecommerce';
/** Cómo se NOMBRA el tramo del cliente en el rastro: el arnés dice lo que hay, no lo que supone. */
const CUSTOMER_SEGMENT = SINGLE_DEVICE ? 'el cliente sigue acá (un solo dispositivo)' : 'B (celular): handoff';
const AMOUNT = Number(arg('amount', '2000000'));
/**
 * Qué contestar en un GATE MANUAL — una pantalla que no tiene «Continuar» sino una DECISIÓN
 * («Aprobado» / «Rechazado»), como `entidad/resultado` del vehicular de BCP.
 *
 * ⚠ SIN BANDERA EL CAMINADOR SE DETIENE, y es a propósito. Adivinar acá no es avanzar: es tomar por su
 * cuenta la decisión que la pantalla existe para pedirle a una persona, y cada rama deja la solicitud en
 * un estado distinto (aprobar sigue el flujo; rechazar la deja NEGADA). El runner por HTTP usa el mismo
 * criterio con `--niega`.
 *
 * ⚠ Y «rechazado» fuera de LOCAL deja basura en una base COMPARTIDA: por eso se exige nombrarlo.
 */
const GATE = arg('gate').trim().toLowerCase();
if (GATE && !['aprobado', 'rechazado'].includes(GATE)) {
    console.log(`\n  ✗ --gate sólo acepta «aprobado» o «rechazado» (vino «${GATE}»)\n`);
    process.exit(2);
}
const INCOME = Number(arg('income', '2500000'));
const SCORE = Number(arg('score', '700'));
/**
 * El plazo a elegir en el plan de pagos. SIN valor por defecto a propósito.
 *
 * ⚠ Antes era `4`, y ninguna entidad de este sistema ofrece 4 —dan `1,3,6,12`, o `1..6`
 * Sistecrédito—, así que el pedido no matcheaba nunca y se caía al respaldo. Y el respaldo era
 * `planes[0]`: como el plan llega ASCENDENTE, eso es **1 cuota**. O sea que todas las corridas
 * cerraban con un solo pago, que es el caso que menos ejercita: sin amortización entre períodos, sin
 * seguro por cuota, sin los factores de ajuste de capital. Cerraban en verde sin probar el plazo.
 *
 * Sin `--cuotas`, ahora se toma el MÁS LARGO que la entidad ofrezca: es el que más maquinaria mueve.
 */
const INSTALLMENTS = arg('cuotas') ? Number(arg('cuotas')) : null;
/** La CUOTA INICIAL que el asesor carga en el listado. Va en 0 por defecto porque es lo que hace
 *  el grueso de las corridas, pero **tiene que poder no serlo**: con `initial_fee > 0` el action de
 *  `available-lenders` toma una rama entera que con 0 no se ejecuta nunca —el cobro por pasarela—,
 *  y ahí vivía el rebote a `/solicitar` que se llevó puesto el merge a `main` del 14/9. Mientras
 *  esto estuvo quemado en 0, este caminador **no podía ver ese bug**, y por eso la validación previa
 *  al merge dio verde en el canal del asesor. El campo sólo se ofrece cuando el comercio tiene
 *  `allieds.initial_fee = 1`. */
const DOWN_PAYMENT = Number(arg('cuota-inicial', '0'));
const MAX_STEPS = 40;
/** ⚠ TOPE DE TIEMPO POR CASO, y no es un lujo: el 2026-09-03 una corrida del motor de navegador contra el
 *  canal de asesor giró **18 minutos sin imprimir una línea**. Cada vuelta del bucle puede esperar
 *  `networkidle` (20 s) más el cambio de URL (25 s) más los reintentos del click, así que 40 vueltas sin
 *  progreso son media hora de silencio — y en paralelo, media hora por caso. Un runner que no puede
 *  terminar es peor que uno que falla. */
const LIMIT_MS = Number(arg('tope', '480')) * 1000;   // 8 min: un caso entero por navegador y con PDF por plantillas ronda los 4
/** Vueltas seguidas sin que cambie la pantalla antes de darla por trabada. Varias pantallas tienen pasos
 *  internos con la MISMA URL (`personal-info` son dos), así que no alcanza con «la URL no cambió». */
const MAX_WITHOUT_PROGRESS = 4;
/** `http` (default) habla el protocolo del front; `navegador` abre Chromium sin ventana y clickea.
 *  Mismo caso, misma siembra, misma traza, mismo forense: lo único distinto es cómo se opera la pantalla. */
const ENGINE = arg('motor', 'http') === 'navegador' ? 'navegador' : 'http';

type Case = { ref: string; lender: number | null };
function parseCases(): Case[] {
    const raws = arg('casos') ? arg('casos').split(';').map((s) => s.trim()).filter(Boolean)
        : [`${arg('comercio', 'pullman')}${arg('lender') ? `:${arg('lender')}` : ''}`];
    return raws.map((c) => {
        const [ref, lender] = c.split(':');
        return { ref, lender: lender ? Number(lender) : null };
    });
}

// ─── derivados por caso (mismo criterio que case.ts: nunca dos casos con el mismo usuario) ──────
const BASE_DOC = 1_090_000_000 + ((Date.now() / 100) % 9_000_000 | 0);
const idNumberOf = (i: number) => String(BASE_DOC + i);
/** El de respaldo, para cuando el comercio NO resuelve y no se le puede preguntar el país.
 *
 * ⚠ ACÁ ESTABA QUEMADA LA FORMA COLOMBIANA (`32` + 8 dígitos), y era el agujero que dejaba abierto el
 * arreglo de más abajo: `merchantPhone` sí preguntaba el país, pero cuando fallaba se caía JUSTO
 * a este literal — o sea que un comercio de otro país que tardara en resolver terminaba con un móvil
 * colombiano y moría en el primer paso, con un error que no habla de teléfonos. Ahora el respaldo sale
 * de la misma tabla, así que lo peor que pasa es que use el país por defecto y no una forma inventada.
 */
const phoneOf = (i: number) => syntheticPhone('COL', i, BASE_DOC);
const merchantDocument = (hash: string, i: number) => branchDocument(hash, i, BASE_DOC);

/**
 * ⚠ EL TELÉFONO Y EL DOCUMENT SALEN DEL COMERCIO, no de acá.
 *
 * Con los colombianos quemados este runner **no podía caminar un comercio de otro país**: contra el
 * peruano el primer paso muere con «Ocurrió un error» (su país pide 9 dígitos y `phoneOf` da 10) y
 * contra el dominicano moriría en el formulario («el tipo de documento no está habilitado en este
 * punto de venta»). Medido el 2026-09-07 contra el comercio de Perú: 1 pantalla y afuera.
 *
 * Las dos lecciones ya estaban aprendidas en `case.ts` y la capacidad ya existía en
 * `pkg/merchants.ts` — lo que faltaba era usarla acá. El largo NO es una regla del código: sale de
 * `countries.cell_phone_lenght`; el tipo de documento lo publica el backend en el payload del
 * comercio, ya recortado por el catálogo del país.
 */
const merchantPhone = (hash: string, i: number) => branchPhone(hash, Number(`3${String(BASE_DOC).slice(-6)}${String(i % 100).padStart(2, '0')}`));

const merchantDocumentType = (hash: string) => documentType(config.mockUrl, hash);

// `findBranch` y `merchantDocumentType` viven en `pkg/merchants.ts`: estaban duplicadas
// con `case.ts` y ya habían divergido (sólo esta copia sabía de `con-tienda`).
const findBranch = (ref: string) => findBranchIn(ref, FLOW === 'ecommerce' ? 'con-tienda' : 'con-mas-entidades');

// El bypass de OTP fuera de local vive en `pkg/otp-bypass.ts`: lo usan los dos runners y estaba
// duplicado en los dos, con dos versiones del mismo comentario. Ver ahí por qué la suma es atómica y
// por qué la escritura ya no pide el permiso general.

/** La siembra que los dos motores necesitan al llegar al formulario: el buró (el proveedor no contesta
 *  en local/dev), las dos fotos de la cédula (sin ellas la formalización muere al final) y, con
 *  `--manual`, la validación de identidad. Vive acá y no en cada motor para no tener dos siembras. */
async function seed(ur: number, doc: string, log: (s: string) => void, lender?: number): Promise<void> {
    // ⚠ Con `lender`, `synthFill` deriva el perfil que CUMPLE las reglas de esa entidad
    // (`deriveSynthReq`); sin él usa uno genérico. Y entonces NO se le pasan `income`/`score`: pisarían
    // justo lo que la derivación acaba de calcular.
    const injected = lender
        ? await synthFill(ur, { lender, skipIdentity: true } as any)
        : await synthFill(ur, { income: INCOME, score: SCORE, skipIdentity: true } as any);
    const u = await one<{ user_id: number }>('SELECT user_id FROM user_requests WHERE id=?', [ur]).catch(() => null);
    if (u?.user_id) await exec('UPDATE users SET front_url=?, back_url=?, updated_at=NOW() WHERE id=?',
        [`https://mock-s3.local/front-web/users/documents/synth/${doc}/frontal.jpg`,
         `https://mock-s3.local/front-web/users/documents/synth/${doc}/reverso.jpg`, u.user_id]).catch(() => null);
    if (flag('manual') && u?.user_id) await manualValidation(u.user_id);
    log(`buró inyectado para uReq ${ur} (Experian ${injected.datacredito_forged})${flag('manual') ? ' · identidad aprobada a mano' : ''}`);
}

/**
 * `--lambda`: le dicta al mock de centrales un empleo para la cédula del caso, ANTES de que arranque.
 *
 * ⚠ La siembra de arriba NO alcanza para las categorías. `synthFill` escribe la ocupación al CARGAR
 * personal-info, pero al ENVIARLA el backend consulta Agildata y guarda lo que conteste, y con eso
 * evalúa las categorías de cada entidad. Para una cédula que no se dictó el mock contesta una persona
 * sin empleo. Medido el 2026-09-25 en local (Amoblando Pullman, CrediPullman): la categoría Premium se
 * rechazaba sólo por `occupation` y el cliente caía en «Segunda oportunidad», que exige cuota inicial.
 * Esa rama también cierra —`/down-payment` se paga contra el mock de Wompi—, pero es otro caso.
 *
 * Sólo contra el mock local, salvo que `RISK_LAMBDA_URL` diga otro: en dev/qa el backend le pregunta a
 * la lambda de la empresa, y dictarle al mock de esta máquina no cambiaría nada.
 */
async function employmentFor(doc: string, log: (s: string) => void): Promise<void> {
    if (!flag('lambda')) return;
    if (TARGET !== 'local' && !process.env.RISK_LAMBDA_URL) {
        log(`--lambda ignorado: contra ${TARGET} el backend no le pregunta al mock local (${RISK_LAMBDA}); pasá RISK_LAMBDA_URL`);
        return;
    }
    const occupation = arg('ocupacion', 'Empleado');
    const ok = await dictateEmployment(doc, INCOME, occupation);
    log(ok
        ? `empleo dictado al mock de centrales para ${doc}: ${occupation} · ${INCOME}`
        : `⚠ el empleo NO quedó dictado para ${doc} (${RISK_LAMBDA}): Agildata va a contestar su default`);
    // Y el buró: sin esto Experian contesta su reporte fijo (score 654, 59 consultas, sin tarjetas).
    // Mismo perfil que siembra `synthFill` —consultas 1— más el score del caso y una tarjeta activa.
    const bureau = { score: SCORE, consultedLast6Months: 1, creditCards: 1 };
    log(await dictateBureauProfile(doc, bureau)
        ? `buró dictado para ${doc}: score ${bureau.score} · ${bureau.consultedLast6Months} consulta · ${bureau.creditCards} tarjeta`
        : `⚠ el buró NO quedó dictado para ${doc} (${RISK_LAMBDA}): Experian va a contestar su reporte fijo`);
}

// ─── la traza contra la BD ───────────────────────────────────────────────────────────────────────
// Es `pkg/trace.ts`, no una copia: la misma clase que usan el visual y el rápido, así que «pasó» tiene
// UNA definición para los tres (la regla de harness/CLAUDE.md). Se pide **una instancia por caso** —
// `createTrace({ salida })`— porque en paralelo el estado compartido entrelazaría las líneas y el uReq.
// La única cosa que este runner sigue leyendo por su cuenta es si un estado SELLA, para decidir el
// desenlace; el mapa viene de `EXPECTED_STATUS`, no de un Set propio.
const sealed = (st: number | null | undefined) => st === EXPECTED_STATUS.success || st === 28;

type Result = {
    caso: string; ur: number | null; tel: string; doc: string;
    pantallas: number; listado: number[]; enListado: boolean | null;
    fin: 'cerro' | 'listo' | 'trabado' | 'malo'; motivo: string; estado: number | null; ms: number;
    lineas: string[];
};

// ─── un caso ─────────────────────────────────────────────────────────────────────────────────────
async function correr(c: Case, i: number): Promise<Result> {
    const t0 = Date.now();
    // Provisorio: el definitivo sale del país del comercio, y para eso hay que resolverlo primero.
    let tel = phoneOf(i);
    let doc = idNumberOf(i);
    const lines: string[] = [];
    const log = (s: string) => lines.push(`  ▸ ${s}`);
    const r: Result = { caso: c.ref + (c.lender ? `:${c.lender}` : ''), ur: null, tel, doc, pantallas: 0,
        listado: [], enListado: null, fin: 'trabado', motivo: '', estado: null, ms: 0, lineas: lines };
    const walkedPaths: string[] = [];
    // ── LA TERCERA FUENTE, Y SÓLO CUANDO HACE FALTA ──
    // PostHog dice en qué PANTALLA del front se rompió, que es lo que ni la BD ni Loki (que sólo ve
    // legacy-backend) pueden decir. Pero se consulta **sólo si el caso terminó mal**, la misma regla que
    // ya seguía `forensicOnClose` de Loki: si cerró como se pedía, no se pregunta nada.
    //
    // No es tacañería, son tres cosas medidas el 2026-09-02 con el forense puesto en TODAS las corridas:
    //   · CUESTA: la ingesta tarda minutos, y esperarla llevó una corrida de 108 s a 128, y otra a 237.
    //   · NO APORTA en el caso feliz: con la solicitud en estado 11, los 18 eventos son narración del
    //     embudo; el diagnóstico ya lo dio la traza contra la BD.
    //   · LLEGA A MEDIAS justo cuando serviría: al cerrar, la ingesta todavía no trajo el final y sale
    //     marcado PARCIAL. Por eso, cuando el caso falla, esto imprime lo que HAY y deja el comando para
    //     volver a mirarlo completo unos minutos después (`dev/posthog-ureq.ts`).
    // `FORENSE=1` lo fuerza igual, para cuando lo que se está probando es el forense mismo.
    const finish = async (end: Result['fin'], reason: string) => {
        r.fin = end; r.motivo = reason; r.ms = Date.now() - t0;
        await t.drenar();   // que no queden líneas en vuelo después del resumen
        const wentWrong = end === 'malo' || end === 'trabado';
        if (r.ur && walkedPaths.length && (wentWrong || process.env.FORENSE === '1')) {
            await postHogForensic(r.ur, new Date(t0), walkedPaths, (l) => lines.push(l), new Date()).catch(() => {});
        } else if (r.ur && !wentWrong) {
            lines.push(`  ▸ PostHog: no se consulta porque el caso cerró como se pedía · si lo querés: make harness-posthog UREQ=${r.ur} DESDE=${new Date(t0 - 60_000).toISOString()}`);
        }
        return r;
    };

    const br = await findBranch(c.ref);
    if (!br) return finish('trabado', `no encontré la sucursal «${c.ref}»`);
    // El teléfono y el documento salen del PAÍS del comercio: ver `merchantPhone`.
    tel = await merchantPhone(br.hash, i).catch(() => tel);
    r.tel = tel;
    // ⚠ El documento también sale del PAÍS, no sólo el teléfono: contra un comercio dominicano un
    // documento de 10 dígitos muere en `request-personal-info` con «la cédula debe tener exactamente 11».
    doc = await merchantDocument(br.hash, i).catch(() => doc);
    r.doc = doc;
    await employmentFor(doc, log);
    const docType = await merchantDocumentType(br.hash);

    const s = new FrontSession();
    // ⚠ El canal ASESOR necesita la sesión de Cognito, y este motor NO LA CARGABA: `s` nacía sin
    // cookies, el primer loader de `/merchant/…` mandaba a `/login`, el bucle seguía la redirección al
    // hosted UI y moría con un «/login: HTTP 500» que no decía nada de la causa. Medido el 2026-09-14
    // contra la rama de ecommerce Y contra qa: idéntico en las dos — el motor, no el código bajo prueba.
    // El estado cacheado es el mismo que usa el motor navegador (`cognitoStorageState`); si no hay,
    // se dice igual que allá. Y si aun con cookies el front manda al login, lo dice el bucle de abajo.
    let advisorSession: { ruta: string; fecha: string } | null = null;
    if (FLOW === 'merchant') {
        const routePath = cognitoStorageState();
        if (!routePath) return finish('trabado', `el canal de asesor pide sesión y no hay ninguna cacheada en ${COGNITO_STATE_PATH} — entrá una vez por el panel (canal asesor) y volvé`);
        try {
            s.conCookiesDe(JSON.parse(readFileSync(routePath, 'utf8')));
            advisorSession = { ruta: routePath, fecha: statSync(routePath).mtime.toISOString().slice(0, 16).replace('T', ' ') };
        } catch (e) {
            return finish('trabado', `no pude leer la sesión cacheada en ${routePath}: ${(e as Error).message}`);
        }
        /* ⚠ ¿LA SUCURSAL QUE PEDISTE ES LA QUE VA A USAR EL WIZARD? En el canal de asesor NO la decide
         * el caso: la decide el BACKEND, según a qué sucursal esté asignado el asesor de la sesión. Si
         * difieren, el wizard te redirige allá y **las entidades son otras** — el caso pide la #77 y el
         * listado trae las de otro comercio, lo que se lee como «esa entidad no salió».
         * Medido el 2026-09-15: una corrida pidió `13874eb6` y caminó `f0548728`, porque otra sesión
         * había reasignado al asesor por afuera. No corta la corrida: avisa, porque correr contra la
         * sucursal que el asesor ya tiene es un caso legítimo. Sólo lectura. */
        try {
            const { preflightBranch, mismatchNotice, advisorSubject } = await import('../pkg/preflight-branch.ts');
            const sub = advisorSubject();
            if (sub) {
                const d = await preflightBranch(br.hash, TARGET, sub);
                for (const l of mismatchNotice(d)) log(l);
            }
        } catch { /* el chequeo es una ayuda: si falla, la corrida sigue */ }
    }
    // La traza de ESTE caso. Su salida va al buffer del caso, no a consola: en paralelo, N casos
    // escribiendo a la vez dan un log ilegible.
    const t = createTrace({ salida: (l) => lines.push(l), ancho: 74 });

    /** Una pantalla: la carga (su loader) y la contrasta con la BD. Devuelve la respuesta del loader. */
    const screen = async (routePath: string) => {
        const res = await s.cargar(routePath);
        r.pantallas += 1;
        walkedPaths.push(routePath);
        if (r.ur) t.trazarUReq(r.ur);
        const http = res.status === 202 ? `202 → ${res.redirect}` : String(res.status);
        t.paso('', routePath, undefined, `[${http} · ${res.ms}ms]`);
        await t.drenar();          // en serie: la línea sale antes de que el caso siga
        return res;
    };

    /** Sigue un redirect: si apunta a una ruta prohibida, NO la pide y lo dice. */
    const target = (redirect: string | null, since: string): string | null => {
        if (!redirect) return null;
        if (/^https?:\/\//.test(redirect) && !redirect.startsWith(s.base)) {
            log(`↪ el front manda AFUERA: ${redirect.slice(0, 120)} — decide otro (rt=0/1); acá no hay más pantallas`);
            return null;
        }
        if (FrontSession.esProhibida(redirect)) {
            log(`↪ ${since} redirigió a ${redirect} — RUTA PROHIBIDA: su loader CANCELA la solicitud (F-50). No la pido.`);
            return null;
        }
        return redirect;
    };

    // El tercer segmento es la solicitud SALVO en `/<tel>/otp`, donde es el teléfono: se excluye por
    // lo que sigue, no por la forma (los dos son dígitos).
    const urOf = (routePath: string): number | null => {
        const m = routePath.match(new RegExp(`^/${FLOW}/[^/]+/(\\d+)/(?!otp(/|\\?|$))`));
        return m ? Number(m[1]) : null;
    };
    const base = `/${FLOW}/${br.hash}`;
    /** ⚠ EL HANDOFF NO VA EN `base`, Y ESO NO ES UN DETALLE. La continuación de una CreditopX la abre
     *  el CUSTOMER en SU celular, y el backend arma esa url como `/self-service/<hash>/<ureq>/confirmation`
     *  — nunca con el prefijo del asesor. Y `confirmation` **sólo está montada en el árbol `:flow`**:
     *  con FLOW=merchant esto pedía `/merchant/<hash>/<ureq>/confirmation`, que no existe en ese árbol,
     *  y React Router no da 404 por eso: matchea `public-layout` con flow="merchant", que redirige a
     *  "/" → /merchant → /solicitar. El caminador volvía al principio, abría OTRA solicitud y repetía
     *  hasta el tope de pasos, reportando «se pasó de 40 pasos» — que se lee como un fallo del producto
     *  cuando era del runner. Medido el 2026-09-15. */
    const baseHandoff = `/self-service/${br.hash}`;
    let routePath = `${base}/solicitar?amount=${AMOUNT}`;
    let erId: number | null = null;                 // el pedido de la tienda (canal ecommerce)
    let linkSeen = false, prefillSeen = false;
    if (FLOW === 'ecommerce') {
        // LA ENTRADA ES EL CHECKOUT, no /solicitar: la tienda manda al cliente a
        // `/ecommerce/{hash}/checkout?o=…&p=…&t=…&u=…&ps=…&config=…` con el pedido en base64; el loader
        // lo persiste en legacy y redirige a /solicitar con `?erId=`. Ese GET CREA el ecommerce_request,
        // así que se hace UNA vez y se sigue su redirección — el caminador no adivina la URL siguiente.
        const token = await branchToken(br.hash);
        if (!token) return finish('trabado', `la sucursal ${br.hash} (${br.com}) no tiene credencial de ecommerce: sin ella no hay checkout. Probá el hash de una sucursal «Ecommerce» de ese comercio (node bin/dbops.ts ecommerce-url ${c.ref.replace(/^#/, '')} te la da)`);
        // El contrato lleva LA IDENTIDAD DEL CASO —el mismo doc, celular y nombre que después se postean
        // en personal-info—, como haría la tienda con su comprador; y por defecto sin destinos externos
        // (puerto 9 = discard), igual que `dev/ecommerce.ts`. `E2E_WEBHOOK_URL` / `E2E_RETURN_URL` los
        // apuntan a una bandeja (webhook.site) cuando lo que se quiere ver es el veredicto que llega.
        // ⚠ Por `env()` y no por `process.env`: lo que declara `.env.<target>` no llega a process.env, así
        // que leído directo el valor del archivo se ignoraba, y el preflight del panel frenaba la corrida.
        const webhook = env('E2E_WEBHOOK_URL') || 'http://localhost:9/notificacion/';
        const returnValue = env('E2E_RETURN_URL') || 'http://localhost:9/volver-al-comercio';
        const c64 = ecommerceContract(br.hash, token, tel, webhook, returnValue,
            { docType: docType, doc, name: 'CARLOS', surname: 'RUIZ', email: `qa${doc}@gmail.com` }, AMOUNT);
        routePath = `${base}/checkout?${new URLSearchParams({ o: c64.order, p: c64.products, t: c64.token, u: c64.returnUrl, ps: c64.processUrl, config: c64.config })}`;
    }
    let bureauInjected = false;
    let chosenLender: any = null;
    let reseeded = false;

    for (let step = 0; step < MAX_STEPS && routePath; step++) {
        { const u = urOf(routePath); if (u) r.ur = u; }
        // Canal ecommerce: apenas existe la solicitud se mira si quedó ATADA al pedido. Es la promesa
        // del canal, y falló en silencio hasta el 2026-09-14 (el OTP v1 salía sin `ecommerce_request_id`):
        // sin el vínculo el comercio no recibe el veredicto y personal-info no prellena ni bloquea nada.
        if (FLOW === 'ecommerce' && r.ur && !linkSeen) {
            linkSeen = true;
            const v = await one<{ er: number }>('SELECT ecommerce_request_id AS er FROM user_requests_by_ecommerce_request WHERE user_request_id = ? ORDER BY id DESC LIMIT 1', [r.ur]).catch(() => null);
            if (v) log(`vínculo comercio ↔ crédito: uReq ${r.ur} atada al pedido ${v.er}${erId !== null && v.er !== erId ? ` ⚠ (el checkout había creado el ${erId})` : ''} ✓`);
            else return finish('malo', `la solicitud ${r.ur} nació SIN atarse al pedido${erId !== null ? ` ${erId}` : ''}: el OTP salió sin el id del pedido — el comercio no recibiría el veredicto y personal-info no prellena ni bloquea nada`);
        }
        const res = await screen(routePath);

        // El loader mismo redirigió (gate, estado terminal, login…): se sigue y punto.
        if (res.status === 202 && res.redirect) {
            // …salvo al LOGIN: seguirlo lleva al hosted UI de Cognito y a un 500 sin causa. Acá la causa
            // es una sola —las cookies cacheadas no le sirven a este front— y se dice con el archivo y
            // su fecha, que es lo que hace falta para arreglarlo (entrar una vez por el panel).
            if (/^\/login(\?|$)/.test(res.redirect)) {
                return finish('trabado', advisorSession
                    ? `el front mandó al LOGIN con las cookies cacheadas en ${advisorSession.ruta} (archivo del ${advisorSession.fecha}): esa sesión no le sirve a ${s.base} (vencida, o de otro origen) — entrá una vez por el panel (canal asesor) y volvé`
                    : `el loader de ${routePath.split('?')[0].split('/').slice(3).join('/')} mandó al LOGIN: esta ruta pide sesión de asesor (probá --flow merchant)`);
            }
            const d = target(res.redirect, routePath);
            if (!d) return finish(/prohibida/i.test(lines.at(-1) ?? '') ? 'malo' : 'trabado', `el loader de ${routePath.split('?')[0].split('/').slice(3).join('/')} redirigió a ${res.redirect}`);
            if (FLOW === 'ecommerce' && erId === null) {
                const m = /[?&]erId=(\d+)/.exec(d);
                if (m) { erId = Number(m[1]); log(`entrada ecommerce: el checkout aceptó el pedido → ecommerce_request ${erId} (viaja en la URL, sin cookie)`); }
            }
            routePath = d; continue;
        }
        if (res.status === 0) return finish('trabado', `${routePath}: ${res.crudo?.slice(0, 120) ?? 'sin respuesta'}`);
        if (res.status >= 400 || (res.status !== 200 && !res.datos)) {
            return finish('trabado', `${routePath.split('?')[0]}: HTTP ${res.status}${res.crudo ? ` · ${res.crudo.replace(/\s+/g, ' ').slice(0, 140)}` : ''}`);
        }

        const path = routePath.split('?')[0];
        const seg = path.split('/');
        const sheet = seg.at(-1) ?? '';
        const q = new URL(routePath, 'http://x').searchParams;
        const amount = q.get('amount') ?? String(AMOUNT);
        let form: Form | null = null;
        let jumpTo: string | null = null;

        // ── cada pantalla: qué manda el navegador al apretar el botón ──
        if (sheet === 'solicitar') {
            form = { phoneNumber: tel, amount, ...(res.datos?.showQuotaConfirmation ? { confirmQuota: 'no' } : {}) };
        } else if (sheet === 'otp' && seg.at(-2) === tel) {
            form = { otp: tel.slice(-4), amount, original_amount: amount };
        } else if (sheet === 'personal-info' || sheet === 'employment-info') {
            const ur = urOf(routePath)!;
            if (!bureauInjected) { await seed(ur, doc, log); bureauInjected = true; }
            // Canal ecommerce: lo que el comercio entregó tiene que llegar PRELLENADO, y eso lo decide el
            // LOADER (`resolvePrefillDelComercio` → `prefill`): se lee de él, no se supone.
            //
            // ⚠ La señal es `prefill`, NO `lockedFields`. Hasta el 2026-09-24 el documento llegaba
            // bloqueado y este chequeo contaba los bloqueados; desde frontend-monorepo#1072 todo llega
            // editable (`lockedFields` vacío a propósito), y contar bloqueados daba «sin prefill» con los
            // cinco campos prellenados. Los bloqueados se informan, no se exigen.
            if (FLOW === 'ecommerce' && sheet === 'personal-info' && !prefillSeen) {
                prefillSeen = true;
                const pf: unknown = res.datos?.prefill;
                const campos = pf && typeof pf === 'object' ? Object.keys(pf as object) : [];
                const lf: unknown = res.datos?.lockedFields;
                const bloqueados = Array.isArray(lf) ? (lf as string[]) : [];
                if (campos.length > 0) log(`personal-info: ${campos.length} campo(s) del comercio prellenados (${campos.join(', ')}) · bloqueados: ${bloqueados.length ? bloqueados.join(', ') : 'ninguno'}`);
                else return finish('malo', 'personal-info llegó SIN prefill del comercio: el loader no encontró el pedido de esta solicitud');
            }
            form = sheet === 'personal-info'
                ? { intent: 'save-personal-info', documentType: docType, documentNumber: doc, name: 'CARLOS', surname: 'RUIZ',
                    email: `qa${doc}@gmail.com`, address: 'Calle 1 # 2-3', stratum: '3',
                    issueDay: '10', issueMonth: '5', issueYear: '2019', birthDay: '10', birthMonth: '5', birthYear: '2001' }
                : { employmentStatus: 'Empleado', monthlyIncome: String(INCOME) };
        } else if (sheet === 'lenders') {
            const lo = res.datos?.loanOptionsPromise;
            const options: any[] = Array.isArray(lo?.loan_options) ? lo.loan_options : [];
            if (lo?.__rechazada || lo?.__pendiente !== undefined) {
                return finish('trabado', `el listado no llegó: ${lo.__rechazada ? `la promesa fue rechazada (${String(lo.__rechazada?.message ?? lo.__rechazada).slice(0, 100)})` : 'la promesa quedó pendiente (¿streamTimeout?)'}`);
            }
            r.listado = options.map((l) => Number(l.id));
            log(`listado: [${r.listado.join(', ')}]${lo?.requestedAmount ? ` · monto ${lo.requestedAmount}` : ''}`);
            if (!flag('cerrar')) return finish('listo', `listó ${options.length} entidad(es)`);
            const order = c.lender ?? Number(options.find((l) => Number(l.response_type) === 2)?.id);
            chosenLender = options.find((l) => Number(l.id) === order);
            r.enListado = !!chosenLender;
            if (!chosenLender && order && !reseeded) {
                // ⚠ LA SEED DE ARRIBA LA PISA EL FORMULARIO, y por eso la entidad pedida puede no
                // estar. `sembrar()` corre ANTES de enviar `personal-info`, y el `action` de esa
                // pantalla escribe los campos del cliente encima: medido el 2026-09-16, la solicitud
                // quedaba con ocupación «Desempleado» e ingreso 0, y con eso una rt=2 se cae por regla
                // DURA — tan afuera que el backend ni siquiera evalúa el cupo.
                //
                // Se resiembra ACÁ y no antes porque el listado ya se consumió en este fetch: con el
                // perfil derivado para la entidad, se vuelve a pedir la misma pantalla. Una sola vez:
                // si tampoco aparece, la exclusión es del comercio y hay que reportarla como tal.
                reseeded = true;
                log(`la entidad ${order} no salió: el formulario pisó la siembra — resembrando para ella y pidiendo el listado de nuevo`);
                await seed(urOf(routePath)!, doc, log, order);
                continue;
            }
            if (!chosenLender) return finish('trabado', `la entidad ${order || '(ninguna rt=2)'} no salió en el listado${reseeded ? ' (ni después de resembrar para ella: la exclusión es del comercio)' : ''}`);
            // El mismo payload que arma `useLenderSelection.ts`. `amount` va igual al pedido: el
            // cálculo de garantía que hace el cliente (financedAmountWithGuarantee) no se replica acá.
            form = {
                lender_id: chosenLender.id, lender_name: chosenLender.name,
                fee_number: chosenLender.fee_number ?? INSTALLMENTS ?? 0, original_amount: amount, amount,
                initial_fee: DOWN_PAYMENT, productId: q.get('productId') ?? '',
                rate: chosenLender.credit_lines?.rate ?? 0, response_type: chosenLender.response_type,
                is_recommended: chosenLender.isRecommended ? 'true' : 'false',
                transaction_data: JSON.stringify(chosenLender.transaction_data ?? null),   // el navegador manda «null» literal, y el action lo parsea
                path_id: chosenLender.path_id ?? '', product: chosenLender.product ?? 'credit',
            };
        } else if (sheet === 'confirmation' || sheet === 'sign-documents') {
            form = {};
        } else if (sheet === 'down-payment') {
            // ⚠ ESTA PANTALLA NO TIENE ACTION: corre entera en el navegador (clientLoader + el widget de
            // Wompi), así que no hay botón que postear. Se hace lo que hace el cliente —intento de pago,
            // el comprador paga, se consulta el estado— contra el mock de Wompi, y después se sigue a donde
            // lleva el «Continuar» de la pantalla de resultado: la fecha de pago, que ahora sí avanza.
            // `--pago DECLINED` prueba el rechazo; `--cuota-inicial` paga más que el mínimo.
            const paid = await payDownPayment({
                feBase: config.feBaseUrl, loanRequestId: r.ur!,
                amountPesos: DOWN_PAYMENT || undefined, status: arg('pago', 'APPROVED'), log,
            });
            if (!paid.ok) return finish('trabado', `down-payment: ${paid.reason}`);
            routePath = `${path.replace(/\/down-payment$/, '')}/first-payment-date`;
            continue;
        } else if (sheet === 'first-payment-date') {
            const dates: any[] = res.datos?.response?.payload?.nextPaymentDates ?? [];
            if (!dates.length) return finish('trabado', `first-payment-date sin fechas: ${JSON.stringify(res.datos?.response).slice(0, 160)}`);
            form = { firstPaymentDate: dates[0].date };
        } else if (sheet === 'payment-schedule') {
            const planes: any[] = res.datos?.response?.payload?.paymentSchedule ?? [];
            if (!planes.length) return finish('trabado', `payment-schedule sin planes: ${JSON.stringify(res.datos?.response).slice(0, 160)}`);
            const offered = planes.map((p) => Number(p.fee_number));
            // El más largo, no el primero: `planes[0]` es el mínimo y un crédito de un pago no
            // ejercita casi nada. Ver la nota de `INSTALLMENTS`.
            const longest = planes.reduce((a, b) => (Number(b.fee_number) > Number(a.fee_number) ? b : a));
            const order = INSTALLMENTS !== null ? planes.find((p) => Number(p.fee_number) === INSTALLMENTS) : undefined;
            const chosen = order ?? longest;

            if (INSTALLMENTS !== null && !order) {
                log(`⚠ el plazo pedido (${INSTALLMENTS}) NO está entre los ofrecidos [${offered.join(', ')}]: se cierra con ${chosen.fee_number}`);
            } else if (INSTALLMENTS === null) {
                log(`plazo: ${chosen.fee_number} cuota(s) — el más largo de [${offered.join(', ')}]`);
            }
            form = { paymentSchedule: chosen.fee_number };
        } else if (sheet === 'otp-validation') {
            form = { _action: 'verify', otp: tel.slice(-6) };
        } else if (sheet === 'loan-approved') {
            // El veredicto lo da `pkg/trace.ts`, el mismo que usan el visual y el rápido: incluye el
            // patrón F-50 (pantalla de éxito con la BD sin sellar) que la traza ya venía marcando.
            const v = r.ur ? await t.veredicto(r.ur, 'success') : null;
            r.estado = v?.st ?? null;
            return finish(v?.ok ? 'cerro' : 'malo',
                v?.ok ? `loan-approved con la BD en ${v.st}` : `loan-approved pero la BD dice ${v?.st ?? '—'} (F-50)`);
        } else if (/^identity-validation/.test(sheet)) {
            return finish('trabado', `pide validar identidad (${sheet})${flag('manual') ? ' A PESAR de la validación manual — eso es un hallazgo' : ' — corré con --manual para saltarla como lo haría el admin'}`);
        } else {
            return finish('trabado', `pantalla sin manejador: ${path.replace(base, '')} — el caminador no sabe qué botón apretar acá`);
        }

        // ── el POST (el botón) ──
        const acc = await s.enviar(routePath, form!);
        if (acc.status === 0) {
            // ⚠ UN TIMEOUT NO ES UNA CAÍDA: el backend sigue y suele terminar (F-180). Antes de decir
            // «no cerró» se vuelve a mirar la BD: si ya está sellada, cerró y lo que falló fue la espera.
            const sn = r.ur ? await one<{ st: number }>('SELECT user_request_status_id st FROM user_requests WHERE id=?', [r.ur]).catch(() => null) : null;
            if (sealed(sn?.st)) { r.estado = sn!.st; return finish('cerro', `la espera de ${sheet} expiró pero la BD ya dice ${sn!.st} (tardó, no falló)`); }
            return finish('trabado', `${sheet}: ${acc.crudo?.slice(0, 120) ?? 'sin respuesta'}${sn ? ` · BD en ${sn.st}` : ''}`);
        }
        if (acc.redirect) {
            if (sheet === 'lenders' && chosenLender && [2, 3, 4].includes(Number(chosenLender.response_type))
                && /\/continue(\?|$)/.test(acc.redirect)) {
                // El backend armó el link de confirmación y se lo mandó al cliente: se abre ESA pantalla.
                //
                // ⚠ EL ATAJO SÓLO VALE SI EL FRONT MANDÓ A `/continue`, y la condición es nueva: antes se
                // tomaba mirando SÓLO el response_type, sin importar a dónde hubiera redirigido el front.
                // Eso TAPABA defectos. Medido el 2026-09-15: con `initial_fee > 0` el action mandaba a
                // `/initial-fee-payment` —que rebota al principio del wizard— y el caminador saltaba por
                // encima y cerraba en estado 11 igual, así que la corrida daba verde con el flujo roto.
                // Si el front manda a otro lado, se SIGUE esa redirección: es lo que haría el navegador.
                log(`${CUSTOMER_SEGMENT} CreditopX (${chosenLender.name}) → ${baseHandoff}/${r.ur}/confirmation  [el front respondió 202 → ${acc.redirect}]`);
                if (SINGLE_DEVICE && /\/continue(\?|$)/.test(String(acc.redirect))) {
                    log(`⚠ pero el front lo dejó en \`/continue\`, la pantalla de ENTREGA, y en este canal no hay`);
                    log(`  segundo dispositivo ni nada que entregar: el link que manda apunta a esta misma app (F-219).`);
                }
                jumpTo = `${baseHandoff}/${r.ur}/confirmation`;
            } else {
                if (sheet === 'lenders' && chosenLender && [2, 3, 4].includes(Number(chosenLender.response_type))) {
                    log(`⚠ ${chosenLender.name} (rt=${chosenLender.response_type}) NO mandó al handoff: el front redirigió a ${acc.redirect}. Se sigue esa redirección, que es lo que hace el navegador.`);
                }
                jumpTo = target(acc.redirect, sheet);
                if (!jumpTo) return finish(FrontSession.esProhibida(acc.redirect) ? 'malo' : 'trabado', `${sheet} → ${acc.redirect}`);
            }
        } else {
            const err = acc.cuerpo?.error ?? acc.datos?.error ?? acc.cuerpo?.data?.error;
            if (err) {
                /* ⚠ CUANDO EL `error` NO ES UN MENSAJE, MOSTRAR EL CUERPO. Medido el 2026-09-15: una
                 * pantalla devolvió `error: true` y el reporte decía literalmente «`confirmation`
                 * respondió error: true» — cero información, y para saber qué pasó había que repetir la
                 * corrida a mano contra el endpoint. `error` booleano es una forma legítima del
                 * envelope (dice «hubo error», el detalle va en otra clave), así que el runner tiene
                 * que ir a buscarlo en vez de imprimir el booleano. */
                /* Y se buscan las DOS formas del envelope: `message` y `errorMessage`/`errorCode`.
                 * La pantalla que destapó esto manda `{error:true, errorCode, errorMessage}` — el
                 * mensaje estaba ahí todo el tiempo y el runner miraba sólo `message`. */
                const d = (acc.cuerpo?.data ?? acc.datos?.data ?? acc.cuerpo ?? acc.datos ?? {}) as any;
                const detail = typeof err === 'string' ? err
                    : (err?.message ?? d.errorMessage ?? (d.errorCode ? `errorCode ${d.errorCode}` : null));
                const body = JSON.stringify(acc.cuerpo ?? acc.datos ?? null);
                /* El STATUS va en el mensaje: un 422 y un 500 se depuran distinto — el primero es una
                 * regla de negocio que rechazó, el segundo es código roto— y sin él hay que repetir la
                 * llamada a mano para saber cuál de los dos fue. Pasó el 2026-09-15 con el OTP de firma:
                 * el reporte decía sólo el texto y el 422 («no hay OTP pendiente») salió de un curl. */
                /* ⚠ «HTTP del FRONT», y la distinción no es pedante: el front responde **200** con el
                 * error adentro del cuerpo aunque el backend haya devuelto 422. Medido el 2026-09-15
                 * con el OTP de firma: acá salía 200 y un `curl` al endpoint daba
                 * `422 "no tiene un OTP pendiente"`. Leer este 200 como «el backend estuvo bien» manda
                 * a buscar el bug en el lugar equivocado. */
                return finish('trabado', `${sheet} respondió error (HTTP ${acc.status} del front; el del backend puede diferir): ${detail ?? `(sin mensaje) cuerpo: ${body.slice(0, 400)}`}`);
            }
            if (sheet === 'lenders' && chosenLender && [2, 3, 4].includes(Number(chosenLender.response_type))) {
                const d = acc.cuerpo?.data ?? {};
                log(`${CUSTOMER_SEGMENT} CreditopX (${chosenLender.name}) → ${baseHandoff}/${r.ur}/confirmation  [el front devolvió ${d.showModal ? `modal «${String(d.modalMessage ?? '').slice(0, 60)}»` : 'datos sin redirect'}]`);
                jumpTo = `${baseHandoff}/${r.ur}/confirmation`;
            } else {
                return finish('trabado', `${sheet}: el action no redirigió ni dio error · ${JSON.stringify(acc.cuerpo).slice(0, 160)}`);
            }
        }
        routePath = jumpTo!;
    }
    return finish('trabado', `se pasó de ${MAX_STEPS} pasos sin llegar al final`);
}


// ─── el motor NAVEGADOR ──────────────────────────────────────────────────────────────────────────
/**
 * El mismo caso, operado con Chromium sin ventana: se clickea, no se postea. Comparte con el motor HTTP
 * todo lo que rodea al recorrido (el caso, la siembra, la traza contra la BD, el forense, el resumen) y
 * se diferencia sólo en cómo avanza una pantalla y en cómo sabe dónde está: acá la URL la dice el
 * navegador, así que no hay que seguir redirecciones a mano — y por eso tampoco hace falta la lista de
 * rutas prohibidas: el caminador no pide URLs, las pide la app.
 *
 * Lo que ESTE motor ve y el otro no: la hidratación, las máscaras de los inputs, las validaciones del
 * componente, y los banners de error que el front pinta con un HTTP 200 (F-88).
 */
async function runBrowser(c: Case, i: number, browser: any): Promise<Result> {
    const t0 = Date.now();
    let tel = phoneOf(i);
    let doc = idNumberOf(i);
    const lines: string[] = [];
    const log = (s: string) => lines.push(`  ▸ ${s}`);
    const r: Result = { caso: c.ref + (c.lender ? `:${c.lender}` : ''), ur: null, tel, doc, pantallas: 0,
        listado: [], enListado: null, fin: 'trabado', motivo: '', estado: null, ms: 0, lineas: lines };
    const walkedPaths: string[] = [];
    const t = createTrace({ salida: (l) => lines.push(l), ancho: 74 });
    const evidenceDir = `.runs/caminar-${new Date(t0).toISOString().slice(0, 19).replace(/[:T]/g, '')}-caso${i}`;

    const br = await findBranch(c.ref);
    if (!br) { r.motivo = `no encontré la sucursal «${c.ref}»`; r.ms = Date.now() - t0; return r; }
    tel = await merchantPhone(br.hash, i).catch(() => tel);
    r.tel = tel;
    // ⚠ El documento también sale del PAÍS, no sólo el teléfono: contra un comercio dominicano un
    // documento de 10 dígitos muere en `request-personal-info` con «la cédula debe tener exactamente 11».
    doc = await merchantDocument(br.hash, i).catch(() => doc);
    r.doc = doc;
    await employmentFor(doc, log);
    // EL CANAL DE ASESOR pide sesión de Cognito. No se loguea acá: se REUSA el storageState que dejó el
    // panel (`pkg/cognito.ts`), y los N contextos de una tanda cargan EL MISMO archivo — un solo login
    // para todos, que es lo que evita golpear el pool.
    //
    // ⚠ Y eso significa que «10 asesores en paralelo» son 10 sesiones del MISMO asesor atendiendo a 10
    // clientes distintos. Alcanza para casi todo, pero no para probar nada que dependa de que los
    // asesores sean distintos (permisos, sucursales asignadas, su lista de solicitudes).
    const session = FLOW === 'merchant' ? cognitoStorageState() : undefined;
    if (FLOW === 'merchant' && !session) {
        r.motivo = `el canal de asesor pide sesión y no hay ninguna cacheada en ${COGNITO_STATE_PATH} — entrá una vez por el panel y volvé`;
        r.ms = Date.now() - t0;
        return r;
    }
    const { ctx, page, evidencia: evidence } = await openContext(browser, config.feBaseUrl, { traza: evidenceDir, storageState: session });

    const finish = async (end: Result['fin'], reason: string) => {
        r.fin = end; r.motivo = reason; r.ms = Date.now() - t0;
        await t.drenar();
        const wentWrong = end === 'malo' || end === 'trabado';
        // La evidencia PESA (traza con DOM por acción + captura), así que se guarda sólo si el caso falló.
        if (wentWrong) {
            // Lo que el navegador vio, en el log: es lo primero que se lee y suele decir la causa. La traza
            // y la captura quedan en disco para lo que el texto no alcanza.
            if (evidence.consola.length) { log('lo que dijo la CONSOLA del navegador:'); for (const l of evidence.consola.slice(0, 8)) log(`   ${l}`); }
            if (evidence.red.length) { log('llamadas que FALLARON:'); for (const l of evidence.red.slice(0, 8)) log(`   ${l}`); }
            try { mkdirSync(evidenceDir, { recursive: true }); } catch { /* ya existe */ }
            await page.screenshot({ path: `${evidenceDir}/ultima.png`, fullPage: true }).catch(() => {});
            await closeContext(ctx, `${evidenceDir}/traza.zip`);
            log(`evidencia: ${evidenceDir}/ (traza.zip se abre con \`npx playwright show-trace\`)`);
        } else if (evidence.consola.length || evidence.red.length) {
            // ⚠ UN CASO QUE CIERRA BIEN TAMBIÉN PUEDE HABER DEJADO ERRORES, y hasta acá se tiraban a la
            // basura: el volcado sólo salía `if (wentWrong)`. O sea que una corrida podía llegar a estado
            // 11 con la consola llena y el reporte no decía una palabra — el mismo patrón que hizo que
            // F-227 viviera dos meses: lo que nadie mira, nadie arregla.
            //
            // Va CORTO y NO toca el veredicto, a propósito: el caso cerró, y un error de consola no lo
            // convierte en fallo. Es una invitación a mirar, no un resultado. Si fuera un volcado entero
            // en cada caso feliz, la tanda se volvería ilegible y se aprendería a saltearlo.
            //
            // ⚠ Y esto SÓLO sirve desde que el filtro de ruido es confiable (`isLocalNoise`): antes
            // habría sacado esta advertencia en todos los casos por cuatro WebSockets de local.
            for (const l of evidenceNotice(evidence.consola, evidence.red)) log(l);
            if (process.env.FORENSE !== '1') {
                log('   (la traza no se guardó: FORENSE=1 la deja en disco aunque el caso cierre)');
                await closeContext(ctx, null);
            } else {
                try { mkdirSync(evidenceDir, { recursive: true }); } catch { /* ya existe */ }
                await page.screenshot({ path: `${evidenceDir}/ultima.png`, fullPage: true }).catch(() => {});
                await closeContext(ctx, `${evidenceDir}/traza.zip`);
                log(`   evidencia: ${evidenceDir}/`);
            }
        } else {
            await closeContext(ctx, null);
        }
        if (r.ur && walkedPaths.length && (wentWrong || process.env.FORENSE === '1')) {
            await postHogForensic(r.ur, new Date(t0), walkedPaths, (l) => lines.push(l), new Date()).catch(() => {});
        } else if (r.ur && !wentWrong) {
            lines.push(`  ▸ PostHog: no se consulta porque el caso cerró como se pedía · si lo querés: make harness-posthog UREQ=${r.ur} DESDE=${new Date(t0 - 60_000).toISOString()}`);
        }
        return r;
    };

    const entityName = c.lender
        ? (await one<{ name: string }>('SELECT name FROM lenders WHERE id=?', [c.lender]).catch(() => null))?.name ?? null
        : null;
    if (c.lender && !entityName) return finish('trabado', `la entidad ${c.lender} no está en la base`);

    const base = `/${FLOW}/${br.hash}`;
    /** ⚠ EL HANDOFF NO VA EN `base`, Y ESO NO ES UN DETALLE. La continuación de una CreditopX la abre
     *  el CUSTOMER en SU celular, y el backend arma esa url como `/self-service/<hash>/<ureq>/confirmation`
     *  — nunca con el prefijo del asesor. Y `confirmation` **sólo está montada en el árbol `:flow`**:
     *  con FLOW=merchant esto pedía `/merchant/<hash>/<ureq>/confirmation`, que no existe en ese árbol,
     *  y React Router no da 404 por eso: matchea `public-layout` con flow="merchant", que redirige a
     *  "/" → /merchant → /solicitar. El caminador volvía al principio, abría OTRA solicitud y repetía
     *  hasta el tope de pasos, reportando «se pasó de 40 pasos» — que se lee como un fallo del producto
     *  cuando era del runner. Medido el 2026-09-15. */
    const baseHandoff = `/self-service/${br.hash}`;
    await page.goto(`${base}/solicitar?amount=${AMOUNT}`, { waitUntil: 'domcontentloaded', timeout: 90_000 }).catch(() => {});
    let seeded = false;
    let lastOne = '';

    let withoutProgress = 0;
    for (let step = 0; step < MAX_STEPS; step++) {
        if (Date.now() - t0 > LIMIT_MS) {
            return finish('trabado', `se pasó del tope de ${Math.round(LIMIT_MS / 1000)} s en ${lastOne || 'la primera pantalla'} (subilo con --tope <segundos> si de verdad tarda tanto)`);
        }
        // La pantalla la dice el navegador. Se espera a que la red se calme para no medir una a medio pintar.
        await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
        const routePath = new URL(page.url()).pathname + new URL(page.url()).search;
        const path = routePath.split('?')[0];
        const sheet = path.split('/').filter(Boolean).pop() ?? '';
        const u = path.match(new RegExp(`^/${FLOW}/[^/]+/(\\d+)/(?!otp(/|$))`));
        if (u) { r.ur = Number(u[1]); t.trazarUReq(r.ur); }

        if (routePath === lastOne) {
            withoutProgress += 1;
            if (withoutProgress > MAX_WITHOUT_PROGRESS) {
                const errs = await screenErrors(page).catch(() => [] as string[]);
                return finish('trabado', `${sheet}: ${MAX_WITHOUT_PROGRESS + 1} intentos sin que la pantalla avance`
                    + (errs.length ? ` · lo que dice: ${errs.slice(0, 3).join(' | ')}` : ''));
            }
        } else {
            withoutProgress = 0;
        }
        if (routePath !== lastOne) {
            r.pantallas += 1;
            walkedPaths.push(routePath);
            // ⚠ EN EL LISTADO, UN MENSAJE DE ERROR NO ES UN MURO. Cada tarjeta consulta su propia
            // pre-aprobación y puede fallar sola: «No pudimos consultar esta entidad» aparece POR
            // ENTIDAD, con su botón de reintentar, y el listado sigue siendo usable. Tratarlo como muro
            // cortaba la corrida en una pantalla que funcionaba (2026-09-03). Se anota y se sigue: quien
            // decide es `chooseEntity`, que sabe si la entidad PEDIDA está y se puede clickear.
            const banner = await errorBanner(page);
            const inListing = sheet === 'lenders';
            t.paso('', routePath, undefined, banner ? `${inListing ? '⚠' : '⛔'} ${banner}` : undefined);
            await t.drenar();
            lastOne = routePath;
            if (banner && !inListing) return finish('trabado', `${sheet}: la pantalla muestra «${banner}» (el motor HTTP no ve esto)`);
        }

        // La sesión de asesor vencida se ve como un aterrizaje en el login, y hay que decirlo con esas
        // palabras: sin esto el caso falla con «sin botón para avanzar» en una pantalla de Cognito.
        if (/^\/login|auth\.merchant|login\.creditop/.test(path) || /auth\.merchant|login\.creditop/.test(page.url())) {
            return finish('trabado', `la sesión de asesor está vencida (aterrizó en ${path}) — entrá una vez por el panel para renovar ${COGNITO_STATE_PATH}`);
        }
        // ⚠ EL ASESOR MANDA SOBRE LA SUCURSAL, y por eso esto CORTA en vez de avisar. Su sesión lleva el
        // comercio asignado, así que `/merchant` redirige al de la sesión y no al que pidió el caso: pasó
        // el 2026-09-02 en una corrida que decía «celurd» y corrió contra la sucursal de Motai, y el
        // reporte no lo dijo. Seguir sería probar OTRO comercio y llamarlo el pedido.
        //
        // No se reasigna solo: cambiar a qué sucursal está pegado un asesor es una escritura que el panel
        // hace explícita (`bin/advisor` → `dbops assign`), y hacerla a escondidas dejaría al asesor movido
        // después de la corrida. Se imprime el comando y se corta.
        if (FLOW === 'merchant' && /^\/merchant\/[0-9a-f]{8}/.test(path) && path.split('/')[2] !== br.hash) {
            const another = path.split('/')[2];
            const theirs = await one<{ cognito_id: string; email: string }>(
                `SELECT u.cognito_id, u.email FROM users u JOIN allied_branches ab ON ab.id=u.allied_branch_id
                  WHERE ab.hash=? AND u.cognito_id IS NOT NULL AND u.cognito_id<>'' ORDER BY u.updated_at DESC LIMIT 1`, [another]).catch(() => null);
            return finish('trabado',
                `la sesión del asesor está pegada a la sucursal ${another}, no a la pedida (${br.hash}), así que esto probaría OTRO comercio`
                + (theirs?.cognito_id ? ` · para moverlo: I_KNOW_THIS_TOUCHES_SHARED_DEV=1 node bin/dbops.ts assign ${theirs.cognito_id} <comercio> ${br.hash} ${theirs.cognito_id}` : ''));
        }

        if (/request-canceled/.test(path)) return finish('malo', 'el front llevó al cliente a la pantalla de cancelación');
        if (/rate-limit-exceeded/.test(path)) return finish('trabado', 'rate limit del onboarding');
        if (/loan-approved/.test(path)) {
            const v = r.ur ? await t.veredicto(r.ur, 'success') : null;
            r.estado = v?.st ?? null;
            return finish(v?.ok ? 'cerro' : 'malo',
                v?.ok ? `loan-approved con la BD en ${v.st}` : `loan-approved pero la BD dice ${v?.st ?? '—'} (F-50)`);
        }

        // El formulario: se siembra ANTES de enviarlo, igual que en el otro motor.
        if ((sheet === 'personal-info' || sheet === 'employment-info') && r.ur && !seeded) {
            await seed(r.ur, doc, log); seeded = true;
        }

        // Pantalla de espera: navega sola. Se le da tiempo en vez de clickear.
        if (/processing|validating|waiting|kyc-processing/.test(path)) {
            const before = page.url();
            await page.waitForURL((x) => x.href !== before, { timeout: 60_000 }).catch(() => {});
            continue;
        }

        // EL HANDOFF, igual que en el motor HTTP y por la misma razón: al elegir una CreditopX el backend
        // arma `/self-service/<hash>/<ureq>/confirmation` y **se lo manda al CUSTOMER** por WhatsApp; la
        // pantalla `/continue` es la del que eligió, que sólo dice «se envió un mensaje» y no tiene botón
        // para avanzar. El caminador hace lo que haría el cliente al tocar el link. Es el salto A→B del panel.
        if (sheet === 'continue' && r.ur) {
            log(`${CUSTOMER_SEGMENT} CreditopX → ${baseHandoff}/${r.ur}/confirmation`);
            await page.goto(`${baseHandoff}/${r.ur}/confirmation`, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {});
            continue;
        }

        if (sheet === 'lenders') {
            if (!flag('cerrar')) return finish('listo', 'llegó al listado');
            if (!entityName) return finish('trabado', 'con --motor navegador hay que pedir la entidad (`#hash:ID`)');
            const el = await chooseEntity(page, entityName);
            r.enListado = el.ok;
            if (!el.ok) return finish('trabado', `«${entityName}» no está en el listado · visibles: ${el.visibles.slice(0, 8).join(' · ')}`);
            log(`elegí «${entityName}» en el listado`);
            await page.waitForTimeout(1500);
            continue;
        }

        const before = page.url();
        const av = await advance(page, { tel, doc, amount: AMOUNT, income: INCOME, cuotaInicial: DOWN_PAYMENT || undefined }, sheet);
        if (av.hechos.length) log(`   ▸ autorrelleno: ${av.hechos.join(' · ')}`);
        if (!av.ok) {
            /* UN GATE MANUAL NO ES UNA PANTALLA TRABADA. `entidad/resultado` no ofrece «Continuar»:
             * ofrece «Aprobado» y «Rechazado», porque ahí decide una persona. Sin `--gate` esto sigue
             * cortando —y está bien, el caminador no elige por nadie—, pero con la bandera puesta el
             * recorrido puede llegar hasta el final.
             *
             * Se busca por NOMBRE ACCESIBLE y sólo si el botón de verdad está: si la pantalla cambió y
             * ya no ofrece esa opción, corta como siempre en vez de clickear cualquier cosa. */
            if (GATE && !av.motivo) {
                const decision = page.getByRole('button', { name: new RegExp(`^\\s*${GATE}\\s*$`, 'i') }).first();
                if (await decision.count().catch(() => 0) && await decision.isEnabled().catch(() => false)) {
                    const failure = await decision.click({ timeout: 15_000 }).then(() => null)
                        .catch((e) => String(e?.message ?? e).replace(/\s+/g, ' ').slice(0, 200));
                    if (!failure) {
                        log(`   ⚖ gate manual: marqué «${GATE}»`);
                        await waitForChange(page, before, 20_000);
                        continue;
                    }
                    log(`   ⚠ gate «${GATE}»: el click falló: ${failure}`);
                }
            }
            // Un click que falló NO es «sin botón habilitado»: el botón estaba y era el correcto.
            // Decirlo distinto es la diferencia entre depurar el harness y depurar el producto.
            return finish('trabado', `${sheet}: ${av.motivo ?? 'sin botón habilitado para avanzar'}`
                + (av.errores?.length ? ` · lo que dice la pantalla: ${av.errores.slice(0, 4).join(' | ')}` : '')
                + (av.candidatos?.length ? ` · botones: ${av.candidatos.slice(0, 6).join(' · ')}` : ' · ningún botón de avance en la pantalla'));
        }
        log(`   ↳ click «${av.boton}»`);
        // Si la URL no cambia no es un fallo: varias pantallas tienen pasos internos (`personal-info`
        // son dos: identificación y fecha de expedición). Se le da tiempo y el bucle vuelve a mirar.
        // ⚠ WAIT GENEROSA DESPUÉS DE UN CLICK ACEPTADO, y el número tiene una razón: el envío de
        // `payment-schedule` es el que dispara la GENERACIÓN DE DOCUMENTOS, ~30 s con plantillas Blade
        // (§«Corridas 4× más rápidas»). Con 12 s el caminador abandonaba una pantalla que estaba
        // funcionando —la captura mostraba el botón con el spinner— y lo reportaba como «sin botón para
        // avanzar»: un falso negativo sobre el paso más lento del flujo.
        //
        // Esperar mucho por click ya no puede colgar la corrida: de eso se encargan el tope global
        // (`--tope`) y el contador de vueltas sin progreso, que son los guardas correctos.
        if (!(await waitForChange(page, before, 60_000))) await page.waitForTimeout(1_000);
    }
    return finish('trabado', `se pasó de ${MAX_STEPS} pantallas sin llegar al final`);
}

// ─── main ────────────────────────────────────────────────────────────────────────────────────────
const cases = parseCases();
console.log(`\n  CAMINAR · ${cases.length} caso(s) · motor ${ENGINE === 'navegador' ? 'NAVEGADOR (Chromium sin ventana)' : 'HTTP'} · ${flag('paralelo') ? 'en paralelo' : 'en serie'} · front ${config.feBaseUrl} · target ${TARGET}`
    + ` · ${flag('cerrar') ? 'hasta loan-approved' : 'hasta el listado'}${flag('manual') ? ' · identidad manual' : ''}\n`);

// Una perilla que cambia QUÉ prueba la corrida no puede estar invisible en el `.env` de otro repo.
const notice = docGenNotice(TARGET);
if (notice) console.log(`  ${notice}\n`);

// ⚠ LA SESIÓN SE MIRA ANTES DE ARRANCAR, y esto es lo que el 2026-09-17 costó dos minutos a los
// golpes: el archivo estaba, así que la corrida cargó las cookies y salió a caminar; recién en la
// primera pantalla —40 s el primer caso, 54 s el segundo— el front la mandó al login. La causa estaba
// EN EL ARCHIVO todo el tiempo (la cookie `_at` había vencido hacía 170 min) y leerla cuesta 0 ms.
// Fallar acá no ahorra sólo tiempo: ahorra un diagnóstico, porque el mensaje nombra la cookie.
//
// ⚠ Y VA ANTES DEL BYPASS, no después. Puesto después, esta corrida registraba sus teléfonos y se
// iba por `process.exit` sin pasar por el `finally` que los limpia: dos teléfonos de prueba
// quedaban en la lista compartida por cada intento con la sesión vencida. Medido corriéndolo.
// Antes esto excluía `local`. La sesión de asesor hace falta en local IGUAL —el wizard la pide— y
// el pre-login funciona si el front está arriba, así que el chequeo vale para todos los targets.
if (FLOW === 'merchant') {
    let session = sessionHealth();

    // ⚠ SE RENUEVA SOLA, y el orden importa tanto como el hecho: el token de acceso vive ~4 minutos,
    // así que entre renovar y arrancar no puede haber una persona leyendo un mensaje y tipeando un
    // comando. Antes esto cortaba y pedía correr el pre-login a mano; en la práctica, para cuando
    // alguien lo hacía y volvía, la sesión nueva ya se estaba muriendo.
    //
    // ⚠ ABRE UNA VENTANA, y se avisa ANTES de abrirla: el Managed Login corta la automatización
    // headless por fingerprint (F-66), así que el pre-login va headed. Una ventana que aparece sola y
    // sin explicación se lee como que algo se rompió.
    //
    // `--sin-warm` lo apaga, para quien no quiera una ventana en el medio.
    if (!session.sirve && !flag('sin-warm')) {
        console.log(`  ⟳ la sesión de asesor no sirve (${session.motivo.split(' —')[0]}).`);
        console.log('     Renovándola: se va a abrir una ventana — el login de Cognito no se puede automatizar sin ella (F-66).\n');

        const renewed = await renewSession();
        if (renewed.ok) {
            console.log(`  ✓ sesión renovada · ${renewed.motivo}\n`);
            session = sessionHealth();
        } else {
            console.log(`  ⚠ no se pudo renovar sola: ${renewed.motivo}\n`);
        }
    }

    if (!session.sirve) {
        console.log(`  ✗ el canal de asesor pide sesión y la que hay no sirve.\n     ${howToRenewSession(session)}\n`);
        process.exit(2);
    }
    // Una sesión que vive 3 minutos pasa el chequeo y se muere a mitad de la tanda: se avisa, porque
    // ese fallo se lee igual que el otro y no tiene por qué. Y con el token durando ~4 minutos, esto
    // salta CASI SIEMPRE justo después de renovar: es correcto, y es el recordatorio de que en este
    // canal la tanda tiene que ser corta.
    if (session.minutos !== null && session.minutos < 15) {
        console.log(`  ⚠ ${session.motivo} — puede vencerse en plena tanda\n`);
    }
}

// Lo que ESTA corrida agregó al bypass, para sacar exactamente eso al terminar y no pisar a las demás.
let bypassSet: { agregados: string[]; comodin: boolean } | null = null;
// ⚠ NO depende de `--cerrar`, y que lo hiciera costó una tarde. El OTP está en la pantalla 3: lo
// cruzan TODAS las corridas, también la corta que se detiene en el listado. Con el bypass atado a
// `--cerrar`, esa corrida moría en el OTP con «Ocurrió un error inesperado» —el mensaje genérico del
// front— y la causa real (el teléfono no estaba en `qa_otp_bypass_phones`, así que el proveedor
// validaba de verdad y devolvía CODE_INVALID) sólo se veía en los logs del backend. Peor: como la
// corrida CON `--cerrar` sí pasaba, el patrón parecía del comercio o de la entidad, y mandaba a
// buscar donde no era.
//
// `local` sigue afuera a propósito: ahí el driver de OTP es falso y no mira el teléfono.
if (TARGET !== 'local') {
    // Los teléfonos se derivan del PAÍS de cada comercio, así que hay que resolver las sucursales
    // ANTES de poder registrarlos en el bypass. Un comercio que no resuelva cae a la forma colombiana:
    // ese caso va a fallar solo, con su propio mensaje, y no por culpa del bypass.
    const tels = await Promise.all(cases.map(async (c, i) => {
        const br = await findBranch(c.ref);
        return br ? await merchantPhone(br.hash, i).catch(() => phoneOf(i)) : phoneOf(i);
    }));
    // ⚠ El aviso NOMBRA la causa, y eso no es cosmético: cuando el registro falla, la corrida no muere
    // acá — muere DOS pantallas después, en el OTP, con el mensaje genérico del front. El 2026-09-17 esa
    // distancia entre la causa y el síntoma costó nueve casos y un diagnóstico entero.
    const r = await registerBypass(tels).catch((e) => ({ ok: false as const, motivo: e instanceof Error ? e.message : String(e) }));
    if (r.ok) bypassSet = r.puesto;
    else console.log(`  ⚠ no se pudo ampliar \`qa_otp_bypass_phones\`, así que los OTP van a fallar: ${r.motivo}\n`);
}

const t0 = Date.now();
let results: Result[];
// UN navegador para toda la tanda; un CONTEXTO por caso (el perfil aislado = «otro cliente»).
if (ENGINE === 'navegador' && FLOW === 'ecommerce') {
    console.log('  ✗ el canal ecommerce está cableado sólo en el motor HTTP: el navegador entra por /solicitar y este canal entra por el checkout de la tienda. Corré sin --motor navegador.\n');
    process.exit(2);
}
const browser = ENGINE === 'navegador' ? await openBrowser({ headed: flag('headed') }) : null;
const oneCase = (c: Case, i: number) => (ENGINE === 'navegador' ? runBrowser(c, i, browser) : correr(c, i));
try {
    results = flag('paralelo')
        ? await Promise.all(cases.map((c, i) => oneCase(c, i)))
        : await (async () => { const out: Result[] = []; for (let i = 0; i < cases.length; i++) out.push(await oneCase(cases[i], i)); return out; })();
} finally {
    await restoreBypass(bypassSet);
    if (browser) await browser.close().catch(() => {});
}

const icon: Record<Result['fin'], string> = { cerro: '✓', listo: '✓', trabado: '⚠', malo: '✗' };
for (const r of results) {
    console.log(`  ${icon[r.fin]} ${r.caso} · uReq ${r.ur ?? '—'} · tel ${r.tel} · doc ${r.doc} · ${r.pantallas} pantallas · ${(r.ms / 1000).toFixed(1)}s`);
    for (const l of r.lineas) console.log(l);
    console.log(`      ${r.fin === 'cerro' ? 'CERRÓ' : r.fin === 'listo' ? 'LISTÓ' : r.fin === 'malo' ? 'DESENLACE MALO' : 'NO cerró'}: ${r.motivo}`);
    /* ⚠ Y SI FALLÓ, decir si la causa del backend quedó registrada en alguna parte.
     * En local la respuesta suele ser NO: con `LOG_CHANNEL=loki` y Loki abajo el handler se traga su
     * propio fallo y el fallback a `storage/logs` no dispara. Medido el 2026-09-15: el último
     * `laravel.log` era de dos días antes, o sea que los errores de todas las corridas del día se
     * perdieron — incluido un 422 que hubo que ir a buscar con `curl`. Va acá y no en la cabecera
     * porque es cuando se va a buscar la causa; en una corrida que cierra no aporta. */
    if (r.fin === 'trabado' || r.fin === 'malo') {
        for (const l of await backendLogsNotice(TARGET, r.ur)) console.log(`      ${l}`);
    }
    console.log('');
}
const closedOnes = results.filter((r) => r.fin === 'cerro' || r.fin === 'listo').length;
console.log(`  ${closedOnes}/${results.length} ${flag('cerrar') ? 'cerraron' : 'listaron'} · ${((Date.now() - t0) / 1000).toFixed(1)}s`);

/* LO QUE LA CORRIDA LE HIZO A LA BASE, del registro directo de `pkg/db.ts`.
 *
 * ⚠ Es distinto del veredicto: una corrida puede decir «0/N cerraron» y haber dejado la base llena
 * —ya pasó tres veces (F-176, F-180)—, y repetirla entonces DUPLICA los datos. Contra una base
 * compartida eso es lo primero que hay que ver antes de volver a lanzar.
 * Y ve los DELETEs, que `dbops activity` admite que no puede ver porque reconstruye mirando filas
 * que existen. */
const lines = writeLines('  ');
if (lines.length) { console.log(''); for (const l of lines) console.log(l); }

// Ruta relativa al repo, igual que el resto de la evidencia del runner (`.runs/caminar-…`).
const dump = `.runs/escrituras-${new Date(t0).toISOString().slice(0, 19).replace(/[:T]/g, '')}.json`;
if (dumpWrites(dump)) console.log(`     detalle sentencia por sentencia → ${dump}`);

/* LA CORRIDA COMO ANOTACIÓN, con `MD=1`. Ver el porqué completo en `pkg/annotation.ts`: el tablero
 * parsea la evidencia de una anotación y deriva con QUÉ se comprobó, pero sólo si lo que se pega trae
 * el comando — y medido, el 86 % no lo trae. Emitirla es lo que hace que salga el comando en vez de
 * prosa.
 *
 * ⚠ SE IMPRIME AL FINAL Y SOLA, sin el resto del informe: el destino es un `Ctrl-C` hacia el `.md` de
 * una tarea, y mezclarla con las cien líneas de la corrida obliga a recortar a mano — que es
 * exactamente la fricción que hace que nadie la pegue. */
if (process.env.MD === '1' || process.env.BLOQUE) {
      const cerró = (r: Result) => r.fin === 'cerro' || r.fin === 'listo';
      const summary = `${closedOnes}/${results.length} ${flag('cerrar') ? 'cerraron' : 'listaron'}`
            + ` en \`${TARGET}\` · motor ${ENGINE} · ${cases.length} caso(s)`
            + (flag('cerrar') ? '' : ' (sin `CERRAR`: llega al listado, no al desenlace)') + '.';
      // Una línea por caso: qué se pidió y dónde terminó. El `uReq` va porque es la llave con la que
      // se sigue investigando (el trazador entra por ahí), y el motivo porque «no cerró» sin el motivo
      // manda a repetir la corrida para volver a leerlo.
      const evidence = results.map((r) => {
            const where = cerró(r)
                  ? `cerró${r.estado !== null ? ` en estado ${r.estado}` : ''}`
                  : `NO cerró: ${r.motivo || 'sin motivo registrado'}`;
            return `${cerró(r) ? '✔' : '✘'} ${r.caso}${r.ur ? ` (uReq ${r.ur})` : ''} — ${r.pantallas} pantalla(s), ${where}`;
      });
      const { emit, cmdMake } = await import('../pkg/annotation.ts');
      emit(summary, cmdMake('harness-caminar', TARGET, {
            CASOS: arg('casos'), COMERCIO: arg('casos') ? '' : arg('comercio'), LENDER: arg('casos') ? '' : arg('lender'),
            MONTO: AMOUNT === 2000000 ? '' : AMOUNT, CUOTA: DOWN_PAYMENT, PLAZO: INSTALLMENTS ?? '',
            FLOW: FLOW === 'self-service' ? '' : FLOW, MOTOR: ENGINE === 'http' ? '' : ENGINE,
            PAR: flag('paralelo') ? 1 : '', CERRAR: flag('cerrar') ? 1 : '', MANUAL: flag('manual') ? 1 : '',
      }), evidence);
}
console.log('');
await close();
process.exit(closedOnes === results.length ? 0 : 1);
