// bcp-return.ts — el flujo VEHICLE de BCP por HTTP, y qué pasa cuando el asesor VUELVE ATRÁS.
//
//   E2E_TARGET=local node dev/bcp-return.ts --comercio '#50e007e4'
//
// POR QUÉ EXISTE. El flujo de BCP tiene tres pantallas que ningún runner sabía caminar —el formulario
// del vehículo (`formulario/pre`), el simulador embebido (`entidad/simulador`) y el gate manual
// (`entidad/resultado`)— y son justo las que se interponen entre el onboarding y el marketplace. Lo
// que se probaba antes era la mitad de atrás: `case.ts` pega contra la API y llega a elegir la
// entidad sin pasar por ninguna de las tres.
//
// LO QUE MIDE. En este funnel «dónde estoy» no lo dice la dirección: lo decide
// `ResolveOnboardingDestinationUc` en cada carga, con tres entradas —los placements del comercio, si
// el formulario ya se respondió (form-service) y una MARCA FIRMADA EN LA COOKIE de que el gate ya se
// pasó (`alternate-flow-session-marker.server.ts`)—. O sea que «volver atrás» no es una operación del
// navegador: es una pregunta que el servidor vuelve a contestar. Este runner la hace explícita:
// después de cada tramo pide la pantalla ANTERIOR —exactamente lo que hace el navegador al apretar
// atrás, que revalida el loader por su endpoint `.data`— y anota qué contestó el front.
//
// ⚠ REQUISITOS DE LOCAL, y el segundo no es opcional:
//   1. `make harness-peru` (siembra el comercio, las dos entidades y los placements);
//   2. el wizard apuntando al form-service LOCAL. En local `bin/advisor` apunta
//      `VITE_FORM_SERVICE_BASE_URL` a **dev**, y el guardado del formulario ESCRIBE: las respuestas
//      del vehículo sintético terminan en la BD compartida, colgadas del `user_request_id` que en dev
//      es la solicitud de otra persona. Para eso está `mock-forms-g2/` (:8109).
//
// ⚠ LO QUE ESTE CAMINO NO VE: el JavaScript del cliente. En particular el campo «Monto a financiar»
// (260), que el esquema declara VISIBLE, OBLIGATORIO y NO EDITABLE: su valor lo calcula el renderer
// (`useFinancedAmount`, en `main` desde el 2026-09-03), y acá ese cálculo NO corre — el runner manda
// el número él mismo y pasa igual, porque el validador del servidor exige el campo pero no mira si es
// editable. O sea que un verde acá no dice que la pantalla se pueda pasar en un navegador: eso hay que
// mirarlo en un navegador.
//
// ✔ YA SE MIRÓ, Y LA RESPUESTA ES QUE SÍ (2026-09-18). Con
// `make harness-caminar CASOS='#50e007e4:207' MOTOR=navegador MONTO=60000` la pantalla se pasa sin
// tocar «Monto a financiar»: basta llenar la cuota inicial y el renderer lo calcula solo — el
// caminador salió a `entidad/simulador?amount=48000`, o sea 60.000 − 12.000, hecho por el cliente.
// Este runner puede seguir mandando el número él mismo; lo que ya no hace falta es dudar de si la
// pantalla es pasable.
//
// ⚠ Y lo que ese recorrido dejó al descubierto: `entidad/simulador` es un IFRAME al simulador REAL de
// BCP (`VITE_BCP_SIMULATOR_URL`, por defecto un Azure del banco), y en local no hay mock — la pantalla
// es una caja vacía con su botón debajo. Se llega, pero no hay nada que mirar ni con qué interactuar.
process.env.E2E_TARGET ||= 'local';
export {};

const { FrontSession } = await import('../pkg/front.ts');
const { one, close, TARGET } = await import('../pkg/db.ts');
const { branchPhone } = await import('../pkg/phones.ts');
const { config } = await import('../pkg/config.ts');

const arg = (n: string, d = ''): string => {
    const i = process.argv.indexOf(`--${n}`);
    return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d;
};

const REF = arg('comercio', '#50e007e4');
const AMOUNT = Number(arg('amount', '60000'));       // valor del vehículo, en soles
const DOWN_PAYMENT = Number(arg('inicial', '10000'));
const BONUS = Number(arg('bono', '2000'));
const BASE_FE = arg('front', config.feBaseUrl);
const FLOW = arg('flow', 'self-service');

