// El mock de centrales de riesgo (Agildata, Experian…): se le DICTA qué contestar para una cédula.
//
// Lo comparten los dos runners que recorren el flujo real —`dev/case.ts` y `dev/walk-wizard.ts`—, y por
// eso vive acá y no en ninguno de los dos: hasta el 2026-09-25 estaba sólo en `case.ts`, y el caminador
// dejaba que el mock contestara su default para una cédula desconocida —una persona sin empleo—, así
// que el cliente caía en la categoría de la entidad que exige cuota inicial y la corrida no cerraba.


// La lambda de mocks de la empresa. Su `enableAdminApi: true` es TODO el mecanismo: se le PIDE de
// antemano qué tiene que contestar para una cédula (`POST /mockoon-admin/global-vars`) y después el
// flujo corre normal. No hace falta ningún fixture: la respuesta se pide, no se inyecta.
// ⚠ POR DEFECTO, EL MOCK LOCAL — no el lambda de la empresa. El lambda hace lo mismo pero es
// infraestructura de OTRO: a mitad de sesión lo redesplegaron, dejó de honrar lo dictado y empezó a
// devolver datos aleatorios con períodos viejos (F-149). Y además es serverless, así que dictar en
// paralelo pierde escrituras (F-139). El local es un proceso, responde en milisegundos y el estado es
// compartido. Mismo contrato: para volver al lambda alcanza con `RISK_LAMBDA_URL=<su url>`.
export const LAMBDA = process.env.RISK_LAMBDA_URL ?? 'http://localhost:8105';

/** Le dicta a la lambda qué contesta cada central PARA ESA CÉDULA. Es el paso que vuelve el caso
 *  hipotético: se pide de antemano la respuesta que se quiere recibir. */
/** ⚠ LEE DESPUÉS DE ESCRIBIR, y reintenta. La lambda es serverless y sus global-vars viven en la
 *  MEMORIA DEL CONTAINER: el POST puede caer en un contenedor y la lectura del backend en otro, y
 *  entonces se sirve la respuesta POR DEFECTO como si nada. No es sólo un problema de concurrencia
 *  —medido el 2026-08-18 con UN caso solo— y el síntoma no se parece a la causa: la default trae
 *  períodos de hace diez meses, así que el backend calcula `employed: false` y `personal-info`
 *  responde `ONB004 laboral information is required`. Uno sale a buscar por qué el comercio pide
 *  información laboral y el problema es que el buró nunca contestó lo que se le pidió.
 *
 *  Confirmar cuesta una petición y convierte un fallo intermitente en uno que no ocurre. */
export async function confirmDictation(doc: string, central: string, expected: string): Promise<boolean> {
    const paths: Record<string, string> = {
        agildata: `/agildata/agildata-services/rest/afiliado/historicoDetalladoEmpleo/1/${doc}`,
    };
    const path = paths[central];
    if (!path) return true;                       // sin ruta conocida no se puede confirmar: no se bloquea
    const r = await fetch(`${LAMBDA}${path}`, { signal: AbortSignal.timeout(15_000) }).catch(() => null);
    if (!r?.ok) return false;
    return (await r.text()).includes(expected);
}

export async function dictate(doc: string, central: string, value: unknown): Promise<boolean> {
    // ⚠ Mockoon NO valida el JSON que se le dicta: lo emite tal cual con 200, y un JSON roto se lee
    // después como «respuesta inválida del proveedor». Se serializa acá y se falla acá si no es válido.
    const v = typeof value === 'string' ? value : JSON.stringify(value);
    try { JSON.parse(v); } catch { return false; }
    const r = await fetch(`${LAMBDA}/mockoon-admin/global-vars`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: `${central}_${doc}`, value: v }),
        signal: AbortSignal.timeout(25_000),
    }).catch(() => null);
    return !!r?.ok;
}

