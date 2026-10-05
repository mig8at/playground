import { parseArgs } from 'node:util';
import { advisorSession } from './session.ts';
import { advisorTarget, defaultOrigin, readSession, sessionStatus, probeSession, removeSession, MissingCredentials } from '../auth/sessions.ts';
import { credentialKeys, credentialsFor, legacyCredentialHint } from '../auth/env.ts';

class UsageError extends Error {}

/** Consola humana. No imprime cookies, passwords ni localStorage. Login nunca se ofrece por MCP. */
async function main(): Promise<void> {
    const { positionals, values: args } = parseArgs({ allowPositionals: true, options: {
        help: { type: 'boolean' }, h: { type: 'boolean' }, target: { type: 'string' }, origin: { type: 'string' }, json: { type: 'boolean' },
        headless: { type: 'boolean' }, headed: { type: 'boolean' },
    } });
    if (args.help || args.h) { console.log('pg advisor status|check|login|logout [--target local|dev|qa|staging] [--origin URL] [--json] [--headless]'); return; }
    const command = positionals[0] ?? 'status';
    if (!['status', 'check', 'login', 'logout'].includes(command) || positionals.length > 1) throw new UsageError('usa advisor status|check|login|logout');
    if (command !== 'status' && !args.target) throw new UsageError('falta --target local|dev|qa|staging');
    const targets = args.target ? [args.target] : ['local', 'dev', 'qa', 'staging'];
    try { for (const target of targets) defaultOrigin('advisor', target); }
    catch (e) { throw new UsageError((e as Error).message); }
    if (command === 'status') {
        const rows = [];
        for (const target of targets) {
            const s = await sessionStatus('advisor', target, args.origin);
            rows.push({ ...s, authTarget: advisorTarget(target, s.origin) });
        }
        if (args.json) console.log(JSON.stringify(rows));
        else for (const s of rows) console.log(`  ${s.target}: ${!s.exists ? 'no hay' : s.valid === true ? 'sirve' : s.valid === false ? 'vencida' : 'sin saber'} · ${s.user ?? '—'} · ${s.motivo}`);
        return;
    }
    const target = targets[0];
    const origin = args.origin ?? defaultOrigin('advisor', target);
    const authTarget = advisorTarget(target, origin);
    if (command === 'check') {
        const s = readSession('advisor', target, origin);
        // Aun sin caché se sondea el front: apagado no significa sesión vencida.
        const p = await probeSession(s ?? { version: 1, kind: 'advisor', target: authTarget, origin, user: '', who: null, createdAt: '', cookies: [] });
        const status = p.valid === null ? 'unreachable' : !s ? 'missing' : p.valid ? 'valid' : 'invalid';
        console.log(JSON.stringify({ target, status, detail: !s && p.valid !== null ? 'sin sesión del conector para este origen y cuenta; entra con pg advisor login' : p.motivo }));
        return;
    }
    if (command === 'logout') {
        console.log(removeSession('advisor', target, origin) ? 'sesión de asesor borrada' : 'no había sesión de asesor');
        return;
    }
    const creds = credentialsFor('advisor', authTarget);
    if (!creds) {
        const old = legacyCredentialHint('advisor', authTarget);
        if (old) console.error(`hay una credencial antigua en ${old.source}; no se usa para entrar`);
        const keys = credentialKeys('advisor');
        throw new MissingCredentials(`faltan ${keys.user} y ${keys.pass} en connectors/.env.${authTarget}`);
    }
    console.log(`credencial: ${creds.user} · ${creds.source} · pool ${authTarget}`);
    const { session, path } = await advisorSession(target, origin).signIn({ headless: !!args.headless && !args.headed });
    console.log(`entró ${session.user} → ${path} (contenido privado)`);
}
main().catch(e => { console.error((e as Error).message); process.exitCode = e instanceof MissingCredentials || e instanceof UsageError || String(e.code).startsWith('ERR_PARSE_ARGS') ? 2 : 1; });
