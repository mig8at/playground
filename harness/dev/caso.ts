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
// Gotchas heredados, que acá aplican igual: `E2E_TARGET` default es dev → se fuerza local · UA de
// iPhone SIEMPRE (con UA de escritorio, 403) · en `main` sin `H2O_API_HOST` el listado da 500.

import { spawnSync } from 'node:child_process';

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
const LAMBDA = process.env.RISK_LAMBDA_URL
    ?? 'https://ub79ck0htd.execute-api.us-east-2.amazonaws.com/development';

// teléfonos ya tomados en ESTA corrida: dos casos en paralelo no pueden compartir uno
const usados = new Set<string>();

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
        if (k === 'amount' || k === 'income' || k === 'score') c[k] = Number(v);
    }
    return c;
}
type Res = {
    caso: Caso; ok: boolean; ur?: number; phone: string; nombre?: string;
    enListado?: boolean; listado?: number[]; conducta?: string; detalle?: string;
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
async function telefonoBypass(i: number): Promise<string | null> {
    const row = await one<{ value: string }>(
        "SELECT value FROM settings WHERE `key`='qa_otp_bypass_phones'").catch(() => null);
    const tels: string[] = JSON.parse(row?.value ?? '[]').map(String);
    for (const t of tels) {
        const n = await one<{ n: number }>('SELECT COUNT(*) AS n FROM users WHERE cell_phone=?', [t])
            .catch(() => null);
        if ((n?.n ?? 1) === 0 && !usados.has(t)) { usados.add(t); return t; }
    }
    // ⚠ Si no queda ninguno limpio, se RECICLA: cada corrida consume un teléfono (deja un usuario), y
    // los 64 del setting se agotan en unas decenas de casos. Se scrubbea SÓLO el que este caso va a
    // usar —nunca la lista entera— porque dos casos en paralelo borrándose usuarios entre sí es
    // exactamente el fallo que este runner existe para evitar.
    for (const t of tels) {
        if (usados.has(t)) continue;
        usados.add(t);
        spawnSync('node', ['bin/dbops.ts', 'scrubphone', t],
                  { cwd: new URL('..', import.meta.url).pathname });
        return t;
    }
    return null;
}

/** Le dicta a la lambda qué contesta cada central PARA ESA CÉDULA. Es el paso que vuelve el caso
 *  hipotético: se pide de antemano la respuesta que se quiere recibir. */
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
const BASE_DOC = 1090000000 + ((Date.now() / 100) % 9_000_000 | 0);
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
        const ok = await dictar(doc, 'agildata', respuestaAgildata(doc, casos[i].income!));
        if (ok) dictados.add(doc); else fallos.push(doc);
    }
    return fallos;
}

async function correrLambda(c: Caso, i: number): Promise<Res> {
    const doc = cedulaDe(i);
    const base: Res = { caso: c, ok: false, phone: '' };

    const tel = await telefonoBypass(i);
    if (!tel) return { ...base, detalle: 'no quedan teléfonos de bypass limpios' };
    base.phone = tel;

    const br = await one<{ hash: string; com: string }>(
        `SELECT b.hash, x.name AS com FROM allied_branches b JOIN allieds x ON x.id=b.allied_id
          WHERE x.name LIKE ?
          ORDER BY (SELECT COUNT(*) FROM lenders_by_allied_branches l WHERE l.allied_branch_id=b.id) DESC
          LIMIT 1`, [`%${c.comercio}%`]).catch(() => null);
    if (!br) return { ...base, detalle: `no encontré el comercio «${c.comercio}»` };

    if (!dictados.has(doc)) return { ...base, detalle: 'la respuesta del buró no quedó dictada' };

    const H = { 'content-type': 'application/json', accept: 'application/json', 'user-agent': UA };
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
    if (!reg.json?.data?.user?.id) return { ...base, detalle: `register HTTP ${reg.status}` };

    const otp = await post(`/api/onboarding/loan-application/otp-validate/${br.hash}`, {
        cell_phone: tel, otp_code: tel.slice(-4),
        original_amount: c.amount, amount: c.amount });
    // ⚠ el uReq viene en `errors.payload`, NO en `payload`: el usuario es temporal y la respuesta
    // llega como error `ONB002 "temporal user found"`. Es la trampa 3 del documento de la tarea.
    const ur = otp.json?.errors?.payload?.user_request_id ?? otp.json?.payload?.user_request_id;
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

    const lis = await fetch(`${API}/api/onboarding/loan-application/lenders/${ur}`, { headers: H })
        .then((r) => r.json()).catch(() => null);
    const crudo = lis?.data ?? lis;
    const arr: any[] = Array.isArray(crudo) ? crudo : Array.isArray(crudo?.lenders) ? crudo.lenders : [];
    base.listado = arr.map((x) => Number(x.id ?? x.lender_id)).filter(Boolean);
    return { ...base, ok: arr.length > 0, nombre: `doc ${doc}`,
             conducta: `listado con ${arr.length} entidades · buró dictado: ibc ${c.income!.toLocaleString('es-CO')}` };
}

async function correr(c: Caso, i: number): Promise<Res> {
    if (flag('lambda')) return correrLambda(c, i);
    const phone = telefono(i);
    const base: Res = { caso: c, ok: false, phone };

    const br = await one<{ b: number; a: number; hash: string; com: string }>(
        `SELECT b.id AS b, b.allied_id AS a, b.hash, x.name AS com
           FROM allied_branches b JOIN allieds x ON x.id=b.allied_id
          WHERE x.name LIKE ?
          ORDER BY (SELECT COUNT(*) FROM lenders_by_allied_branches l WHERE l.allied_branch_id=b.id) DESC
          LIMIT 1`, [`%${c.comercio}%`]).catch(() => null);
    if (!br) return { ...base, detalle: `no encontré el comercio «${c.comercio}»` };

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
        [uid, br.a, br.b, amount, amount, asesor]).catch(() => null);
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
    }
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
