// inyectar-aml.ts — forja la fila de AML (`TusDatos - AML`) que la elegibilidad del codeudor exige.
//
// POR QUÉ EXISTE. El AML **no corre en local para nadie**: medido el 2026-08-22, cero filas en toda la
// base para la central `TusDatos - AML`. No es del codeudor — ningún paso del wizard que se ejercita
// por API lo dispara, y su endpoint (`POST /api/identity/aml/launch`) está detrás de autenticación de
// SESIÓN: con el `X-Cosigner-Token` devuelve un redirect 302, no un 401.
//
// Y sin esa fila, `evaluate-eligibility` NO evalúa nunca — devuelve `evaluated: false` a propósito:
//     CosignerEligibilityService::hasCompletedValidations()
//     return $aml['completed'] && (!$identity['applies'] || $identity['completed']);
//
// La FORMA sale de `readAmlStatus`, no de suponer:
//     $completed = ($data['estado'] ?? null) === 'finalizado' || array_key_exists('hallazgo', $data);
// Se emite `estado: finalizado` SIN la clave `hallazgo` → completado y limpio. Para probar el camino
// contrario (codeudor rechazado por AML), pasá `--con-hallazgos`.
//
// Uso:  node dev/inyectar-aml.ts <user_id> [--con-hallazgos]

process.env.E2E_TARGET ||= 'local';
export {};

const { one, exec, close, appKey } = await import('../pkg/db.ts');
const { encryptLaravelString } = await import('../pkg/laravel-crypt.ts');

const USER = Number(process.argv[2] ?? 0);
const CON_HALLAZGOS = process.argv.includes('--con-hallazgos');
if (!USER) {
    console.log('\n  uso: node dev/inyectar-aml.ts <user_id> [--con-hallazgos]\n');
    await close();
    process.exit(2);
}
const rc = await one<{ id: number }>("SELECT id FROM risk_centrals WHERE name='TusDatos - AML' LIMIT 1");
if (!rc) {
    console.log('\n  ✗ no existe la central `TusDatos - AML` en esta base\n');
    await close();
    process.exit(2);
}
// ⚠ `data` va ENCRIPTADA igual que el cast `encrypted:collection` de Laravel — escribirla en claro
// hace que el backend falle al desencriptar, y el error no menciona el cifrado.
const payload = CON_HALLAZGOS
    ? { estado: 'finalizado', hallazgo: [{ tipo: 'lista_restrictiva', nivel: 'alto' }] }
    : { estado: 'finalizado', hallazgos: [] };
await exec('DELETE FROM risk_central_user_data WHERE user_id=? AND risk_central_id=?', [USER, rc.id]);
await exec(
    'INSERT INTO risk_central_user_data (uuid, user_id, risk_central_id, score, data, created_at, updated_at) ' +
    'VALUES (UUID(), ?, ?, 0, ?, NOW(), NOW())',
    [USER, rc.id, encryptLaravelString(JSON.stringify(payload), appKey())]);
console.log(`  AML inyectado · user ${USER} · ${CON_HALLAZGOS ? 'CON hallazgos (debe rechazar)' : 'limpio'}`);
await close();
