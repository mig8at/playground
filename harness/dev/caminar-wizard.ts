// caminar-wizard.ts — el WIZARD de punta a punta POR HTTP: pasa por todas las pantallas, sin navegador.
//
//   node dev/caminar-wizard.ts --casos '#e9409aff:77' --cerrar --manual
//   node dev/caminar-wizard.ts --casos 'pullman:77;pullman:77;pullman:77' --paralelo --cerrar --manual
//   node dev/caminar-wizard.ts --comercio pullman --lender 77 --amount 2000000 --income 2500000 --score 700
//
// ES EL TERCER CAMINO, y contesta otra pregunta que los dos que ya había:
//   · `dev/caso.ts`     → pega contra el BACKEND: dice si el backend decide bien. No ve el front.
//   · el panel          → recorrido VISUAL por el front, pero lo conduce una persona.
//   · éste              → recorre el FRONT por sus endpoints `.data` (ver `pkg/front.ts`): corre los
//                         loaders, los actions, el middleware y las validaciones zod de cada pantalla,
//                         en segundos y en paralelo. Lo que no corre es el JavaScript del cliente.
// Por qué hace falta el tercero: el bug de F-50 —un tipo de validación que el front no contempla y
// que termina cancelando el crédito— vive en un `action`. `caso.ts` no pasa por ahí, y el panel
// necesita a alguien clickeando. Medido el 2026-09-02 con la uReq 502039 en qa.
//
// LA REGLA QUE LO HACE SEGURO: sólo se siguen las redirecciones que la app emite. Acá NO se adivina
// ninguna URL, porque en este wizard hay loaders que ESCRIBEN (`request-canceled` cancela con sólo
// cargarse). Si el front redirige a una ruta prohibida, el caminador NO la pide: lo reporta como
// desenlace y contrasta la BD. Ver `PROHIBIDAS` en `pkg/front.ts`.
//
// LA ÚNICA URL QUE ESTE RUNNER ARMA SOLO ES EL HANDOFF. Al elegir una entidad CreditopX (rt=2/3/4),
// el backend arma `/self-service/<hash>/<ureq>/confirmation` y se lo manda al CLIENTE por WhatsApp
// (`UserRequestService`: `standBy=true` + `sendSelfManagement`); el front del que eligió sólo muestra
// «se envió un mensaje». El caminador hace lo que haría el cliente al tocar el link: abre esa
// pantalla. Es el mismo salto A→B que hace el panel (`guided.spec.ts`), y se imprime como tal.
//
// CANAL: `self-service` por defecto (no pide sesión). El canal asesor (`/merchant`) exige la sesión
// Cognito; `pkg/front.ts` ya sabe cargar el storageState cacheado, falta cablear el `--flow merchant`.
//
// QUÉ SIEMBRA: lo mismo que `caso.ts` y el panel, y por la misma razón —el buró no lo contesta el
// proveedor en local/dev— (`synthFill` al llegar a personal-info) y, con `--manual`, la validación
// manual de identidad (`validacionManual`, ver su cabecera). El teléfono y la cédula se DERIVAN por
// caso, igual que en `caso.ts`: así dos casos en paralelo nunca comparten usuario.
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

const { SesionFront, PROHIBIDAS } = await import('../pkg/front.ts');
const { one, exec, close, TARGET } = await import('../pkg/db.ts');
const { synthFill, validacionManual } = await import('../pkg/inject.ts');
const { config, avisoDocGen } = await import('../pkg/config.ts');
const { forensePostHog } = await import('../pkg/posthog.ts');
const { crearTraza, ESTADO_ESPERADO } = await import('../pkg/trace.ts');
const { abrirNavegador, abrirContexto, cerrarContexto, avanzar, elegirEntidad, bannerDeError, esperarCambio } =
    await import('../pkg/wizard-navegador.ts');
const { erroresDeValidacion: erroresEnPantalla } = await import('../pkg/autorrelleno.ts');
const { mkdirSync } = await import('node:fs');
const { cognitoStorageState, COGNITO_STATE_PATH } = await import('../pkg/cognito.ts');

type Form = Record<string, string | number | null | undefined>;

// ─── argumentos ──────────────────────────────────────────────────────────────────────────────────
const arg = (n: string, d = ''): string => {
    const i = process.argv.indexOf(`--${n}`);
    return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d;
};
const flag = (n: string) => process.argv.includes(`--${n}`);

const FLOW = arg('flow', 'self-service');
const AMOUNT = Number(arg('amount', '2000000'));
const INCOME = Number(arg('income', '2500000'));
const SCORE = Number(arg('score', '700'));
const CUOTAS = Number(arg('cuotas', '4'));
const MAX_PASOS = 40;
/** ⚠ TOPE DE TIEMPO POR CASO, y no es un lujo: el 2026-09-03 una corrida del motor de navegador contra el
 *  canal de asesor giró **18 minutos sin imprimir una línea**. Cada vuelta del bucle puede esperar
 *  `networkidle` (20 s) más el cambio de URL (25 s) más los reintentos del click, así que 40 vueltas sin
 *  progreso son media hora de silencio — y en paralelo, media hora por caso. Un runner que no puede
 *  terminar es peor que uno que falla. */