/** La respuesta que se le pide a la central para este caso. El ingreso del caso se vuelve el `ibc`
 *  (Ingreso Base de Cotización) de los pagos: el backend NO lo recibe inyectado, lo descubre
 *  consultando. Se emiten 8 períodos para que las reglas de continuidad (3/6/12 meses) tengan de
 *  dónde calcular — con menos, «no continuo» sería un artefacto del mock y no del caso planteado. */
/** ⚠ LA OCUPACIÓN NO SE INYECTA: SE DEDUCE DE ESTE PAYLOAD, y de una comparación de nombres.
 *
 *  `AgildataService::validateContractType` compara el nombre del EMPLEADOR contra el de la persona —los
 *  dos salen de esta misma respuesta— y si coinciden devuelve `2` (**Independiente**); si no, `1`
 *  (**Empleado**). Tiene sentido de negocio: quien se cotiza a sí mismo es independiente.
 *
 *  Y esto NO es un detalle de laboratorio: la regla de Credifamilia exige `ocupación = Independiente`,
 *  así que con el empleador por defecto esa entidad **nunca sale en el listado** — y el síntoma es una
 *  ausencia silenciosa, no un rechazo visible. */
export function agildataAnswer(doc: string, ibc: number, occupation?: string, periods = 8) {
    // ⚠ EL PERÍODO ES `YYYYMM` Y NO SE PUEDE RESTAR COMO ENTERO. `202603 - k` parece razonable y a
    // partir del cuarto pago da 202599, 202598… meses que no existen. El backend calcula la
    // continuidad (3/6/12 meses) contando períodos, así que con basura ahí devuelve `employed: false`,
    // continuidad en cero y `approximate_real_salary: 0` — el ingreso llega y NO SIRVE. El caso que
    // uno creyó plantar («alguien que gana 15M») termina siendo «alguien sin empleo», y el listado no
    // cambia por la razón equivocada.
    const payments = Array.from({ length: periods }, (_, k) => {
        // ⚠ RELATIVO A HOY, no a una fecha fija. `validateContractType` compara el último período
        // contra la fecha de la solicitud: una serie que termina hace cinco meses da `employed:false`
        // por vieja, no por el caso que se quiso plantear. Una fecha horneada acá envejece sola y
        // rompe el runner en silencio unos meses después.
        const today = new Date();
        const months = today.getFullYear() * 12 + today.getMonth() - k;
        const [y, m] = [Math.floor(months / 12), (months % 12) + 1];
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
                id: 1, pagos: payments,
                // Empleador = la persona → Independiente. Distinto → Empleado. Ver la cabecera.
                nombreEmpleador: String(occupation ?? '').toLowerCase() === 'independiente'
                    ? 'CARLOS RUIZ MENDOZA'
                    : 'STANGERSON SAS',
                telefonoEmpleador: null,
                direccionEmpleador: null, identifiacionEmpleador: '900101010',
                tipoIdentifiacionEmpleador: 'NI' }],
        },
    };
}

/**
 * Le dicta a Agildata un empleo PARA ESA CÉDULA y confirma que quedó, con hasta 4 intentos.
 *
 * ⚠ HAY QUE HACERLO ANTES DE ENVIAR `personal-info`: es al enviarlo que el backend consulta la central
 * y escribe ocupación, ingreso y continuidad con lo que conteste. Reponer esos campos después no
 * alcanza, porque el perfilamiento ya evaluó las categorías con la respuesta del mock.
 */
export async function dictateEmployment(doc: string, income: number, occupation?: string, periods = 8): Promise<boolean> {
    for (let attempt = 0; attempt < 4; attempt++) {
        await dictate(doc, 'agildata', agildataAnswer(doc, income, occupation, periods));
        if (await confirmDictation(doc, 'agildata', String(income))) return true;
    }
    return false;
}

