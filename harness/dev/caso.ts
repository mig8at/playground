// caso.ts — UN CASO HIPOTÉTICO de punta a punta: decís comercio y entidad, y corre.
//
//   node dev/caso.ts --comercio pullman --lender 77
//   node dev/caso.ts --casos 'pullman;pullman' --paralelo
//   node dev/caso.ts --casos 'pullman@score=700;pullman@score=300,income=900000' --paralelo
//   node dev/caso.ts --casos 'pullman:77;pullman:9' --paralelo
//   node dev/caso.ts --comercio pullman --lender 77 --amount 3000000 --income 1200000 --score 520
//
// QUÉ CORRE: siembra la solicitud en ese comercio, le inyecta datos de riesgo, pide el LISTADO, y
// después SELECCIONA la entidad pedida y clasifica la conducta que devuelve el backend (standBy /
// modal de autogestión / redirect externo / OTP del lender / error). O sea: de cero hasta el punto en
// que el flujo se bifurca por entidad.
//
// ⚠ EL TELÉFONO ES POR CASO, Y ESA ES LA CONDICIÓN DEL PARALELO. Los runners que ya existían
// (`sweep.ts`, `qr-corbeta.ts`, `listado.ts`) comparten el fijo `3131010101` y arrancan llamando a
// `scrubphone`, que **borra todos los usuarios con ese teléfono**. Dos corridas simultáneas se
// borran la una a la otra a mitad de vuelo, y el síntoma no se parece a la causa: la que pierde
// falla más adelante con un 404 o un 500 raro, en un paso que no tiene nada que ver. Acá cada caso
// deriva el suyo del índice, así que no hay dos corridas mirando el mismo usuario.
//
// ⚠ Y POR ESO MISMO `--paralelo` NO es «lo mismo pero más rápido»: cambia qué se puede afirmar. En
// serie, un fallo puede venir de basura que dejó el caso anterior; en paralelo, cada caso tiene su
// usuario y sus solicitudes. Si dos casos se pisan igual, es que comparten algo REAL (un lock de
// comercio, un cupo, un asesor) — y eso es justo lo que uno quiere descubrir.
//
// EL CASO COMPLETO, con `--cerrar`: buró dictado → listado → integración del proveedor dictada →
// pre-aprobación (la que haría el front) → SELECCIÓN del lender CreditopX del comercio y cierre hasta
// estado 11. Si el comercio no tiene rt=2, el caso cierra BIEN diciendo «sin CreditopX»: es un hecho
// del comercio y no un fallo — contarlo como error haría ver rota la mitad del catálogo. Medido:
// Pullman cierra en 11; automarquet, kreditkasa y godentist no tienen CreditopX.
// ⚠ Cerrar cuesta: ~90s por caso contra ~6s hasta el listado. Para barrer muchos comercios conviene
// no pedirlo, y reservarlo para los que se quieren probar de punta a punta.
//
// EL CATÁLOGO ENTERO, medido el 2026-08-22 — 223 comercios (una sucursal por comercio, la de más
// entidades, direccionada por `#hash`), en 8 tandas de 30 en paralelo, ~12 minutos:
//
//     214  ofrecen al menos una entidad     (mediana 3 · máximo 12)
//       6  ofrecen CERO — y no todos por lo mismo:
//            · Crediteame  → su ÚNICA entidad tiene `status=0`. Cero legítimo.
//            · CeluRD Test → una de sus dos entidades es `country_id=60`. Filtro de país.
//            · Vtex, TIENDAS JOSH, Credicesar, Smart Academia → SIN explicar todavía.
//       2  rotos por F-143 (`sort on null`): Creditop y PARQUE SALITRE MÁGICO
//       1  pide ESTRATO (`STRATUM_REQUIRED`) en personal-info, que este runner no manda
//
// ⚠ «Cero entidades» NO es lo mismo que «falló», y el runner los mezcla: marca ✗ cuando la lista
// viene vacía. Seis de los nueve «fallos» de arriba son listados que CORRIERON BIEN. Vale la pena
// separarlos si esto se usa para vigilar el catálogo.
//
// ESCALA MEDIDA (2026-08-18, contra el backend local en Docker):
//     10 casos → 29s     20 → 60s     30 → 90s
// Crece LINEAL, así que el cuello es el backend y no el runner: no hay paralelismo real del lado del
// servidor, pero tampoco degradación. Y lo que importa, la CORRECCIÓN aguanta: a 30 en paralelo los
// dos controles devolvieron su listado conocido, idéntico al de la corrida de a uno.
//     pullman     [77, 100, 39, 68, 6, 9, 32]
//     kreditkasa  [68, 6, 5, 41, 7, 29, 17, 30, 31, 16, 19, 34]
// A 30 fallaron 3 de 30, y los TRES por F-142 (Credifamilia con host nulo se lleva el listado entero).
// Ninguno fue carrera.
//
// VALIDADO A 10 EN PARALELO (2026-08-18). Tres rondas de 10 casos simultáneos con comercios
// distintos, más dos fijos de control en las tres. 28 de 29 cerraron, ~31s por ronda, y los dos
// controles devolvieron el listado **idéntico** en las tres rondas:
//     pullman     [77, 100, 39, 68, 6, 9, 32]
//     kreditkasa  [68, 6, 5, 41, 7, 29, 17, 30, 31, 16, 19, 34]
// O sea que correr diez a la vez no altera el resultado de ninguno. El único fallo (`orthoarte`)
// **también falla corriéndolo solo**: es un comercio roto en local por F-142, no una carrera. Esa
// distinción —volver a correr el caso SOLO— es la que separa un hallazgo de un artefacto, y conviene
// hacerla siempre antes de reportar un fallo de una corrida paralela.
//
// Gotchas heredados, que acá aplican igual: `E2E_TARGET` default es dev → se fuerza local · UA de
// iPhone SIEMPRE (con UA de escritorio, 403) · en `main` sin `H2O_API_HOST` el listado da 500.

// ⚠ Marca de MÓDULO. Al sacar el último `import` estático, node pasó a leer este archivo como CJS y
// `await` de nivel superior dejó de ser válido (lo delató `node --check`). Un `export {}` vacío
// alcanza y no cambia nada más.
export {};

process.env.E2E_TARGET ||= 'local';
process.env.CFE_TARGET ||= 'local';

const { one, query, exec, close } = await import('../pkg/db.ts');
const { synthFill } = await import('../pkg/inject.ts');
const { config: e2eConfig } = await import('../pkg/config.ts');

const API = e2eConfig.mockUrl;
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 '
    + '(KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1';

