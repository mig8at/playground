// DE FLUJO A RECETA. Un flujo (`jarvis/flows/<sitio>/<id>.json`) es el registro de lo que se hizo UN día: sus pasos,
// sus fotos, su video. Una receta es cómo se hace, para repetirlo cualquier día: con nombre, explicación y parámetros.
// Esto escribe el esqueleto de la receta a partir del flujo; después se pule a mano (la explicación de cada paso, qué
// comprueba al final, qué imprime). El flujo se queda donde está: es el registro.
//
//   make jarvis-recipe-from FLOW=jarvis/flows/<sitio>/<id>.json APP=<herramienta> NAME=<receta>
//
// Cada paso del flujo ya trae su línea de Playwright (`code`), con el localizador que Jarvis verificó contra la página.
// Lo que se ESCRIBIÓ o se ELIGIÓ (fill, select, press de un campo) pasa a ser un parámetro de la receta (`--<nombre>`, con
// el valor del flujo por defecto); los clics y los goto quedan como están. Un `expect` se vuelve una espera del elemento.
// Si el flujo hace algo que escribe en la herramienta (un clic en Guardar, Enviar, Borrar…), la cabecera lo dice
// («ESCRIBE: …»): la receta generada no se corre a ciegas.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const flag = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const flowPath = flag('flow');
const app = flag('app');
const name = flag('name');
const force = argv.includes('--force');
if (!flowPath || !app || !name || !/^[a-z0-9-]+$/.test(name) || !/^[a-z0-9-]+$/.test(app)) {
    console.error('  uso: from-flow --flow jarvis/flows/<sitio>/<id>.json --app <herramienta> --name <receta-en-kebab> [--force]');
    process.exit(2);
}

type Step = { action: string; target?: string; value?: string; instruction?: string; why?: string; code?: string };
const flow = JSON.parse(fs.readFileSync(path.resolve(ROOT, flowPath), 'utf8')) as { name: string; meta?: string; start?: string; steps: Step[] };

// Un nombre de parámetro a partir del rótulo del campo («Dominio de la tienda» → dominio-de-la-tienda).
const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'valor';
const fieldName = (code: string) => /name: '([^']+)'/.exec(code)?.[1] || /getByText\('([^']+)'/.exec(code)?.[1] || /getByPlaceholder\('([^']+)'/.exec(code)?.[1] || '';
const WRITES = /\b(guardar|save|enviar|send|submit|publicar|publish|borrar|eliminar|delete|remove|archivar|archive|pagar|pay|comprar|confirmar|confirm|crear|create|activar|activate|desactivar|deactivate|seleccionar)\b/i;

const params: { flag: string; def: string; label: string }[] = [];
const lines: string[] = [];
const writes: string[] = [];
const q = (s: string) => JSON.stringify(s);

// La página de partida: muchos flujos la guardan en `start` y no como paso.
if (flow.start && flow.steps[0]?.action !== 'goto') {
    lines.push(`    say(${q(`Abrí ${flow.start}`)});`);
    lines.push(`    await page.goto(${q(flow.start)}, { waitUntil: 'domcontentloaded', timeout: 90_000 });`);
}
for (const s of flow.steps) {
    const code = (s.code || '').trim();
    if (!code) continue;
    const said = (s.why || s.instruction || '').replace(/\s+/g, ' ').trim();
    if (said) lines.push(`    say(${q(said)});`);
    switch (s.action) {
    case 'fill':
    case 'select':
    case 'press': {
        const m = /\.(fill|selectOption|press)\('((?:[^'\\]|\\.)*)'\)\s*$/.exec(code);
        if (!m || s.action === 'press') { lines.push(`    await ${code};`); break; }
        let p = slug(fieldName(code) || s.target || s.action);
        while (params.some((x) => x.flag === p)) p += '-2';
        params.push({ flag: p, def: m[2].replace(/\\'/g, "'"), label: fieldName(code) || p });
        lines.push(`    await ${code.slice(0, m.index)}.${m[1]}(arg(${q(p)}));`);
        break;
    }
    case 'expect': {
        const m = /^expect\((.*)\)\.toBeVisible\(\)$/.exec(code);
        lines.push(m ? `    await ${m[1]}.waitFor({ timeout: 30_000 });` : `    // ${code}`);
        break;
    }
    case 'dialog':
        lines.push(`    ${code};`);
        break;
    default:
        if (s.action === 'click' && WRITES.test(fieldName(code) || said)) writes.push(fieldName(code) || said);
        lines.push(`    await ${code};`);
    }
}

const out = path.join(ROOT, 'jarvis/recipes', app, `${name}.ts`);
if (fs.existsSync(out) && !force) {
    console.error(`  ✗ ya existe ${path.relative(ROOT, out)} (--force lo pisa)`);
    process.exit(1);
}
const usage = `make jarvis-recipe APP=${app} RECIPE=${name}` + (params.length ? ` ARGS='${params.map((p) => `--${p.flag} ${q(p.def)}`).join(' ')}'` : '');
const header = [
    `// RECETA POR PANTALLA · ${flow.name}. (Salió del flujo ${path.relative(ROOT, path.resolve(ROOT, flowPath))}: pulí la explicación.)`,
    '//',
    `//   ${usage}`,
    '//',
    `// ${(flow.meta || flow.name).replace(/\s+/g, ' ')}`,
    '//',
    params.length ? `// Parámetros: ${params.map((p) => `--${p.flag} (${p.label}; por defecto ${q(p.def)})`).join(' · ')} · --json` : '// Parámetros: --json',
    '// Necesita: Jarvis conectado en Chrome, sin otra sesión manejándolo, y la sesión del sitio abierta en Chrome.',
    writes.length ? `// ESCRIBE: ${[...new Set(writes)].join(', ')} (revisar antes de correrla)` : '// Sólo lectura: navega y mira, no guarda nada.',
].join('\n');

const body = `${header}
import '../args.ts';
import { openChrome } from '../recorder.ts';

const argv = process.argv.slice(2);
const JSON_OUT = argv.includes('--json');
const say = (s: string) => { if (!JSON_OUT) console.log(\`  \${s}\`); };
const DEFAULTS: Record<string, string> = ${JSON.stringify(Object.fromEntries(params.map((p) => [p.flag, p.def])), null, 4).replace(/\n/g, '\n')};
const arg = (n: string) => { const i = argv.indexOf(\`--\${n}\`); return i >= 0 ? argv[i + 1] : DEFAULTS[n]; };

const { page, close } = await openChrome();
try {
${lines.join('\n')}
    const result = { recipe: ${q(`${app}/${name}`)}, url: page.url() };
    if (JSON_OUT) console.log(JSON.stringify(result));
    else say(\`listo · \${result.url}\`);
} finally {
    await close();
}
`;
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, body);
console.log(`  ✓ ${path.relative(ROOT, out)} (${flow.steps.length} pasos, ${params.length} parámetros${writes.length ? `, ESCRIBE: ${[...new Set(writes)].join(', ')}` : ''})`);
console.log(`  probala: ${usage}`);
