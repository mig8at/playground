// auto-onboarding.ts — ¿a dónde termina el comprador del AUTO-ONBOARDING según lo que contesten las centrales?
//
//   cd harness && E2E_TARGET=local node dev/auto-onboarding.ts   [CASES=aprobado,agil-desempleado] [MERCHANT=pullman]
//   (necesita el mock de centrales arriba: `make harness-bureaus`)
//
// El auto-onboarding (`/auto/{hash}/…`) entra por la tienda con la fecha de expedición en el pedido: el
// comprador sólo escribe el código y `validando` guarda los datos personales del pedido, que es lo que
// corre la cascada AgilData → Mareigua → TusDatos. Si la validación no pasa, el comprador sigue por
// `personal-info` prellenado y con el aviso (`?validacion=fallida`); si falta el empleo, por
// `employment-info`.
//
// Cada caso DICTA al mock local de centrales (:8105, `make harness-bureaus`) lo que contesta cada una para
// SU cédula —incluida una central caída: `{"__http_status": 500}`— y recorre el front por sus `.data`
// (pkg/front.ts), igual que el caminador: checkout → inicio → código → validando. Lo que reporta es el
// DESTINO y lo que quedó en la base, no si «pasó»: el desenlace correcto de cada falla es una decisión de
// producto, y acá sólo se mide.
//
// Sólo local: dicta al mock local y escribe en la base local.
import { FrontSession } from '../pkg/front.ts';
import { dictate, dictateBureauProfile, dictateEmployment } from '../pkg/risk-lambda.ts';
import { buildEcommerceUrl } from '../pkg/ecommerce.ts';
import { close, one, query } from '../pkg/db.ts';

if ((process.env.E2E_TARGET || 'local') !== 'local') {
    console.error('✗ auto-onboarding corre sólo contra local (dicta al mock local de centrales).');
    process.exit(2);
}
process.env.E2E_TARGET = 'local';

const FRONT = process.env.E2E_BASE_URL || 'http://localhost:5174';
const MERCHANT = process.env.MERCHANT || 'pullman';

const AGIL_SIN_DATOS = { codRespuesta: '02', observaciones: 'No se encontró información.', respuesta: null };
const MAREIGUA_SIN_DATOS = { respuesta_id: 1, mensaje: 'No se encontró información.' };
const CAIDA = { __http_status: 500 };
const tusdatos = (findings: Record<string, number>, extra: Record<string, unknown> = {}) => ({
    data: {
        findings: Object.fromEntries(['first_name', 'middle_name', 'first_surname', 'second_surname', 'issue_date']
            .map((k) => [k, { match_code: findings[k] ?? 1, match_description: (findings[k] ?? 1) ? 'Coincide' : 'No coincide' }])),
        status: 'Vigente', status_code: 0,
    },
    document_status: true, status: 'success', ...extra,
});

/** AgilData con la persona y un empleador, pero con los aportes terminados hace más de un año: el backend
 *  guarda su resumen con `employed: false`. Es lo que devolvió la lambda de qa para Refurbi (uReq 503252). */
const agilOldJobs = (doc: string) => {
    const old = new Date(); old.setMonth(old.getMonth() - 18);
    const pagos = Array.from({ length: 6 }, (_, k) => {
        const m = new Date(old); m.setMonth(old.getMonth() - k);
        const per = `${m.getFullYear()}${String(m.getMonth() + 1).padStart(2, '0')}`;
        return { id: k + 1, ibc: 1_890_000, periodo: Number(per), fechaPago: `${per.slice(0, 4)}-${per.slice(4)}-15 00:00:00`, diasCotizados: 30, valorCotizacionObligatoria: 217_350 };
    });
    return {
        usuario: null, codRespuesta: '01', observaciones: 'Consulta Exitosa.', codConsulta: 1,
        respuesta: {
            type: 'aorg.asofondos.agildata.domain.AfiliadoDetalladoa', fechaVinculacion: null,
            datosBasicos: { edad: 30, genero: 'F', nombre: 'LAURA AUTO PRUEBA', tipoId: 'CC', numeroId: doc, viabilidad: null },
            detalladoEmpleos: [{ id: 1, pagos, nombreEmpleador: 'EMPRESA ANTERIOR SAS', identifiacionEmpleador: '900101010', tipoIdentifiacionEmpleador: 'NI' }],
        },
    };
};

type Case = { id: string; what: string; name?: string; dictate: (doc: string) => Promise<unknown> };

