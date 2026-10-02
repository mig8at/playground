// dev/login-check.ts — ¿el ASESOR DE PRUEBA de un comercio entra al wizard en cada ambiente?
//
//   make harness-login-check ALLIED=346 TARGETS=dev,qa,staging
//   make harness-login-check TARGETS=dev,qa,staging             (sólo descubre a qué login manda cada front)
//
// Por cada ambiente lanza UN PROCESO HIJO con `E2E_TARGET` propio, porque la config del harness (front,
// cache, pool) se resuelve una vez al importar y no se puede cambiar dentro de un proceso. El hijo hace
// tres cosas, de la más barata a la más cara:
//
//   1. descubre a qué login alojado manda el front (un fetch; sin clave ni navegador),
//   2. busca el asesor de prueba del comercio en la base del ambiente (sólo lectura),
//   3. si hay clave, entra de verdad en un contexto limpio.
//
// La clave del asesor de prueba es compartida y sale de `ALLIED_TEST_ADVISOR_PASSWORD` (shell o
// `harness/.env.<target>`): nunca por la línea de comandos y nunca se imprime. Sin ella, el recorrido
// llega hasta el paso 2 y lo dice (`sin clave`).
//
// Exit code = veredicto: 0 todos entraron · 1 alguno no entró · 2 alguno no se pudo probar.
//
// ⚠ Contra qa y staging el Managed Login corta la automatización sin ventana (F-66): ahí va con ventana.
import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';

const { values: args } = parseArgs({
    options: {
        targets: { type: 'string', default: 'dev' },
        allied: { type: 'string' },
        user: { type: 'string' },
        headed: { type: 'boolean', default: false },
        child: { type: 'boolean', default: false },
        json: { type: 'boolean', default: false },
    },
});

const HEADED_ALWAYS = new Set(['qa', 'staging']);
const PROTECTED = new Set(['prod', 'production']);
const RESULT_MARK = 'LOGIN_RESULT ';

if (args.child) {
    await runChild();
} else {
    await runParent();
}

/** El hijo: un ambiente, el de `E2E_TARGET`. Imprime su resultado como UNA línea marcada. */
async function runChild(): Promise<void> {
    const { chromium } = await import('@playwright/test');
    const { env, TARGET } = await import('../pkg/env.ts');
    const { config } = await import('../pkg/config.ts');
    const { discoverHostedUi, findTestAdvisor, notProbed, probeLogin } = await import('../pkg/login-probe.ts');
    const { close } = await import('../pkg/db.ts');

    const emit = (r: object): never => {
        console.log(RESULT_MARK + JSON.stringify(r));
        process.exit(0);
    };
    const finish = async (r: object): Promise<never> => { await close().catch(() => {}); return emit(r); };

    const { hosted, motivo } = await discoverHostedUi(config.feBaseUrl);
    if (!hosted) return finish(notProbed({ veredicto: 'no se pudo probar', detalle: motivo }));

    let advisor = null;
    let user = args.user ?? '';
    if (args.allied) {
        try {
            advisor = await findTestAdvisor(Number(args.allied));
        } catch (e) {
            return finish(notProbed({ veredicto: 'no se pudo probar', hosted, detalle: `no pude leer la base de ${TARGET}: ${(e as Error).message.split('\n')[0].slice(0, 120)}` }));
        }
        if (!advisor) return finish(notProbed({ veredicto: 'no se pudo probar', hosted, detalle: `el comercio ${args.allied} no tiene asesor de prueba en ${TARGET}` }));
        if (!advisor.hasSub) return finish(notProbed({ veredicto: 'no entró', hosted, user: advisor.email, advisor, detalle: 'el asesor existe pero su fila no tiene cognito_id: el backend no lo reconocería' }));
        user = advisor.email;
    }
    if (!user) return finish(notProbed({ veredicto: 'sin clave', hosted, detalle: 'login descubierto; falta ALLIED=<id> o ACCOUNT=<correo> para entrar' }));

    const pass = env('ALLIED_TEST_ADVISOR_PASSWORD');
    if (!pass) return finish(notProbed({ veredicto: 'sin clave', hosted, user, advisor, detalle: `${advisor ? 'login y asesor encontrados' : 'login descubierto'}; falta ALLIED_TEST_ADVISOR_PASSWORD para entrar` }));

    const headless = !(args.headed || HEADED_ALWAYS.has(TARGET));
    const browser = await chromium.launch({ headless });
    try {
        return await finish(await probeLogin(browser, { user, pass, hosted, advisor, expectedBranch: advisor?.branchHash }));
    } finally {
        await browser.close().catch(() => {});
    }
}

/** El padre: un hijo por ambiente, en serie (qa y staging abren ventana; en paralelo se pisarían). */
async function runParent(): Promise<void> {
    const { exitCodeOf, notProbed, renderLoginTable } = await import('../pkg/login-probe.ts');
    type R = ReturnType<typeof notProbed>;
    const targets = (args.targets ?? 'dev').split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);

    const bad = targets.filter((t) => PROTECTED.has(t));
    if (bad.length) {
        console.error(`✖ ${bad.join(', ')}: producción es sólo lectura, y entrar crea una sesión. No se prueba el login ahí.`);
        process.exit(2);
    }

    const results: R[] = [];
    for (const target of targets) {
        console.error(`▸ ${target} …`);
        const out = await new Promise<string>((resolve) => {
            const p = spawn(process.execPath, [new URL(import.meta.url).pathname, '--child', '--targets', target,
                ...(args.allied ? ['--allied', args.allied] : []), ...(args.user ? ['--user', args.user] : []),
                ...(args.headed ? ['--headed'] : [])],
            { env: { ...process.env, E2E_TARGET: target }, stdio: ['ignore', 'pipe', 'inherit'] });
            let buf = '';
            p.stdout.on('data', (d) => { buf += d; });
            p.on('close', () => resolve(buf));
            p.on('error', () => resolve(buf));
        });
        const line = out.split('\n').find((l) => l.startsWith(RESULT_MARK));
        const r: R = line
            ? { ...notProbed({ veredicto: 'no se pudo probar', detalle: '' }), ...JSON.parse(line.slice(RESULT_MARK.length)) }
            : { ...notProbed({ veredicto: 'no se pudo probar', detalle: 'el proceso no devolvió resultado' }), target };
        r.target = target;
        results.push(r);
    }

    if (args.json) {
        console.log(JSON.stringify(results, null, 2));
    } else {
        console.log('');
        console.log(renderLoginTable(results));
        const wrongBranch = results.filter((r) => r.branchMatches === false);
        if (wrongBranch.length) console.log(`\n  ⚠ entró a otra sucursal en: ${wrongBranch.map((r) => r.target).join(', ')}`);
        console.log('');
    }

    if (process.env.MD === '1' || process.env.BLOQUE) {
        const entered = results.filter((r) => r.veredicto === 'entró').length;
        const summary = `${entered}/${results.length} ambiente(s) dejaron entrar al asesor de prueba${args.allied ? ` del comercio ${args.allied}` : ''}.`;
        const evidence = results.map((r) => `${r.veredicto === 'entró' ? '✔' : '✘'} ${r.target} — ${r.veredicto}: ${r.detalle}${r.hosted ? ` (login ${r.hosted.host})` : ''}`);
        const { emit, cmdMake } = await import('../pkg/annotation.ts');
        emit(summary, cmdMake('harness-login-check', targets.join(','), { ALLIED: args.allied, ACCOUNT: args.user, TARGETS: targets.join(',') }), evidence);
    }
    process.exit(exitCodeOf(results));
}