const TOPE_MS = Number(arg('tope', '480')) * 1000;   // 8 min: un caso entero por navegador y con PDF por plantillas ronda los 4
/** Vueltas seguidas sin que cambie la pantalla antes de darla por trabada. Varias pantallas tienen pasos
 *  internos con la MISMA URL (`personal-info` son dos), así que no alcanza con «la URL no cambió». */
const SIN_PROGRESO_MAX = 4;
/** `http` (default) habla el protocolo del front; `navegador` abre Chromium sin ventana y clickea.
 *  Mismo caso, misma siembra, misma traza, mismo forense: lo único distinto es cómo se opera la pantalla. */
const MOTOR = arg('motor', 'http') === 'navegador' ? 'navegador' : 'http';

type Caso = { ref: string; lender: number | null };
function parsearCasos(): Caso[] {
    const crudos = arg('casos') ? arg('casos').split(';').map((s) => s.trim()).filter(Boolean)
        : [`${arg('comercio', 'pullman')}${arg('lender') ? `:${arg('lender')}` : ''}`];
    return crudos.map((c) => {
        const [ref, lender] = c.split(':');
        return { ref, lender: lender ? Number(lender) : null };
    });
}

// ─── derivados por caso (mismo criterio que caso.ts: nunca dos casos con el mismo usuario) ──────
const BASE_DOC = 1_090_000_000 + ((Date.now() / 100) % 9_000_000 | 0);
const cedulaDe = (i: number) => String(BASE_DOC + i);
/** 32 + 8 dígitos: un prefijo distinto del de caso.ts (313…), para no chocar con una tanda suya en curso. */
const telefonoDe = (i: number) => `32${String(BASE_DOC).slice(-6)}${String(i % 100).padStart(2, '0')}`;

async function buscarSucursal(ref: string) {
    const porHash = ref.startsWith('#');
    return one<{ id: number; hash: string; com: string; allied: number }>(
        porHash
            ? `SELECT b.id, b.hash, x.name AS com, x.id AS allied FROM allied_branches b
                 JOIN allieds x ON x.id = b.allied_id WHERE b.hash = ? LIMIT 1`
            : `SELECT b.id, b.hash, x.name AS com, x.id AS allied FROM allied_branches b
                 JOIN allieds x ON x.id = b.allied_id
                WHERE x.slug = ? OR x.name LIKE ?
                ORDER BY (x.slug = ?) DESC,
                         (SELECT COUNT(*) FROM lenders_by_allied_branches l WHERE l.allied_branch_id = b.id) DESC LIMIT 1`,
        porHash ? [ref.slice(1)] : [ref, `%${ref}%`, ref]).catch(() => null);
}

// ─── bypass de OTP fuera de local (el driver fake de local no mira el teléfono) ─────────────────
async function registrarBypass(tels: string[]): Promise<string | null> {
    const row = await one<{ value: string }>("SELECT value FROM settings WHERE `key`='qa_otp_bypass_phones'").catch(() => null);
    if (!row) return null;
    const actuales: string[] = JSON.parse(row.value ?? '[]').map(String);
    if (actuales.includes('*')) return row.value;
    const faltan = tels.filter((t) => !actuales.includes(t));
    if (!faltan.length) return row.value;
    await exec("UPDATE settings SET value=? WHERE `key`='qa_otp_bypass_phones'", [JSON.stringify([...actuales, ...faltan])]);
    return row.value;
}
async function restaurarBypass(original: string | null): Promise<void> {
    if (original === null) return;
    await exec("UPDATE settings SET value=? WHERE `key`='qa_otp_bypass_phones'", [original]).catch(() => {});
}

/** La siembra que los dos motores necesitan al llegar al formulario: el buró (el proveedor no contesta
 *  en local/dev), las dos fotos de la cédula (sin ellas la formalización muere al final) y, con
 *  `--manual`, la validación de identidad. Vive acá y no en cada motor para no tener dos siembras. */
async function sembrar(ur: number, doc: string, log: (s: string) => void): Promise<void> {
    const inj = await synthFill(ur, { income: INCOME, score: SCORE, skipIdentity: true } as any);
    const u = await one<{ user_id: number }>('SELECT user_id FROM user_requests WHERE id=?', [ur]).catch(() => null);
    if (u?.user_id) await exec('UPDATE users SET front_url=?, back_url=?, updated_at=NOW() WHERE id=?',
        [`https://mock-s3.local/front-web/users/documents/synth/${doc}/frontal.jpg`,
         `https://mock-s3.local/front-web/users/documents/synth/${doc}/reverso.jpg`, u.user_id]).catch(() => null);
    if (flag('manual') && u?.user_id) await validacionManual(u.user_id);
    log(`buró inyectado para uReq ${ur} (Experian ${inj.datacredito_forged})${flag('manual') ? ' · identidad aprobada a mano' : ''}`);
}

// ─── la traza contra la BD ───────────────────────────────────────────────────────────────────────
// Es `pkg/trace.ts`, no una copia: la misma clase que usan el visual y el rápido, así que «pasó» tiene
// UNA definición para los tres (la regla de harness/CLAUDE.md). Se pide **una instancia por caso** —
// `crearTraza({ salida })`— porque en paralelo el estado compartido entrelazaría las líneas y el uReq.
// La única cosa que este runner sigue leyendo por su cuenta es si un estado SELLA, para decidir el
// desenlace; el mapa viene de `ESTADO_ESPERADO`, no de un Set propio.
const sellado = (st: number | null | undefined) => st === ESTADO_ESPERADO.success || st === 28;