/* ── CONTRA QUÉ AMBIENTE, Y QUÉ CAMBIA FUERA DE LOCAL ────────────────────────────────────────────
 *
 * En LOCAL el runner deriva un teléfono nuevo por caso y no le debe nada a nadie. Fuera de local no:
 *
 *   · EL TELÉFONO HAY QUE DÁRSELO. El OTP sólo se puede saltar con los números que están en
 *     `qa_otp_bypass_phones` —el código son sus últimos 4 dígitos—, así que uno derivado al azar deja
 *     el recorrido trabado en la pantalla del OTP. Van dos, uno por recorrido: con el mismo número los
 *     dos recorridos serían el mismo cliente y el segundo chocaría con la solicitud del primero.
 *   · EL RECORRIDO B NO CORRE SOLO. Es el que prueba que el gate mata una solicitud, así que la DEJA
 *     NEGADA. En una base compartida eso es basura que queda: hay que pedirlo con `--niega`.
 *
 * `prod` no está y no va a estar: acá se registran clientes y se llenan formularios. */
const ENVIRONMENTS = ['local', 'dev', 'qa', 'staging'];
if (!ENVIRONMENTS.includes(TARGET)) {
    throw new Error(`bcp-volver no corre contra «${TARGET}» (registra clientes y llena formularios). Ambientes: ${ENVIRONMENTS.join(', ')}`);
}
const TELS = arg('tel').split(',').map((t) => t.trim()).filter(Boolean);
if (TARGET !== 'local' && TELS.length < 1) {
    throw new Error(
        `contra «${TARGET}» hay que pasar los teléfonos con --tel: sólo los que están en el bypass de OTP`
            + '\n   pueden pasar la pantalla del código (el código son sus últimos 4 dígitos).'
            + '\n   ej:  --tel 321411214,321411217   (el primero para el recorrido A, el segundo para el B)',
    );
}
const DENIES = TARGET === 'local' || process.argv.includes('--niega');

const c = (s: string, n: number) => `[${n}m${s}[0m`;
const ok = (s: string) => c(s, 32), bad = (s: string) => c(s, 31), eye = (s: string) => c(s, 33), gris = (s: string) => c(s, 90);
const line = (s = '') => console.log(s);

// ─── el comercio ─────────────────────────────────────────────────────────────────────────────────
const byHash = REF.startsWith('#');
const br = await one<{ id: number; hash: string; com: string; allied: number; pais: number }>(
    byHash
        ? `SELECT b.id, b.hash, x.name AS com, x.id AS allied, x.country_id AS pais FROM allied_branches b
             JOIN allieds x ON x.id=b.allied_id WHERE b.hash=? LIMIT 1`
        : `SELECT b.id, b.hash, x.name AS com, x.id AS allied, x.country_id AS pais FROM allied_branches b
             JOIN allieds x ON x.id=b.allied_id WHERE x.slug=? OR x.name LIKE ? ORDER BY b.id LIMIT 1`,
    byHash ? [REF.slice(1)] : [REF, `%${REF}%`]);
if (!br) throw new Error(`no encontré el comercio «${REF}»`);

/** Tipo de documento del comercio: el backend ya lo publica, recortado por el catálogo del país. */
async function documentType(hash: string): Promise<string> {
    try {
        const r = await fetch(`${config.mockUrl}/api/loans/allied/${hash}`, { signal: AbortSignal.timeout(20_000) });
        const j = await r.json() as any;
        const list = j?.data?.allowed_document_types;
        return Array.isArray(list) && typeof list[0] === 'string' ? list[0] : 'CC';
    } catch { return 'CC'; }
}
const DOC_TYPE = await documentType(br.hash);

const base = `/${FLOW}/${br.hash}`;
line(`\n  BCP · VOLVER ATRÁS — ${br.com} (sucursal ${br.id}, país ${br.pais}) · front ${BASE_FE} · target ${TARGET}`);
line(gris(`  documento del comercio: ${DOC_TYPE} · vehículo ${AMOUNT} − inicial ${DOWN_PAYMENT} − bono ${BONUS} = ${AMOUNT - DOWN_PAYMENT - BONUS} a financiar`));

