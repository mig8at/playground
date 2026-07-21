#!/usr/bin/env node
// experian-check — ¿la solicitud OMITIÓ la consulta a Experian, y se puede afirmar?
//
//   node dev/experian-check.ts [<uReqId>]     (sin id: la última solicitud creada)
//
// Existe porque "no hay fila nueva de buró" NO prueba la omisión: hay tres cosas distintas que
// producen ese mismo silencio, y hay que descartar dos antes de creerle a la tercera.
//
//   1. FIRMA DE FLUJO   `user_requests.flow_id = 2` (already-confirmed-pre-approval). Si no está,
//                       no hubo nada que omitir — el selector se vio pero no se selló.
//   2. COMPUERTA        `DatacreditoQueryByAlliedController` decide ANTES, por frecuencia del aliado.
//                       Si corta ahí, `Experian.php` ni se invoca y el corte por flujo nunca se
//                       ejerce: la corrida sale "sin consulta" por el motivo equivocado (F-60).
//   3. CACHÉ            `Experian::performRequest` reusa el reporte por 1 mes (user_id + central).
//                       Con caché vigente tampoco se consulta, y otra vez no hay fila nueva.
//
// Solo cuando 1 dice "firmada", 2 dice "la compuerta disparó" y 3 dice "caché fría", la ausencia de
// fila significa lo que queremos que signifique.
//
// Exit code = veredicto:  0 omisión PROBADA · 1 SÍ se consultó · 2 no concluyente.
import { query, one, close, TARGET } from '../pkg/db.ts';

/** Las tres variaciones de Experian (`risk_centrals`); las demás centrales son otro asunto. */
const EXPERIAN = [1, 8, 9];
const FLOW_ALREADY_CONFIRMED = 2;

type Row = Record<string, any>;

const money = (v: any) => '$' + Number(v ?? 0).toLocaleString('es-CO', { maximumFractionDigits: 0 });
const line = (label: string, value: string) => console.log(`  ${label.padEnd(13)}${value}`);

const arg = process.argv[2];
const ur = await one<Row>(
    arg
        ? `SELECT * FROM user_requests WHERE id = ?`
        : `SELECT * FROM user_requests ORDER BY id DESC LIMIT 1`,
    arg ? [arg] : [],
);

if (!ur) {
    console.log(`✗ no encontré la solicitud ${arg ?? '(última)'} en '${TARGET}'`);
    await close();
    process.exit(2);
}

const branch = await one<Row>(
    `SELECT ab.id, ab.name, ab.hash, a.id AS allied_id, a.name AS allied
       FROM allied_branches ab JOIN allieds a ON a.id = ab.allied_id WHERE ab.id = ?`,
    [ur.allied_branch_id],
);

console.log(`\n▶ EXPERIAN · solicitud ${ur.id} (${TARGET})`);
line('comercio', `${branch?.allied ?? '?'} (allied ${ur.allied_id}) · sucursal ${ur.allied_branch_id} ${branch?.name ?? ''}`);
line('monto', `${money(ur.amount)} · estado ${ur.user_request_status_id} · creada ${ur.created_at}`);
line('usuario', String(ur.user_id));

// ── 1 · ¿se firmó el flujo que omite el buró? ────────────────────────────────────────────────────
const firmada = Number(ur.flow_id) === FLOW_ALREADY_CONFIRMED;
console.log('\n  1 · FIRMA DE FLUJO');
line('', firmada
    ? `flow_id = 2 → FIRMADA (already-confirmed-pre-approval: no se consulta Experian)`
    : `flow_id = ${ur.flow_id ?? 'NULL'} → NO firmada (flujo estándar: el buró SÍ se consulta)`);

// ── 2 · la compuerta de frecuencia, que decide antes que el flujo ────────────────────────────────
const freq = await one<Row>(`SELECT frequency, every FROM datacredito_frequencies WHERE allied_id = ?`, [ur.allied_id]);
// El contexto del veredicto va en `logs.request` (no en `response`, que queda vacío): `Log::create`
// mete ahí el JSON con `reason`. Se leen las tres por si el modelo cambia.
const veredictos = await query<Row>(
    `SELECT name, COALESCE(NULLIF(request,''), NULLIF(response,''), description) AS payload, created_at
       FROM logs WHERE user_request_id = ? AND controller = 'DatacreditoQueryByAlliedController'
      ORDER BY id DESC LIMIT 3`,
    [ur.id],
);
const razon = (p: any) => { try { return JSON.parse(p)?.reason ?? '?'; } catch { return '?'; } };
console.log('\n  2 · COMPUERTA (frecuencia del aliado)');
line('regla', freq
    ? `frequency=${freq.frequency ?? 'NULL'} every=${freq.every}` +
      (freq.frequency === null ? ' → "consultar siempre" (nunca enmascara)' : ` → throttle: consulta 1 de cada ${freq.every}`)
    : 'SIN REGLA → el aliado nunca consulta Experian (enmascara siempre)');
