#!/usr/bin/env node
// flows — el registro de comercios (`harness.json`) por terminal, para lo que no puede importar `pkg/flows.ts` (bash).
// Para agregar, asociar o revisar comercios: `bin/merchants.ts` (`make harness-merchants`).
//
//   node bin/flows.ts branch <comercio> <ambiente>       la sucursal contra la que se corre ('' si no la sabe)
//   node bin/flows.ts phone <comercio>                   el teléfono de bypass del comercio, o el general
//   node bin/flows.ts set <comercio> <ambiente> <hash>   anota la sucursal en la base de ese ambiente
//   node bin/flows.ts migrate                            reescribe el registro en el formato nuevo
//   node bin/flows.ts show                               el registro, ya en el formato nuevo
//
// El formato y por qué: `pkg/flows.ts`.
import { readFlows, writeFlows, branchFor, setBranch, FLOWS_FILE } from '../pkg/flows.ts';

const [cmd = 'show', a, b, c] = process.argv.slice(2);
if (cmd === 'branch') process.stdout.write(branchFor(a ?? '', b ?? 'local'));
else if (cmd === 'phone') { const f = readFlows(); process.stdout.write(f.merchants[a ?? '']?.otp_bypass_phone || f.otp_bypass_phone || ''); }
else if (cmd === 'set') { setBranch(a ?? '', b ?? 'local', c ?? ''); console.log(`✓ ${a} → ${c} en ${b}`); }
else if (cmd === 'migrate') { writeFlows(readFlows()); console.log(`✓ ${FLOWS_FILE} en el formato nuevo`); }
else if (cmd === 'show') console.log(JSON.stringify(readFlows(), null, 2));
else { console.error(`no conozco «${cmd}»: branch · phone · set · migrate · show`); process.exit(1); }