// La lambda de mocks de la empresa. Su `enableAdminApi: true` es TODO el mecanismo: se le PIDE de
// antemano qué tiene que contestar para una cédula (`POST /mockoon-admin/global-vars`) y después el
// flujo corre normal. No hace falta ningún fixture: la respuesta se pide, no se inyecta.
// ⚠ POR DEFECTO, EL MOCK LOCAL — no el lambda de la empresa. El lambda hace lo mismo pero es
// infraestructura de OTRO: a mitad de sesión lo redesplegaron, dejó de honrar lo dictado y empezó a
// devolver datos aleatorios con períodos viejos (F-149). Y además es serverless, así que dictar en
// paralelo pierde escrituras (F-139). El local es un proceso, responde en milisegundos y el estado es
// compartido. Mismo contrato: para volver al lambda alcanza con `RISK_LAMBDA_URL=<su url>`.
const LAMBDA = process.env.RISK_LAMBDA_URL ?? 'http://localhost:8105';


// El mock de integraciones de entidades (`mock-lenders`), donde se dicta qué contesta cada proveedor.
const MOCK_LENDERS = process.env.MOCK_LENDERS_URL ?? 'http://localhost:8099';

// El microservicio de PRE-APROBADOS. Lo llama el FRONT, no el backend (F-141), así que una corrida
// por API lo saltea sin fallar: el listado se ve completo y la etapa no ocurrió. Acá se REPLICA esa
// llamada para poder validarla sin levantar el wizard.
// ⚠ la ruta va COMPLETA: `VITE_PREAPPROVALS_ENDPOINT` del wizard es una URL con path
// (`…:8082/v1/preapprovals/check`), no un host. Apuntando sólo al host, el mock responde 404 a todo
// y las cinco consultas «fallan» por una razón que no tiene nada que ver con el negocio.
const PREAPPROVALS = process.env.PREAPPROVALS_URL ?? 'http://localhost:8095/v1/preapprovals/check';

// El `lending_product_key` NO es el slug siempre — el contrato lo arma
// `fetch-lender-preapproval.ts:148-153` del monorepo, y son tres casos:
const CREDITOP_X_PRODUCT_KEY = 'creditop_x';   // rt 2 y 3 comparten UN producto
const WELLI_IDS = [23, 141, 142, 166];         // las cuatro variantes comparten `welli`
const claveDeProducto = (rt: number, id: number, slug: string) =>
    (rt === 2 || rt === 3) ? CREDITOP_X_PRODUCT_KEY : WELLI_IDS.includes(id) ? 'welli' : slug;

/** EL CIERRE rt=2. La secuencia NO se dedujo: es la misma de `dev/sweep.ts close`, que a su vez la
 *  sacó corriendo el wizard. Dos cosas que costaron un 404 y un "PromissoryNote no encontrado" y que
 *  por eso van comentadas allá y acá: las pantallas de fecha y cronograma viven BAJO el prefijo
 *  `promissory-note`, y hay que pedir el `show` del pagaré ANTES de firmar, porque es ese loader el
 *  que genera los documentos.
 *
 *  ⚠ Si el comercio NO tiene una entidad rt=2, esto NO es un fallo: es un hecho del comercio. Se
 *  reporta «sin CreditopX» y el caso cierra bien. Contarlo como error haría que la mitad del catálogo
 *  se viera rota. */
async function cerrarCreditopX(arr: any[], ur: number, tel: string, amount: number,
                               post: any, get: any, pedido: number | null = null) {
    // Si el caso pidió una entidad concreta (`#hash:173`), se cierra por ÉSA. Sin pedido, el primer
    // rt=2 — que con varios CreditopX en el mismo comercio es arbitrario y llevaría a cerrar por otro.
    const ctopx = pedido
        ? arr.find((l) => Number(l.id) === pedido)
        : arr.find((l) => Number(l.response_type) === 2);
    if (pedido && !ctopx) return { cerro: false, motivo: `la entidad ${pedido} no salió en el listado`, estado: null };
    if (!ctopx) return { cerro: false, motivo: 'sin CreditopX', estado: null as number | null };

    const sel = await post(`/api/onboarding/loan-application/update-user-request/${ur}`, {
        lender_id: Number(ctopx.id), fee_number: 4, original_amount: amount, amount,
        initial_fee: 0, rate: '0', transaction_data: null });
    // `standBy` es la marca de in-platform: sin eso el flujo se va por otro lado y el cierre no aplica
    if (!sel.json?.data?.standBy) {
        return { cerro: false, motivo: `${ctopx.name}: no devolvió standBy`, estado: null };
    }

    const PN = '/api/loans/requests/promissory-note';
    await get(`/api/loans/requests/${ur}`);
    await post('/api/loans/requests/confirm', { user_request_id: ur });

    const dates = await get(`${PN}/${ur}/select-payment-date`);
    const dOpts = dates.json?.data?.nextPaymentDates ?? dates.json?.data?.dates ?? [];
    const firstDate = Array.isArray(dOpts) ? (dOpts[0]?.date ?? dOpts[0]) : null;
    await post(`${PN}/${ur}/confirm-payment-date`, { user_request_id: ur, payment_date: firstDate, date: firstDate });

    const sim = await get(`${PN}/${ur}/simulate-payment-schedule`);
    const cycles = sim.json?.data?.cycles ?? sim.json?.data?.simulations ?? sim.json?.data ?? [];
    const cyc = Array.isArray(cycles) ? cycles[0] : cycles;
    const urRow = await one<{ a: number }>('SELECT allied_id a FROM user_requests WHERE id=?', [ur]).catch(() => null);
    await post(`${PN}/${ur}/confirm-payment-schedule`, {
        user_request_id: ur, amount, lender_id: Number(ctopx.id), allied_id: urRow?.a,
        fee_number: cyc?.fee_number ?? cyc?.feeNumber ?? 4, selected_cycle: cyc ?? {} });

    await get(`${PN}/${ur}`);                       // genera los documentos
    await post('/api/loans/requests/promissory-note/validate/send-otp', { user_request_id: ur });
    await post('/api/loans/requests/promissory-note/validate/verify-otp',
               { user_request_id: ur, otp: tel.slice(-6) });
    const aut = await post('/api/loans/requests/promissory-note/validate/authorize', { user_request_id: ur });

    const fin = await one<{ e: number }>(
        'SELECT user_request_status_id e FROM user_requests WHERE id=?', [ur]).catch(() => null);
    // ⚠ El MOTIVO, no sólo el status. Un `HTTP 422` a secas manda a adivinar: puede ser el pagaré, el
    // OTP, el cupo o el cronograma. El cuerpo lo dice, y sin él el diagnóstico cuesta una sesión.
    const porQue = aut.status === 200 ? '' :
        ' · ' + String(aut.json?.errors?.payload
            ? JSON.stringify(aut.json.errors.payload)
            : aut.json?.message ?? aut.json?.raw ?? '').split('\n')[0].slice(0, 90);
    return {
        cerro: fin?.e === 11,
        motivo: `${ctopx.name} · HTTP ${aut.status}${porQue}`,
        estado: fin?.e ?? null,
    };
}

