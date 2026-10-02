// dev/allied-create.ts — crear un COMERCIO de prueba por el admin real y comprobar que su asesor quedó bien.
//
//   make harness-allied-create TARGET=local                    crea, verifica y deja el comercio
//   make harness-allied-create TARGET=dev CLEANUP=1            crea, verifica y lo borra al terminar
//   make harness-allied-create TARGET=dev LOGIN=1 CLEANUP=1    …y entre la verificación y el borrado, prueba el login
//   make harness-allied-create TARGET=dev CLEANUP_ID=349       sólo borra uno que creó esta herramienta
//   make harness-allied-create TARGET=dev CHECK=1              sólo comprueba la sesión y lee el formulario: NO crea nada
//
// La cadena, que es lo que se hacía a mano: 1) el alta por el formulario del admin (sesión y CSRF, sin ventana),
// 2) lo que el admin mostró del asesor de prueba, 3) lo que dice la BASE (no la pantalla), 4) opcional, el login del
// asesor en el wizard (`dev/login-check.ts`, con ventana: la clave la teclea esa herramienta en tu corrida), 5) opcional,
// el borrado por id exacto del comercio, la sucursal, el asesor y su cuenta del pool.
//
// La sesión del admin no se inventa (ver `pkg/sessions.ts`): se usa la que se guardó con `make harness-signin KIND=admin
// TARGET=<t>` —local la renueva sola, porque la emite la propia app— y la herramienta dice con QUIÉN actúa antes de escribir.
// Producción no se toca, y qa no tiene admin propio: usa dev.
// El alta ESCRIBE (en dev, en la base compartida): lo creado lleva el prefijo «PRUEBA AUTO», y es lo único que se borra.
//
// Exit code: 0 todo bien · 1 algo quedó mal (la pantalla o la base no cuadran, o el login no entró) · 2 no se pudo empezar.
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { NoAdminSession } from '../pkg/admin-http.ts';
import { cleanupAllied, createAllied, verifyAdvisor, type CleanupResult, type TestAdvisorFlash } from '../pkg/allied-admin.ts';
import { close } from '../pkg/db.ts';
import { env, TARGET } from '../pkg/env.ts';
import { adminClientFor } from '../pkg/sessions.ts';

const { values: args } = parseArgs({
    options: {
        name: { type: 'string' },
        cleanup: { type: 'boolean', default: false },
        'cleanup-id': { type: 'string' },
        login: { type: 'boolean', default: false },
        json: { type: 'boolean', default: false },
        check: { type: 'boolean', default: false },
    },
});

const HAS_POOL = TARGET !== 'local';
const POOL_ID = env('E2E_MERCHANT_POOL_ID', 'us-east-2_Mh2hIqeQ5');

function fail(msg: string, code = 2): never {
    console.error(`\n  ✖ ${msg}\n`);
    process.exit(code);
}

/** Borra las cuentas del pool con la CLI de AWS (perfil dev). Si no se puede, deja los comandos para correrlos a mano. */
function deletePoolAccounts(emails: string[]): { done: string[]; pending: string[] } {
    const done: string[] = [];
    const pending: string[] = [];
    for (const email of emails) {
        const r = spawnSync('aws', ['cognito-idp', 'admin-delete-user', '--user-pool-id', POOL_ID, '--username', email],
            { env: { ...process.env, AWS_PROFILE: 'dev', AWS_DEFAULT_REGION: POOL_ID.split('_')[0] }, encoding: 'utf8' });
        // «no existe» también es un resultado válido: la cuenta ya no está.
        if (r.status === 0 || /UserNotFoundException/.test(`${r.stderr}${r.stdout}`)) done.push(email); else pending.push(email);
    }
    return { done, pending };
}

async function runCleanup(alliedId: number): Promise<CleanupResult> {
    const c = await cleanupAllied(alliedId);
    console.log(`  borrado    base: ${c.deleted.allieds} comercio · ${c.deleted.branches} sucursal(es) · ${c.deleted.users} asesor(es) · ${c.deleted.roles} rol(es)`);
    if (HAS_POOL && c.emails.length) {
        const { done, pending } = deletePoolAccounts(c.emails);
        if (done.length) console.log(`             pool: ${done.length} cuenta(s) borrada(s)`);
        for (const email of pending) {
            console.log(`  ⚠ pool: no pude borrar ${email}. Con la sesión de AWS al día:\n      AWS_PROFILE=dev aws cognito-idp admin-delete-user --user-pool-id ${POOL_ID} --username ${email}`);
        }
    }
    return c;
}