/** Lo que se le puede pedir al reporte de Experian para una cédula. Cada campo es opcional. */
export interface BureauProfile {
    score?: number;
    consultedLast6Months?: number;
    /** Cuántas tarjetas de crédito ACTIVAS trae el reporte. */
    creditCards?: number;
    negativeHistoricalLast12Months?: number;
    /** La mora actual: la que mira el criterio de moras vigentes de cada categoría. */
    currentNegativeCredits?: number;
    /** Desde cuándo está en el sector financiero, `YYYY-MM-DD`. */
    maturationSince?: string;
    /** QUANTO: el ingreso mensual estimado (en pesos). 0 = Quanto no estima, y el backend no pisa el ingreso. */
    quantoIncome?: number;
}

/**
 * Le dicta a Experian un perfil de buró PARA ESA CÉDULA: score, consultas de seis meses y tarjetas.
 *
 * ⚠ Sólo lo entiende el mock LOCAL (`mock-bureaus/server.mjs`, clave `experian_profile_<cédula>`): el
 * lambda de la empresa no tiene esa clave y contestaría su reporte de siempre. Su reporte fijo trae score
 * 654, 59 consultas y ninguna tarjeta, que es un cliente que no entra en la categoría de mejores
 * condiciones de ninguna entidad que las pida.
 */
export async function dictateBureauProfile(doc: string, profile: BureauProfile): Promise<boolean> {
    return dictate(doc, 'experian_profile', profile);
}

/** El caso del panel, tal como lo dicta `dictateCase`. */
export interface DictatedCase {
    income: number; occupation?: string;
    score: number; negatives: number; delinquencies: number; consulted: number; maturationSince: string;
}

/**
 * Le dicta al mock el caso ENTERO del panel —empleo e ingreso a Agildata, el perfil de buró a Experian—
 * para que la consulta real que hace el backend durante el flujo conteste lo mismo que el panel inyecta.
 *
 * ⚠ Sin esto, «Buró inyectado» no gobernaba la categoría: al enviar `personal-info` el backend consulta
 * las centrales y guarda lo que contesten, y el motor de categorías evalúa con ESO. Medido el 2026-09-25
 * en una corrida del panel (cédula 2927492104): el motor puso las cuatro entidades de Motai en «Recuperar
 * mejores» con el reporte fijo del mock (score 654, 59 consultas, sin tarjetas) cuando el caso decía score
 * 700 — la predicción del panel era Premium.
 *
 * Trece períodos de Agildata, no ocho: la continuidad de 12 meses (la que el panel asume) necesita un año
 * entero de pagos. Una tarjeta activa con vector, como la que forja la inyección.
 */
export async function dictateCase(doc: string, c: DictatedCase): Promise<{ employment: boolean; bureau: boolean }> {
    const employment = await dictateEmployment(doc, c.income, c.occupation, 13);
    const bureau = await dictateBureauProfile(doc, {
        score: c.score, consultedLast6Months: c.consulted, creditCards: 1,
        negativeHistoricalLast12Months: c.negatives, currentNegativeCredits: c.delinquencies,
        maturationSince: c.maturationSince,
    });
    return { employment, bureau };
}


/* ── LOS TRES ESTADOS DE UNA CENTRAL (la pestaña «Burós» del panel) ─────────────────────────────────────
 * Para probar la CASCADA de identidad y empleo —Agildata → Mareigua → TusDatos, que corta en la primera que
 * resuelve (legacy-backend `Modules/Backoffice/App/Services/UsersService.php:313`)— cada central puede:
 *   · `ok`    responder: Agildata con el ingreso y la ocupación del caso; las demás con su default del mock;
 *   · `empty` contestar 200 «sin información»: la cascada pasa a la siguiente;
 *   · `fail`  caerse (HTTP 500): un fallo técnico, que es OTRA rama del backend.
 * «Sin información» usa las respuestas REALES del lambda de mocks, copiadas por el backend en
 * `Modules/Identity/tests/Fixtures/lambda-riskservices.json`: Agildata `codRespuesta: "02"` (el backend sólo
 * acepta 01 y 21) y Mareigua `respuesta_id: 2` (sólo acepta 4). TusDatos y Experian no tienen una forma
 * verificada de «sin información», así que para ellas ese estado no se ofrece. Todo es POR CÉDULA. */