/** Lo que el wizard dispara por cada entidad elegible después de recibir el listado.
 *  ⚠ Sólo para `response_type !== 0`: las STANDARD nunca usan el microservicio. */
async function preAprobar(lender: any, ureq: number, userId: number, alliedId: number,
                          hash: string, amount: number, estadoMock?: string) {
    const payload: Record<string, unknown> = {
        applicant_id: userId,
        lending_product_key: claveDeProducto(Number(lender.response_type), Number(lender.id), String(lender.slug ?? '')),
        lending_product_id: String(lender.id),
        merchant_id: alliedId,
        user_request_id: ureq,
        allied_branch_hash: hash,
    };
    // ⚠ el monto va SÓLO si es > 0: welli, meddipay, prami y bancolombia_consumer_loan rechazan la
    // consulta sin monto positivo, y para el resto el MS lo trata como opcional.
    if (amount > 0) payload.amount = amount;
    // ⚠ `?status=` NO es parte del contrato: es una perilla del MOCK (`mock-preapprovals`), que
    // también acepta `x-mock-status` y `body.force_status`. Va en la URL y no en el cuerpo a
    // propósito — el cuerpo tiene que seguir siendo EXACTAMENTE el que manda el front, o la prueba
    // deja de probar el contrato real. Contra el MS de verdad, este parámetro se ignora.
    const url = estadoMock ? `${PREAPPROVALS}?status=${encodeURIComponent(estadoMock)}` : PREAPPROVALS;
    const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload), signal: AbortSignal.timeout(45_000),
    }).catch((e) => e as Error);
    if (r instanceof Error) return { id: lender.id, estado: `sin respuesta (${String(r.message).slice(0, 40)})` };
    if (r.status === 422) {
        const b: any = await r.json().catch(() => ({}));
        return { id: lender.id, estado: `bajo el mínimo (${b?.minimum_amount ?? '?'})` };
    }
    if (!r.ok) return { id: lender.id, estado: `http_${r.status}` };
    const j: any = await r.json().catch(() => ({}));
    return { id: lender.id, estado: String(j?.status ?? 'sin status'), cupo: j?.approved_amount ?? j?.available ?? null };
}

const arg = (n: string, d = ''): string => {
    const i = process.argv.indexOf(`--${n}`);
    return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d;
};
const flag = (n: string) => process.argv.includes(`--${n}`);

// Base 313 + 7 dígitos. El índice del caso va al final para que dos casos NUNCA compartan usuario;
// se imprime en el reporte porque es lo que hace falta para ir a mirar la solicitud después.
const telefono = (i: number) => `313${String(2_000_000 + i).slice(0, 7)}`;

type Caso = {
    comercio: string; lender: number | null;
    amount?: number; income?: number; score?: number;
    // qué debe contestar cada integración PARA ESTE CASO: `pullman@meddipay=rechaza`
    escenarios?: Record<string, string>;
};

/** `pullman` · `pullman:77` · `pullman@score=300,income=900000` · `pullman:77@amount=5000000`
 *
 * Los parámetros van POR CASO y no como flag global porque el paralelo sirve justamente para
 * comparar: dos corridas idénticas sólo prueban que el sistema es determinista (útil una vez), y
 * dos que difieren en UN dato muestran qué mueve ese dato. Medido: con `score=300,income=900000`
 * CrediPullman desaparece del listado y con el default no — el cupo rt=2 filtra de verdad. */
function parseCaso(spec: string, dflt: { amount: number; income: number; score: number }): Caso {
    const [izq, params] = spec.split('@');
    const [comercio, l] = izq.split(':');
    const c: Caso = { comercio, lender: l ? Number(l) : null, ...dflt };
    for (const kv of (params ?? '').split(',').filter(Boolean)) {
        const [k, v] = kv.split('=');
        if (k === 'amount' || k === 'income' || k === 'score') { c[k] = Number(v); continue; }
        // cualquier otra clave es el ESCENARIO de una entidad: `pullman@meddipay=rechaza`.
        // Se dicta al mock de integraciones POR CÉDULA, así que dos casos en paralelo pueden pedir
        // cosas distintas de la misma entidad sin pisarse.
        (c.escenarios ??= {})[k] = v;
    }
    return c;
}
type Res = {
    caso: Caso; ok: boolean; ur?: number; phone: string; nombre?: string;
    enListado?: boolean; listado?: number[]; conducta?: string; detalle?: string;
    com?: string;
    preaprobados?: { id: number; estado: string; cupo?: unknown }[];
    cierre?: { cerro: boolean; motivo: string; estado: number | null };
};

async function http(method: string, path: string, body: unknown, phone: string) {
    const r = await fetch(`${API}${path}`, {
        method,
        headers: { 'content-type': 'application/json', accept: 'application/json', 'user-agent': UA },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(90_000),
    }).catch((e) => e as Error);
    if (r instanceof Error) return { status: 0, json: { message: String(r.message).slice(0, 140) } };
    const t = await r.text();
    try { return { status: r.status, json: JSON.parse(t) }; }
    catch { return { status: r.status, json: { raw: t.slice(0, 200) } }; }
}

/** Clasifica por los MISMOS campos que mira el front (mismo criterio que `sweep.ts`). */
function conductaDe(d: any): string {
    if (!d) return 'sin data';
    if (d.standBy) return 'standBy (in-platform)';
    if (d.showModal) return 'modal (autogestión)';
    if (d.url) return `redirect externo`;
    if (d.otp || d.otpId) return 'OTP del lender';
    return 'continúa sin bifurcar';
}

/** Elige un teléfono de bypass LIMPIO (sin usuario) del setting `qa_otp_bypass_phones`. El OTP es
 *  sus últimos 4 dígitos. Se saltea el de `mock_rules`, que iría al fixture. */
// La raíz única de la corrida: de acá salen la cédula y el teléfono de cada caso, así ninguna
// corrida pisa a la anterior.
const BASE_DOC = 1090000000 + ((Date.now() / 100) % 9_000_000 | 0);

/** La sucursal de un caso. Acepta `#hash` —la sucursal EXACTA— o un nombre.
 *
 *  ⚠ Para un CENSO hay que usar hash. Con nombre resuelve por `LIKE %x%` y se queda con la sucursal
 *  de más entidades, así que dos comercios que comparten prefijo se pisan y uno de los dos NUNCA se
 *  prueba: el barrido quedaría corto sin que nada avise. */
