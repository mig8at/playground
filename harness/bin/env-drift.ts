// ¿El ambiente remoto está al día con su rama? (`make harness-env-drift TARGET=qa`). Sólo lectura.
// Migraciones de la rama desplegada que la base compartida no tiene, y rutas que el backend le pide al lambda de
// centrales y el lambda no conoce. La lógica: `pkg/environment-drift.ts`. Sale 1 si hay desfase, 2 si no pudo medir.
const { TARGET, query, close } = await import('../pkg/db.ts');
const { environmentDrift } = await import('../pkg/environment-drift.ts');

if (TARGET === 'local' || TARGET === 'prod') {
    console.error(`env-drift es para dev, qa o staging (TARGET=${TARGET}): local corre tu working tree y prod se migra aparte`);
    process.exit(2);
}

const drift = await environmentDrift(TARGET, async () =>
    (await query<{ migration: string }>('SELECT migration FROM migrations')).map((m) => m.migration))
    .finally(() => close().catch(() => { }));

if (process.argv.includes('--json')) {
    console.log(JSON.stringify(drift, null, 2));
} else {
    const out: string[] = [];
    out.push(`  ${TARGET} · legacy-backend ${drift.branch} @ ${drift.sha ?? '?'}${drift.fetched ? '' : '  (sin fetch: ref local, puede estar vieja)'}`);
    const m = drift.migrations;
    if ('error' in m) out.push(`  ✗ migraciones: no se pudieron leer (${m.error})`);
    else if (!m.missing.length) out.push(`  ✓ migraciones: las ${m.inBranch} de la rama están corridas en la base`);
    else {
        out.push(`  ✗ migraciones: ${m.missing.length} de la rama NO están corridas en la base compartida`);
        for (const name of m.missing) out.push(`      ${name}`);
        out.push('    se corren con --path, una por una (nunca `migrate` pelado): ver tablero/CLAUDE.md §«no se corre entera»');
    }
    const k = drift.mock;
    if ('skipped' in k) out.push(`  · mock de centrales: ${k.skipped}`);
    else if (!k.missing.length) out.push(`  ✓ mock de centrales: las ${k.checked} rutas que pide el backend existen en el lambda${k.unreachable ? ` (${k.unreachable} sin respuesta)` : ''}`);
    else {
        out.push(`  ✗ mock de centrales: ${k.missing.length} de ${k.checked} rutas responden 404 — el backend cae a su respaldo sin avisar`);
        for (const r of k.missing) out.push(`      ${r.method} ${r.path}   (${r.source})`);
    }
    console.log(out.join('\n'));
}

const bad = ('missing' in drift.migrations && drift.migrations.missing.length > 0)
    || ('missing' in drift.mock && drift.mock.missing.length > 0);
const unmeasured = 'error' in drift.migrations;
process.exit(bad ? 1 : unmeasured ? 2 : 0);