export type BureauMode = 'ok' | 'empty' | 'fail';
export const BUREAUS = ['agildata', 'mareigua', 'tusdatos', 'experian'] as const;
export type Bureau = typeof BUREAUS[number];

const NO_INFO: Partial<Record<Bureau, (doc: string) => unknown>> = {
    agildata: () => ({ usuario: null, respuesta: null, codConsulta: '10000000000000000', codRespuesta: '02',
        observaciones: 'No se encontró información del afiliado.' }),
    mareigua: (doc) => ({ fecha: new Date().toISOString().slice(0, 19), genero: '', aportantes: [], consulta_id: 1000000000,
        respuesta_id: 2, primer_nombre_persona_natural: '', segundo_nombre_persona_natural: '',
        primer_apellido_persona_natural: '', segundo_apellido_persona_natural: '',
        numero_identificacion_persona_natural: doc, tipo_identificacion_persona_natural_id: 1 }),
};
export const bureauSupports = (central: Bureau, mode: BureauMode): boolean => mode !== 'empty' || !!NO_INFO[central];

/** Mareigua con un ingreso y una cantidad de meses: la misma forma que el default del mock de burós, que es la
 *  del lambda (`respuesta_id: 4`, que es la única que el backend acepta). El ingreso va como media, mínimo y
 *  máximo del aportante y en cada pago. */
export function mareiguaAnswer(doc: string, income: number, months = 8) {
    const ibc = Math.round(income);
    return {
        respuesta_id: 4, consulta_id: 1916660000, genero: 'M',
        primer_nombre_persona_natural: 'CARLOS', segundo_nombre_persona_natural: '',
        primer_apellido_persona_natural: 'RUIZ', segundo_apellido_persona_natural: 'MENDOZA',
        numero_identificacion_persona_natural: doc, tipo_identificacion_persona_natural_id: 1,
        AFP: 'COLPENSIONES', EPS: 'COMPENSAR', servidor_publico: false,
        aportantes: [{
            nivel_riesgo: 'Bajo', media_ingresos: ibc, minimo: ibc, maximo: ibc, CIIU_aportante: '8412',
            regimen: '', tipo_contrato: '', fecha_ingreso: '',
            resultado_pagos: Array.from({ length: months }, () => ({
                ingresos: ibc, total_ingreso: ibc, ingreso_neto: ibc, realizo_pago: true, retefuente: 0,
                indemnizacion: 0, bonificaciones: 0, deducciones_ley: Math.round(ibc * 0.115), otras_deducciones: 0,
            })),
        }],
    };
}

/** Olvida lo dictado para esa central y esa cédula: vuelve a su default. */
export async function forgetDictation(doc: string, central: string): Promise<boolean> {
    const r = await fetch(`${LAMBDA}/mockoon-admin/global-vars/${encodeURIComponent(`${central}_${doc}`)}`,
        { method: 'DELETE', signal: AbortSignal.timeout(10_000) }).catch(() => null);
    return !!r?.ok;
}

/** Lo que contesta una central cuando RESPONDE: Agildata y Mareigua traen la información laboral (el backend
 *  guarda de ellas el ingreso y la ocupación de la solicitud, campos 87 y 29). Vacío = lo del caso. */
export interface BureauAnswer { income?: number; occupation?: string; months?: number }