const employed = (doc: string) => dictateEmployment(doc, 2_500_000, 'Empleado');
const CASES: Case[] = [
    { id: 'aprobado', what: 'las tres centrales contestan bien', dictate: employed },
    { id: 'agil-sin-datos', what: 'AgilData sin datos; Mareigua contesta', dictate: (d) => dictate(d, 'agildata', AGIL_SIN_DATOS) },
    { id: 'agil-caida', what: 'AgilData caída (HTTP 500); Mareigua contesta', dictate: (d) => dictate(d, 'agildata', CAIDA) },
    { id: 'agil-desempleado', what: 'AgilData encuentra a la persona, pero con aportes de hace más de un año (sale «Desempleado», como en qa)', dictate: (d) => dictate(d, 'agildata', agilOldJobs(d)) },
    { id: 'sin-empleo', what: 'AgilData y Mareigua sin datos', dictate: async (d) => { await dictate(d, 'agildata', AGIL_SIN_DATOS); await dictate(d, 'mareigua', MAREIGUA_SIN_DATOS); } },
    { id: 'todas-caidas', what: 'AgilData, Mareigua y TusDatos caídas (HTTP 500)', dictate: async (d) => { for (const c of ['agildata', 'mareigua', 'tusdatos']) await dictate(d, c, CAIDA); } },
    { id: 'tusdatos-no-coincide', what: 'sin empleo en Agil/Mareigua y TusDatos: el apellido no coincide', dictate: async (d) => { await dictate(d, 'agildata', AGIL_SIN_DATOS); await dictate(d, 'mareigua', MAREIGUA_SIN_DATOS); await dictate(d, 'tusdatos', tusdatos({ first_surname: 0 })); } },
    { id: 'fecha-no-coincide', what: 'sin empleo en Agil/Mareigua y TusDatos: la fecha de expedición no coincide', dictate: async (d) => { await dictate(d, 'agildata', AGIL_SIN_DATOS); await dictate(d, 'mareigua', MAREIGUA_SIN_DATOS); await dictate(d, 'tusdatos', tusdatos({ issue_date: 0 })); } },
    { id: 'nombre-corto', what: 'el pedido trae un nombre de 2 letras (el backend exige 3)', name: 'QA PRUEBA AUTO', dictate: employed },
];

const pick = (process.env.CASES || '').split(',').map((s) => s.trim()).filter(Boolean);
const cases = pick.length ? CASES.filter((c) => pick.includes(c.id)) : CASES;
if (!cases.length) { console.error(`✗ ningún caso con ese id. Hay: ${CASES.map((c) => c.id).join(', ')}`); process.exit(2); }

const stamp = Date.now() % 100_000;
const describe = (path: string | null): string => {
    if (!path) return 'sin destino';
    if (/validacion=fallida/.test(path)) return 'personal-info prellenado CON aviso';
    if (/\/employment-info/.test(path)) return 'employment-info (faltan datos laborales)';
    if (/\/lenders/.test(path)) return 'lenders';
    if (/\/solicitar/.test(path)) return 'flujo ecommerce normal (respaldo)';
    return path.split('?')[0];
};

console.log(`\n  AUTO-ONBOARDING · ${cases.length} caso(s) · front ${FRONT} · comercio ${MERCHANT} · target local\n`);
const rows: string[] = [];
for (const [i, c] of cases.entries()) {
    const doc = String(1_236_000_000 + stamp * 100 + i);
    const phone = `310${String(5_000_000 + stamp * 10 + i).slice(-7)}`;
    await dictateBureauProfile(doc, { score: 700, consultedLast6Months: 1, creditCards: 1, negativeHistoricalLast12Months: 0, currentNegativeCredits: 0 });
    await c.dictate(doc);

    process.env.E2E_AUTO_ONBOARDING = '1';
    process.env.E2E_SYNTH_DOC = doc;
    process.env.E2E_SYNTH_NAME = c.name ?? 'LAURA AUTO PRUEBA';
    process.env.E2E_SYNTH_EXP = '2012-09-10';
    const url = await buildEcommerceUrl(MERCHANT, phone, 2_000_000);

    const s = new FrontSession(FRONT);
    const trail: string[] = [];
    const step = async (kind: 'GET' | 'POST', path: string, form?: Record<string, string>) => {
        const r = kind === 'GET' ? await s.cargar(path) : await s.enviar(path, form);
        trail.push(`${kind} ${path.split('?')[0]} → ${r.status}${r.redirect ? ` ↪ ${r.redirect.split('?')[0]}` : ''}`);
        return r;
    };

    let at: string | null = url.checkout_path;
    let r = await step('GET', at);
    at = r.redirect;
    if (at && /\/auto\/[^/]+\/inicio/.test(at)) { r = await step('GET', at); at = r.redirect; }
    if (at && /\/auto\/[^/]+\/\d+\/otp/.test(at)) { r = await step('POST', at, { otp: phone.slice(-4) }); at = r.redirect ?? at; }
    if (at && /\/validando/.test(at)) { r = await step('POST', at, {}); at = r.redirect ?? at; }

    const ur = /\/(\d+)\/(?:personal-info|employment-info|lenders|validando)/.exec(at ?? '')?.[1] ?? null;
    const user = ur ? await one<{ first_name: string; expedition_date: string | null }>(
        'SELECT u.first_name, u.expedition_date FROM user_requests ur JOIN users u ON u.id = ur.user_id WHERE ur.id = ?', [ur]) : null;
    const centrals = ur ? (await query<{ name: string }>(
        'SELECT rc.name FROM risk_central_user_data r JOIN risk_centrals rc ON rc.id = r.risk_central_id JOIN user_requests ur ON ur.user_id = r.user_id WHERE ur.id = ? ORDER BY r.id', [ur])).map((x) => x.name.split(' ')[0]) : [];

    console.log(`  ● ${c.id} — ${c.what}`);
    for (const t of trail) console.log(`      ${t}`);
    console.log(`      → ${describe(at)}${ur ? ` · uReq ${ur}` : ''} · usuario ${user ? `${user.first_name}${user.expedition_date ? ' (con fecha)' : ' (sin fecha: datos no guardados)'}` : '—'} · centrales: ${centrals.join(', ') || 'ninguna'}\n`);
    rows.push(`  ${c.id.padEnd(22)} ${describe(at)}`);
}
console.log('  ── RESUMEN ──');
for (const row of rows) console.log(row);
await close();
