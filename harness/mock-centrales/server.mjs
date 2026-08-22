// Mock LOCAL de las centrales de riesgo — el reemplazo del lambda de la empresa.
//
// POR QUÉ EXISTE (2026-08-18). El lambda de mocks (`risk-services-mockery-lambda`, un Mockoon en API
// Gateway) hace exactamente esto y andaba bien: se le dicta por cédula qué debe contestar cada
// central. Pero es **infraestructura de otro**, y a mitad de sesión lo redesplegaron con otra
// plantilla: dejó de honrar lo dictado, empezó a devolver nombres ALEATORIOS por petición, y sus
// períodos de cotización quedaron diez meses viejos —así que el backend calculaba `employed: false` y
// las solicitudes morían con `ONB004` (F-144). Encima es serverless: sus global-vars viven en la
// memoria del contenedor, de modo que dictar en paralelo pierde escrituras (F-139).
//
// Este server no tiene ninguno de los dos problemas: es UN proceso, el estado es compartido, dictar
// en paralelo es seguro, y responde en milisegundos en vez de cruzar a us-east-2.
//
// MISMO CONTRATO que el lambda, a propósito: quien lo consume no se entera del cambio.
//   POST   /mockoon-admin/global-vars   {"key":"agildata_<céd>","value":"<json como STRING>"}
//   GET    /mockoon-admin/global-vars   → lo dictado hasta ahora  (el lambda perdió esta ruta)
//   POST   /mockoon-admin/state/purge   → limpia todo
//
// Rutas de las centrales, sacadas de `app/Actions/RiskCentrals/*` y no de suponer:
//   GET  /agildata/agildata-services/rest/afiliado/historicoDetalladoEmpleo/{type}/{number}
//   POST /mareigua/consultas
//   POST /experian/cs/credit-history/v1/hdcplus[/quanto|/acierta-quanto]
//
// Uso:  node mock-centrales/server.mjs      env: MOCK_CENTRALES_PORT (8105 — 8095/8097-8104 ya los usan los otros mocks del harness)

import http from 'node:http';
import { readFileSync } from 'node:fs';

const PORT = Number(process.env.MOCK_CENTRALES_PORT || 8105);
const log = (...a) => console.log(new Date().toISOString(), ...a);
const json = (res, code, body) => {
    res.writeHead(code, { 'content-type': 'application/json' });
    res.end(typeof body === 'string' ? body : JSON.stringify(body));
};

/** Lo dictado, por clave `<central>_<cédula>`. En memoria y en UN proceso: sin el problema del
 *  lambda serverless, donde el POST y la lectura pueden caer en contenedores distintos. */
const dictado = new Map();

/** La cédula que viaja en cada petición. Cada central la manda a su manera — Agildata en la URL,
 *  Mareigua y Experian en el cuerpo — y por eso se resuelve acá y no en cada ruta. */
const cedulaDe = (url, body) => {
    const m = /historicoDetalladoEmpleo\/[^/]+\/(\d+)/.exec(url.pathname);
    if (m) return m[1];
    try {
        const b = JSON.parse(body || '{}');
        return String(b.numero_documento ?? b.documentNumber ?? b.document_number
            ?? b?.consumers?.[0]?.identityId ?? b.identification ?? '') || null;
    } catch { return null; }
};

/** ⚠ LOS PERÍODOS VAN RELATIVOS A HOY, y es la razón principal de que este archivo exista. El
 *  backend calcula la continuidad (3/6/12 meses) contando períodos `YYYYMM` contra la fecha de la
 *  solicitud: una serie que termina hace meses da `employed: false`, y entonces `personal-info`
 *  responde «laboral information is required» y la solicitud ni llega al listado. Una fecha horneada
 *  acá envejece sola y rompe el mock en silencio unos meses después — que es justo lo que le pasó al
 *  lambda. */
const pagos = (ibc, n = 8) => Array.from({ length: n }, (_, k) => {
    const hoy = new Date();
    const meses = hoy.getFullYear() * 12 + hoy.getMonth() - k;
    const [y, m] = [Math.floor(meses / 12), (meses % 12) + 1];
    const mm = String(m).padStart(2, '0');
    return {
        id: k + 1, ibc, periodo: Number(`${y}${mm}`), fechaPago: `${y}-${mm}-15 00:00:00`,
        diasCotizados: 30, valorCotizacionObligatoria: Math.round(ibc * 0.115),
    };
});

