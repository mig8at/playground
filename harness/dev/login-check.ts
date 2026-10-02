// dev/login-check.ts — ¿el ASESOR DE PRUEBA de un comercio entra al wizard en cada ambiente?
//
//   make harness-login-check ALLIED=346 TARGETS=dev,qa,staging
//   make harness-login-check ALLIED=last BLOQUE=98     el comercio recién creado, y la prueba queda en la tarea
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
// Va CON ventana, como el panel (`HEADLESS=1` la quita). ⚠ Contra qa y staging el Managed Login corta la
// automatización sin ventana (F-66): ahí va con ventana siempre.
import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';

const { values: args } = parseArgs({
    options: {
        targets: { type: 'string', default: 'dev' },
        allied: { type: 'string' },
        user: { type: 'string' },
        headless: { type: 'boolean', default: false },
        child: { type: 'boolean', default: false },
        json: { type: 'boolean', default: false },
        'no-restart': { type: 'boolean', default: false },
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
    const { discoverHostedUi, findTestAdvisor, latestTestAdvisor, notProbed, probeLogin } = await import('../pkg/login-probe.ts');
    const { close } = await import('../pkg/db.ts');

    const emit = (r: object): never => {
        console.log(RESULT_MARK + JSON.stringify(r));
        process.exit(0);
    };
    const finish = async (r: object): Promise<never> => { await close().catch(() => {}); return emit(r); };

    // Si el front es el wizard LOCAL, que esté al día con su propia configuración: Vite lee el `.env` una sola vez
    // y un cambio de login sin reiniciar hace probar el login viejo (2026-10-02). Si no lo está, se reinicia solo.
    if (/^(localhost|127\.0\.0\.1)$/.test(new URL(config.feBaseUrl).hostname) && !args['no-restart']) {
        const { ensureWizard } = await import('../pkg/wizard-health.ts');
        const w = await ensureWizard();
        if (w.estado !== 'sano') console.error(`  wizard: ${w.estado} — ${w.detalle}${w.reasons.length ? ` (${w.reasons.join('; ')})` : ''}`);
        if (w.estado === 'falló') return finish(notProbed({ veredicto: 'no se pudo probar', detalle: `el wizard local no quedó al día: ${w.detalle}` }));
    }

    const { hosted, motivo } = await discoverHostedUi(config.feBaseUrl);
    if (!hosted) return finish(notProbed({ veredicto: 'no se pudo probar', detalle: motivo }));

    let advisor = null;
    let user = args.user ?? '';
    if (args.allied) {
        try {
            // `last` = el asesor de prueba más reciente del ambiente (el comercio que se acaba de crear).
            advisor = args.allied === 'last' ? await latestTestAdvisor() : await findTestAdvisor(Number(args.allied));
        } catch (e) {
            return finish(notProbed({ veredicto: 'no se pudo probar', hosted, detalle: `no pude leer la base de ${TARGET}: ${(e as Error).message.split('\n')[0].slice(0, 120)}` }));
        }
        if (!advisor) return finish(notProbed({ veredicto: 'no se pudo probar', hosted, detalle: args.allied === 'last' ? `no hay ningún asesor de prueba en ${TARGET}` : `el comercio ${args.allied} no tiene asesor de prueba en ${TARGET}` }));
        if (!advisor.hasSub) return finish(notProbed({ veredicto: 'no entró', hosted, user: advisor.email, advisor, detalle: 'el asesor existe pero su fila no tiene cognito_id: el backend no lo reconocería' }));
        user = advisor.email;
    }
    if (!user) return finish(notProbed({ veredicto: 'sin clave', hosted, detalle: 'login descubierto; falta ALLIED=<id> o ACCOUNT=<correo> para entrar' }));

    const pass = env('ALLIED_TEST_ADVISOR_PASSWORD');
    if (!pass) return finish(notProbed({ veredicto: 'sin clave', hosted, user, advisor, detalle: `${advisor ? 'login y asesor encontrados' : 'login descubierto'}; falta ALLIED_TEST_ADVISOR_PASSWORD para entrar` }));

    // Con ventana por defecto, como el panel: se ve quién entra y dónde se queda. `--headless` la quita, salvo
    // en qa y staging, donde el Managed Login corta la automatización sin ventana (F-66).
    const headless = args.headless && !HEADED_ALWAYS.has(TARGET);
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
                ...(args.headless ? ['--headless'] : []), ...(args['no-restart'] ? ['--no-restart'] : [])],
            // E2E_PREVIEW=1: ventana acomodada como la del panel. El autorrelleno del harness se apaga: llena
            // pantallas del wizard y no tiene nada que hacer en el formulario de Cognito.
            { env: { ...process.env, E2E_TARGET: target, E2E_AUTORELLENO: '0', ...(args.headless ? {} : { E2E_PREVIEW: '1' }) }, stdio: ['ignore', 'pipe', 'inherit'] });
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

    // Un bloque es un hecho con fecha: sólo si alguien INTENTÓ entrar. «Sin clave» o «no se pudo probar» no
    // prueban nada, y anotarlos llenaría la pila de corridas que no corrieron.
    const attempted = results.some((r) => r.veredicto === 'entró' || r.veredicto === 'no entró');
    if (process.env.BLOQUE && !attempted) console.log('  ▸ no se agregó bloque: ningún ambiente llegó a intentar el login');
    if ((process.env.MD === '1' || process.env.BLOQUE) && attempted) {
        const entered = results.filter((r) => r.veredicto === 'entró').length;
        const who = results.find((r) => r.advisor)?.advisor;
        const summary = `${entered}/${results.length} ambiente(s) dejaron entrar al asesor de prueba${who ? ` del comercio ${who.alliedId}` : ''}.`;
        const evidence = results.map((r) => `${r.veredicto === 'entró' ? '✔' : '✘'} ${r.target} — ${r.veredicto}: ${r.detalle}${r.hosted ? ` (login ${r.hosted.host})` : ''}`);
        const { emit, cmdMake } = await import('../pkg/annotation.ts');
        emit(summary, cmdMake('harness-login-check', targets.join(','), { ALLIED: args.allied, ACCOUNT: args.user, TARGETS: targets.join(',') }), evidence);
    }
    process.exit(exitCodeOf(results));
}
