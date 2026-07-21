#!/usr/bin/env node
// envget — imprime el valor de una clave resuelta por TARGET, para que el shell no tenga que
// re-implementar la cadena (`process.env` > `.env.<target>` > `env/<target>.env` > heredados).
//
// Existe porque `bin/asesor` greppeaba `.env.$TARGET` a mano: eso ignora los hechos COMPARTIDOS de
// `env/<target>.env` y, con la herencia de targets (staging → dev), quedaría siempre corto.
//
//   node bin/envget.ts E2E_BASE_URL [fallback]
import { env } from '../pkg/env.ts';

const [key, fallback = ''] = process.argv.slice(2);
if (!key) {
    console.error('uso: node bin/envget.ts <CLAVE> [fallback]');
    process.exit(2);
}
process.stdout.write(env(key, fallback));
