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
