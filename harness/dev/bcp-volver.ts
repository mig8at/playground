// bcp-volver.ts — el flujo VEHICULAR de BCP por HTTP, y qué pasa cuando el asesor VUELVE ATRÁS.
//
//   E2E_TARGET=local node dev/bcp-volver.ts --comercio '#50e007e4'
//
// POR QUÉ EXISTE. El flujo de BCP tiene tres pantallas que ningún runner sabía caminar —el formulario
// del vehículo (`formulario/pre`), el simulador embebido (`entidad/simulador`) y el gate manual
// (`entidad/resultado`)— y son justo las que se interponen entre el onboarding y el marketplace. Lo
// que se probaba antes era la mitad de atrás: `caso.ts` pega contra la API y llega a elegir la
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
//   2. el wizard apuntando al form-service LOCAL. En local `bin/asesor` apunta
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
process.env.E2E_TARGET ||= 'local';
export {};

const { SesionFront } = await import('../pkg/front.ts');
const { one, exec, close, TARGET } = await import('../pkg/db.ts');
const { telefonoDeLaSucursal } = await import('../pkg/telefonos.ts');
const { config } = await import('../pkg/config.ts');

const arg = (n: string, d = ''): string => {
    const i = process.argv.indexOf(`--${n}`);
    return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d;
};

const REF = arg('comercio', '#50e007e4');
const MONTO = Number(arg('amount', '60000'));       // valor del vehículo, en soles
const CUOTA_INICIAL = Number(arg('inicial', '10000'));
const BONO = Number(arg('bono', '2000'));
const BASE_FE = arg('front', config.feBaseUrl);
const FLUJO = arg('flow', 'self-service');

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
const AMBIENTES = ['local', 'dev', 'qa', 'staging'];
if (!AMBIENTES.includes(TARGET)) {
    throw new Error(`bcp-volver no corre contra «${TARGET}» (registra clientes y llena formularios). Ambientes: ${AMBIENTES.join(', ')}`);
}
const TELS = arg('tel').split(',').map((t) => t.trim()).filter(Boolean);
if (TARGET !== 'local' && TELS.length < 1) {
    throw new Error(
        `contra «${TARGET}» hay que pasar los teléfonos con --tel: sólo los que están en el bypass de OTP`
            + '\n   pueden pasar la pantalla del código (el código son sus últimos 4 dígitos).'
            + '\n   ej:  --tel 321411214,321411217   (el primero para el recorrido A, el segundo para el B)',
    );
}
const NIEGA = TARGET === 'local' || process.argv.includes('--niega');

const c = (s: string, n: number) => `[${n}m${s}[0m`;
const ok = (s: string) => c(s, 32), mal = (s: string) => c(s, 31), ojo = (s: string) => c(s, 33), gris = (s: string) => c(s, 90);
const linea = (s = '') => console.log(s);

// ─── el comercio ─────────────────────────────────────────────────────────────────────────────────
const porHash = REF.startsWith('#');
const br = await one<{ id: number; hash: string; com: string; allied: number; pais: number }>(
    porHash
        ? `SELECT b.id, b.hash, x.name AS com, x.id AS allied, x.country_id AS pais FROM allied_branches b
             JOIN allieds x ON x.id=b.allied_id WHERE b.hash=? LIMIT 1`
        : `SELECT b.id, b.hash, x.name AS com, x.id AS allied, x.country_id AS pais FROM allied_branches b
             JOIN allieds x ON x.id=b.allied_id WHERE x.slug=? OR x.name LIKE ? ORDER BY b.id LIMIT 1`,
    porHash ? [REF.slice(1)] : [REF, `%${REF}%`]);
if (!br) throw new Error(`no encontré el comercio «${REF}»`);

/** Tipo de documento del comercio: el backend ya lo publica, recortado por el catálogo del país. */
async function tipoDeDocumento(hash: string): Promise<string> {
    try {
        const r = await fetch(`${config.mockUrl}/api/loans/allied/${hash}`, { signal: AbortSignal.timeout(20_000) });
        const j = await r.json() as any;
        const lista = j?.data?.allowed_document_types;
        return Array.isArray(lista) && typeof lista[0] === 'string' ? lista[0] : 'CC';
    } catch { return 'CC'; }
}
const DOC_TIPO = await tipoDeDocumento(br.hash);

