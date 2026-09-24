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
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const JSON_OUT = process.argv.includes('--json');

// ⚠ EL TARGET POR ARGUMENTO, Y LOS IMPORTS DE ABAJO SON DINÁMICOS A PROPÓSITO.
//
// Este archivo anunciaba `node bin/preflight.ts [<target>]` en su propia cabecera y **nunca leía el
// argumento**: `node bin/preflight.ts qa` chequeaba `dev` —el default— y lo decía con el aplomo de
// haber chequeado qa. La herramienta que existe para cazar «un valor del ambiente resuelto en el lugar
// equivocado» lo tenía adentro.
//
// Y no alcanza con asignar la variable arriba: `pkg/env.ts` resuelve `TARGET` al EVALUAR el módulo, y
// un import estático corre ANTES de la primera sentencia del archivo. Es literalmente F-187, que ya
// costó dos runners imprimiendo «target local» mientras pegaban contra el RDS compartido.
//
// ⚠ Y el argumento sólo vale cuando esto SE CORRE. Importado —lo hace `preflight.spec.ts` para fijar el
// chequeo estático— el `argv` es del proceso anfitrión: Playwright pasa `test` como posicional, así que
// la primera versión del spec chequeó un target llamado «test» y encima el `process.exit` del final
// habría matado la corrida. Un módulo que se puede importar no puede tener el CLI en el cuerpo.
const esCLI = process.argv[1] ? fileURLToPath(import.meta.url) === resolve(process.argv[1]) : false;
const pedido = esCLI ? process.argv.slice(2).find((a) => !a.startsWith('-')) : undefined;
if (pedido) process.env.E2E_TARGET = pedido.toLowerCase();

const { TARGET, env, INHERITS } = await import('../pkg/env.ts');
const { config } = await import('../pkg/config.ts');
const { lokiConfig, porQueNo } = await import('../pkg/loki.ts');

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

// El forense de Loki apagado NO es una incoherencia: en `local` es lo correcto (el backend local corre
// con GRAFANA_LOKI_ENABLED=false y no empuja nada). Lo que sí hay que decir es cuándo está ENCENDIDO e
// incompleto: ahí la corrida termina y el bloque forense sale vacío, que se lee como "no hubo errores".
// La regla de "¿se puede consultar?" NO se reimplementa acá: se le pregunta a `porQueNo()`, que es la que
// usan el forense y los dos runners. Tener una copia propia ya falló una vez — este chequeo reportaba
// «falta E2E_LOKI_USER/TOKEN» para el target local, donde un Loki en Docker no pide credenciales. Un
// preflight que grita cuando todo está bien es un preflight que se ignora.
function lokiEstado(): string {
    const c = lokiConfig();
    const no = porQueNo(c);
    if (!no) return `${c.url}${c.hasCredentials ? ' · con credenciales' : ' · sin auth (Loki local)'}${c.env ? ` · env ${c.env}` : ''}  (connectors/.env.${TARGET})`;
    if (!c.enabled) {
        return TARGET === 'local'
            ? 'apagado (prendelo con bin/loki-local start y E2E_LOKI_ENABLED=true)'
            : 'apagado (falta el acceso al stack de este target)';
    }
    return `⚠ ENCENDIDO pero no usable: ${no}`;
}

// Informativos: no son incoherencias, pero decidir a ciegas contra data compartida es peor que saberlo.
const informativo = [
    { clave: 'front (E2E_BASE_URL)', valor: env('E2E_BASE_URL', 'http://localhost:5174') + (TARGET !== 'local' && esLocal(env('E2E_BASE_URL', 'http://localhost:5174')) ? '  (wizard local contra backend remoto: es lo esperado)' : '') },
    { clave: 'pre-aprobaciones', valor: env('E2E_REAL_PREAPPROVALS', '0') === '1' ? 'MS REAL' : 'mock local :8095' },
    { clave: 'cuenta Cognito', valor: env('E2E_COGNITO_USER') || '(de .cognito.json)' },
    { clave: 'sub del asesor', valor: env('E2E_ASESOR_SUB') || '(de .flows.json)' },
    { clave: 'APP_KEY', valor: env('APP_KEY') ? 'presente' : '⚠ AUSENTE (la inyección de buró escribiría un blob ilegible)' },
    { clave: 'escrituras', valor: TARGET === 'local' ? 'base local, sin riesgo' : 'DATA COMPARTIDA con el equipo' },
    { clave: 'forense Loki', valor: lokiEstado() },
];

const malos = chequeos.filter((c) => c.local);

// ── LA MITAD QUE ESTE PREFLIGHT NO TENÍA: quién NO le pregunta a la cadena ────────────────────────
//
// Todo lo de arriba mira VALORES RESUELTOS, y ahí está su punto ciego: un call site que nunca pregunta
// da valores resueltos perfectos y pega igual contra el ambiente equivocado. Medido el 2026-09-15,
// `pkg/ecommerce.ts` hacía `process.env.E2E_MOCK_URL ?? 'http://localhost'` y posteaba a **localhost en
// los cuatro targets** —con `E2E_TARGET=qa` leía el token de la base COMPARTIDA y escribía en la local—
// mientras este preflight decía «configuración coherente», porque lo era: nadie la había consultado.
//
// La regla es corta y no tiene excepción legítima: `env()` mira `process.env` PRIMERO, así que
// `env('X')` nunca es peor que `process.env.X` — pero sí al revés, porque `env()` NO escribe en
// `process.env` y lo que vive en `.env.<target>` es invisible desde ahí. O sea que leer del `process.env`
// pelado una clave que algún `.env.<target>` sirve es, siempre, saltarse la cadena.
//
// ⚠ Las claves NO están listadas acá: se DERIVAN de los `.env.<target>` que existan. Una lista a mano
// habría quedado vieja el día que alguien agrega una variable, que es la forma en que un chequeo empieza
// a contestar «no hay» sin haber sabido buscar.
const RAIZ = join(import.meta.dirname, '..');

