// Adaptador del panel: mismo JSON y exit 0; la comprobación real pertenece al conector.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { config } from '../pkg/config.ts';
import { TARGET } from '../pkg/env.ts';
const cli = fileURLToPath(new URL('../../connectors/advisor/cli.ts', import.meta.url));
const result = spawnSync(process.execPath, [cli, 'check', '--target', TARGET, '--origin', config.feBaseUrl], { encoding: 'utf8', timeout: 25_000 });
if (result.status === 0 && result.stdout.trim()) console.log(result.stdout.trim());
else console.log(JSON.stringify({ target: TARGET, status: 'unreachable', detail: 'no se pudo consultar la sesión del conector' }));