if (!veredictos.length) {
    line('veredicto', 'sin registro en `logs` para esta solicitud → la compuerta no llegó a evaluarse');
} else {
    for (const v of veredictos) line('veredicto', `${v.name} · ${razon(v.payload)} (${v.created_at})`);
}
const disparo = veredictos.some((v) => v.name === 'EXPERIAN_TRIGGERED');
const corto = veredictos.some((v) => v.name === 'EXPERIAN_NOT_TRIGGERED');

// ── 3 · la caché de 1 mes, que produce el mismo silencio que la omisión ──────────────────────────
const previa = await one<Row>(
    `SELECT rcud.id, rc.name, rcud.created_at
       FROM risk_central_user_data rcud JOIN risk_centrals rc ON rc.id = rcud.risk_central_id
      WHERE rcud.user_id = ? AND rcud.risk_central_id IN (?) AND rcud.created_at < ?
      ORDER BY rcud.id DESC LIMIT 1`,
    [ur.user_id, EXPERIAN, ur.created_at],
);
// Misma ventana que `Experian::performRequest`: created_at > now()-1mes, medida contra la solicitud.
const cacheVigente = previa
    ? new Date(previa.created_at).getTime() > new Date(ur.created_at).getTime() - 30 * 864e5
    : false;
console.log('\n  3 · CACHÉ (1 mes, por user_id + central)');
line('', previa
    ? `previa #${previa.id} '${previa.name}' ${previa.created_at} → ${cacheVigente ? 'VIGENTE (enmascara)' : 'vencida (no enmascara)'}`
    : 'sin reporte Experian previo → caché FRÍA (no enmascara)');

// ── 4 · ¿se consultó el buró PARA ESTA solicitud? ────────────────────────────────────────────────
// Por el VÍNCULO (`user_request_risk_central_user_data`), no por fecha suelta: filtrar solo por
// `created_at >= solicitud` cuenta las consultas de solicitudes POSTERIORES del mismo usuario y da un
// falso "sí se consultó" (me pasó con la 464334, que se comió una fila del día siguiente).
// La tabla ata el reporte que quedó pegado a la solicitud venga de consulta fresca o de CACHÉ, así que
// la fecha sigue importando: anterior a la solicitud = reusado; posterior = consultado de verdad.
const atados = await query<Row>(
    `SELECT rcud.id, rc.name, rcud.created_at
       FROM user_request_risk_central_user_data urr
       JOIN risk_central_user_data rcud ON rcud.id = urr.risk_central_user_data_id
       JOIN risk_centrals rc ON rc.id = rcud.risk_central_id
      WHERE urr.user_request_id = ? AND rcud.risk_central_id IN (?)
      ORDER BY rcud.id`,
    [ur.id, EXPERIAN],
);
const desc = (r: Row) => `#${r.id} '${r.name}' ${r.created_at}`;
const nuevas = atados.filter((r) => new Date(r.created_at) >= new Date(ur.created_at));
const reusados = atados.filter((r) => new Date(r.created_at) < new Date(ur.created_at));
console.log('\n  4 · CONSULTA (reportes Experian atados a esta solicitud)');
line('consultado', nuevas.length ? nuevas.map(desc).join('\n               ') : 'ninguno — no se consultó el buró para esta solicitud');
if (reusados.length) line('reusado', `${reusados.map(desc).join('\n               ')}  ← anterior a la solicitud: vino de caché`);

// ── veredicto ────────────────────────────────────────────────────────────────────────────────────
let code = 2;
let texto: string;
if (nuevas.length) {
    code = 1;
    texto = firmada
        ? '✗ SE CONSULTÓ el buró pese a la firma — la omisión NO funcionó. Es el caso que había que cazar.'
        : '✗ SE CONSULTÓ el buró, como corresponde a una solicitud sin firmar. No prueba nada sobre la omisión.';
} else if (!firmada) {
    texto = '— NO CONCLUYENTE: la solicitud no está firmada, así que no había nada que omitir.\n'
        + '    Ver el selector no alcanza: hay que elegirlo y que el backend selle el flujo (pasa al verificar el OTP).';
} else if (corto || !disparo) {
    texto = '— NO CONCLUYENTE: la compuerta de frecuencia cortó (o nunca corrió), así que `Experian.php`\n'
        + '    no se invocó y el corte por flujo no llegó a ejercerse. Probá en un comercio con\n'
        + '    frequency = NULL (ej. Mediarte, allied 91). Ver F-60.';
} else if (cacheVigente) {
    texto = '— NO CONCLUYENTE: la compuerta disparó y no hay fila nueva, pero el usuario tenía caché\n'
        + '    Experian vigente — el silencio se explica igual sin la omisión. Hace falta un usuario\n'
        + '    con caché fría (sin reporte Experian en el último mes).';
} else {
    code = 0;
    texto = '✓ OMISIÓN PROBADA: el flujo está firmado, la compuerta disparó (así que se llegó a\n'
        + '    `Experian.php`) y la caché estaba fría — lo único que pudo frenar la consulta es el flujo.';
}
console.log(`\n  VEREDICTO\n  ${texto}\n`);

await close();
process.exit(code);