type Resultado = {
    caso: string; ur: number | null; tel: string; doc: string;
    pantallas: number; listado: number[]; enListado: boolean | null;
    fin: 'cerro' | 'listo' | 'trabado' | 'malo'; motivo: string; estado: number | null; ms: number;
    lineas: string[];
};

// ─── un caso ─────────────────────────────────────────────────────────────────────────────────────
async function correr(c: Caso, i: number): Promise<Resultado> {
    const t0 = Date.now();
    const tel = telefonoDe(i);
    const doc = cedulaDe(i);
    const lineas: string[] = [];
    const log = (s: string) => lineas.push(`  ▸ ${s}`);
    const r: Resultado = { caso: c.ref + (c.lender ? `:${c.lender}` : ''), ur: null, tel, doc, pantallas: 0,
        listado: [], enListado: null, fin: 'trabado', motivo: '', estado: null, ms: 0, lineas };
    const rutasCaminadas: string[] = [];
    // ── LA TERCERA FUENTE, Y SÓLO CUANDO HACE FALTA ──
    // PostHog dice en qué PANTALLA del front se rompió, que es lo que ni la BD ni Loki (que sólo ve
    // legacy-backend) pueden decir. Pero se consulta **sólo si el caso terminó mal**, la misma regla que
    // ya seguía `forenseAlCerrar` de Loki: si cerró como se pedía, no se pregunta nada.
    //
    // No es tacañería, son tres cosas medidas el 2026-09-02 con el forense puesto en TODAS las corridas:
    //   · CUESTA: la ingesta tarda minutos, y esperarla llevó una corrida de 108 s a 128, y otra a 237.
    //   · NO APORTA en el caso feliz: con la solicitud en estado 11, los 18 eventos son narración del
    //     embudo; el diagnóstico ya lo dio la traza contra la BD.
    //   · LLEGA A MEDIAS justo cuando serviría: al cerrar, la ingesta todavía no trajo el final y sale
    //     marcado PARCIAL. Por eso, cuando el caso falla, esto imprime lo que HAY y deja el comando para
    //     volver a mirarlo completo unos minutos después (`dev/posthog-ureq.ts`).
    // `FORENSE=1` lo fuerza igual, para cuando lo que se está probando es el forense mismo.
    const terminar = async (fin: Resultado['fin'], motivo: string) => {
        r.fin = fin; r.motivo = motivo; r.ms = Date.now() - t0;
        await t.drenar();   // que no queden líneas en vuelo después del resumen
        const salioMal = fin === 'malo' || fin === 'trabado';
        if (r.ur && rutasCaminadas.length && (salioMal || process.env.FORENSE === '1')) {
            await forensePostHog(r.ur, new Date(t0), rutasCaminadas, (l) => lineas.push(l), new Date()).catch(() => {});
        } else if (r.ur && !salioMal) {
            lineas.push(`  ▸ PostHog: no se consulta porque el caso cerró como se pedía · si lo querés: make harness-posthog UREQ=${r.ur} DESDE=${new Date(t0 - 60_000).toISOString()}`);
        }
        return r;
    };

    const br = await buscarSucursal(c.ref);
    if (!br) return terminar('trabado', `no encontré la sucursal «${c.ref}»`);

    const s = new SesionFront();
    // La traza de ESTE caso. Su salida va al buffer del caso, no a consola: en paralelo, N casos
    // escribiendo a la vez dan un log ilegible.
    const t = crearTraza({ salida: (l) => lineas.push(l), ancho: 74 });

    /** Una pantalla: la carga (su loader) y la contrasta con la BD. Devuelve la respuesta del loader. */
    const pantalla = async (ruta: string) => {
        const res = await s.cargar(ruta);
        r.pantallas += 1;
        rutasCaminadas.push(ruta);
        if (r.ur) t.trazarUReq(r.ur);
        const http = res.status === 202 ? `202 → ${res.redirect}` : String(res.status);
        t.paso('', ruta, undefined, `[${http} · ${res.ms}ms]`);
        await t.drenar();          // en serie: la línea sale antes de que el caso siga
        return res;
    };

    /** Sigue un redirect: si apunta a una ruta prohibida, NO la pide y lo dice. */
    const destino = (redirect: string | null, desde: string): string | null => {
        if (!redirect) return null;
        if (/^https?:\/\//.test(redirect) && !redirect.startsWith(s.base)) {
            log(`↪ el front manda AFUERA: ${redirect.slice(0, 120)} — decide otro (rt=0/1); acá no hay más pantallas`);
            return null;
        }
        if (SesionFront.esProhibida(redirect)) {
            log(`↪ ${desde} redirigió a ${redirect} — RUTA PROHIBIDA: su loader CANCELA la solicitud (F-50). No la pido.`);
            return null;
        }
        return redirect;
    };

    // El tercer segmento es la solicitud SALVO en `/<tel>/otp`, donde es el teléfono: se excluye por
    // lo que sigue, no por la forma (los dos son dígitos).
    const urDe = (ruta: string): number | null => {
        const m = ruta.match(new RegExp(`^/${FLOW}/[^/]+/(\\d+)/(?!otp(/|\\?|$))`));
        return m ? Number(m[1]) : null;
    };
    const base = `/${FLOW}/${br.hash}`;
    let ruta = `${base}/solicitar?amount=${AMOUNT}`;
    let burоInyectado = false;
    let lenderElegido: any = null;

    for (let paso = 0; paso < MAX_PASOS && ruta; paso++) {
        { const u = urDe(ruta); if (u) r.ur = u; }
        const res = await pantalla(ruta);

        // El loader mismo redirigió (gate, estado terminal, login…): se sigue y punto.
        if (res.status === 202 && res.redirect) {
            const d = destino(res.redirect, ruta);
            if (!d) return terminar(/prohibida/i.test(lineas.at(-1) ?? '') ? 'malo' : 'trabado', `el loader de ${ruta.split('?')[0].split('/').slice(3).join('/')} redirigió a ${res.redirect}`);
            ruta = d; continue;
        }
        if (res.status === 0) return terminar('trabado', `${ruta}: ${res.crudo?.slice(0, 120) ?? 'sin respuesta'}`);
        if (res.status >= 400 || (res.status !== 200 && !res.datos)) {
            return terminar('trabado', `${ruta.split('?')[0]}: HTTP ${res.status}${res.crudo ? ` · ${res.crudo.replace(/\s+/g, ' ').slice(0, 140)}` : ''}`);
        }

        const path = ruta.split('?')[0];
        const seg = path.split('/');
        const hoja = seg.at(-1) ?? '';
        const q = new URL(ruta, 'http://x').searchParams;
        const amount = q.get('amount') ?? String(AMOUNT);
        let form: Form | null = null;
        let saltoA: string | null = null;

        // ── cada pantalla: qué manda el navegador al apretar el botón ──
        if (hoja === 'solicitar') {
            form = { phoneNumber: tel, amount, ...(res.datos?.showQuotaConfirmation ? { confirmQuota: 'no' } : {}) };
        } else if (hoja === 'otp' && seg.at(-2) === tel) {
            form = { otp: tel.slice(-4), amount, original_amount: amount };
        } else if (hoja === 'personal-info' || hoja === 'employment-info') {
            const ur = urDe(ruta)!;
            if (!burоInyectado) { await sembrar(ur, doc, log); burоInyectado = true; }
            form = hoja === 'personal-info'
                ? { intent: 'save-personal-info', documentType: 'CC', documentNumber: doc, name: 'CARLOS', surname: 'RUIZ',
                    email: `qa${doc}@gmail.com`, address: 'Calle 1 # 2-3', stratum: '3',
                    issueDay: '10', issueMonth: '5', issueYear: '2019', birthDay: '10', birthMonth: '5', birthYear: '2001' }
                : { employmentStatus: 'Empleado', monthlyIncome: String(INCOME) };
        } else if (hoja === 'lenders') {
            const lo = res.datos?.loanOptionsPromise;
            const opciones: any[] = Array.isArray(lo?.loan_options) ? lo.loan_options : [];
            if (lo?.__rechazada || lo?.__pendiente !== undefined) {
                return terminar('trabado', `el listado no llegó: ${lo.__rechazada ? `la promesa fue rechazada (${String(lo.__rechazada?.message ?? lo.__rechazada).slice(0, 100)})` : 'la promesa quedó pendiente (¿streamTimeout?)'}`);
            }
            r.listado = opciones.map((l) => Number(l.id));
            log(`listado: [${r.listado.join(', ')}]${lo?.requestedAmount ? ` · monto ${lo.requestedAmount}` : ''}`);
            if (!flag('cerrar')) return terminar('listo', `listó ${opciones.length} entidad(es)`);
            const pedido = c.lender ?? Number(opciones.find((l) => Number(l.response_type) === 2)?.id);
            lenderElegido = opciones.find((l) => Number(l.id) === pedido);
            r.enListado = !!lenderElegido;
            if (!lenderElegido) return terminar('trabado', `la entidad ${pedido || '(ninguna rt=2)'} no salió en el listado`);
            // El mismo payload que arma `useLenderSelection.ts`. `amount` va igual al pedido: el
            // cálculo de garantía que hace el cliente (financedAmountWithGuarantee) no se replica acá.
            form = {
                lender_id: lenderElegido.id, lender_name: lenderElegido.name,
                fee_number: lenderElegido.fee_number ?? CUOTAS, original_amount: amount, amount,
                initial_fee: 0, productId: q.get('productId') ?? '',
                rate: lenderElegido.credit_lines?.rate ?? 0, response_type: lenderElegido.response_type,
                is_recommended: lenderElegido.isRecommended ? 'true' : 'false',
                transaction_data: JSON.stringify(lenderElegido.transaction_data ?? null),   // el navegador manda «null» literal, y el action lo parsea
                path_id: lenderElegido.path_id ?? '', product: lenderElegido.product ?? 'credit',
            };
        } else if (hoja === 'confirmation' || hoja === 'sign-documents') {
            form = {};
        } else if (hoja === 'first-payment-date') {
            const fechas: any[] = res.datos?.response?.payload?.nextPaymentDates ?? [];
            if (!fechas.length) return terminar('trabado', `first-payment-date sin fechas: ${JSON.stringify(res.datos?.response).slice(0, 160)}`);
            form = { firstPaymentDate: fechas[0].date };
        } else if (hoja === 'payment-schedule') {
            const planes: any[] = res.datos?.response?.payload?.paymentSchedule ?? [];
            if (!planes.length) return terminar('trabado', `payment-schedule sin planes: ${JSON.stringify(res.datos?.response).slice(0, 160)}`);
            const elegido = planes.find((p) => Number(p.fee_number) === CUOTAS) ?? planes[0];
            if (Number(elegido.fee_number) !== CUOTAS) log(`⚠ el plazo pedido (${CUOTAS}) no está entre los ofrecidos [${planes.map((p) => p.fee_number).join(', ')}]: se cierra con ${elegido.fee_number}`);
            form = { paymentSchedule: elegido.fee_number };
        } else if (hoja === 'otp-validation') {
            form = { _action: 'verify', otp: tel.slice(-6) };
        } else if (hoja === 'loan-approved') {
            // El veredicto lo da `pkg/trace.ts`, el mismo que usan el visual y el rápido: incluye el
            // patrón F-50 (pantalla de éxito con la BD sin sellar) que la traza ya venía marcando.
            const v = r.ur ? await t.veredicto(r.ur, 'success') : null;
            r.estado = v?.st ?? null;
            return terminar(v?.ok ? 'cerro' : 'malo',
                v?.ok ? `loan-approved con la BD en ${v.st}` : `loan-approved pero la BD dice ${v?.st ?? '—'} (F-50)`);
        } else if (/^identity-validation/.test(hoja)) {
            return terminar('trabado', `pide validar identidad (${hoja})${flag('manual') ? ' A PESAR de la validación manual — eso es un hallazgo' : ' — corré con --manual para saltarla como lo haría el admin'}`);
        } else {
            return terminar('trabado', `pantalla sin manejador: ${path.replace(base, '')} — el caminador no sabe qué botón apretar acá`);
        }

        // ── el POST (el botón) ──
        const acc = await s.enviar(ruta, form!);
        if (acc.status === 0) {
            // ⚠ UN TIMEOUT NO ES UNA CAÍDA: el backend sigue y suele terminar (F-180). Antes de decir
            // «no cerró» se vuelve a mirar la BD: si ya está sellada, cerró y lo que falló fue la espera.
            const sn = r.ur ? await one<{ st: number }>('SELECT user_request_status_id st FROM user_requests WHERE id=?', [r.ur]).catch(() => null) : null;
            if (sellado(sn?.st)) { r.estado = sn!.st; return terminar('cerro', `la espera de ${hoja} expiró pero la BD ya dice ${sn!.st} (tardó, no falló)`); }
            return terminar('trabado', `${hoja}: ${acc.crudo?.slice(0, 120) ?? 'sin respuesta'}${sn ? ` · BD en ${sn.st}` : ''}`);
        }
        if (acc.redirect) {
            if (hoja === 'lenders' && lenderElegido && [2, 3, 4].includes(Number(lenderElegido.response_type))) {
                // El backend armó el link de confirmación y se lo mandó al cliente: se abre ESA pantalla.
                log(`B (celular): handoff CreditopX (${lenderElegido.name}) → abro ${base}/${r.ur}/confirmation  [el front respondió 202 → ${acc.redirect}]`);
                saltoA = `${base}/${r.ur}/confirmation`;
            } else {
                saltoA = destino(acc.redirect, hoja);
                if (!saltoA) return terminar(SesionFront.esProhibida(acc.redirect) ? 'malo' : 'trabado', `${hoja} → ${acc.redirect}`);
            }
        } else {
            const err = acc.cuerpo?.error ?? acc.datos?.error ?? acc.cuerpo?.data?.error;
            if (err) return terminar('trabado', `${hoja} respondió error: ${typeof err === 'string' ? err : (err?.message ?? JSON.stringify(err)).slice(0, 160)}`);
            if (hoja === 'lenders' && lenderElegido && [2, 3, 4].includes(Number(lenderElegido.response_type))) {
                const d = acc.cuerpo?.data ?? {};
                log(`B (celular): handoff CreditopX (${lenderElegido.name}) → abro ${base}/${r.ur}/confirmation  [el front devolvió ${d.showModal ? `modal «${String(d.modalMessage ?? '').slice(0, 60)}»` : 'datos sin redirect'}]`);
                saltoA = `${base}/${r.ur}/confirmation`;
            } else {
                return terminar('trabado', `${hoja}: el action no redirigió ni dio error · ${JSON.stringify(acc.cuerpo).slice(0, 160)}`);
            }
        }
        ruta = saltoA!;
    }
    return terminar('trabado', `se pasó de ${MAX_PASOS} pasos sin llegar al final`);
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
async function correrNavegador(c: Caso, i: number, browser: any): Promise<Resultado> {
    const t0 = Date.now();
    const tel = telefonoDe(i);
    const doc = cedulaDe(i);
    const lineas: string[] = [];
    const log = (s: string) => lineas.push(`  ▸ ${s}`);
    const r: Resultado = { caso: c.ref + (c.lender ? `:${c.lender}` : ''), ur: null, tel, doc, pantallas: 0,
        listado: [], enListado: null, fin: 'trabado', motivo: '', estado: null, ms: 0, lineas };
    const rutasCaminadas: string[] = [];
    const t = crearTraza({ salida: (l) => lineas.push(l), ancho: 74 });
    const dirEvidencia = `.runs/caminar-${new Date(t0).toISOString().slice(0, 19).replace(/[:T]/g, '')}-caso${i}`;

    const br = await buscarSucursal(c.ref);
    if (!br) { r.motivo = `no encontré la sucursal «${c.ref}»`; r.ms = Date.now() - t0; return r; }
    // EL CANAL DE ASESOR pide sesión de Cognito. No se loguea acá: se REUSA el storageState que dejó el
    // panel (`pkg/cognito.ts`), y los N contextos de una tanda cargan EL MISMO archivo — un solo login
    // para todos, que es lo que evita golpear el pool.
    //
    // ⚠ Y eso significa que «10 asesores en paralelo» son 10 sesiones del MISMO asesor atendiendo a 10
    // clientes distintos. Alcanza para casi todo, pero no para probar nada que dependa de que los
    // asesores sean distintos (permisos, sucursales asignadas, su lista de solicitudes).
    const sesion = FLOW === 'merchant' ? cognitoStorageState() : undefined;
    if (FLOW === 'merchant' && !sesion) {
        r.motivo = `el canal de asesor pide sesión y no hay ninguna cacheada en ${COGNITO_STATE_PATH} — entrá una vez por el panel y volvé`;
        r.ms = Date.now() - t0;
        return r;
    }
    const { ctx, page, evidencia } = await abrirContexto(browser, config.feBaseUrl, { traza: dirEvidencia, storageState: sesion });

    const terminar = async (fin: Resultado['fin'], motivo: string) => {
        r.fin = fin; r.motivo = motivo; r.ms = Date.now() - t0;
        await t.drenar();
        const salioMal = fin === 'malo' || fin === 'trabado';
        // La evidencia PESA (traza con DOM por acción + captura), así que se guarda sólo si el caso falló.
        if (salioMal) {
            // Lo que el navegador vio, en el log: es lo primero que se lee y suele decir la causa. La traza
            // y la captura quedan en disco para lo que el texto no alcanza.
            if (evidencia.consola.length) { log('lo que dijo la CONSOLA del navegador:'); for (const l of evidencia.consola.slice(0, 8)) log(`   ${l}`); }
            if (evidencia.red.length) { log('llamadas que FALLARON:'); for (const l of evidencia.red.slice(0, 8)) log(`   ${l}`); }
            try { mkdirSync(dirEvidencia, { recursive: true }); } catch { /* ya existe */ }
            await page.screenshot({ path: `${dirEvidencia}/ultima.png`, fullPage: true }).catch(() => {});
            await cerrarContexto(ctx, `${dirEvidencia}/traza.zip`);
            log(`evidencia: ${dirEvidencia}/ (traza.zip se abre con \`npx playwright show-trace\`)`);
        } else {
            await cerrarContexto(ctx, null);
        }
        if (r.ur && rutasCaminadas.length && (salioMal || process.env.FORENSE === '1')) {
            await forensePostHog(r.ur, new Date(t0), rutasCaminadas, (l) => lineas.push(l), new Date()).catch(() => {});
        } else if (r.ur && !salioMal) {
            lineas.push(`  ▸ PostHog: no se consulta porque el caso cerró como se pedía · si lo querés: make harness-posthog UREQ=${r.ur} DESDE=${new Date(t0 - 60_000).toISOString()}`);
        }
        return r;
    };

    const nombreEntidad = c.lender
        ? (await one<{ name: string }>('SELECT name FROM lenders WHERE id=?', [c.lender]).catch(() => null))?.name ?? null
        : null;
    if (c.lender && !nombreEntidad) return terminar('trabado', `la entidad ${c.lender} no está en la base`);

    const base = `/${FLOW}/${br.hash}`;
    await page.goto(`${base}/solicitar?amount=${AMOUNT}`, { waitUntil: 'domcontentloaded', timeout: 90_000 }).catch(() => {});
    let sembrado = false;
    let ultima = '';

    let sinProgreso = 0;
    for (let paso = 0; paso < MAX_PASOS; paso++) {
        if (Date.now() - t0 > TOPE_MS) {
            return terminar('trabado', `se pasó del tope de ${Math.round(TOPE_MS / 1000)} s en ${ultima || 'la primera pantalla'} (subilo con --tope <segundos> si de verdad tarda tanto)`);
        }
        // La pantalla la dice el navegador. Se espera a que la red se calme para no medir una a medio pintar.
        await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
        const ruta = new URL(page.url()).pathname + new URL(page.url()).search;
        const path = ruta.split('?')[0];
        const hoja = path.split('/').filter(Boolean).pop() ?? '';
        const u = path.match(new RegExp(`^/${FLOW}/[^/]+/(\\d+)/(?!otp(/|$))`));
        if (u) { r.ur = Number(u[1]); t.trazarUReq(r.ur); }

        if (ruta === ultima) {
            sinProgreso += 1;
            if (sinProgreso > SIN_PROGRESO_MAX) {
                const errs = await erroresEnPantalla(page).catch(() => [] as string[]);
                return terminar('trabado', `${hoja}: ${SIN_PROGRESO_MAX + 1} intentos sin que la pantalla avance`
                    + (errs.length ? ` · lo que dice: ${errs.slice(0, 3).join(' | ')}` : ''));
            }
        } else {
            sinProgreso = 0;
        }
        if (ruta !== ultima) {
            r.pantallas += 1;
            rutasCaminadas.push(ruta);
            // ⚠ EN EL LISTADO, UN MENSAJE DE ERROR NO ES UN MURO. Cada tarjeta consulta su propia
            // pre-aprobación y puede fallar sola: «No pudimos consultar esta entidad» aparece POR
            // ENTIDAD, con su botón de reintentar, y el listado sigue siendo usable. Tratarlo como muro
            // cortaba la corrida en una pantalla que funcionaba (2026-09-03). Se anota y se sigue: quien
            // decide es `elegirEntidad`, que sabe si la entidad PEDIDA está y se puede clickear.
            const banner = await bannerDeError(page);
            const enListado = hoja === 'lenders';
            t.paso('', ruta, undefined, banner ? `${enListado ? '⚠' : '⛔'} ${banner}` : undefined);
            await t.drenar();
            ultima = ruta;
            if (banner && !enListado) return terminar('trabado', `${hoja}: la pantalla muestra «${banner}» (el motor HTTP no ve esto)`);
        }

        // La sesión de asesor vencida se ve como un aterrizaje en el login, y hay que decirlo con esas
        // palabras: sin esto el caso falla con «sin botón para avanzar» en una pantalla de Cognito.
        if (/^\/login|auth\.merchant|login\.creditop/.test(path) || /auth\.merchant|login\.creditop/.test(page.url())) {
            return terminar('trabado', `la sesión de asesor está vencida (aterrizó en ${path}) — entrá una vez por el panel para renovar ${COGNITO_STATE_PATH}`);
        }
        // ⚠ EL ASESOR MANDA SOBRE LA SUCURSAL, y por eso esto CORTA en vez de avisar. Su sesión lleva el
        // comercio asignado, así que `/merchant` redirige al de la sesión y no al que pidió el caso: pasó
        // el 2026-09-02 en una corrida que decía «celurd» y corrió contra la sucursal de Motai, y el
        // reporte no lo dijo. Seguir sería probar OTRO comercio y llamarlo el pedido.
        //
        // No se reasigna solo: cambiar a qué sucursal está pegado un asesor es una escritura que el panel
        // hace explícita (`bin/asesor` → `dbops assign`), y hacerla a escondidas dejaría al asesor movido
        // después de la corrida. Se imprime el comando y se corta.
        if (FLOW === 'merchant' && /^\/merchant\/[0-9a-f]{8}/.test(path) && path.split('/')[2] !== br.hash) {
            const otro = path.split('/')[2];
            const suyo = await one<{ cognito_id: string; email: string }>(
                `SELECT u.cognito_id, u.email FROM users u JOIN allied_branches ab ON ab.id=u.allied_branch_id
                  WHERE ab.hash=? AND u.cognito_id IS NOT NULL AND u.cognito_id<>'' ORDER BY u.updated_at DESC LIMIT 1`, [otro]).catch(() => null);
            return terminar('trabado',
                `la sesión del asesor está pegada a la sucursal ${otro}, no a la pedida (${br.hash}), así que esto probaría OTRO comercio`
                + (suyo?.cognito_id ? ` · para moverlo: I_KNOW_THIS_TOUCHES_SHARED_DEV=1 node bin/dbops.ts assign ${suyo.cognito_id} <comercio> ${br.hash} ${suyo.cognito_id}` : ''));
        }

        if (/request-canceled/.test(path)) return terminar('malo', 'el front llevó al cliente a la pantalla de cancelación');
        if (/rate-limit-exceeded/.test(path)) return terminar('trabado', 'rate limit del onboarding');
        if (/loan-approved/.test(path)) {
            const v = r.ur ? await t.veredicto(r.ur, 'success') : null;
            r.estado = v?.st ?? null;
            return terminar(v?.ok ? 'cerro' : 'malo',
                v?.ok ? `loan-approved con la BD en ${v.st}` : `loan-approved pero la BD dice ${v?.st ?? '—'} (F-50)`);
        }

        // El formulario: se siembra ANTES de enviarlo, igual que en el otro motor.
        if ((hoja === 'personal-info' || hoja === 'employment-info') && r.ur && !sembrado) {
            await sembrar(r.ur, doc, log); sembrado = true;
        }

        // Pantalla de espera: navega sola. Se le da tiempo en vez de clickear.
        if (/processing|validating|waiting|kyc-processing/.test(path)) {
            const antes = page.url();
            await page.waitForURL((x) => x.href !== antes, { timeout: 60_000 }).catch(() => {});
            continue;
        }

        // EL HANDOFF, igual que en el motor HTTP y por la misma razón: al elegir una CreditopX el backend
        // arma `/self-service/<hash>/<ureq>/confirmation` y **se lo manda al CLIENTE** por WhatsApp; la
        // pantalla `/continue` es la del que eligió, que sólo dice «se envió un mensaje» y no tiene botón
        // para avanzar. El caminador hace lo que haría el cliente al tocar el link. Es el salto A→B del panel.
        if (hoja === 'continue' && r.ur) {
            log(`B (celular): handoff CreditopX → abro ${base}/${r.ur}/confirmation`);
            await page.goto(`${base}/${r.ur}/confirmation`, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {});
            continue;
        }

        if (hoja === 'lenders') {
            if (!flag('cerrar')) return terminar('listo', 'llegó al listado');
            if (!nombreEntidad) return terminar('trabado', 'con --motor navegador hay que pedir la entidad (`#hash:ID`)');
            const el = await elegirEntidad(page, nombreEntidad);
            r.enListado = el.ok;
            if (!el.ok) return terminar('trabado', `«${nombreEntidad}» no está en el listado · visibles: ${el.visibles.slice(0, 8).join(' · ')}`);
            log(`elegí «${nombreEntidad}» en el listado`);
            await page.waitForTimeout(1500);
            continue;
        }

        const antes = page.url();
        const av = await avanzar(page, { tel, doc, amount: AMOUNT, income: INCOME }, hoja);
        if (av.hechos.length) log(`   ▸ autorrelleno: ${av.hechos.join(' · ')}`);
        if (!av.ok) {
            return terminar('trabado', `${hoja}: sin botón habilitado para avanzar`
                + (av.errores?.length ? ` · lo que dice la pantalla: ${av.errores.slice(0, 4).join(' | ')}` : '')
                + (av.candidatos?.length ? ` · botones: ${av.candidatos.slice(0, 6).join(' · ')}` : ' · ningún botón de avance en la pantalla'));
        }
        log(`   ↳ click «${av.boton}»`);
        // Si la URL no cambia no es un fallo: varias pantallas tienen pasos internos (`personal-info`
        // son dos: identificación y fecha de expedición). Se le da tiempo y el bucle vuelve a mirar.
        // ⚠ ESPERA GENEROSA DESPUÉS DE UN CLICK ACEPTADO, y el número tiene una razón: el envío de
        // `payment-schedule` es el que dispara la GENERACIÓN DE DOCUMENTOS, ~30 s con plantillas Blade
        // (§«Corridas 4× más rápidas»). Con 12 s el caminador abandonaba una pantalla que estaba
        // funcionando —la captura mostraba el botón con el spinner— y lo reportaba como «sin botón para
        // avanzar»: un falso negativo sobre el paso más lento del flujo.
        //
        // Esperar mucho por click ya no puede colgar la corrida: de eso se encargan el tope global
        // (`--tope`) y el contador de vueltas sin progreso, que son los guardas correctos.
        if (!(await esperarCambio(page, antes, 60_000))) await page.waitForTimeout(1_000);
    }
    return terminar('trabado', `se pasó de ${MAX_PASOS} pantallas sin llegar al final`);
}

// ─── main ────────────────────────────────────────────────────────────────────────────────────────
const casos = parsearCasos();
console.log(`\n  CAMINAR · ${casos.length} caso(s) · motor ${MOTOR === 'navegador' ? 'NAVEGADOR (Chromium sin ventana)' : 'HTTP'} · ${flag('paralelo') ? 'en paralelo' : 'en serie'} · front ${config.feBaseUrl} · target ${TARGET}`
    + ` · ${flag('cerrar') ? 'hasta loan-approved' : 'hasta el listado'}${flag('manual') ? ' · identidad manual' : ''}\n`);

// Una perilla que cambia QUÉ prueba la corrida no puede estar invisible en el `.env` de otro repo.
const aviso = avisoDocGen(TARGET);
if (aviso) console.log(`  ${aviso}\n`);

let bypassOriginal: string | null = null;
if (flag('cerrar') && TARGET !== 'local') {
    bypassOriginal = await registrarBypass(casos.map((_, i) => telefonoDe(i))).catch(() => null);
    if (bypassOriginal === null) console.log('  ⚠ no se pudo ampliar `qa_otp_bypass_phones`: los OTP van a fallar fuera de local\n');
}

const t0 = Date.now();
let resultados: Resultado[];
// UN navegador para toda la tanda; un CONTEXTO por caso (el perfil aislado = «otro cliente»).
const browser = MOTOR === 'navegador' ? await abrirNavegador({ headed: flag('headed') }) : null;
const unCaso = (c: Caso, i: number) => (MOTOR === 'navegador' ? correrNavegador(c, i, browser) : correr(c, i));
try {
    resultados = flag('paralelo')
        ? await Promise.all(casos.map((c, i) => unCaso(c, i)))
        : await (async () => { const out: Resultado[] = []; for (let i = 0; i < casos.length; i++) out.push(await unCaso(casos[i], i)); return out; })();
} finally {
    await restaurarBypass(bypassOriginal);
    if (browser) await browser.close().catch(() => {});
}

const icono: Record<Resultado['fin'], string> = { cerro: '✓', listo: '✓', trabado: '⚠', malo: '✗' };
for (const r of resultados) {
    console.log(`  ${icono[r.fin]} ${r.caso} · uReq ${r.ur ?? '—'} · tel ${r.tel} · doc ${r.doc} · ${r.pantallas} pantallas · ${(r.ms / 1000).toFixed(1)}s`);
    for (const l of r.lineas) console.log(l);
    console.log(`      ${r.fin === 'cerro' ? 'CERRÓ' : r.fin === 'listo' ? 'LISTÓ' : r.fin === 'malo' ? 'DESENLACE MALO' : 'NO cerró'}: ${r.motivo}\n`);
}
const cerraron = resultados.filter((r) => r.fin === 'cerro' || r.fin === 'listo').length;
console.log(`  ${cerraron}/${resultados.length} ${flag('cerrar') ? 'cerraron' : 'listaron'} · ${((Date.now() - t0) / 1000).toFixed(1)}s`);
await close();
process.exit(cerraron === resultados.length ? 0 : 1);