async function buscarSucursal(ref: string) {
    const porHash = ref.startsWith('#');
    return one<{ id: number; hash: string; com: string; allied: number }>(
        porHash
            ? `SELECT b.id, b.hash, x.name AS com, x.id AS allied FROM allied_branches b
                 JOIN allieds x ON x.id = b.allied_id WHERE b.hash = ? LIMIT 1`
            : `SELECT b.id, b.hash, x.name AS com, x.id AS allied FROM allied_branches b
                 JOIN allieds x ON x.id = b.allied_id WHERE x.name LIKE ?
                ORDER BY (SELECT COUNT(*) FROM lenders_by_allied_branches l
                           WHERE l.allied_branch_id = b.id) DESC LIMIT 1`,
        [porHash ? ref.slice(1) : `%${ref}%`]).catch(() => null);
}

/** El teléfono de un caso. DERIVADO, como la cédula — no sale de una lista.
 *
 *  Hasta el 2026-08-18 esto elegía uno de los 64 de `settings.qa_otp_bypass_phones`, los reciclaba
 *  con `scrubphone` cuando se agotaban, y necesitaba un candado para que dos casos en paralelo no se
 *  llevaran el mismo. Toda esa maquinaria era INNECESARIA: con `ONBOARDING_DRIVER_OTP=fake`,
 *  `FakeOtpServiceRepository::validateOtp` **ignora el código tecleado** y no exige que el teléfono
 *  esté en ninguna lista. Verificado con un teléfono inventado y el código `9999`: `otp-validate`
 *  devolvió el `uReq` igual.
 *
 *  Lo que se gana no es sólo código menos: desaparece el tope de 64 casos, desaparece el borrado de
 *  usuarios ajenos (`scrubphone` borra TODOS los del teléfono) y desaparece la carrera por reservar.
 *
 *  ⚠ Depende de que el driver de OTP siga en `fake`. Si alguien lo pone en `real`, esto deja de
 *  andar y hay que volver a los de `qa_otp_bypass_phones` —cuyo código son sus últimos 4 dígitos—.
 *  El síntoma sería `otp-validate` rechazando el código, que es explícito y no engaña. */
//  ⚠ El índice va con DOS dígitos, no con `i % 10`: con `% 10` treinta casos comparten diez
//  teléfonos, y tres de ellos pelean por el mismo usuario. Así soporta 100 casos por corrida.
const telefonoDe = (i: number) => `31${String(BASE_DOC).slice(-6)}${String(i % 100).padStart(2, '0')}`;

/** ⚠ PARA CERRAR hace falta un teléfono de `qa_otp_bypass_phones`, y no es capricho: son DOS
 *  mecanismos de OTP distintos y sólo uno acepta cualquier teléfono.
 *    · el OTP del ONBOARDING va por el driver fake (`FakeOtpServiceRepository`), que ignora el código
 *      y no mira el teléfono → cualquiera sirve, y por eso el listado se prueba con derivados.
 *    · el OTP de la FIRMA DEL PAGARÉ va por `Modules/Loans/App/Services/OtpService.php:47`, que
 *      honra `qa_otp_bypass_phones` → un teléfono fuera de esa lista hace que `authorize` responda
 *      422 «No se encontró un OTP validado para esta solicitud» y la solicitud quede en estado 10.
 *  Se toma por ÍNDICE, sin buscar ni reservar: cada caso tiene el suyo y no hay carrera posible. */
async function telefonoParaCerrar(i: number): Promise<string | null> {
    const row = await one<{ value: string }>(
        "SELECT value FROM settings WHERE `key`='qa_otp_bypass_phones'").catch(() => null);
    const tels: string[] = JSON.parse(row?.value ?? '[]').map(String);
    return tels.length ? tels[i % tels.length] : null;
}

/** Le dicta a la lambda qué contesta cada central PARA ESA CÉDULA. Es el paso que vuelve el caso
 *  hipotético: se pide de antemano la respuesta que se quiere recibir. */
/** ⚠ LEE DESPUÉS DE ESCRIBIR, y reintenta. La lambda es serverless y sus global-vars viven en la
 *  MEMORIA DEL CONTENEDOR: el POST puede caer en un contenedor y la lectura del backend en otro, y
 *  entonces se sirve la respuesta POR DEFECTO como si nada. No es sólo un problema de concurrencia
 *  —medido el 2026-08-18 con UN caso solo— y el síntoma no se parece a la causa: la default trae
 *  períodos de hace diez meses, así que el backend calcula `employed: false` y `personal-info`
 *  responde `ONB004 laboral information is required`. Uno sale a buscar por qué el comercio pide
 *  información laboral y el problema es que el buró nunca contestó lo que se le pidió.
 *
 *  Confirmar cuesta una petición y convierte un fallo intermitente en uno que no ocurre. */
async function confirmarDictado(doc: string, central: string, esperado: string): Promise<boolean> {
    const rutas: Record<string, string> = {
        agildata: `/agildata/agildata-services/rest/afiliado/historicoDetalladoEmpleo/1/${doc}`,
    };
    const ruta = rutas[central];
    if (!ruta) return true;                       // sin ruta conocida no se puede confirmar: no se bloquea
    const r = await fetch(`${LAMBDA}${ruta}`, { signal: AbortSignal.timeout(15_000) }).catch(() => null);
    if (!r?.ok) return false;
    return (await r.text()).includes(esperado);
}

async function dictar(doc: string, central: string, valor: unknown): Promise<boolean> {
    // ⚠ Mockoon NO valida el JSON que se le dicta: lo emite tal cual con 200, y un JSON roto se lee
    // después como «respuesta inválida del proveedor». Se serializa acá y se falla acá si no es válido.
    const v = typeof valor === 'string' ? valor : JSON.stringify(valor);
    try { JSON.parse(v); } catch { return false; }
    const r = await fetch(`${LAMBDA}/mockoon-admin/global-vars`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: `${central}_${doc}`, value: v }),
        signal: AbortSignal.timeout(25_000),
    }).catch(() => null);
    return !!r?.ok;
}

/** El camino REAL: register → otp-validate → personal-info. No usa `synthFill` — justamente porque
 *  synthFill escribe la fila de `risk_central_user_data` y entonces el backend la reusa (caché de un
 *  mes) y NO llama a la central. Es la trampa 1 del documento de la tarea. */
/** La cédula de un caso. Única POR CORRIDA, no sólo por caso: derivarla de (índice, score) hacía que
 *  la segunda vez que se corría el mismo comando repitiera cédula, y el flujo moría con «El correo
 *  electrónico ya se encuentra registrado» — un error que no se parece a su causa. Peor: la caché de
 *  un mes de `risk_central_user_data` habría servido la consulta anterior en vez de llamar a la
 *  central, que es justo lo que se quiere ejercitar. */
