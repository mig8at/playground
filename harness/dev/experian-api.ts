#!/usr/bin/env node
// experian-api — ¿la firma del flujo apaga la consulta a Experian? Medido por API, sin navegador.
//
//   node dev/experian-api.ts <uReqId>
//
// Es un EXPERIMENTO CONTROLADO sobre la MISMA solicitud: se pregunta "¿hay que consultar Experian?"
// antes y después de firmar el flujo, y lo único que cambia entre las dos mediciones es la firma.
// Si el veredicto pasa de "consultar" a RKV24029, la lógica de la tarea funciona.
//
// No cuesta una consulta de buró: `check-hard-rules-trigger` es un endpoint de DECISIÓN — dice si el
// usuario *debe* ser consultado, no consulta. Por eso sirve para iterar rápido antes de la prueba de UI.
//
// ⚠ QUÉ PRUEBA Y QUÉ NO. Esto valida la regla en la arquitectura NUEVA (RiskV2). El wizard, en el flujo
// clásico, no pasa por acá: consulta vía `DatacreditoQueryByAlliedController` → `Experian.php`, que
// implementa la MISMA regla como espejo declarado. O sea: esto confirma rápido que la regla y la firma
// funcionan; la prueba de UI + `dev/experian-check.ts` es la que prueba el camino que el usuario recorre.
//
// Las tres APIs son internas y sin auth por diseño (no se exponen a internet) → hace falta VPN.
//
// Exit code: 0 la firma APAGA la consulta · 1 no la apaga · 2 no se pudo medir.
import { one, close, TARGET, env } from '../pkg/db.ts';

const BUREAUS = ['experian-acierta', 'experian-quanto', 'experian-acierta-quanto'];
const ABLE_TO_OMIT = 'RKV26000';   // el aliado PUEDE omitir (lo que el front mira para ofrecer el selector)
const OMITTED = 'RKV24029';        // no se consulta: la solicitud está en el flujo con pre-aprobados listos
const CACHED = 'RKV24027';       // no se consulta: ya hay dato vigente para esa central
const SIGNED = 'URV13000';        // la firma quedó

// Los ÚNICOS veredictos que significan "sí, consultá Experian". Todo lo demás es una razón para NO
// consultar — y hay varias. Importa para leer el resultado: el chequeo de "dato vigente" (RKV24027)
// corre ANTES que el de flujo, así que una central con reporte fresco corta ahí y NUNCA llega a decir
// RKV24029. No es que la omisión falle: es que esa central ni siquiera participa de la medición.
const ASKS_BUREAU = ['RKV24000', 'RKV24007', 'RKV24020', 'RKV24021'];
const asksBureau = (code: string) => ASKS_BUREAU.includes(code);

const ROOT = env('E2E_API_BASE_URL', '').replace(/\/api\/?$/, '').replace(/\/$/, '');
if (!ROOT) {
    console.log(`✗ sin E2E_API_BASE_URL para '${TARGET}' (vive en env/${TARGET}.env)`);
    process.exit(2);
}

type Res = { status: number; code: string; message: string };

async function call(method: 'GET' | 'POST', path: string): Promise<Res> {
    try {
        const r = await fetch(`${ROOT}${path}`, { method, signal: AbortSignal.timeout(20_000) });
        const body: any = await r.json().catch(() => ({}));
        return { status: r.status, code: body?.code ?? '(sin code)', message: body?.message ?? '' };
    } catch (e: any) {
        // Estas APIs viven en la red interna: sin VPN el fetch muere acá, no con un 4xx.
        return { status: 0, code: '(sin respuesta)', message: `${e?.name ?? 'error'}: ${e?.message ?? ''} — ¿VPN?` };
    }
}

const urId = process.argv[2];
if (!urId) {
    console.log('uso: node dev/experian-api.ts <uReqId>');
    process.exit(2);
}

const ur = await one<Record<string, any>>(
    `SELECT ur.id, ur.flow_id, ur.allied_id, ur.allied_branch_id, ab.hash AS branch_hash, a.name AS allied
       FROM user_requests ur
       JOIN allied_branches ab ON ab.id = ur.allied_branch_id
       JOIN allieds a ON a.id = ur.allied_id
      WHERE ur.id = ?`, [urId]);
if (!ur) {
    console.log(`✗ no encontré la solicitud ${urId} en '${TARGET}'`);
    await close();
    process.exit(2);
}
// El id, ya sin `null`. `process.exit` no estrecha el tipo dentro de una función declarada más abajo:
// para TypeScript ese cuerpo podría correr en cualquier momento, así que el guard de arriba no lo alcanza.
const urIdNum: number = Number(ur.id);

console.log(`\n▶ EXPERIAN por API · solicitud ${ur.id} (${TARGET})`);
console.log(`  ${ur.allied} (allied ${ur.allied_id}) · sucursal ${ur.allied_branch_id} (${ur.branch_hash}) · flow_id actual = ${ur.flow_id ?? 'NULL'}`);
console.log(`  backend ${ROOT}`);

// ── 1 · ¿el comercio está autorizado a omitir? Es lo que el front pregunta para mostrar el selector ──
console.log('\n  1 · ¿PUEDE OMITIR? (lo que decide si aparece el selector)');
const able = await call('GET', `/api/v2/risk/check-if-able-to-omit/experian-acierta/${ur.branch_hash}`);
const can = able.code === ABLE_TO_OMIT;
console.log(`      HTTP ${able.status} · ${able.code} → ${can ? 'SÍ, autorizado' : 'NO autorizado'}`);
if (!can) console.log(`      ${able.message}`);