async function main(): Promise<void> {
    if (TARGET === 'prod' || TARGET === 'production') fail('producción es sólo lectura: esta herramienta no crea ni borra nada ahí');
    console.log(`\n  harness-allied-create · ${TARGET}${HAS_POOL ? ` · pool ${POOL_ID}` : ''}`);

    // ── sólo borrar ─────────────────────────────────────────────────────────────────────────────────
    if (args['cleanup-id']) {
        const id = Number(args['cleanup-id']);
        if (!Number.isInteger(id) || id <= 0) fail(`CLEANUP_ID inválido: «${args['cleanup-id']}»`);
        try { await runCleanup(id); } catch (e) { fail((e as Error).message, 1); }
        return;
    }

    // ── sólo comprobar ──────────────────────────────────────────────────────────────────────────────
    if (args.check) {
        try {
            const { client, user, who } = await adminClientFor(TARGET);
            const form = await client.get('/aliados/crear');
            const s = form.page?.props?.settings;
            if (!s) fail(`el formulario de alta no trajo opciones (HTTP ${form.status})`, 1);
            console.log(`  ✔ sesión de admin válida en ${client.base} · actúa como ${who ?? user} (${user})`);
            console.log(`  ✔ el formulario trae ${s.alliedTypes?.length ?? 0} tipo(s), ${s.alliedIndustries?.length ?? 0} industria(s) y ${s.countries?.length ?? 0} país(es) · no se creó nada\n`);
        } catch (e) {
            if (e instanceof NoAdminSession) fail(`sin sesión de admin: ${e.message}`);
            fail((e as Error).message, 1);
        }
        return;
    }

    // ── 1) el alta por el admin ────────────────────────────────────────────────────────────────────
    let created;
    let actingAs = '';
    try {
        const { client, user, who } = await adminClientFor(TARGET);
        actingAs = `${who ?? user} (${user})`;
        console.log(`  actúa como ${actingAs}`);
        created = await createAllied(client, { name: args.name });
    } catch (e) {
        if (e instanceof NoAdminSession) fail(`sin sesión de admin: ${e.message}`);
        fail(`no se pudo crear el comercio: ${(e as Error).message}`, 1);
    }
    const flash: TestAdvisorFlash | null = created.flash;
    console.log(`  comercio   ${created.id} · ${created.name}   (alta en ${(created.ms / 1000).toFixed(1)} s)`);

    // ── 2) lo que mostró el admin, y 3) lo que dice la base ──────────────────────────────────────────
    const verified = await verifyAdvisor(created.id, HAS_POOL);
    const problems = [...verified.problems];
    if (!flash) problems.push('el admin no mostró nada del asesor de prueba (¿versión sin la función?)');
    else if (HAS_POOL && !['created', 'already_exists'].includes(flash.cognito)) {
        problems.push(`el admin dijo que la cuenta de Cognito quedó «${flash.cognito}»${flash.notes.length ? `: ${flash.notes.join(' · ')}` : ''}`);
    }
    if (verified.advisor) {
        console.log(`  asesor     ${verified.advisor.email} · sucursal ${flash?.branchName ?? '—'} (hash ${verified.advisor.branchHash ?? '—'})`);
        console.log(`  cognito    admin: ${flash?.cognito ?? '—'}  ·  base: cognito_id ${verified.advisor.hasSub ? '✔' : '—'}${HAS_POOL ? '' : '  (local no tiene pool)'}`);
    }
    for (const p of problems) console.log(`  ✖ ${p}`);

    mkdirSync(join(process.cwd(), '.runs'), { recursive: true });
    writeFileSync(join(process.cwd(), '.runs', `allied-create-${TARGET}-${created.id}.json`), JSON.stringify({
        target: TARGET, allied: created.id, name: created.name, createdBy: actingAs, advisor: verified.advisor, flash, problems, at: new Date().toISOString(),
    }, null, 2));

    // ── 4) el login del asesor, si se pidió ──────────────────────────────────────────────────────────
    let loginOk: boolean | null = null;
    if (args.login) {
        console.log('\n  ▸ login del asesor (abre una ventana)…');
        const code = await new Promise<number>((resolve) => {
            const p = spawn(process.execPath, ['dev/login-check.ts', '--targets', TARGET, '--allied', String(created.id)], { stdio: 'inherit', env: process.env });
            p.on('close', (c) => resolve(c ?? 1));
            p.on('error', () => resolve(1));
        });
        loginOk = code === 0;
        if (!loginOk) problems.push(`el login del asesor no terminó bien (código ${code})`);
    }

    // ── 5) borrar, si se pidió ───────────────────────────────────────────────────────────────────────
    if (args.cleanup) {
        console.log('');
        try { await runCleanup(created.id); } catch (e) { problems.push(`no se pudo borrar: ${(e as Error).message}`); console.log(`  ✖ ${problems[problems.length - 1]}`); }
    } else {
        console.log(`\n  queda creado. Para borrarlo:  make harness-allied-create TARGET=${TARGET} CLEANUP_ID=${created.id}`);
    }

    if (args.json) console.log(JSON.stringify({ target: TARGET, allied: created.id, name: created.name, flash, advisor: verified.advisor, loginOk, problems }, null, 2));

    // La corrida como bloque de la tarea, igual que las demás herramientas (BLOQUE=<tarea>).
    if (process.env.MD === '1' || process.env.BLOQUE) {
        const { emit, cmdMake } = await import('../pkg/annotation.ts');
        const summary = problems.length
            ? `el alta del comercio ${created.id} en ${TARGET} dejó ${problems.length} problema(s)`
            : `el alta del comercio ${created.id} en ${TARGET} dejó al asesor de prueba bien${loginOk ? ' y entró al wizard' : ''}`;
        const evidence = [
            `cognito: admin ${flash?.cognito ?? '—'}, base ${verified.advisor?.hasSub ? 'con cognito_id' : 'sin cognito_id'}`,
            `alta en ${(created.ms / 1000).toFixed(1)} s`,
            ...(loginOk === null ? [] : [`login ${loginOk ? 'entró' : 'no entró'}`]),
            ...(args.cleanup ? ['borrado al terminar'] : []),
            ...problems.map((p) => `problema: ${p}`),
        ];
        emit(summary, cmdMake('harness-allied-create', TARGET, { LOGIN: args.login ? 1 : '', CLEANUP: args.cleanup ? 1 : '' }), evidence);
    }

    console.log('');
    process.exitCode = problems.length ? 1 : 0;
}

try {
    await main();
} finally {
    await close().catch(() => { /* sin conexión abierta */ });
}