const cedulaDe = (i: number) => String(BASE_DOC + i);

/** La respuesta que se le pide a la central para este caso. El ingreso del caso se vuelve el `ibc`
 *  (Ingreso Base de Cotización) de los pagos: el backend NO lo recibe inyectado, lo descubre
 *  consultando. Se emiten 8 períodos para que las reglas de continuidad (3/6/12 meses) tengan de
 *  dónde calcular — con menos, «no continuo» sería un artefacto del mock y no del caso planteado. */
function respuestaAgildata(doc: string, ibc: number) {
    // ⚠ EL PERÍODO ES `YYYYMM` Y NO SE PUEDE RESTAR COMO ENTERO. `202603 - k` parece razonable y a
    // partir del cuarto pago da 202599, 202598… meses que no existen. El backend calcula la
    // continuidad (3/6/12 meses) contando períodos, así que con basura ahí devuelve `employed: false`,
    // continuidad en cero y `approximate_real_salary: 0` — el ingreso llega y NO SIRVE. El caso que
    // uno creyó plantar («alguien que gana 15M») termina siendo «alguien sin empleo», y el listado no
    // cambia por la razón equivocada.
    const pagos = Array.from({ length: 8 }, (_, k) => {
        // ⚠ RELATIVO A HOY, no a una fecha fija. `validateContractType` compara el último período
        // contra la fecha de la solicitud: una serie que termina hace cinco meses da `employed:false`
        // por vieja, no por el caso que se quiso plantear. Una fecha horneada acá envejece sola y
        // rompe el runner en silencio unos meses después.
        const hoy = new Date();
        const meses = hoy.getFullYear() * 12 + hoy.getMonth() - k;
        const [y, m] = [Math.floor(meses / 12), (meses % 12) + 1];
        const mm = String(m).padStart(2, '0');
        return {
            id: k + 1, ibc, periodo: Number(`${y}${mm}`),
            fechaPago: `${y}-${mm}-15 00:00:00`,
            diasCotizados: 30, valorCotizacionObligatoria: Math.round(ibc * 0.115),
        };
    });
    return {
        usuario: null, codRespuesta: '01', observaciones: 'Consulta Exitosa.',
        codConsulta: 14744568681490196,
        respuesta: {
            type: 'aorg.asofondos.agildata.domain.AfiliadoDetalladoa', fechaVinculacion: null,
            datosBasicos: { edad: 25, type: 'org.asofondos.agildata.domain.AfiliadoDatosBasicos',
                            genero: 'M', nombre: 'CARLOS RUIZ MENDOZA', tipoId: 'CC',
                            numeroId: doc, viabilidad: null },
            detalladoEmpleos: [{
                id: 1, pagos, nombreEmpleador: 'STANGERSON SAS', telefonoEmpleador: null,
                direccionEmpleador: null, identifiacionEmpleador: '900101010',
                tipoIdentifiacionEmpleador: 'NI' }],
        },
    };
}

const dictados = new Set<string>();

/** ⚠ DICTAR VA EN SERIE, AUNQUE LOS CASOS CORRAN EN PARALELO. La lambda es serverless y sus
 *  global-vars viven en la MEMORIA DEL CONTENEDOR: tres POST concurrentes caen en contenedores
 *  distintos y dos de los tres dictados se pierden — medido el 2026-08-17, y no es una carrera que se
 *  resuelva sola: la cédula perdida devuelve la respuesta por defecto para siempre. El síntoma es
 *  cruel, porque el flujo TERMINA BIEN con datos que nadie pidió, y uno concluye «el ingreso no
 *  cambia el listado» cuando en realidad el ingreso nunca llegó. En serie, las tres quedan. */
async function dictarTodos(casos: Caso[]): Promise<string[]> {
    const fallos: string[] = [];
    for (let i = 0; i < casos.length; i++) {
        const doc = cedulaDe(i);
        // el escenario de cada integración va acá también: es preparación del caso, y se dicta
        // POR CÉDULA para que dos casos en paralelo puedan pedir cosas opuestas de la misma entidad
        for (const [lender, modo] of Object.entries(casos[i].escenarios ?? {})) {
            // ⚠ `preaprobado` NO es una entidad: es el estado que debe devolver el MICROSERVICIO de
            // pre-aprobados, y se aplica en su propia llamada. Mandarlo al admin API del mock de
            // integraciones lo rechaza y hace fallar la preparación del caso entero.
            if (lender === 'preaprobado') continue;
            const r = await fetch(`${MOCK_LENDERS}/__mock/escenario`, {
                method: 'POST', headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ lender, modo, doc }), signal: AbortSignal.timeout(8_000),
            }).catch(() => null);
            if (!r?.ok) fallos.push(`${lender}=${modo}`);
        }
        // hasta 4 intentos: cada POST puede caer en un contenedor distinto, así que reintentar
        // NO es supersticioso — es lo que hace que alguno pegue en el que después atiende la lectura
        let ok = false;
        for (let intento = 0; intento < 4 && !ok; intento++) {
            await dictar(doc, 'agildata', respuestaAgildata(doc, casos[i].income!));
            ok = await confirmarDictado(doc, 'agildata', String(casos[i].income!));
        }
        if (ok) dictados.add(doc); else fallos.push(doc);
    }
    return fallos;
}