// ── 2 · medición ANTES de firmar ─────────────────────────────────────────────────────────────────
async function measure(): Promise<Record<string, Res>> {
    const out: Record<string, Res> = {};
    for (const c of BUREAUS) out[c] = await call('GET', `/api/v2/risk/check-hard-rules-trigger/${c}/${urIdNum}`);
    return out;
}
const gloss = (code: string) =>
    code === OMITTED ? '  ← NO se consulta (omitido por FLUJO)'
    : code === CACHED ? '  ← NO se consulta (ya hay dato vigente: CACHÉ, corta antes del flujo)'
    : asksBureau(code) ? '  ← SÍ se consulta'
    : '';
const paints = (m: Record<string, Res>) => {
    for (const c of BUREAUS) {
        const r = m[c];
        console.log(`      ${c.padEnd(24)} HTTP ${r.status} · ${r.code}${gloss(r.code)}`);
    }
};
console.log('\n  2 · ANTES de firmar — ¿hay que consultar Experian?');
const before = await measure();
paints(before);

// ── 3 · firmar el flujo que omite el buró ────────────────────────────────────────────────────────
console.log('\n  3 · FIRMA del flujo already-confirmed-pre-approval');
const signature = await call('POST', `/api/v1/user-request/${ur.id}/flow-signature/already-confirmed-pre-approval`);
const wasSigned = signature.code === SIGNED;
console.log(`      HTTP ${signature.status} · ${signature.code} → ${wasSigned ? 'FIRMADA' : 'NO firmada'}`);
if (!wasSigned) {
    // El rechazo viaja en HTTP 200 con code URV13004 — el front no lo mira y lo toma por éxito (F-58).
    console.log(`      ${signature.message}`);
    if (signature.status === 200) console.log('      ⚠ rechazo en HTTP 200: esto es exactamente lo que el front no distingue (F-58).');
}
const flowAfter = await one<Record<string, any>>(`SELECT flow_id FROM user_requests WHERE id = ?`, [ur.id]);
console.log(`      en BD: flow_id = ${flowAfter?.flow_id ?? 'NULL'}`);

// ── 4 · medición DESPUÉS ─────────────────────────────────────────────────────────────────────────
console.log('\n  4 · DESPUÉS de firmar — ¿hay que consultar Experian?');
const after = await measure();
paints(after);

// ── veredicto ────────────────────────────────────────────────────────────────────────────────────
// Lo que prueba la tarea es el CAMBIO: centrales que pedían buró antes y quedaron omitidas por flujo
// después. Las que ya venían cortadas por caché no participan — y contarlas como fallo fue un falso
// negativo de la primera versión de este script.
const disabledOnes = BUREAUS.filter((c) => asksBureau(before[c].code) && after[c].code === OMITTED);
const alreadyOmitted = BUREAUS.filter((c) => before[c].code === OMITTED);
const masked = BUREAUS.filter((c) => after[c].code === CACHED);
const stillAsking = BUREAUS.filter((c) => asksBureau(after[c].code));
const withoutAnswer = BUREAUS.some((c) => after[c].status === 0);
const note = masked.length
    ? `\n    (${masked.join(', ')} no participó: ya tenía dato vigente y ${CACHED} corta antes del flujo.)`
    : '';

let code = 1;
let text: string;
if (withoutAnswer || able.status === 0) {
    code = 2;
    text = '— NO SE PUDO MEDIR: el backend no respondió. Estas APIs son internas — ¿VPN conectada?';
} else if (stillAsking.length) {
    text = `✗ LA FIRMA NO APAGA LA CONSULTA: siguen pidiendo buró → ${stillAsking.join(', ')}.\n`
        + (wasSigned ? '    Y la firma sí quedó, así que el problema está en la regla de omisión.'
                   : '    Pero la firma tampoco quedó — mirá el paso 3 primero.');
} else if (disabledOnes.length) {
    code = 0;
    const plural = disabledOnes.length > 1;
    text = `✓ LA FIRMA APAGA LA CONSULTA: ${disabledOnes.join(', ')} ${plural ? 'pedían' : 'pedía'} buró antes\n`
        + `    y ${plural ? 'quedaron' : 'quedó'} en ${OMITTED} después. Lo único que cambió entre ambas mediciones es la firma.${note}`;
} else if (alreadyOmitted.length) {
    code = 2;
    text = '— NO CONCLUYENTE: ya venían omitidas ANTES de firmar (la solicitud ya estaba en flow_id=2),\n'
        + '    así que la medición no aísla el efecto de la firma. Usá una solicitud sin firmar.';
} else {
    code = 2;
    text = '— NO CONCLUYENTE: ninguna central llegó a pedir buró antes de firmar, así que no había nada\n'
        + `    que apagar.${note} Hace falta un usuario con caché fría (teléfono de bypass 3131010101).`;
}
console.log(`\n  VEREDICTO\n  ${text}\n`);
console.log(`  (la solicitud ${ur.id} quedó con flow_id = ${flowAfter?.flow_id ?? 'NULL'}; para devolverla:\n   POST ${ROOT}/api/v1/user-request/${ur.id}/flow-signature/standard)\n`);

await close();
process.exit(code);