export async function dictateBureauMode(doc: string, central: Bureau, mode: BureauMode,
    c: BureauAnswer = {}): Promise<{ ok: boolean; detalle: string }> {
    if (!doc) return { ok: false, detalle: 'el caso no tiene cédula' };
    if (!bureauSupports(central, mode)) return { ok: false, detalle: `${central} no tiene una respuesta «sin información» verificada` };
    let ok: boolean;
    if (mode === 'fail') ok = await dictate(doc, central, { __http_status: 500, __body: { error: 'falla simulada por el panel del harness' } });
    else if (mode === 'empty') ok = await dictate(doc, central, NO_INFO[central]!(doc));
    else if (central === 'agildata') ok = await dictate(doc, 'agildata', agildataAnswer(doc, c.income || 2_500_000, c.occupation, c.months || 8));
    else if (central === 'mareigua') ok = await dictate(doc, 'mareigua', mareiguaAnswer(doc, c.income || 2_500_000, c.months || 8));
    else ok = await forgetDictation(doc, central);
    const money = (n?: number) => '$' + Math.round(n || 2_500_000).toLocaleString('es-CO');
    const what = mode === 'fail' ? 'falla (HTTP 500)' : mode === 'empty' ? 'sin información'
        : central === 'agildata' ? `responde ${money(c.income)} · ${String(c.occupation || 'Empleado').toLowerCase()} · ${c.months || 8} meses`
        : central === 'mareigua' ? `responde ${money(c.income)} · ${c.months || 8} meses` : 'responde';
    return { ok, detalle: ok ? `${central}: ${what}` : `${central}: el mock de burós (${LAMBDA}) no tomó el dictado` };
}


/* ── LA CONFIGURACIÓN DE LOS BURÓS PARA UNA CÉDULA (panel y `bin/bureaus.ts`) ─────────────────────────────
 * Una sola fuente de VALORES POR DEFECTO, para que el panel y un agente que configura su prueba por consola
 * partan del mismo cliente: lo que no se dice queda como acá. Trece meses y no ocho: la continuidad de 12
 * meses necesita un año entero de pagos (ver `dictateCase`). Experian con una tarjeta activa, como la que
 * forja la inyección; su reporte fijo (score 654, 59 consultas, sin tarjetas) no entra en ninguna categoría
 * de mejores condiciones. */
export interface BureauConfig {
    agildata?: { mode?: BureauMode; income?: number; occupation?: string; months?: number };
    mareigua?: { mode?: BureauMode; income?: number; months?: number };
    tusdatos?: { mode?: BureauMode };
    experian?: { mode?: BureauMode; score?: number; negatives?: number; consulted?: number; delinquencies?: number; creditCards?: number; quantoIncome?: number };
}
export const BUREAU_DEFAULTS = {
    agildata: { mode: 'ok' as BureauMode, income: 2_500_000, occupation: 'Empleado', months: 13 },
    mareigua: { mode: 'ok' as BureauMode, income: 2_500_000, months: 13 },
    tusdatos: { mode: 'ok' as BureauMode },
    // Quanto en 0 por defecto: así el ingreso del cliente lo deciden Agildata y Mareigua, y Quanto sólo pisa cuando la
    // prueba lo pide (en el backend pisa el ingreso si el comercio dispara Experian: `experian_trigger_allieds`).
    experian: { mode: 'ok' as BureauMode, score: 700, negatives: 0, consulted: 1, delinquencies: 0, creditCards: 1, quantoIncome: 0 },
};
export type FullBureauConfig = typeof BUREAU_DEFAULTS;

/** La configuración completa: lo dicho encima de los valores por defecto (lo vacío o inválido no pisa). */
export function withBureauDefaults(cfg: BureauConfig = {}): FullBureauConfig {
    const out = structuredClone(BUREAU_DEFAULTS) as any;
    for (const c of BUREAUS) for (const [k, v] of Object.entries((cfg as any)[c] || {})) {
        if (v === undefined || v === null || v === '' || (typeof v === 'number' && !Number.isFinite(v))) continue;
        out[c][k] = v;
    }
    return out;
}