async function correrLambda(c: Caso, i: number): Promise<Res> {
    const doc = cedulaDe(i);
    const base: Res = { caso: c, ok: false, phone: '' };

    // cerrar exige un teléfono de la lista de bypass (ver `telefonoParaCerrar`); el resto del flujo
    // anda con uno derivado
    const tel = (flag('cerrar') ? await telefonoParaCerrar(i) : null) ?? telefonoDe(i);
    base.phone = tel;

    // ⚠ `x.id AS allied` NO es cosmético: `preAprobar` lo manda como `merchant_id` y este lookup no
    // lo seleccionaba, así que viajaba `undefined`. El mock no valida ese campo y por eso el bug
    // sobrevivió — contra el microservicio real habría fallado. Los mocks permisivos esconden
    // exactamente esta clase de error (misma lección que F-140).
    const br = await buscarSucursal(c.comercio);
    if (!br) return { ...base, detalle: `no encontré el comercio «${c.comercio}»` };
    base.com = br.com;

    if (!dictados.has(doc)) return { ...base, detalle: 'la respuesta del buró no quedó dictada' };

    const H = { 'content-type': 'application/json', accept: 'application/json', 'user-agent': UA };
    const get = async (ruta: string) => {
        const r = await fetch(`${API}${ruta}`, { headers: H, signal: AbortSignal.timeout(90_000) })
            .catch((e) => e as Error);
        if (r instanceof Error) return { status: 0, json: {} as any };
        const t = await r.text();
        try { return { status: r.status, json: JSON.parse(t) }; } catch { return { status: r.status, json: {} as any }; }
    };
    const post = async (ruta: string, body: unknown) => {
        const r = await fetch(`${API}${ruta}`, { method: 'POST', headers: H,
            body: JSON.stringify(body), signal: AbortSignal.timeout(150_000) }).catch((e) => e as Error);
        if (r instanceof Error) return { status: 0, json: { message: String(r.message).slice(0, 120) } };
        const t = await r.text();
        try { return { status: r.status, json: JSON.parse(t) }; } catch { return { status: r.status, json: { raw: t.slice(0, 200) } }; }
    };

    const reg = await post('/api/onboarding/phone/register', {
        phone_number: tel, phoneNumber: tel, terms: true, policies: true,
        otp_length: 4, otpLength: 4, partner_branch_hash: br.hash, partnerBranchHash: br.hash });
    const uid = reg.json?.data?.user?.id;
    if (!uid) return { ...base, detalle: `register HTTP ${reg.status}` };

    const otp = await post(`/api/onboarding/loan-application/otp-validate/${br.hash}`, {
        cell_phone: tel, otp_code: tel.slice(-4),
        original_amount: c.amount, amount: c.amount });
    // ⚠ el uReq viene en `errors.payload`, NO en `payload`: el usuario es temporal y la respuesta
    // llega como error `ONB002 "temporal user found"`. Es la trampa 3 del documento de la tarea.
    // ⚠ EL uReq VIENE EN TRES LUGARES DISTINTOS según cómo terminó la validación, y mirar sólo dos
    // hace fallar el caso con «otp-validate sin uReq (HTTP 200)» — un mensaje que se contradice solo:
    // HTTP 200 y sin dato. Se vio a 30 en paralelo, con el comercio `creditop`.
    //   · usuario TEMPORAL  → llega como ERROR `ONB002 "temporal user found"` en `errors.payload`
    //   · usuario ya válido → llega como éxito en `data.payload`
    //   · variante suelta   → `payload` a secas
    const ur = otp.json?.errors?.payload?.user_request_id
        ?? otp.json?.data?.payload?.user_request_id
        ?? otp.json?.payload?.user_request_id;
    if (!ur) return { ...base, detalle: `otp-validate sin uReq (HTTP ${otp.status})` };
    base.ur = ur;

    const pi = await post(`/api/onboarding/loan-application/personal-info/${br.hash}/${ur}`, {
        document_type: 'CC', document_number: doc, name: 'CARLOS', surname: 'RUIZ',
        email: `qa${doc}@gmail.com`,
        expedition_day: 10, expedition_month: 5, expedition_year: 2019,
        birth_day: 10, birth_month: 5, birth_year: 2001 });
    if (pi.json?.success !== true) {
        return { ...base, conducta: 'personal-info rechazó',
                 detalle: `${pi.json?.errors?.error_subcode ?? ''} ${JSON.stringify(pi.json?.errors?.payload ?? pi.json?.message ?? '').slice(0, 90)}` };
    }

    // ⚠ EL MONTO VA EN LA QUERY, y sin él el backend usa 180.000 por default
    // (`ListLenderController::index:39` — `$request->query('amount', 180000)`), NO el monto de la
    // solicitud. Todo lo medido hasta el 2026-08-22 se calculó con 180 mil sin que nada avisara: los
    // tramos y las categorías se evalúan contra ESE número, así que un lender cuyo mínimo es más alto
    // desaparece del listado por una razón que no tiene que ver con el caso planteado.
    const lis = await fetch(`${API}/api/onboarding/loan-application/lenders/${ur}?amount=${c.amount}`, { headers: H })
        .then((r) => r.json()).catch(() => null);
    // ⚠ «CERO ENTIDADES» Y «LA LLAMADA FALLÓ» NO SON LO MISMO, y hasta el 2026-08-18 esto los
    // reportaba igual: un comercio cuyo listado reventaba salía como «0 entidades», que se lee como
    // un hecho de negocio («no ofrece nada») cuando es una excepción de PHP. Pasó de verdad — un
    // lender con host nulo tira `PendingRequest::baseUrl(): Argument #1 must be of type string, null
    // given` y se lleva el listado ENTERO del comercio, no sólo esa card.
    if (lis?.exception || (lis?.success === false) || (lis?.message && !lis?.data)) {
        return { ...base, ok: false, nombre: `doc ${doc}`, conducta: 'el LISTADO falló',
                 detalle: String(lis.message ?? lis.exception).split('\n')[0].slice(0, 110) };
    }
    const crudo = lis?.data ?? lis;
    const arr: any[] = Array.isArray(crudo) ? crudo : Array.isArray(crudo?.lenders) ? crudo.lenders : [];
    base.listado = arr.map((x) => Number(x.id ?? x.lender_id)).filter(Boolean);

    // LO QUE HARÍA EL FRONT. Sin esto la corrida termina en el listado y la pre-aprobación NO ocurre
    // —sin fallar, que es lo peor (F-141)—. Se dispara una por entidad elegible y en paralelo, igual
    // que el loader del wizard, con el payload de `fetch-lender-preapproval.ts:154-170`.
    if (flag('preaprobados')) {
        const elegibles = arr.filter((l) => Number(l.response_type) !== 0);
        base.preaprobados = await Promise.all(elegibles.map((l) =>
            preAprobar(l, ur, uid, br.allied, br.hash, c.amount!, c.escenarios?.preaprobado)));
    }

    let cierre = '';
    if (flag('cerrar')) {
        const r = await cerrarCreditopX(arr, ur, tel, c.amount!, post, get, c.lender);
        base.cierre = r;
        cierre = r.cerro ? ` · CERRÓ en estado ${r.estado} (${r.motivo})`
                         : ` · NO cerró: ${r.motivo}${r.estado ? ` (quedó en estado ${r.estado})` : ''}`;
    }

    return { ...base, ok: arr.length > 0, nombre: `doc ${doc}`,
             conducta: `listado con ${arr.length} entidades · buró dictado: ibc ${c.income!.toLocaleString('es-CO')}${cierre}` };
}