const base = `/${FLUJO}/${br.hash}`;
linea(`\n  BCP · VOLVER ATRÁS — ${br.com} (sucursal ${br.id}, país ${br.pais}) · front ${BASE_FE} · target ${TARGET}`);
linea(gris(`  documento del comercio: ${DOC_TIPO} · vehículo ${MONTO} − inicial ${CUOTA_INICIAL} − bono ${BONO} = ${MONTO - CUOTA_INICIAL - BONO} a financiar`));

// ─── utilidades del recorrido ────────────────────────────────────────────────────────────────────
type Punto = { s: InstanceType<typeof SesionFront>; ur: number; tel: string; doc: string };

const ruta = (r: string) => r.split('?')[0].replace(base, '').replace(/^\//, '') || '/';
const conQuery = (r: string) => r.replace(base, '').replace(/^\//, '');

/** El semáforo de una carga: qué contestó el front al pedir esa pantalla. */
async function mirar(s: any, r: string): Promise<{ txt: string; destino: string | null; res: any }> {
    const res = await s.cargar(r);
    if (res.status === 202 && res.redirect) return { txt: `↪ me MANDA a ${c(conQuery(res.redirect), 36)}`, destino: res.redirect, res };
    if (res.status >= 400) return { txt: mal(`✗ HTTP ${res.status}`), destino: null, res };
    if (res.status === 0) return { txt: mal(`✗ sin respuesta (${res.crudo?.slice(0, 60)})`), destino: null, res };
    return { txt: ok('✓ la SIRVE'), destino: null, res };
}

/** Un experimento de «atrás»: pide la pantalla anterior y cuenta qué pasó. */
async function volverA(s: any, r: string, pregunta: string): Promise<any> {
    const { txt, res } = await mirar(s, r);
    linea(`      ↩ ${gris('atrás a')} ${ruta(r).padEnd(24)} ${txt}   ${gris(pregunta)}`);
    return res;
}

/** Las respuestas del formulario del vehículo, armadas DESDE EL ESQUEMA que el loader devolvió. */
function respuestasDelVehiculo(datos: any, valor: number, inicial: number, bono: number): Record<string, any> {
    const campos: any[] = (datos?.formDefinition?.sections ?? []).flatMap((s: any) => s.fields ?? []);
    const arbol = datos?.carsTree;
    const marca = arbol?.brands?.[0];
    const modelo = marca?.models?.[0];
    const version = modelo?.versions?.[0];
    const financiado = valor - inicial - bono;
    const porRol: Record<string, any> = {
        'field_options.bcp.cars_tree': marca?.key,
        'field_options.bcp.cars_tree.models': modelo?.key,
        'field_options.bcp.cars_tree.models.versions': version?.key,
        'amount.vehicle_value': valor,
        'amount.down_payment': inicial,
        'amount.rebate': bono,
        'computed.financed_amount': financiado,
    };
    const out: Record<string, any> = {};
    for (const f of campos) {
        const ds = f.dataSource ?? '';
        if (ds in porRol) { out[String(f.id)] = porRol[ds]; continue; }
        if (/^field_options\.years/.test(ds)) { out[String(f.id)] = String(new Date().getFullYear() - 1); continue; }
        if (/^field_options\.percent/.test(ds)) { out[String(f.id)] = '1'; continue; }
        // Lo que quede: la primera opción si el esquema la trae, si no un texto plausible.
        const opciones = f.options ?? [];
        out[String(f.id)] = opciones.length ? String(opciones[0].key ?? opciones[0].value ?? opciones[0].id) : `H${Date.now() % 100000000}`;
    }
    return out;
}

// ─── FASE 1: la ida, hasta el formulario del vehículo ────────────────────────────────────────────
let n = 0;
async function llegarHastaElFormulario(etiqueta: string): Promise<Punto> {
    n += 1;
    const semilla = Number(`9${String(Date.now()).slice(-8)}${n}`);
    // El de la lista si lo dieron; si no, uno derivado del país del comercio. `n` arranca en 1.
    const tel = TELS[n - 1] ?? (TELS.length ? TELS[TELS.length - 1] : await telefonoDeLaSucursal(br!.hash, semilla));
    /* El documento del usuario si ya existe. Un cliente que ya pasó por acá tiene el suyo, y mandarle
       otro es pedirle al backend que cambie la identidad de una persona en medio del flujo. Los
       `TEMP-…` no cuentan: son el marcador de «todavía no completó datos». */
    const yaEsta = await one<{ document_number: string }>(
        'SELECT document_number FROM users WHERE cell_phone=? ORDER BY id DESC LIMIT 1', [tel]).catch(() => null);
    const previo = yaEsta?.document_number ?? '';
    const doc = /^\d+$/.test(previo) ? previo : String(80000000 + (Date.now() % 9000000) + n).slice(0, 8);
    const s = new SesionFront(BASE_FE);
    linea(`\n  ── ${etiqueta} · tel ${tel} · ${DOC_TIPO} ${doc} ──`);

    const paso = async (r: string, form: any, que: string, json = false) => {
        const acc = json ? await s.enviarJson(r, form) : await s.enviar(r, form);
        const err = acc.cuerpo?.error ?? acc.datos?.error ?? acc.cuerpo?.data?.error;
        if (acc.redirect) { linea(`      ${gris('→')} ${que.padEnd(26)} ${gris('→')} ${c(conQuery(acc.redirect), 36)}`); return acc.redirect; }
        throw new Error(`${que}: no redirigió · ${err ? JSON.stringify(err) : JSON.stringify(acc.cuerpo ?? acc.crudo).slice(0, 260)}`);
    };

    /* PREFLIGHT, y no es de más: si el wizard apunta a OTRO backend, el payload del comercio se
     * rechaza y la pantalla degrada a `country: null` — el registro se cae después con «Ocurrió un
     * error», que se lee como un problema del caso y es del ambiente. Pasa seguido porque `bin/asesor`
     * deja el :5174 apuntando al target de la última corrida. */
    const entrada = await s.cargar(`${base}/solicitar?amount=${MONTO}`);
    if (!entrada.datos?.country) {
        throw new Error(`el front de ${BASE_FE} no resuelve este comercio (country: null): está apuntando a OTRO backend.`
            + `\n   Levantá uno contra local:  cd <frontend-monorepo>/apps/loan-request-wizard && VITE_API_URL=http://localhost`
            + ` VITE_FORM_SERVICE_BASE_URL=http://localhost:8109 VITE_BCP_VEHICLE_FORM_TYPE_ID=8`
            + ` VITE_PREAPPROVALS_ENDPOINT=http://localhost:8095/v1/preapprovals/check ./node_modules/.bin/react-router dev --port 5176`
            + `\n   y volvé con  --front http://localhost:5176`);
    }
    let r = await paso(`${base}/solicitar?amount=${MONTO}`, { phoneNumber: tel, amount: MONTO }, 'celular');
    await s.cargar(r);
    r = await paso(r, { otp: tel.slice(-4), amount: MONTO, original_amount: MONTO }, 'OTP');

    const ur = Number(r.match(/\/(\d+)\//)?.[1]);
    if (!ur) throw new Error(`no pude sacar la solicitud de ${r}`);

    // El resto del onboarding, siguiendo SÓLO las redirecciones que la app emite.
    for (let i = 0; i < 8; i++) {
        const hoja = ruta(r).split('?')[0].split('/').pop();
        if (hoja === 'pre' || hoja === 'post' || r.includes('/entidad/') || hoja === 'lenders') break;
        const res = await s.cargar(r);
        if (res.status === 202 && res.redirect) { r = res.redirect; continue; }
        if (hoja === 'personal-info') {
            r = await paso(r, {
                intent: 'save-personal-info', documentType: DOC_TIPO, documentNumber: doc,
                name: 'CARLOS', surname: 'RUIZ', email: `qa${doc}@gmail.com`, address: 'Av Larco 123', stratum: '3',
                issueDay: '10', issueMonth: '5', issueYear: '2019', birthDay: '10', birthMonth: '5', birthYear: '1995',
            }, 'datos personales');
        } else if (hoja === 'employment-info') {
            r = await paso(r, { employmentStatus: 'Empleado', monthlyIncome: '9000' }, 'datos laborales');
        } else {
            throw new Error(`pantalla que este runner no sabe pasar: ${ruta(r)} (HTTP ${res.status})`);
        }
    }
    linea(`      ${ok('•')} solicitud ${c(String(ur), 1)} · el funnel me dejó en ${c(ruta(r), 36)}`);
    return { s, ur, tel, doc };
}

// ─── el recorrido, con los experimentos intercalados ─────────────────────────────────────────────
const A = await llegarHastaElFormulario('RECORRIDO A — la ida completa');
const { s, ur } = A;

// 1) el formulario del vehículo
const rPre = `${base}/${ur}/formulario/pre?amount=${MONTO}`;
const pre = await s.cargar(rPre);
if (pre.status !== 200) throw new Error(`formulario/pre no abre: HTTP ${pre.status} ${String(pre.crudo).slice(0, 200)}`);
const respuestas = respuestasDelVehiculo(pre.datos, MONTO, CUOTA_INICIAL, BONO);
linea(`\n  ① formulario del vehículo (form_type 8) — ${Object.keys(respuestas).length} campos: ${gris(JSON.stringify(respuestas))}`);

await volverA(s, `${base}/${ur}/personal-info?amount=${MONTO}`, '¿puedo volver a los datos personales?');

const gPre = await s.enviarJson(rPre, { answers: respuestas });
if (!gPre.redirect) throw new Error(`guardar el formulario del vehículo no redirigió: ${JSON.stringify(gPre.cuerpo).slice(0, 300)}`);
linea(`      ${gris('→')} ${'guardado'.padEnd(26)} ${gris('→')} ${c(conQuery(gPre.redirect), 36)}`);
const montoTrasPre = new URL(gPre.redirect, 'http://x').searchParams.get('amount');
linea(`      ${montoTrasPre === String(MONTO - CUOTA_INICIAL - BONO) ? ok('✓') : ojo('⚠')} el monto que sigue viaja en la URL: ${c(String(montoTrasPre), 1)} ${gris(`(el del vehículo era ${MONTO})`)}`);

// 2) el simulador
const rSim = gPre.redirect;
const sim = await s.cargar(rSim);
linea(`\n  ② simulador embebido — ${sim.status === 200 ? ok('abre') : mal(`HTTP ${sim.status}`)} · prellenado: ${sim.datos?.diagnostics?.prefilled ? ok('sí') : ojo('no')} ${gris(JSON.stringify({ vehicleValue: sim.datos?.diagnostics?.vehicleValue, financingAmount: sim.datos?.diagnostics?.financingAmount }))}`);
await volverA(s, rPre, '¿puedo volver a corregir el vehículo ANTES de simular?');

// 3) el gate manual
const rRes = `${base}/${ur}/entidad/resultado?amount=${montoTrasPre}`;
await s.cargar(rRes);
const decision = await s.enviar(rRes, { decision: 'approved' });
if (!decision.redirect) throw new Error(`el gate no redirigió: ${JSON.stringify(decision.cuerpo).slice(0, 300)}`);
linea(`\n  ③ gate manual «¿tiene oferta preaprobada?» → Aprobado ${gris('→')} ${c(conQuery(decision.redirect), 36)}`);

linea(`\n  ${c('LOS EXPERIMENTOS DE «ATRÁS», ya pasado el gate', 1)}`);
await volverA(s, rPre, '¿puedo corregir el vehículo DESPUÉS de simular?');
await volverA(s, rSim, '¿puedo volver a simular?');
await volverA(s, `${base}/${ur}/personal-info?amount=${montoTrasPre}`, '¿puedo volver a los datos personales?');

// 4) el formulario posterior
const rPost = decision.redirect;
const post = await s.cargar(rPost);
let rLenders = `${base}/${ur}/lenders?amount=${montoTrasPre}`;
if (post.status === 200 && ruta(rPost).includes('formulario/post')) {
    const rp = respuestasDelVehiculo(post.datos, MONTO, CUOTA_INICIAL, BONO);
    linea(`\n  ④ formulario posterior (form_type 9) — ${Object.keys(rp).length} campos`);
    const gPost = await s.enviarJson(rPost, { answers: rp });
    if (!gPost.redirect) throw new Error(`guardar el posterior no redirigió: ${JSON.stringify(gPost.cuerpo).slice(0, 300)}`);
    linea(`      ${gris('→')} ${'guardado'.padEnd(26)} ${gris('→')} ${c(conQuery(gPost.redirect), 36)}`);
    rLenders = gPost.redirect;
    await volverA(s, rPost, '¿puedo volver a editar chasis y motor?');
    await volverA(s, rPre, '¿y el formulario del vehículo, desde acá?');
}

// 5) el marketplace, y EL MONTO
linea(`\n  ⑤ marketplace`);
const conMonto = await s.cargar(rLenders);
const lo1 = conMonto.datos?.loanOptionsPromise;
const sinMonto = await s.cargar(`${base}/${ur}/lenders`);
const lo2 = sinMonto.datos?.loanOptionsPromise;
const idsDe = (lo: any) => Array.isArray(lo?.loan_options) ? lo.loan_options.map((x: any) => x.id).join(', ') : `— (${lo?.__rechazada ? 'promesa rechazada' : 'pendiente'})`;
/* EL NÚMERO QUE DECIDE ES `requestedAmount`, no el `calculated` que devuelve el backend.
 *
 * Costó una vuelta entenderlo: `calculated` es el eco del backend, y lo consume sólo el reprecio de
 * renting/RTO. Lo que la pantalla muestra lo calcula el CLIENTE con `CalculateLoanFinancialsUc` sobre
 * `qsAmount > 0 ? qsAmount : requestedAmount`, así que medir `calculated` contestaba otra pregunta —y
 * daba «oferta distinta» con la pantalla ya arreglada—.
 *
 * Se imprime igual, porque su diferencia sí dice algo: sin monto en la URL el backend contesta con un
 * número propio que no es ninguno de los dos de la solicitud. */
const ecoDelBackend = (lo: any, id: number) => {
    const l = (lo?.loan_options ?? []).find((x: any) => Number(x.id) === id);
    const cal = l?.credit_lines?.calculated ?? l?.calculated ?? null;
    return cal ? JSON.stringify(cal).slice(0, 120) : gris('sin `calculated`');
};
linea(`      con ?amount=${montoTrasPre}  → entidades [${idsDe(lo1)}] · requestedAmount ${c(String(lo1?.requestedAmount), 1)} ${gris(`· eco del backend ${ecoDelBackend(lo1, 207)}`)}`);
linea(`      SIN  ?amount           → entidades [${idsDe(lo2)}] · requestedAmount ${c(String(lo2?.requestedAmount), 1)} ${gris(`· eco del backend ${ecoDelBackend(lo2, 207)}`)}`);
const esperado = String(MONTO - CUOTA_INICIAL - BONO);
const igual = String(lo1?.requestedAmount) === String(lo2?.requestedAmount);
const bien = igual && String(lo1?.requestedAmount) === esperado;
linea(`      ${bien ? ok('✓') : mal('✗')} ${bien
    ? `el mismo monto por los dos caminos, y es el financiado (${esperado})`
    : (igual ? `el mismo monto por los dos caminos, pero NO es el financiado (${esperado})` : 'MONTO DISTINTO según venga o no la query')} ${gris('— la pantalla cotiza sobre `qsAmount > 0 ? qsAmount : requestedAmount`')}`);

// 6) la sesión perdida: otro navegador, la misma solicitud
linea(`\n  ⑥ el asesor cambia de equipo (sesión nueva, misma solicitud ${ur})`);
const s2 = new SesionFront(BASE_FE);
for (const r of [`${base}/${ur}/formulario/post?amount=${montoTrasPre}`, `${base}/${ur}/formulario/pre?amount=${montoTrasPre}`]) {
    const { txt } = await mirar(s2, r);
    linea(`      ${ruta(r).padEnd(26)} ${txt}`);
}

// ─── ⑦ CORREGIR EL VEHÍCULO DESPUÉS DEL GATE ────────────────────────────────────────────────────
// Que la pantalla se SIRVA no dice nada sobre qué pasa al guardarla. Lo que importa es si el funnel
// entiende que la simulación anterior ya no vale: se hizo con otro vehículo y otro monto.
linea(`\n  ⑦ corregir el vehículo pasado el gate — ¿el funnel vuelve a exigir la simulación?`);
const NUEVO_VALOR = MONTO + 15000;
const preOtraVez = await s.cargar(rPre);
if (preOtraVez.status !== 200) {
    linea(`      ${mal('✗')} formulario/pre no abre (HTTP ${preOtraVez.status}): no se puede corregir`);
} else {
    const corregido = await s.enviarJson(rPre, {
        answers: respuestasDelVehiculo(preOtraVez.datos, NUEVO_VALOR, CUOTA_INICIAL, BONO),
    });
    const destino = corregido.redirect ?? '—';
    const vuelveASimular = /entidad\/simulador/.test(destino);
    const montoNuevo = corregido.redirect ? new URL(corregido.redirect, 'http://x').searchParams.get('amount') : null;
    const esperado = String(NUEVO_VALOR - CUOTA_INICIAL - BONO);
    linea(`      guardo el vehículo en ${NUEVO_VALOR} ${gris('→')} ${c(conQuery(destino), 36)}`);
    linea(`      ${vuelveASimular ? ok('✓') : mal('✗')} ${vuelveASimular
        ? 'vuelve al simulador: la simulación vieja quedó invalidada'
        : 'NO vuelve al simulador — la decisión del gate sigue en pie sobre datos que cambiaron'}`);
    linea(`      ${montoNuevo === esperado ? ok('✓') : mal('✗')} el monto que sigue es ${c(String(montoNuevo), 1)} ${gris(`(esperado ${esperado})`)}`);
    const enBase = await one<{ amount: number; original_amount: number }>(
        'SELECT amount, original_amount FROM user_requests WHERE id=?', [ur]);
    const bienEnBase = String(Number(enBase?.amount)) === esperado;
    linea(`      ${bienEnBase ? ok('✓') : mal('✗')} la BD dice amount ${c(String(enBase?.amount), 1)} · original_amount ${enBase?.original_amount} ${gris(`(esperado ${esperado} / ${NUEVO_VALOR})`)}`);
}

// ─── RECORRIDO B: el gate, dos veces ─────────────────────────────────────────────────────────────
if (!NIEGA) {
    linea(`\n  ${c('RECORRIDO B — volver al gate y cambiar de opinión', 1)}  ${ojo('OMITIDO')}`);
    linea(`      ${gris(`deja una solicitud NEGADA, y «${TARGET}» es una base compartida. Para correrlo: --niega`)}`);
    linea();
    await close();
    process.exit(0);
}
linea(`\n  ${c('RECORRIDO B — volver al gate y cambiar de opinión', 1)}${TARGET === 'local' ? '' : ojo('  ⚠ deja una solicitud NEGADA')}`);
const B = await llegarHastaElFormulario('RECORRIDO B');
const rPreB = `${base}/${B.ur}/formulario/pre?amount=${MONTO}`;
const preB = await B.s.cargar(rPreB);
const gB = await B.s.enviarJson(rPreB, { answers: respuestasDelVehiculo(preB.datos, MONTO, CUOTA_INICIAL, BONO) });
const montoB = new URL(gB.redirect!, 'http://x').searchParams.get('amount');
const rResB = `${base}/${B.ur}/entidad/resultado?amount=${montoB}`;
await B.s.cargar(rResB);
const ap = await B.s.enviar(rResB, { decision: 'approved' });
linea(`      Aprobado  ${gris('→')} ${c(conQuery(ap.redirect ?? '—'), 36)}`);
const estadoTrasAprobar = await one<{ st: number }>('SELECT user_request_status_id st FROM user_requests WHERE id=?', [B.ur]);
linea(`      BD tras aprobar: estado ${c(String(estadoTrasAprobar?.st), 1)}`);
const rech = await B.s.enviar(rResB, { decision: 'rejected' });
linea(`      ${ojo('↩ vuelvo al gate y ahora marco Rechazado')}  ${gris('→')} ${c(conQuery(rech.redirect ?? '—'), 36)}`);
const estadoTrasRechazar = await one<{ st: number }>('SELECT user_request_status_id st FROM user_requests WHERE id=?', [B.ur]);
linea(`      BD tras rechazar: estado ${c(String(estadoTrasRechazar?.st), 1)} ${estadoTrasRechazar?.st !== estadoTrasAprobar?.st ? mal('← el gate se puede volver a apretar y MATA la solicitud ya aprobada') : gris('(sin cambio)')}`);

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
linea(`\n  ${c('RECORRIDO C — rechazar, y volver al gate', 1)}${TARGET === 'local' ? '' : ojo('  ⚠ deja una solicitud NEGADA')}`);
const C = await llegarHastaElFormulario('RECORRIDO C');
const rPreC = `${base}/${C.ur}/formulario/pre?amount=${MONTO}`;
const preC = await C.s.cargar(rPreC);
const gC = await C.s.enviarJson(rPreC, { answers: respuestasDelVehiculo(preC.datos, MONTO, CUOTA_INICIAL, BONO) });
const montoC = new URL(gC.redirect!, 'http://x').searchParams.get('amount');
const rResC = `${base}/${C.ur}/entidad/resultado?amount=${montoC}`;
await C.s.cargar(rResC);

const rechC = await C.s.enviar(rResC, { decision: 'rejected' });
linea(`      Rechazado ${gris('→')} ${c(conQuery(rechC.redirect ?? '—'), 36)}`);
const estadoTrasRechazarC = await one<{ st: number }>('SELECT user_request_status_id st FROM user_requests WHERE id=?', [C.ur]);
linea(`      BD tras rechazar: estado ${c(String(estadoTrasRechazarC?.st), 1)} ${estadoTrasRechazarC?.st === 6 ? gris('(6 = Negada, como debe)') : mal('← se esperaba 6 (Negada)')}`);

/* El «atrás» del navegador: revalida el loader por su endpoint `.data`. Acá la solicitud ya está
   cerrada, así que servir la pantalla del gate sería volver a ofrecer una decisión sobre un crédito
   que no existe. */
const vueltaC = await mirar(C.s, rResC);
const destinoVuelta = vueltaC.destino ?? '(la SIRVE)';
const vaARetorno = destinoVuelta.includes('/entidad/retorno');
linea(`      ↩ ${gris('atrás al gate')}  ${gris('→')} ${c(conQuery(destinoVuelta), 36)}  ${vaARetorno ? ok('✓ a la pantalla de retorno') : mal('✗ debería ir a la pantalla de retorno: la solicitud está cerrada')}`);

/* Y el POST directo, que es quien llama a la ruta sin pasar por la pantalla: la guarda del `action`
   tiene que contestar lo mismo que la del `loader`, o el asesor ve una cosa y la ruta hace otra. */
const reintentoC = await C.s.enviar(rResC, { decision: 'approved' });
const destinoReintento = reintentoC.redirect ?? '(sin redirect)';
const reintentoARetorno = destinoReintento.includes('/entidad/retorno');
linea(`      ${ojo('↩ y ahora POSTEO «Aprobado» sobre la solicitud rechazada')}  ${gris('→')} ${c(conQuery(destinoReintento), 36)}  ${reintentoARetorno ? ok('✓ no la revive') : mal('✗ el rechazo se puede deshacer posteando')}`);
const estadoFinalC = await one<{ st: number }>('SELECT user_request_status_id st FROM user_requests WHERE id=?', [C.ur]);
linea(`      BD al final: estado ${c(String(estadoFinalC?.st), 1)} ${estadoFinalC?.st === estadoTrasRechazarC?.st ? gris('(sin cambio)') : mal('← el estado se movió')}`);

// ─── el rastro que quedó ─────────────────────────────────────────────────────────────────────────
linea(`\n  ${c('EL RASTRO', 1)}`);
const guardadas = TARGET !== 'local' ? null : await fetch('http://localhost:8109/_estado').then((r) => r.json()).catch(() => null) as any;
if (guardadas) linea(`      form-service (mock): ${guardadas.guardadas.map((g: any) => `${g.clave}→${g.campos} campos`).join(' · ')}`);
for (const id of [ur, B.ur, C.ur]) {
    const f = await one<{ st: number; amount: number }>('SELECT user_request_status_id st, amount FROM user_requests WHERE id=?', [id]);
    linea(`      solicitud ${id}: estado ${f?.st} · amount ${f?.amount} ${gris(`(el vehículo valía ${MONTO}; a financiar ${MONTO - CUOTA_INICIAL - BONO})`)}`);
}
linea();
await close();