/** Aplica la configuración a una cédula: cada central contesta lo suyo. Devuelve una línea por central. */
export async function applyBureauConfig(doc: string, cfg: BureauConfig = {}): Promise<{ ok: boolean; config: FullBureauConfig; lines: string[] }> {
    const full = withBureauDefaults(cfg);
    const results = await Promise.all(BUREAUS.map(async (c) => {
        const r = await dictateBureauMode(doc, c, full[c].mode, full[c] as BureauAnswer);
        if (c !== 'experian' || full.experian.mode !== 'ok') return r;
        const e = full.experian;
        const ok = await dictateBureauProfile(doc, { score: e.score, consultedLast6Months: e.consulted, negativeHistoricalLast12Months: e.negatives,
            currentNegativeCredits: e.delinquencies, creditCards: e.creditCards, quantoIncome: e.quantoIncome });
        const quanto = e.quantoIncome > 0 ? `Quanto $${Math.round(e.quantoIncome).toLocaleString('es-CO')}` : 'Quanto sin estimación';
        return { ok: r.ok && ok, detalle: `experian: responde Acierta score ${e.score} · ${e.negatives} negativos · ${e.consulted} consultas · ${e.delinquencies} moras · ${quanto}` };
    }));
    return { ok: results.every((r) => r.ok), config: full, lines: results.map((r) => r.detalle) };
}

/** Qué contesta HOY cada central para esa cédula, leído del mock (no de lo que alguien cree que dictó). */
export async function readBureauConfig(doc: string): Promise<Record<string, string>> {
    const r = await fetch(`${LAMBDA}/mockoon-admin/global-vars`, { signal: AbortSignal.timeout(10_000) }).catch(() => null);
    if (!r?.ok) throw new Error(`el mock de burós no responde en ${LAMBDA} (make harness-bureaus)`);
    const all = await r.json() as Record<string, string>;
    const parse = (k: string) => { try { return k in all ? JSON.parse(all[k]) : undefined; } catch { return undefined; } };
    const money = (n: unknown) => '$' + Math.round(Number(n) || 0).toLocaleString('es-CO');
    const out: Record<string, string> = {};
    for (const c of BUREAUS) {
        const v = parse(`${c}_${doc}`);
        if (v === undefined) out[c] = c === 'agildata' || c === 'mareigua' ? 'sin dictar: contesta el default del mock' : 'responde (default del mock)';
        else if (v.__http_status) out[c] = `falla (HTTP ${v.__http_status})`;
        else if (c === 'agildata') out[c] = v.codRespuesta !== '01' ? `sin información (codRespuesta ${v.codRespuesta})`
            : `responde ${money(v.respuesta?.detalladoEmpleos?.[0]?.pagos?.[0]?.ibc)} · ${v.respuesta?.detalladoEmpleos?.[0]?.nombreEmpleador === v.respuesta?.datosBasicos?.nombre ? 'independiente' : 'empleado'} · ${v.respuesta?.detalladoEmpleos?.[0]?.pagos?.length ?? 0} meses`;
        else if (c === 'mareigua') out[c] = v.respuesta_id !== 4 ? `sin información (respuesta_id ${v.respuesta_id})`
            : `responde ${money(v.aportantes?.[0]?.media_ingresos)} · ${v.aportantes?.[0]?.resultado_pagos?.length ?? 0} meses`;
        else out[c] = 'dictado a mano';
    }
    const p = parse(`experian_profile_${doc}`);
    if (p && !out.experian.startsWith('falla')) out.experian = `responde Acierta score ${p.score ?? '654 (fijo)'} · ${p.negativeHistoricalLast12Months ?? '?'} negativos · ${p.consultedLast6Months ?? '?'} consultas · ${p.currentNegativeCredits ?? '?'} moras · `
        + (p.quantoIncome == null ? 'Quanto del mock ($2.320.000)' : Number(p.quantoIncome) > 0 ? `Quanto $${Math.round(Number(p.quantoIncome)).toLocaleString('es-CO')}` : 'Quanto sin estimación');
    return out;
}