// ─── utilidades del recorrido ────────────────────────────────────────────────────────────────────
type Point = { s: InstanceType<typeof FrontSession>; ur: number; tel: string; doc: string };

const path = (r: string) => r.split('?')[0].replace(base, '').replace(/^\//, '') || '/';
const withQuery = (r: string) => r.replace(base, '').replace(/^\//, '');

/** El semáforo de una carga: qué contestó el front al pedir esa pantalla. */
async function look(s: any, r: string): Promise<{ txt: string; destino: string | null; res: any }> {
    const res = await s.cargar(r);
    if (res.status === 202 && res.redirect) return { txt: `↪ me MANDA a ${c(withQuery(res.redirect), 36)}`, destino: res.redirect, res };
    if (res.status >= 400) return { txt: bad(`✗ HTTP ${res.status}`), destino: null, res };
    if (res.status === 0) return { txt: bad(`✗ sin respuesta (${res.crudo?.slice(0, 60)})`), destino: null, res };
    return { txt: ok('✓ la SIRVE'), destino: null, res };
}

/** Un experimento de «atrás»: pide la pantalla anterior y cuenta qué pasó. */
async function backTo(s: any, r: string, question: string): Promise<any> {
    const { txt, res } = await look(s, r);
    line(`      ↩ ${gris('atrás a')} ${path(r).padEnd(24)} ${txt}   ${gris(question)}`);
    return res;
}

/** Las respuestas del formulario del vehículo, armadas DESDE EL ESQUEMA que el loader devolvió. */
function vehicleAnswers(data: any, value: number, initial: number, bonus: number): Record<string, any> {
    const fields: any[] = (data?.formDefinition?.sections ?? []).flatMap((s: any) => s.fields ?? []);
    const tree = data?.carsTree;
    const mark = tree?.brands?.[0];
    const model = mark?.models?.[0];
    const version = model?.versions?.[0];
    const financed = value - initial - bonus;
    const byRole: Record<string, any> = {
        'field_options.bcp.cars_tree': mark?.key,
        'field_options.bcp.cars_tree.models': model?.key,
        'field_options.bcp.cars_tree.models.versions': version?.key,
        'amount.vehicle_value': value,
        'amount.down_payment': initial,
        'amount.rebate': bonus,
        'computed.financed_amount': financed,
    };
    const out: Record<string, any> = {};
    for (const f of fields) {
        const ds = f.dataSource ?? '';
        if (ds in byRole) { out[String(f.id)] = byRole[ds]; continue; }
        if (/^field_options\.years/.test(ds)) { out[String(f.id)] = String(new Date().getFullYear() - 1); continue; }
        if (/^field_options\.percent/.test(ds)) { out[String(f.id)] = '1'; continue; }
        // Lo que quede: la primera opción si el esquema la trae, si no un texto plausible.
        const options = f.options ?? [];
        out[String(f.id)] = options.length ? String(options[0].key ?? options[0].value ?? options[0].id) : `H${Date.now() % 100000000}`;
    }
    return out;
}

// ─── FASE 1: la ida, hasta el formulario del vehículo ────────────────────────────────────────────
let n = 0;
async function reachTheForm(label: string): Promise<Point> {
    n += 1;
    const seedValue = Number(`9${String(Date.now()).slice(-8)}${n}`);
    // El de la lista si lo dieron; si no, uno derivado del país del comercio. `n` arranca en 1.
    const tel = TELS[n - 1] ?? (TELS.length ? TELS[TELS.length - 1] : await branchPhone(br!.hash, seedValue));
    /* El documento del usuario si ya existe. Un cliente que ya pasó por acá tiene el suyo, y mandarle
       otro es pedirle al backend que cambie la identidad de una persona en medio del flujo. Los
       `TEMP-…` no cuentan: son el marcador de «todavía no completó datos». */
    const alreadyThere = await one<{ document_number: string }>(
        'SELECT document_number FROM users WHERE cell_phone=? ORDER BY id DESC LIMIT 1', [tel]).catch(() => null);
    const prior = alreadyThere?.document_number ?? '';
    const doc = /^\d+$/.test(prior) ? prior : String(80000000 + (Date.now() % 9000000) + n).slice(0, 8);
    const s = new FrontSession(BASE_FE);
    line(`\n  ── ${label} · tel ${tel} · ${DOC_TYPE} ${doc} ──`);

    const step = async (r: string, form: any, what: string, json = false) => {
        const acc = json ? await s.enviarJson(r, form) : await s.enviar(r, form);
        const err = acc.cuerpo?.error ?? acc.datos?.error ?? acc.cuerpo?.data?.error;
        if (acc.redirect) { line(`      ${gris('→')} ${what.padEnd(26)} ${gris('→')} ${c(withQuery(acc.redirect), 36)}`); return acc.redirect; }
        throw new Error(`${what}: no redirigió · ${err ? JSON.stringify(err) : JSON.stringify(acc.cuerpo ?? acc.crudo).slice(0, 260)}`);
    };

    /* PREFLIGHT, y no es de más: si el wizard apunta a OTRO backend, el payload del comercio se
     * rechaza y la pantalla degrada a `country: null` — el registro se cae después con «Ocurrió un
     * error», que se lee como un problema del caso y es del ambiente. Pasa seguido porque `bin/advisor`
     * deja el :5174 apuntando al target de la última corrida. */
    const entry = await s.cargar(`${base}/solicitar?amount=${AMOUNT}`);
    if (!entry.datos?.country) {
        throw new Error(`el front de ${BASE_FE} no resuelve este comercio (country: null): está apuntando a OTRO backend.`
            + `\n   Levantá uno contra local:  cd <frontend-monorepo>/apps/loan-request-wizard && VITE_API_URL=http://localhost`
            + ` VITE_FORM_SERVICE_BASE_URL=http://localhost:8109 VITE_BCP_VEHICLE_FORM_TYPE_ID=8`
            + ` VITE_PREAPPROVALS_ENDPOINT=http://localhost:8095/v1/preapprovals/check ./node_modules/.bin/react-router dev --port 5176`
            + `\n   y volvé con  --front http://localhost:5176`);
    }
    let r = await step(`${base}/solicitar?amount=${AMOUNT}`, { phoneNumber: tel, amount: AMOUNT }, 'celular');
    await s.cargar(r);
    r = await step(r, { otp: tel.slice(-4), amount: AMOUNT, original_amount: AMOUNT }, 'OTP');

    const ur = Number(r.match(/\/(\d+)\//)?.[1]);
    if (!ur) throw new Error(`no pude sacar la solicitud de ${r}`);

    // El resto del onboarding, siguiendo SÓLO las redirecciones que la app emite.
    for (let i = 0; i < 8; i++) {
        const sheet = path(r).split('?')[0].split('/').pop();
        if (sheet === 'pre' || sheet === 'post' || r.includes('/entidad/') || sheet === 'lenders') break;
        const res = await s.cargar(r);
        if (res.status === 202 && res.redirect) { r = res.redirect; continue; }
        if (sheet === 'personal-info') {
            r = await step(r, {
                intent: 'save-personal-info', documentType: DOC_TYPE, documentNumber: doc,
                name: 'CARLOS', surname: 'RUIZ', email: `qa${doc}@gmail.com`, address: 'Av Larco 123', stratum: '3',
                issueDay: '10', issueMonth: '5', issueYear: '2019', birthDay: '10', birthMonth: '5', birthYear: '1995',
            }, 'datos personales');
        } else if (sheet === 'employment-info') {
            r = await step(r, { employmentStatus: 'Empleado', monthlyIncome: '9000' }, 'datos laborales');
        } else {
            throw new Error(`pantalla que este runner no sabe pasar: ${path(r)} (HTTP ${res.status})`);
        }
    }
    line(`      ${ok('•')} solicitud ${c(String(ur), 1)} · el funnel me dejó en ${c(path(r), 36)}`);
    return { s, ur, tel, doc };
}

// ─── el recorrido, con los experimentos intercalados ─────────────────────────────────────────────
const A = await reachTheForm('RECORRIDO A — la ida completa');
const { s, ur } = A;

// 1) el formulario del vehículo
const rPre = `${base}/${ur}/formulario/pre?amount=${AMOUNT}`;
const pre = await s.cargar(rPre);
if (pre.status !== 200) throw new Error(`formulario/pre no abre: HTTP ${pre.status} ${String(pre.crudo).slice(0, 200)}`);
const answers_ = vehicleAnswers(pre.datos, AMOUNT, DOWN_PAYMENT, BONUS);
line(`\n  ① formulario del vehículo (form_type 8) — ${Object.keys(answers_).length} campos: ${gris(JSON.stringify(answers_))}`);

await backTo(s, `${base}/${ur}/personal-info?amount=${AMOUNT}`, '¿puedo volver a los datos personales?');

const gPre = await s.enviarJson(rPre, { answers: answers_ });
if (!gPre.redirect) throw new Error(`guardar el formulario del vehículo no redirigió: ${JSON.stringify(gPre.cuerpo).slice(0, 300)}`);
line(`      ${gris('→')} ${'guardado'.padEnd(26)} ${gris('→')} ${c(withQuery(gPre.redirect), 36)}`);
const amountAfterPre = new URL(gPre.redirect, 'http://x').searchParams.get('amount');
line(`      ${amountAfterPre === String(AMOUNT - DOWN_PAYMENT - BONUS) ? ok('✓') : eye('⚠')} el monto que sigue viaja en la URL: ${c(String(amountAfterPre), 1)} ${gris(`(el del vehículo era ${AMOUNT})`)}`);

// 2) el simulador
const rSim = gPre.redirect;
const sim = await s.cargar(rSim);
line(`\n  ② simulador embebido — ${sim.status === 200 ? ok('abre') : bad(`HTTP ${sim.status}`)} · prellenado: ${sim.datos?.diagnostics?.prefilled ? ok('sí') : eye('no')} ${gris(JSON.stringify({ vehicleValue: sim.datos?.diagnostics?.vehicleValue, financingAmount: sim.datos?.diagnostics?.financingAmount }))}`);
await backTo(s, rPre, '¿puedo volver a corregir el vehículo ANTES de simular?');

// 3) el gate manual
const rRes = `${base}/${ur}/entidad/resultado?amount=${amountAfterPre}`;
await s.cargar(rRes);
const decision = await s.enviar(rRes, { decision: 'approved' });
if (!decision.redirect) throw new Error(`el gate no redirigió: ${JSON.stringify(decision.cuerpo).slice(0, 300)}`);
line(`\n  ③ gate manual «¿tiene oferta preaprobada?» → Aprobado ${gris('→')} ${c(withQuery(decision.redirect), 36)}`);

line(`\n  ${c('LOS EXPERIMENTOS DE «ATRÁS», ya pasado el gate', 1)}`);
await backTo(s, rPre, '¿puedo corregir el vehículo DESPUÉS de simular?');
await backTo(s, rSim, '¿puedo volver a simular?');
await backTo(s, `${base}/${ur}/personal-info?amount=${amountAfterPre}`, '¿puedo volver a los datos personales?');

// 4) el formulario posterior
const rPost = decision.redirect;
const post = await s.cargar(rPost);
let rLenders = `${base}/${ur}/lenders?amount=${amountAfterPre}`;
if (post.status === 200 && path(rPost).includes('formulario/post')) {
    const rp = vehicleAnswers(post.datos, AMOUNT, DOWN_PAYMENT, BONUS);
    line(`\n  ④ formulario posterior (form_type 9) — ${Object.keys(rp).length} campos`);
    const gPost = await s.enviarJson(rPost, { answers: rp });
    if (!gPost.redirect) throw new Error(`guardar el posterior no redirigió: ${JSON.stringify(gPost.cuerpo).slice(0, 300)}`);
    line(`      ${gris('→')} ${'guardado'.padEnd(26)} ${gris('→')} ${c(withQuery(gPost.redirect), 36)}`);
    rLenders = gPost.redirect;
    await backTo(s, rPost, '¿puedo volver a editar chasis y motor?');
    await backTo(s, rPre, '¿y el formulario del vehículo, desde acá?');
}

// 5) el marketplace, y EL MONTO
line(`\n  ⑤ marketplace`);
const withAmount = await s.cargar(rLenders);
const lo1 = withAmount.datos?.loanOptionsPromise;
const withoutAmount = await s.cargar(`${base}/${ur}/lenders`);
const lo2 = withoutAmount.datos?.loanOptionsPromise;
const idsOf = (lo: any) => Array.isArray(lo?.loan_options) ? lo.loan_options.map((x: any) => x.id).join(', ') : `— (${lo?.__rechazada ? 'promesa rechazada' : 'pendiente'})`;
/* EL NÚMERO QUE DECIDE ES `requestedAmount`, no el `calculated` que devuelve el backend.
 *
 * Costó una vuelta entenderlo: `calculated` es el eco del backend, y lo consume sólo el reprecio de
 * renting/RTO. Lo que la pantalla muestra lo calcula el CUSTOMER con `CalculateLoanFinancialsUc` sobre
 * `qsAmount > 0 ? qsAmount : requestedAmount`, así que medir `calculated` contestaba otra pregunta —y
 * daba «oferta distinta» con la pantalla ya arreglada—.
 *
 * Se imprime igual, porque su diferencia sí dice algo: sin monto en la URL el backend contesta con un
 * número propio que no es ninguno de los dos de la solicitud. */
const backendEcho = (lo: any, id: number) => {
    const l = (lo?.loan_options ?? []).find((x: any) => Number(x.id) === id);
    const cal = l?.credit_lines?.calculated ?? l?.calculated ?? null;
    return cal ? JSON.stringify(cal).slice(0, 120) : gris('sin `calculated`');
};
line(`      con ?amount=${amountAfterPre}  → entidades [${idsOf(lo1)}] · requestedAmount ${c(String(lo1?.requestedAmount), 1)} ${gris(`· eco del backend ${backendEcho(lo1, 207)}`)}`);
line(`      SIN  ?amount           → entidades [${idsOf(lo2)}] · requestedAmount ${c(String(lo2?.requestedAmount), 1)} ${gris(`· eco del backend ${backendEcho(lo2, 207)}`)}`);
const expected = String(AMOUNT - DOWN_PAYMENT - BONUS);
const same = String(lo1?.requestedAmount) === String(lo2?.requestedAmount);
const okOnes = same && String(lo1?.requestedAmount) === expected;
line(`      ${okOnes ? ok('✓') : bad('✗')} ${okOnes
    ? `el mismo monto por los dos caminos, y es el financiado (${expected})`
    : (same ? `el mismo monto por los dos caminos, pero NO es el financiado (${expected})` : 'MONTO DISTINTO según venga o no la query')} ${gris('— la pantalla cotiza sobre `qsAmount > 0 ? qsAmount : requestedAmount`')}`);

// 6) la sesión perdida: otro navegador, la misma solicitud
line(`\n  ⑥ el asesor cambia de equipo (sesión nueva, misma solicitud ${ur})`);
const s2 = new FrontSession(BASE_FE);
for (const r of [`${base}/${ur}/formulario/post?amount=${amountAfterPre}`, `${base}/${ur}/formulario/pre?amount=${amountAfterPre}`]) {
    const { txt } = await look(s2, r);
    line(`      ${path(r).padEnd(26)} ${txt}`);
}

// ─── ⑦ CORREGIR EL VEHÍCULO DESPUÉS DEL GATE ────────────────────────────────────────────────────
// Que la pantalla se SIRVA no dice nada sobre qué pasa al guardarla. Lo que importa es si el funnel
// entiende que la simulación anterior ya no vale: se hizo con otro vehículo y otro monto.
line(`\n  ⑦ corregir el vehículo pasado el gate — ¿el funnel vuelve a exigir la simulación?`);
const NEW_VALUE = AMOUNT + 15000;
const preAgain = await s.cargar(rPre);
if (preAgain.status !== 200) {
    line(`      ${bad('✗')} formulario/pre no abre (HTTP ${preAgain.status}): no se puede corregir`);
} else {
    const corrected = await s.enviarJson(rPre, {
        answers: vehicleAnswers(preAgain.datos, NEW_VALUE, DOWN_PAYMENT, BONUS),
    });
    const target = corrected.redirect ?? '—';
    const simulatesAgain = /entidad\/simulador/.test(target);
    const newAmount = corrected.redirect ? new URL(corrected.redirect, 'http://x').searchParams.get('amount') : null;
    const expected = String(NEW_VALUE - DOWN_PAYMENT - BONUS);
    line(`      guardo el vehículo en ${NEW_VALUE} ${gris('→')} ${c(withQuery(target), 36)}`);
    line(`      ${simulatesAgain ? ok('✓') : bad('✗')} ${simulatesAgain
        ? 'vuelve al simulador: la simulación vieja quedó invalidada'
        : 'NO vuelve al simulador — la decisión del gate sigue en pie sobre datos que cambiaron'}`);
    line(`      ${newAmount === expected ? ok('✓') : bad('✗')} el monto que sigue es ${c(String(newAmount), 1)} ${gris(`(esperado ${expected})`)}`);
    const inDb = await one<{ amount: number; original_amount: number }>(
        'SELECT amount, original_amount FROM user_requests WHERE id=?', [ur]);
    const okInDb = String(Number(inDb?.amount)) === expected;
    line(`      ${okInDb ? ok('✓') : bad('✗')} la BD dice amount ${c(String(inDb?.amount), 1)} · original_amount ${inDb?.original_amount} ${gris(`(esperado ${expected} / ${NEW_VALUE})`)}`);
}

// ─── RECORRIDO B: el gate, dos veces ─────────────────────────────────────────────────────────────
if (!DENIES) {
    line(`\n  ${c('RECORRIDO B — volver al gate y cambiar de opinión', 1)}  ${eye('OMITIDO')}`);
    line(`      ${gris(`deja una solicitud NEGADA, y «${TARGET}» es una base compartida. Para correrlo: --niega`)}`);
    line();
    await close();
    process.exit(0);
}
line(`\n  ${c('RECORRIDO B — volver al gate y cambiar de opinión', 1)}${TARGET === 'local' ? '' : eye('  ⚠ deja una solicitud NEGADA')}`);
const B = await reachTheForm('RECORRIDO B');
const rPreB = `${base}/${B.ur}/formulario/pre?amount=${AMOUNT}`;
const preB = await B.s.cargar(rPreB);
const gB = await B.s.enviarJson(rPreB, { answers: vehicleAnswers(preB.datos, AMOUNT, DOWN_PAYMENT, BONUS) });
const amountB = new URL(gB.redirect!, 'http://x').searchParams.get('amount');
const rResB = `${base}/${B.ur}/entidad/resultado?amount=${amountB}`;
await B.s.cargar(rResB);
const ap = await B.s.enviar(rResB, { decision: 'approved' });
line(`      Aprobado  ${gris('→')} ${c(withQuery(ap.redirect ?? '—'), 36)}`);
const statusAfterApprove = await one<{ st: number }>('SELECT user_request_status_id st FROM user_requests WHERE id=?', [B.ur]);
line(`      BD tras aprobar: estado ${c(String(statusAfterApprove?.st), 1)}`);
const rej = await B.s.enviar(rResB, { decision: 'rejected' });
line(`      ${eye('↩ vuelvo al gate y ahora marco Rechazado')}  ${gris('→')} ${c(withQuery(rej.redirect ?? '—'), 36)}`);
const statusAfterReject = await one<{ st: number }>('SELECT user_request_status_id st FROM user_requests WHERE id=?', [B.ur]);
line(`      BD tras rechazar: estado ${c(String(statusAfterReject?.st), 1)} ${statusAfterReject?.st !== statusAfterApprove?.st ? bad('← el gate se puede volver a apretar y MATA la solicitud ya aprobada') : gris('(sin cambio)')}`);

// ─── RECORRIDO C: rechazar, y VOLVER ─────────────────────────────────────────────────────────────
//
// El otro sentido del mismo botón, y el que la guarda de etapa no cubría cuando se escribió. Con la
// marca del gate reducida a un booleano, quien rechazaba y volvía atrás era indistinguible de quien
// había aprobado: la guarda lo mandaba al PASO SIGUIENTE DEL FUNNEL —el formulario posterior, o el
// marketplace— de una solicitud que el backend ya cerró. Y eso contradice la regla que el propio
// archivo del gate tiene escrita: «RECHAZADO MATA LA SOLICITUD, no la manda al marketplace (…)
// tampoco pasa por los formularios posteriores».
//
// Lo que se espera acá: los dos caminos —mirar la pantalla y volver a postearla— terminan en la
// pantalla de RETORNO, y el estado no se mueve del 6.
line(`\n  ${c('RECORRIDO C — rechazar, y volver al gate', 1)}${TARGET === 'local' ? '' : eye('  ⚠ deja una solicitud NEGADA')}`);
const C = await reachTheForm('RECORRIDO C');
const rPreC = `${base}/${C.ur}/formulario/pre?amount=${AMOUNT}`;
const preC = await C.s.cargar(rPreC);
const gC = await C.s.enviarJson(rPreC, { answers: vehicleAnswers(preC.datos, AMOUNT, DOWN_PAYMENT, BONUS) });
const amountC = new URL(gC.redirect!, 'http://x').searchParams.get('amount');
const rResC = `${base}/${C.ur}/entidad/resultado?amount=${amountC}`;
await C.s.cargar(rResC);

const rejC = await C.s.enviar(rResC, { decision: 'rejected' });
line(`      Rechazado ${gris('→')} ${c(withQuery(rejC.redirect ?? '—'), 36)}`);
const statusAfterRejectC = await one<{ st: number }>('SELECT user_request_status_id st FROM user_requests WHERE id=?', [C.ur]);
line(`      BD tras rechazar: estado ${c(String(statusAfterRejectC?.st), 1)} ${statusAfterRejectC?.st === 6 ? gris('(6 = Negada, como debe)') : bad('← se esperaba 6 (Negada)')}`);

/* El «atrás» del navegador: revalida el loader por su endpoint `.data`. Acá la solicitud ya está
   cerrada, así que servir la pantalla del gate sería volver a ofrecer una decisión sobre un crédito
   que no existe. */
const returnC = await look(C.s, rResC);
const returnTarget = returnC.destino ?? '(la SIRVE)';
const goesToReturn = returnTarget.includes('/entidad/retorno');
line(`      ↩ ${gris('atrás al gate')}  ${gris('→')} ${c(withQuery(returnTarget), 36)}  ${goesToReturn ? ok('✓ a la pantalla de retorno') : bad('✗ debería ir a la pantalla de retorno: la solicitud está cerrada')}`);

/* Y el POST directo, que es quien llama a la ruta sin pasar por la pantalla: la guarda del `action`
   tiene que contestar lo mismo que la del `loader`, o el asesor ve una cosa y la ruta hace otra. */
const retryC = await C.s.enviar(rResC, { decision: 'approved' });
const retryTarget = retryC.redirect ?? '(sin redirect)';
const retryToReturn = retryTarget.includes('/entidad/retorno');
line(`      ${eye('↩ y ahora POSTEO «Aprobado» sobre la solicitud rechazada')}  ${gris('→')} ${c(withQuery(retryTarget), 36)}  ${retryToReturn ? ok('✓ no la revive') : bad('✗ el rechazo se puede deshacer posteando')}`);
const finalStatusC = await one<{ st: number }>('SELECT user_request_status_id st FROM user_requests WHERE id=?', [C.ur]);
line(`      BD al final: estado ${c(String(finalStatusC?.st), 1)} ${finalStatusC?.st === statusAfterRejectC?.st ? gris('(sin cambio)') : bad('← el estado se movió')}`);

// ─── el rastro que quedó ─────────────────────────────────────────────────────────────────────────
line(`\n  ${c('EL RASTRO', 1)}`);
const saved = TARGET !== 'local' ? null : await fetch('http://localhost:8109/_estado').then((r) => r.json()).catch(() => null) as any;
if (saved) line(`      form-service (mock): ${saved.guardadas.map((g: any) => `${g.clave}→${g.campos} campos`).join(' · ')}`);
for (const id of [ur, B.ur, C.ur]) {
    const f = await one<{ st: number; amount: number }>('SELECT user_request_status_id st, amount FROM user_requests WHERE id=?', [id]);
    line(`      solicitud ${id}: estado ${f?.st} · amount ${f?.amount} ${gris(`(el vehículo valía ${AMOUNT}; a financiar ${AMOUNT - DOWN_PAYMENT - BONUS})`)}`);
}
line();
await close();
