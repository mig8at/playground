// Adaptador de consola: admin y asesor pertenecen a connectors.
import { parseArgs } from 'node:util';
import { runPg } from '../pkg/pg.ts';
const { positionals, values: args } = parseArgs({ allowPositionals: true, options: {
    kind: { type: 'string' }, target: { type: 'string' }, origin: { type: 'string' }, merchant: { type: 'string' },
    headless: { type: 'boolean' }, headed: { type: 'boolean' },
} });
const command = positionals[0] ?? 'status';
function fail(message: string): never { console.error(message); process.exit(2); }
if (!['status', 'signin', 'signout'].includes(command)) fail('usa status|signin|signout');
if (args.kind && !['admin', 'advisor'].includes(args.kind)) fail('KIND=admin|advisor');
if (command !== 'status' && (!args.kind || !args.target)) fail('faltan KIND y TARGET');
const kinds = args.kind ? [args.kind] : ['admin', 'advisor'];
// El asesor es el de PRUEBA del comercio (`c<hash>-fake@`, lo crea el admin con cada comercio), con la clave compartida
// del ambiente. `--merchant` (slug o hash) lo resuelve.
let account = '';
if (args.merchant) {
    const { execFileSync } = await import('node:child_process');
    let r: any = null;
    try { r = JSON.parse(execFileSync(process.execPath, ['bin/dbops.ts', 'test-advisor', args.merchant], { encoding: 'utf8', env: { ...process.env, E2E_TARGET: args.target || process.env.E2E_TARGET || 'local' } })); } catch { }
    if (!r?.ok || !r.email) fail(`sin asesor de prueba para «${args.merchant}»: ${r?.motivo ?? 'no pude consultarlo'}`);
    account = r.email;
    console.log(`  asesor de prueba de ${args.merchant}: ${account}`);
}
for (const kind of kinds) {
    const sub = command === 'signin' ? 'login' : command === 'signout' ? 'logout' : 'status';
    const flags = [...(args.target ? ['--target', args.target] : []),
        ...(kind === 'advisor' && args.origin ? ['--origin', args.origin] : []),
        ...(kind === 'advisor' && account ? ['--account', account] : []),
        ...(kind === 'advisor' && command === 'signin' && args.headless && !args.headed ? ['--headless'] : [])];
    const result = runPg([kind, sub, ...flags]);
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.status !== 0) { process.exitCode = result.status; break; }
}