const IBC_DEFAULT = 2_500_000;

const agildataDefault = (doc) => ({
    usuario: null, codRespuesta: '01', observaciones: 'Consulta Exitosa.',
    codConsulta: 14744568681490196,
    respuesta: {
        type: 'aorg.asofondos.agildata.domain.AfiliadoDetalladoa', fechaVinculacion: null,
        datosBasicos: {
            edad: 25, type: 'org.asofondos.agildata.domain.AfiliadoDatosBasicos', genero: 'M',
            nombre: 'CARLOS RUIZ MENDOZA', tipoId: 'CC', numeroId: doc ?? '1001202010',
            viabilidad: null,
        },
        detalladoEmpleos: [{
            id: 1, pagos: pagos(IBC_DEFAULT), nombreEmpleador: 'STANGERSON SAS',
            telefonoEmpleador: null, direccionEmpleador: null,
            identifiacionEmpleador: '900101010', tipoIdentifiacionEmpleador: 'NI',
        }],
    },
});

const mareiguaDefault = (doc) => ({
    respuesta_id: 4, consulta_id: 1916660000, genero: 'M',
    primer_nombre_persona_natural: 'CARLOS', segundo_nombre_persona_natural: '',
    primer_apellido_persona_natural: 'RUIZ', segundo_apellido_persona_natural: 'MENDOZA',
    numero_identificacion_persona_natural: doc ?? '1001202010',
    tipo_identificacion_persona_natural_id: 1,
    AFP: 'COLPENSIONES', EPS: 'COMPENSAR', servidor_publico: false,
    aportantes: [{
        nivel_riesgo: 'Bajo', media_ingresos: IBC_DEFAULT, minimo: IBC_DEFAULT, maximo: IBC_DEFAULT,
        CIIU_aportante: '8412', regimen: '', tipo_contrato: '', fecha_ingreso: '',
        resultado_pagos: pagos(IBC_DEFAULT).map((p) => ({
            ingresos: p.ibc, total_ingreso: p.ibc, ingreso_neto: p.ibc, realizo_pago: true,
            retefuente: 0, indemnizacion: 0, bonificaciones: 0,
            deducciones_ley: p.valorCotizacionObligatoria, otras_deducciones: 0,
        })),
    }],
});

// ⚠ LOS PAYLOADS DE EXPERIAN SON LOS DEL REPO, no una forma inventada. La primera versión de este
// mock devolvía `{status, consumers:[{scores}]}` —plausible y falsa—: el backend no encontraba el
// score, la categoría rt=2 no se resolvía y CrediPullman DESAPARECÍA del listado sin mensaje. Salieron
// de `app/Actions/RiskCentrals/ExperianFixture.php`, que es lo que el propio backend usa como fixture,
// así que la forma está garantizada. ~70 KB cada uno.
//
// El score vive en `ReportHDCplus.models[0].scoreValue` (654 en el fixture) y se puede pisar dictando
// `experian_score_<cédula>` con un número — más cómodo que dictar 70 KB para cambiar un dato.
const leer = (f) => JSON.parse(readFileSync(new URL(f, import.meta.url), 'utf8'));
const EXPERIAN = {
    hdcplus: leer('./hdcplus.json'),
    quanto: leer('./quanto.json'),
    'acierta-quanto': leer('./acierta-quanto.json'),
};

const experianDefault = (doc, variante = 'hdcplus') => {
    const base = structuredClone(EXPERIAN[variante] ?? EXPERIAN.hdcplus);
    const pisado = doc && dictado.get(`experian_score_${doc}`);
    if (pisado && base?.ReportHDCplus?.models?.[0]) {
        base.ReportHDCplus.models[0].scoreValue = Number(pisado);
    }
    return base;
};

