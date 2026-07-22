#!/usr/bin/env node
// preflight — ¿la configuración de ESTE target es coherente? Resuelve cada valor que depende del
// ambiente por la cadena real y marca el que apunte a localhost cuando el target NO es local.
//
//   node bin/preflight.ts [<target>] [--json]
//
// POR QUÉ EXISTE. Tres bugs de la misma semana fueron el MISMO bug —un valor dependiente del ambiente
// resuelto por fuera de la cadena, fallando en silencio—:
//   F-59  `bin/asesor` greppeaba `.env.$TARGET` a mano  → moría mudo
//   F-64  `/api/lenders` se tragaba el error            → mapa vacío, indistinguible de "no hay datos"
//   F-65  `'http://localhost'` como default             → registraba al cliente en la base equivocada
// Los tres se cazan acá ANTES de la primera corrida, porque la firma es siempre la misma: contra dev o
// staging, algo sigue apuntando a tu máquina.
//
// Exit code: 0 coherente · 1 hay incoherencias · 2 no se pudo resolver.
import { TARGET, env, INHERITS } from '../pkg/env.ts';
import { config } from '../pkg/config.ts';

const JSON_OUT = process.argv.includes('--json');

/** ¿La URL/host apunta a la máquina local? */
const esLocal = (v: string) => /(^|\/\/)(localhost|127\.0\.0\.1|::1)(:|\/|$)/.test(v.trim());

type Chequeo = { clave: string; valor: string; local: boolean; nota?: string };

// `derivado` marca los valores que NO son una variable suelta sino el resultado de resolverla: son los
// peligrosos, porque el `.env` puede verse bien y el valor efectivo estar mal (fue exactamente F-65).
// El FRONT queda fuera del chequeo a propósito: en `local` y en `dev` el wizard corre en tu :5174 por
// diseño (solo el backend es remoto en dev). Marcarlo sería un falso positivo, y un chequeo que grita
// cuando todo está bien se ignora enseguida — que es la forma de que después no se vea el grito real.
const checks: Array<{ clave: string; valor: string; derivado?: boolean; nota?: string }> = [
    { clave: 'backend (E2E_API_BASE_URL)', valor: env('E2E_API_BASE_URL', '(sin definir)') },
    { clave: 'backend efectivo (config.mockUrl)', valor: config.mockUrl, derivado: true,
      nota: 'lo usa el sembrado headless para registrar al cliente sintético' },
    { clave: 'BD (E2E_DB_HOST)', valor: env('E2E_DB_HOST', '127.0.0.1') },
    { clave: 'forms (VITE_ONBOARDING_FORM_SERVICE)', valor: env('VITE_ONBOARDING_FORM_SERVICE', '(del .env del wizard)') },
];

const chequeos: Chequeo[] = checks.map((c) => ({
    clave: c.clave, valor: c.valor, nota: c.nota,
    // En `local` apuntar a localhost es LO CORRECTO: la incoherencia es solo contra un target remoto.
    local: TARGET !== 'local' && esLocal(c.valor),
}));

// Informativos: no son incoherencias, pero decidir a ciegas contra data compartida es peor que saberlo.
const informativo = [
    { clave: 'front (E2E_BASE_URL)', valor: env('E2E_BASE_URL', 'http://localhost:5174') + (TARGET !== 'local' && esLocal(env('E2E_BASE_URL', 'http://localhost:5174')) ? '  (wizard local contra backend remoto: es lo esperado)' : '') },
    { clave: 'pre-aprobaciones', valor: env('E2E_REAL_PREAPPROVALS', '0') === '1' ? 'MS REAL' : 'mock local :8095' },
    { clave: 'cuenta Cognito', valor: env('E2E_COGNITO_USER') || '(de .cognito.json)' },
    { clave: 'sub del asesor', valor: env('E2E_ASESOR_SUB') || '(de .flows.json)' },
    { clave: 'APP_KEY', valor: env('APP_KEY') ? 'presente' : '⚠ AUSENTE (la inyección de buró escribiría un blob ilegible)' },
    { clave: 'escrituras', valor: TARGET === 'local' ? 'base local, sin riesgo' : 'DATA COMPARTIDA con el equipo' },
];

const malos = chequeos.filter((c) => c.local);

if (JSON_OUT) {
    console.log(JSON.stringify({ target: TARGET, hereda: INHERITS || null, ok: malos.length === 0, chequeos, informativo }));
    process.exit(malos.length ? 1 : 0);
}

console.log(`\n▶ PREFLIGHT · target ${TARGET}${INHERITS ? ` (hereda de ${INHERITS})` : ''}`);
for (const c of chequeos) {
    console.log(`  ${c.local ? '✗' : '·'} ${c.clave.padEnd(38)} ${c.valor}${c.local ? '   ← APUNTA A TU MÁQUINA' : ''}`);
    if (c.local && c.nota) console.log(`      ${c.nota}`);
}
console.log('');
for (const i of informativo) console.log(`  · ${i.clave.padEnd(38)} ${i.valor}`);

if (malos.length) {
    console.log(`\n  ✗ ${malos.length} valor(es) apuntan a localhost con target '${TARGET}'.`);
    console.log(`    Eso mezcla ambientes: se lee de un lado y se escribe en otro, y el síntoma aparece`);
    console.log(`    lejos del origen (un 500 en /lenders, un mapa vacío). Revisá env/${TARGET}.env y`);
    console.log(`    frontend-e2e/.env.${TARGET} antes de correr.\n`);
    process.exit(1);
}
console.log(`\n  ✓ configuración coherente para '${TARGET}'\n`);
