// montar-kyc-flow.ts — deja el resolvedor de KYC usable en LOCAL.
//
// QUÉ RESUELVE. `GET api/v2/onboarding/kyc-flow/{hash}` es el endpoint con el que el wizard decide por
// cuál de sus DOS caminos de OTP va (`otp-verification.tsx` → `resolveKycFlow`): v2 si el comercio
// está en la lista `kyc_pipeline_allieds`, v1 —el legacy del monolito— si no. La lista vive en la
// tabla `settings` y el servicio (`ResolveKycFlowService`) la lee con `SettingsService::get`, que
// LANZA si la fila no existe. En local no existía: el endpoint daba 500 `OBV23003` para TODO hash.
//
// POR QUÉ IMPORTA AUNQUE «FUNCIONE». El front tolera ese 500 cayendo al v1 sin avisar, así que los
// flujos locales andaban igual y el error sólo se veía en el log del wizard. Pero el docblock del
// servicio dice «la lista está vacía por defecto» y eso no es lo que pasa: AUSENTE no es VACÍA —
// vacía responde 200 y ausente revienta. Con la fila puesta, el front local toma la misma decisión
// que qa, y por la misma vía. Medido el 2026-09-14: en qa la fila existe y ningún comercio consultado
// usa pipeline (`usesPipeline=false` para los 7 que existen allá).
//
// FORMATO. Copiado de la fila real de dev (solo lectura, 2026-09-14):
//   code='setting' · key='kyc_pipeline_allieds' · value='{"allieds":[91]}' · serialized=4 · country_id=1
// El modelo `App\Models\Setting` castea `value` a json; `serialized` se copia igual por fidelidad.
// Acá se siembra VACÍA (`{"allieds":[]}`): todos por el legacy, que es la conducta de qa para los
// comercios que probamos. Si querés ver el camino v2 en local, agregá el allied_id a esa lista.
//
// Uso:  make harness-kyc-flow            (sólo local · idempotente: si ya existe no la toca)

process.env.E2E_TARGET ||= 'local';
export {};

/* Imports DINÁMICOS a propósito: `pkg/db.ts` resuelve el target al evaluarse, y un import estático
   correría ANTES del `||=` de arriba y pegaría contra el dev compartido (F-187). */
const { TARGET } = await import('../pkg/env.ts');
if (TARGET !== 'local') {
    // `settings` es configuración COMPARTIDA del ambiente: sembrarla en dev/staging cambia la conducta
    // de todo el equipo. Esto es una receta de local y nada más.
    console.log(`\n  ✗ esto siembra configuración y sólo corre en local (target actual: ${TARGET})\n`);
    process.exit(2);
}
const { one, exec, close } = await import('../pkg/db.ts');
const { config } = await import('../pkg/config.ts');

const KEY = 'kyc_pipeline_allieds';
const already = await one<{ id: number; value: string }>(
    "SELECT id, value FROM settings WHERE code = 'setting' AND `key` = ? LIMIT 1", [KEY],
);
if (already) {
    console.log(`\n  ✓ la setting ya existe (id ${already.id}) · value ${already.value} — no se toca`);
} else {
    const r = await exec(
        "INSERT INTO settings (code, `key`, value, serialized, country_id, created_at, updated_at) VALUES ('setting', ?, ?, 4, 1, NOW(), NOW())",
        [KEY, JSON.stringify({ allieds: [] })],
    );
    console.log(`\n  ✓ sembrada la setting \`${KEY}\` = {"allieds":[]} (id ${r.insertId}) — todos por el flujo legacy, como en qa`);
}

// Se comprueba CORRIENDO, no suponiendo: el endpoint tiene que contestar 200 para una sucursal real.
// (La consulta que falla no se cachea —lanza antes del set—, así que el efecto es inmediato.)
const br = await one<{ hash: string; name: string }>('SELECT hash, name FROM allied_branches WHERE status = 1 ORDER BY id LIMIT 1');
await close();
if (!br) { console.log('  ⚠ no hay sucursales activas en local para comprobar el endpoint\n'); process.exit(0); }
const url = `${config.mockUrl}/api/v2/onboarding/kyc-flow/${br.hash}`;
try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    const body = await res.json().catch(() => ({}));
    const ok = res.status === 200;
    console.log(`  ${ok ? '✓' : '✗'} ${url} → HTTP ${res.status} ${body.code ?? ''} ${ok ? `· usesPipeline=${body?.data?.payload?.usesPipeline}` : `· ${body.message ?? ''}`}\n`);
    process.exit(ok ? 0 : 1);
} catch (e) {
    console.log(`  ✗ no pude pegarle a ${url}: ${(e as Error).message} — ¿está arriba el backend local?\n`);
    process.exit(1);
}