async function correr(c: Caso, i: number): Promise<Res> {
    if (flag('lambda')) return correrLambda(c, i);
    const phone = telefono(i);
    const base: Res = { caso: c, ok: false, phone };

    const br = await buscarSucursal(c.comercio);
    if (!br) return { ...base, detalle: `no encontré el comercio «${c.comercio}»` };
    base.com = br.com;

    if (c.lender !== null) {
        const len = await one<{ name: string }>('SELECT name FROM lenders WHERE id=?', [c.lender]).catch(() => null);
        base.nombre = len?.name ?? `lender ${c.lender}`;
    }

    const reg = await http('POST', '/api/onboarding/phone/register', {
        phone_number: phone, phoneNumber: phone, terms: true, policies: true,
        otp_length: 4, otpLength: 4, partner_branch_hash: br.hash, partnerBranchHash: br.hash,
    }, phone);
    const uid = reg.json?.data?.user?.id;
    if (!uid) return { ...base, detalle: `register HTTP ${reg.status}` };

    const asesor = (await one<{ id: number }>(
        'SELECT id FROM users WHERE allied_branch_id=? AND cognito_id IS NOT NULL LIMIT 1', [br.b])
        .catch(() => null))?.id ?? null;
    const amount = c.amount!;
    const ins = await exec(
        `INSERT INTO user_requests (user_id, allied_id, allied_branch_id, lender_id, amount,
           original_amount, user_request_status_id, corporate_user_id, credit_line_id, fee_number,
           fee_value, rate, created_at, updated_at) VALUES (?,?,?,NULL,?,?,1,?,1,0,0,0,NOW(),NOW())`,
        [uid, br.allied, br.id, amount, amount, asesor]).catch(() => null);
    if (!ins?.insertId) return { ...base, detalle: 'no se pudo crear la solicitud' };
    base.ur = ins.insertId;

    await synthFill(ins.insertId, { income: c.income!, score: c.score! });

    const lis = await http('GET', `/api/onboarding/loan-application/lenders/${ins.insertId}`, undefined, phone);
    const crudo = lis.json?.data ?? lis.json;
    const arr: any[] = Array.isArray(crudo) ? crudo : Array.isArray(crudo?.lenders) ? crudo.lenders : [];
    base.listado = arr.map((x) => Number(x.id ?? x.lender_id)).filter(Boolean);
    base.enListado = base.listado.includes(c.lender);

    // Sin entidad pedida, el caso TERMINA en el listado. Es el recorrido más corto que ya prueba
    // algo real —monto → solicitud → datos de riesgo → qué se le ofrece— y no arrastra la bifurcación
    // por entidad, que es donde el flujo se vuelve N flujos distintos.
    if (c.lender === null) {
        return { ...base, ok: arr.length > 0, conducta: `listado con ${arr.length} entidades`,
                 detalle: arr.length ? '' : 'el listado vino VACÍO' };
    }

    // Se selecciona AUNQUE no esté en el listado: que el backend acepte una entidad que no ofreció
    // es en sí un resultado, y callarlo lo escondería.
    const sel = await http('POST', `/api/onboarding/loan-application/update-user-request/${ins.insertId}`, {
        lender_id: c.lender, fee_number: 4, original_amount: amount, amount,
        initial_fee: 0, rate: '0', transaction_data: null,
    }, phone);
    if (sel.status !== 200 || sel.json?.success === false) {
        return { ...base, ok: false, conducta: 'ERROR al seleccionar',
                 detalle: String(sel.json?.message ?? sel.json?.raw ?? `HTTP ${sel.status}`).split('\n')[0].slice(0, 100) };
    }
    return { ...base, ok: true, conducta: conductaDe(sel.json?.data) };
}

/** PREVUELO. Todo lo que este runner necesita vive FUERA del repo —el `.env` del backend y dos mocks
 *  levantados a mano— y cuando falta algo, el flujo NO se rompe: devuelve un resultado plausible y
 *  equivocado. Las tres formas ya documentadas:
 *    · drivers KYC en `fake` → el buró contesta siempre lo mismo → «el ingreso no cambia nada» (F-139)
 *    · mock de integraciones caído → la entidad desaparece → «la excluye una regla» (F-140)
 *    · `CREDIFAMILIA_HOST_OAUTH` ausente → el listado revienta → «el comercio no ofrece nada» (F-142)
 *  Las tres se leen como hechos del negocio. Por eso esto avisa ANTES, en vez de dejar que el próximo
 *  las descubra una por una como pasó el 2026-08-18. */
async function prevuelo(): Promise<string[]> {
    const faltan: string[] = [];
    const vivo = async (url: string) =>
        !!(await fetch(url, { signal: AbortSignal.timeout(5_000) }).catch(() => null));

    if (!(await vivo(`${API}/`))) faltan.push(`el backend no responde en ${API}`);
    if (!(await vivo(`${MOCK_LENDERS}/`))) {
        faltan.push(`mock de integraciones caído (${MOCK_LENDERS}) → las rt=1 desaparecen del listado`
            + ' y parece regla de negocio (F-140). Levantalo: node mock-lenders/server.mjs');
    }
    if (flag('preaprobados') && !(await vivo(PREAPPROVALS.replace(/\/v1\/.*$/, '/')))) {
        faltan.push(`mock de pre-aprobados caído (${PREAPPROVALS}). Levantalo: node mock-preapprovals/server.mjs`);
    }
    if (flag('lambda') && !(await vivo(`${LAMBDA}/agildata/agildata-services/rest/afiliado/historicoDetalladoEmpleo/1/1`))) {
        faltan.push(`la lambda de centrales no responde (${LAMBDA})`);
    }
    return faltan;
}

/** POSTVUELO del buró: ¿el ingreso que se DICTÓ llegó de verdad? Es la única comprobación que
 *  distingue «el parámetro no influye» de «el parámetro nunca llegó», y las dos se ven igual en el
 *  listado. Si los drivers KYC están en `fake`, acá salta. */
async function buroLlego(res: Res[]): Promise<string | null> {
    const conUr = res.filter((r) => r.ur && r.caso.income);
    if (!conUr.length) return null;
    const vistos = new Set<number>();
    for (const r of conUr) {
        const row = await one<{ a: string }>(
            'SELECT s.agildata a FROM user_requests u JOIN user_summaries s ON s.user_id=u.user_id WHERE u.id=?',
            [r.ur]).catch(() => null);
        const m = /"last_payment_value":\s*(\d+)/.exec(row?.a ?? '');
        if (m) vistos.add(Number(m[1]));
    }
    const pedidos = new Set(conUr.map((r) => r.caso.income!));
    if (vistos.size === 1 && pedidos.size > 1) {
        return `el buró devolvió SIEMPRE ${[...vistos][0].toLocaleString('es-CO')} pese a que se`
            + ` dictaron ${pedidos.size} ingresos distintos → los drivers KYC están en \`fake\` e`
            + ' interceptan antes que la lambda (F-139). No concluyas nada de estas corridas.';
    }
    return null;
}

