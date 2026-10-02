// dev/session.ts — las sesiones de login (admin y asesor) en un solo lugar.
//
//   make harness-sessions                                    ¿qué sesiones hay, de quién, y sirven?
//   make harness-signin KIND=admin TARGET=local              entra (local: la app emite la sesión, sin credencial)
//   make harness-signin KIND=admin TARGET=dev                entra con ADMIN_USER/ADMIN_PASS de connectors/.env.dev, con Chrome
//   make harness-signin KIND=advisor TARGET=dev [ORIGIN=…]   entra al wizard con ADVISOR_USER/ADVISOR_PASS
//   make harness-signout KIND=admin TARGET=dev               borra la sesión guardada
//
// El ADMIN lo maneja el conector (`bin/pg admin …`): acá se delega, y el asesor sigue siendo de este módulo. Entrar con usuario y
// contraseña lo corre una persona; lo guardado lo usan después las herramientas. Ningún valor de sesión se imprime. Producción no.
// Exit code: 0 bien · 1 no se pudo entrar o no sirve · 2 faltan credenciales o argumentos.
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { MissingCredentials, removeSession, sessionStatus, signIn, type SessionKind } from '../pkg/sessions.ts';
import { credentialKeys, credentialsFor, legacyCredentialHint } from '../pkg/connector-env.ts';
import { runPg } from '../pkg/pg.ts';

const { positionals, values: args } = parseArgs({
    allowPositionals: true,
    options: {
        kind: { type: 'string' }, target: { type: 'string' }, origin: { type: 'string' },
        headless: { type: 'boolean', default: false }, headed: { type: 'boolean', default: false },
    },
});
const command = positionals[0] ?? 'status';
const KINDS: SessionKind[] = ['admin', 'advisor'];
const TARGETS = ['local', 'dev', 'qa', 'staging'];

function fail(msg: string, code = 2): never {
    console.error(`\n  ✖ ${msg}\n`);
    process.exit(code);
}

function kindOf(): SessionKind {
    if (!args.kind || !KINDS.includes(args.kind as SessionKind)) fail(`falta KIND=admin|advisor (llegó «${args.kind ?? ''}»)`);
    return args.kind as SessionKind;
}
function targetOf(): string {
    const t = (args.target ?? '').toLowerCase();
    if (!t) fail('falta TARGET=local|dev|qa|staging');
    if (/^prod/.test(t)) fail('producción es sólo lectura: no se guardan sesiones de ahí');
    return t;
}

/** El admin lo maneja el conector: se le pasa el comando tal cual, con la salida a la vista. */
function viaPg(sub: string, target: string): never {
    const r = spawnSync(`${process.cwd()}/../bin/pg`, ['admin', sub, '--target', target], { stdio: 'inherit', cwd: `${process.cwd()}/..` });
    process.exit(r.status ?? 1);
}

if (command === 'status') {
    const kinds = args.kind ? [kindOf()] : KINDS;
    const targets = args.target ? [targetOf()] : TARGETS;
    const rows: Array<[string, string, string, string, string]> = [];
    for (const kind of kinds) {
        for (const target of targets) {
            if (kind === 'admin' && target === 'qa') continue;   // qa no tiene admin propio
            if (kind === 'admin') {
                // El estado del admin lo dice el conector, que es quien lo maneja.
                const r = runPg(['admin', 'status', '--target', target, '--json']);
                const row = r.status === 0 ? (JSON.parse(r.stdout) as Array<Record<string, any>>)[0] : null;
                const exists = !!row?.exists;
                const mark = !exists ? '—' : row!.valid === true ? '✅' : row!.valid === false ? '✖ ' : '? ';
                const label = !exists ? 'no hay' : row!.valid === true ? 'sirve' : row!.valid === false ? 'vencida' : 'sin saber';
                const who = exists ? `${row!.who || row!.user}${row!.who && row!.user && row!.who !== row!.user ? ` (${row!.user})` : ''}` : '';
                const when = exists && row!.since ? String(row!.since).slice(0, 16).replace('T', ' ') : '';
                rows.push([kind, target, `${mark}${label}`, who, exists ? `${when} · ${row!.detail}` : (row?.detail ?? 'no se pudo preguntar al conector')]);
                continue;
            }
            const s = await sessionStatus(kind, target, args.origin);
            const mark = !s.exists ? '—' : s.valid === true ? '✅' : s.valid === false ? '✖ ' : '? ';
            const when = s.createdAt ? s.createdAt.slice(0, 16).replace('T', ' ') : '';
            rows.push([`${kind}`, target, `${mark}${s.exists ? (s.valid === true ? 'sirve' : s.valid === false ? 'vencida' : 'sin saber') : 'no hay'}`,
                s.exists ? `${s.who ?? s.user ?? '—'}${s.who && s.user && s.who !== s.user ? ` (${s.user})` : ''}` : '', s.exists ? `${when} · ${s.motivo}` : s.motivo]);
        }
    }
    const w = (i: number) => Math.max(...rows.map((r) => r[i].length), 4);
    console.log('');
    console.log(`  ${'tipo'.padEnd(w(0))}  ${'ambiente'.padEnd(Math.max(w(1), 8))}  ${'estado'.padEnd(w(2))}  ${'quién'.padEnd(w(3))}  detalle`);
    for (const r of rows) console.log(`  ${r[0].padEnd(w(0))}  ${r[1].padEnd(Math.max(w(1), 8))}  ${r[2].padEnd(w(2))}  ${r[3].padEnd(w(3))}  ${r[4]}`);
    console.log('');
} else if (command === 'signin') {
    const kind = kindOf();
    const target = targetOf();
    if (kind === 'admin') viaPg('login', target);
    if (target !== 'local' || kind === 'advisor') {
        const creds = credentialsFor(kind, target);
        if (creds) {
            console.log(`  credencial: ${creds.user} · de ${creds.source}`);
        } else {
            const k = credentialKeys(kind);
            const old = legacyCredentialHint(kind, target);
            if (old) {
                console.error(`\n  ⚠ hay una credencial en un lugar viejo (${old.source}, de ${old.user}) y NO se usa: puede ser de otra persona.`);
            }
            fail(`faltan tus credenciales de ${kind} para ${target}: pon ${k.user} y ${k.pass} en connectors/.env.${target}`);
        }
    }
    try {
        const { path, who, session } = await signIn(kind, target, { origin: args.origin, headless: args.headless && !args.headed });
        console.log(`  ✔ ${kind} en ${target}: entró ${session.user}${who ? ` (${who})` : ''} → ${path.replace(process.env.HOME ?? '', '~')}`);
        console.log('    la sesión quedó guardada (su contenido no se muestra)\n');
    } catch (e) {
        if (e instanceof MissingCredentials) fail(e.message);
        fail(`no se pudo entrar: ${(e as Error).message}`, 1);
    }
} else if (command === 'signout') {
    const kind = kindOf();
    const target = targetOf();
    if (kind === 'admin') viaPg('logout', target);
    console.log(removeSession(kind, target, args.origin) ? `  ✔ sesión de ${kind} en ${target} borrada` : `  · no había sesión de ${kind} en ${target}`);
} else {
    fail(`comando desconocido «${command}». Los que hay: status · signin · signout`);
}