function clavesDeLaCadena(): Set<string> {
    const claves = new Set<string>();
    for (const f of readdirSync(RAIZ)) {
        if (!/^\.env\.[a-z]+$/.test(f)) continue;   // los `.example` no: declaran plantilla, no ambiente
        for (const l of readFileSync(join(RAIZ, f), 'utf8').split('\n')) {
            const m = /^([A-Z0-9_]+)=/.exec(l.trim());
            if (m) claves.add(m[1]);
        }
    }
    return claves;
}

function archivosTS(dir: string, out: string[] = []): string[] {
    let entradas: string[];
    try { entradas = readdirSync(join(RAIZ, dir)); } catch { return out; }
    for (const e of entradas) {
        const rel = `${dir}/${e}`;
        if (statSync(join(RAIZ, rel)).isDirectory()) { if (e !== 'node_modules') archivosTS(rel, out); }
        else if (e.endsWith('.ts') && !e.endsWith('.spec.ts')) out.push(rel);
    }
    return out;
}

/** Los lugares que resuelven un valor del ambiente sin pasar por `env()`. */
export function fueraDeLaCadena(): Array<{ archivo: string; linea: number; clave: string }> {
    const claves = clavesDeLaCadena();
    const hallados: Array<{ archivo: string; linea: number; clave: string }> = [];
    for (const arch of ['pkg', 'dev', 'bin', 'panel', 'channel'].flatMap((d) => archivosTS(d))) {
        const lineas = readFileSync(join(RAIZ, arch), 'utf8').split('\n');
        lineas.forEach((l, i) => {
            const sinComentario = l.replace(/\/\/.*$/, '').replace(/\/\*[\s\S]*?\*\//g, '');
            for (const m of sinComentario.matchAll(/process\.env\.([A-Z0-9_]+)|process\.env\[['"`]([A-Z0-9_]+)['"`]\]/g)) {
                const clave = m[1] ?? m[2];
                // `env.ts` ES la cadena: es el único que tiene que leer `process.env`.
                if (!claves.has(clave) || arch === 'pkg/env.ts') continue;
                // 🔴 ESCRIBIR en process.env es LEGÍTIMO y la primera versión lo marcaba: `env()` mira
                // process.env PRIMERO, así que asignar ahí es justo cómo se pone un override (lo hacen
                // `pkg/ecommerce.ts` con el processUrl del caso y `dev/ecommerce.ts` con sus destinos de
                // prueba). Lo que se salta la cadena es LEER. Un chequeo que marca de más se aprende a
                // ignorar, y entonces el día que marca de verdad tampoco se mira.
                const resto = sinComentario.slice((m.index ?? 0) + m[0].length);
                if (/^\s*(=[^=]|\+=|\?\?=|\|\|=)/.test(resto)) continue;
                hallados.push({ archivo: arch, linea: i + 1, clave });
            }
        });
    }
    return hallados;
}

const fuera = fueraDeLaCadena();

if (esCLI) {
    if (JSON_OUT) {
        console.log(JSON.stringify({ target: TARGET, hereda: INHERITS || null, ok: malos.length === 0 && fuera.length === 0, chequeos, informativo, fueraDeLaCadena: fuera }));
        process.exit(malos.length || fuera.length ? 1 : 0);
    }

    console.log(`\n▶ PREFLIGHT · target ${TARGET}${INHERITS ? ` (hereda de ${INHERITS})` : ''}`);
    for (const c of chequeos) {
        console.log(`  ${c.local ? '✗' : '·'} ${c.clave.padEnd(38)} ${c.valor}${c.local ? '   ← APUNTA A TU MÁQUINA' : ''}`);
        if (c.local && c.nota) console.log(`      ${c.nota}`);
    }
    console.log('');
    for (const i of informativo) console.log(`  · ${i.clave.padEnd(38)} ${i.valor}`);

    if (fuera.length) {
        console.log(`\n  ✗ ${fuera.length} lectura(s) del ambiente FUERA de la cadena:`);
        for (const f of fuera) console.log(`      ${f.archivo}:${f.linea}  process.env.${f.clave}`);
        console.log(`    \`env()\` NO escribe en process.env, así que lo que declara .env.${TARGET} es invisible`);
        console.log(`    ahí: ese valor no cambia con el target. Cambialo por \`env('<clave>')\` (o por`);
        console.log(`    \`config.mockUrl\` si es el backend). Es la firma de F-65 y de F-187.\n`);
    }

    if (malos.length) {
        console.log(`\n  ✗ ${malos.length} valor(es) apuntan a localhost con target '${TARGET}'.`);
        console.log(`    Eso mezcla ambientes: se lee de un lado y se escribe en otro, y el síntoma aparece`);
        console.log(`    lejos del origen (un 500 en /lenders, un mapa vacío). Revisá harness/.env.${TARGET}`);
        console.log(`    antes de correr.\n`);
    }
    if (malos.length || fuera.length) process.exit(1);
    console.log(`\n  ✓ configuración coherente para '${TARGET}', y nadie resuelve el ambiente por fuera de la cadena\n`);
}