async function main(): Promise<number> {
    const dflt = {
        amount: Number(arg('amount', '2000000')),
        income: Number(arg('income', '2500000')),
        score: Number(arg('score', '700')),
    };
    const casos: Caso[] = arg('casos')
        ? arg('casos').split(';').map((x) => parseCaso(x, dflt))
        : [parseCaso(`${arg('comercio', 'pullman')}${arg('lender') ? ':' + arg('lender') : ''}`, dflt)];
    const par = flag('paralelo');

    console.log(`\n  CASOS · ${casos.length} · ${par ? 'EN PARALELO' : 'en serie'} · ${API}\n`);
    const faltan = await prevuelo();
    if (faltan.length) {
        console.log('  ⚠ PREVUELO — falta algo, y sin esto el resultado MIENTE:\n');
        for (const f of faltan) console.log(`      · ${f}`);
        console.log('');
        return 2;
    }
    if (flag('lambda')) {
        const fallos = await dictarTodos(casos);
        console.log(`  respuestas del buró pedidas a la lambda: ${casos.length - fallos.length}/${casos.length}`
            + (fallos.length ? `  ⚠ fallaron ${fallos.join(', ')}` : '') + '\n');
    }
    const t0 = Date.now();
    const res = par
        ? await Promise.all(casos.map((c, i) => correr(c, i).catch((e) => (
            { caso: c, ok: false, phone: telefono(i), detalle: String(e).slice(0, 90) } as Res))))
        : await (async () => {
            const out: Res[] = [];
            for (let i = 0; i < casos.length; i++) {
                out.push(await correr(casos[i], i).catch((e) => (
                    { caso: casos[i], ok: false, phone: telefono(i), detalle: String(e).slice(0, 90) } as Res)));
            }
            return out;
        })();

    for (const r of res) {
        const c = r.caso;
        const cab = `${c.comercio} → ${c.lender === null ? 'listado' : (r.nombre ?? c.lender)}`
            + `   [monto ${(c.amount ?? 0).toLocaleString('es-CO')} · ingreso `
            + `${(c.income ?? 0).toLocaleString('es-CO')} · score ${c.score}]`;
        console.log(`  ${r.ok ? '✓' : '✗'} ${cab}`);
        console.log(`      uReq ${r.ur ?? '—'} · tel ${r.phone}`
            + (r.listado ? ` · listado: [${r.listado.join(', ')}]`
                + (r.caso.lender === null ? '' : ` · la pedida ${r.enListado ? 'SÍ' : '**NO**'} estaba`) : ''));
        console.log(`      ${r.conducta ?? '—'}${r.detalle ? ` · ${r.detalle}` : ''}`);
        if (r.preaprobados?.length) {
            console.log(`      PRE-APROBADOS (lo que dispara el front · ${r.preaprobados.length} entidades):`);
            for (const q of r.preaprobados) {
                console.log(`          ${String(q.id).padStart(4)}  ${q.estado}`
                    + (q.cupo ? `  cupo ${Number(q.cupo).toLocaleString('es-CO')}` : ''));
            }
        }
    }
    // EL CONTRASTE, que es para lo que sirve correr varios. Una lista por caso obliga a diffear a
    // ojo, y el ojo se equivoca justo cuando los conjuntos son parecidos — que es el caso interesante.
    const conListado = res.filter((r) => r.listado?.length);
    if (conListado.length > 1) {
        const sets = conListado.map((r) => new Set(r.listado!));
        const comun = [...sets[0]].filter((x) => sets.every((s) => s.has(x)));
        console.log(`\n  EN QUÉ SE DIFERENCIAN\n`);
        console.log(`    en TODOS los casos : ${comun.length ? comun.join(', ') : '(ninguna)'}`);
        for (let k = 0; k < conListado.length; k++) {
            const solo = conListado[k].listado!.filter((x) => !sets.every((s) => s.has(x)));
            const c = conListado[k].caso;
            const etiq = `${c.comercio}${c.lender === null ? '' : ':' + c.lender}`;
            console.log(`    sólo en ${etiq.padEnd(18)}: ${solo.length ? solo.join(', ') : '(nada propio)'}`);
        }
        // ⚠ listados IDÉNTICOS no significan «el parámetro no influye»: puede significar que el
        // parámetro nunca llegó. Con `--lambda`, la comprobación es que `approximate_real_salary` en
        // `user_summaries` sea distinto por caso (ver F-139).
        if (conListado.every((r) => r.listado!.length === comun.length)) {
            console.log(`\n    ⚠ todos idénticos. Antes de concluir «no influye», verificá que el dato`);
            console.log(`      LLEGÓ: SELECT agildata FROM user_summaries WHERE user_id=… (F-139)`);
        }
    }

    // El recuento del cierre va aparte del de casos: «sin CreditopX» NO es un fallo, es un hecho del
    // comercio, y mezclarlos haría ver rota la mitad del catálogo.
    const conCierre = res.filter((r) => r.cierre);
    if (conCierre.length) {
        const cerraron = conCierre.filter((r) => r.cierre!.cerro).length;
        const sinCtopx = conCierre.filter((r) => r.cierre!.motivo === 'sin CreditopX').length;
        const trabados = conCierre.length - cerraron - sinCtopx;
        console.log(`\n  CIERRE rt=2 — ${cerraron} cerraron en estado 11 · ${sinCtopx} sin CreditopX`
            + (trabados ? ` · ⚠ ${trabados} se trabaron` : ''));
        for (const r of conCierre.filter((x) => !x.cierre!.cerro && x.cierre!.motivo !== 'sin CreditopX')) {
            console.log(`      ⚠ ${r.caso.comercio}: ${r.cierre!.motivo}`
                + (r.cierre!.estado ? ` · quedó en estado ${r.cierre!.estado}` : ''));
        }
    }

    const mentira = await buroLlego(res);
    if (mentira) console.log(`\n  ⚠ ${mentira}`);

    const malos = res.filter((r) => !r.ok).length;
    console.log(`\n  ${res.length - malos}/${res.length} cerraron · ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    // ⚠ uReq REPETIDO entre casos sería la señal de que se pisaron. Con teléfono por caso no debería
    // pasar nunca; si pasa, hay un recurso compartido de verdad y hay que ir a buscarlo.
    const urs = res.map((r) => r.ur).filter(Boolean);
    if (new Set(urs).size !== urs.length) console.log('  ⚠ DOS CASOS COMPARTIERON SOLICITUD — se pisaron');
    console.log();
    return malos ? 1 : 0;
}

const code = await main().catch((e) => { console.error('\n  ✗', e); return 1; });
await close().catch(() => {});
process.exit(code);