// TusDatos tiene DOS rutas y las dos hacen falta: sin la de AML el cierre rt=2 muere con
// «Error inesperado al crear validación de TusDatos AML» y la solicitud queda trabada en estado 10 —
// con el listado saliendo perfecto, así que el síntoma aparece tarde y lejos. La forma sale de
// `app/Actions/RiskCentrals/TusDatosFixture.php`.
const TUSDATOS = leer('./tusdatos-validations.json');

const RUTAS = [
    { central: 'agildata', test: (u, m) => m === 'GET' && /historicoDetalladoEmpleo/.test(u.pathname), def: agildataDefault },
    { central: 'mareigua', test: (u, m) => m === 'POST' && /\/consultas$/.test(u.pathname), def: mareiguaDefault },
    { central: 'experian',
      test: (u, m) => m === 'POST' && /hdcplus/.test(u.pathname),
      def: (doc, u) => experianDefault(doc, /acierta-quanto$/.test(u?.pathname ?? '') ? 'acierta-quanto'
                                          : /quanto$/.test(u?.pathname ?? '') ? 'quanto' : 'hdcplus') },
    { central: 'tusdatos', test: (u, m) => m === 'POST' && /\/identity\/validations$/.test(u.pathname),
      def: () => structuredClone(TUSDATOS) },
    { central: 'tusdatos', test: (u, m) => m === 'POST' && /\/launch\/verify\//.test(u.pathname),
      def: () => structuredClone(TUSDATOS) },
    { central: 'experian', test: (u, m) => m === 'POST' && /oauth2\/v1\/token$/.test(u.pathname),
      def: () => ({ access_token: 'MOCK-EXPERIAN-TOKEN', token_type: 'Bearer', expires_in: 3600 }) },
];

const server = http.createServer((req, res) => {
    const url = new URL(String(req.url).replace(/^\/{2,}/, '/'), `http://localhost:${PORT}`);
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
        if (req.method === 'GET' && url.pathname === '/') {
            return json(res, 200, { mock: 'centrales', port: PORT, dictados: dictado.size });
        }
        if (url.pathname === '/mockoon-admin/global-vars') {
            if (req.method === 'GET') return json(res, 200, Object.fromEntries(dictado));
            if (req.method === 'POST') {
                let p = {};
                try { p = JSON.parse(body || '{}'); } catch { return json(res, 400, { error: 'JSON inválido' }); }
                if (!p.key) return json(res, 400, { error: 'se espera {key, value}' });
                // ⚠ el valor llega como STRING con JSON adentro (así lo manda el contrato del lambda,
                // y así lo escribe la receta de la tarea 49). Se valida ACÁ: Mockoon no lo hacía y un
                // JSON roto se leía después como «respuesta inválida del proveedor».
                try { JSON.parse(String(p.value)); }
                catch { return json(res, 400, { error: 'el value no es JSON válido' }); }
                dictado.set(p.key, String(p.value));
                log(`dictado ${p.key}`);
                return json(res, 200, { message: `Global variable '${p.key}' has been set` });
            }
        }
        if (req.method === 'POST' && url.pathname === '/mockoon-admin/state/purge') {
            dictado.clear(); log('purgado');
            return json(res, 200, {});
        }

        const hit = RUTAS.find((r) => r.test(url, req.method));
        if (!hit) {
            // Misma filosofía que `mock-lenders`: lo no mapeado es RUIDOSO, para que el próximo muro
            // se documente solo en vez de aparecer como un error opaco.
            log(`⚠ RUTA NO MAPEADA ← ${req.method} ${url.pathname}${body ? ' body=' + body.slice(0, 200) : ''}`);
            return json(res, 404, { error: 'ruta no mapeada en mock-centrales', path: url.pathname });
        }
        const doc = cedulaDe(url, body);
        const clave = `${hit.central}_${doc}`;
        if (doc && dictado.has(clave)) {
            log(`${req.method} ${url.pathname} → ${hit.central} DICTADO (doc ${doc})`);
            return json(res, 200, dictado.get(clave));
        }
        log(`${req.method} ${url.pathname} → ${hit.central} default${doc ? ` (doc ${doc})` : ''}`);
        return json(res, 200, hit.def(doc, url));
    });
});

server.listen(PORT, () => log(`mock-centrales escuchando en :${PORT}`));
