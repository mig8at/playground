/**
 * LAS RECETAS DE CÓDIGO: correr un pedazo de PHP adentro de la app LOCAL (legacy-backend o legacy-application, con sus
 * clases, sus modelos y su base) y ver qué devuelve, sin armar un flujo entero. Es el «corrido en local» de las
 * incidencias hecho herramienta (Miguel, 2026-11-18: «herramientas que el modelo use día a día, como un artesano»).
 *
 *   node dev/recipe.ts                                  la lista: nombre, repo, qué contesta y qué pide
 *   node dev/recipe.ts <receta> [--param valor …]       la corre (`--json`: un objeto en stdout)
 *   node dev/recipe.ts --code 'return …;' [--repo legacy-application]   el modo libre: PHP suelto, sin guardarlo
 *
 * Una receta es un archivo de `harness/recipes/<nombre>.php`: PHP normal (puede tener `use`, `const` y funciones),
 * con un comentario arriba cuya primera oración es la pregunta que contesta, y estas marcas:
 *   @repo legacy-backend|legacy-application     dónde corre (por defecto legacy-backend)
 *   @param <nombre> <qué es>                     lo que pide; adentro llega en `$params['<nombre>']`
 *   @writes                                      si escribe en la base local (y limpia)
 * Lo que la receta `return`a sale como resultado (JSON); lo que imprime, como salida.
 *
 * ⚠ SÓLO LOCAL. Antes de incluir la receta, el mismo proceso de PHP mira a qué base apunta la app y no sigue si no es
 * la del contenedor: el 2026-08-19 una prueba vació la base compartida porque el `.env` apuntaba afuera. No hay
 * `TARGET=`: no existe otra opción.
 *
 * Cada corrida deja su última vez en `.runs/recipes/<nombre>.json` (la lee la pestaña Recetas del panel) y, con
 * `BLOCK=<tarea>`, un bloque en la pila de la tarea.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { emit } from '../pkg/annotation.ts';

const HARNESS = fileURLToPath(new URL('../', import.meta.url));
const RECIPES = join(HARNESS, 'recipes');
const RUNS = join(HARNESS, '.runs', 'recipes');
const REPOS: Record<string, string> = {
      'legacy-backend': join(homedir(), 'Desktop/CREDITOP/github/legacy-backend'),
      'legacy-application': join(homedir(), 'Desktop/CREDITOP/github/legacy-application'),
};
// La base del contenedor: el servicio `mysql` de sail, o el puerto local publicado.
const LOCAL_HOSTS = ['mysql', '127.0.0.1', 'localhost'];

export type Recipe = { name: string; what: string; repo: string; params: { name: string; what: string; optional: boolean }[]; writes: boolean; file: string };

/** Lee el comentario de arriba de una receta: la pregunta (la primera oración) y las marcas. */
export function parseRecipe(file: string): Recipe {
      const src = readFileSync(file, 'utf8');
      const doc = src.match(/\/\*\*([\s\S]*?)\*\//)?.[1] ?? '';
      const lines = doc.split('\n').map((l) => l.replace(/^\s*\*\s?/, ''));
      const prose = lines.filter((l) => !l.startsWith('@')).join(' ').replace(/\s+/g, ' ').trim();
      const what = (prose.match(/^.*?[?.](?=\s|$)/)?.[0] ?? prose).trim();
      const tag = (t: string) => lines.filter((l) => l.startsWith(`@${t}`)).map((l) => l.slice(t.length + 1).trim());
      return {
            name: basename(file, '.php'),
            what,
            repo: tag('repo')[0] || 'legacy-backend',
            // `@param nombre? …`: opcional.
            params: tag('param').map((p) => { const [raw, ...rest] = p.split(/\s+/); return { name: raw.replace(/\?$/, ''), what: rest.join(' '), optional: raw.endsWith('?') }; }),
            writes: tag('writes').length > 0,
            file,
      };
}

export function listRecipes(): Recipe[] {
      if (!existsSync(RECIPES)) return [];
      return readdirSync(RECIPES).filter((f) => f.endsWith('.php')).sort().map((f) => parseRecipe(join(RECIPES, f)));
}

/** La última vez que corrió cada una (lo que muestra el panel). */
export function lastRuns(): Record<string, unknown> {
      const out: Record<string, unknown> = {};
      if (!existsSync(RUNS)) return out;
      for (const f of readdirSync(RUNS).filter((x) => x.endsWith('.json'))) {
            try { out[basename(f, '.json')] = JSON.parse(readFileSync(join(RUNS, f), 'utf8')); } catch { /* una a medias no corta la lista */ }
      }
      return out;
}

type Outcome = { ok: boolean; blocked?: string; result?: unknown; output: string; error?: string; ms: number };

/** Corre un cuerpo PHP en el repo, con la guarda de la base adelante. */
export function runPHP(repo: string, body: string, params: Record<string, string>): Outcome {
      const dir = REPOS[repo];
      if (!dir) return { ok: false, output: '', error: `repo desconocido: ${repo} (hay: ${Object.keys(REPOS).join(', ')})`, ms: 0 };
      if (!existsSync(join(dir, 'vendor/bin/sail'))) return { ok: false, output: '', error: `${repo} no tiene sail instalado en ${dir}`, ms: 0 };
      const id = `${process.pid}-${Date.now()}`;
      const bodyFile = `.harness-recipe-${id}-body.php`;
      const mainFile = `.harness-recipe-${id}.php`;
      const p64 = Buffer.from(JSON.stringify(params)).toString('base64');
      // La guarda corre en el MISMO proceso que la receta: no hay un hueco entre mirar y ejecutar.
      const main = `<?php
$__conn = config('database.default');
$__host = (string) config("database.connections.{$__conn}.host");
if (!in_array($__host, ${JSON.stringify(LOCAL_HOSTS).replaceAll('"', "'")}, true)) { echo "\\n__RECIPE_BLOCKED__ " . $__host . "\\n"; return; }
$params = json_decode(base64_decode('${p64}'), true);
echo "\\n__RECIPE_START__\\n";
try {
    $__result = require base_path('${bodyFile}');
    echo "\\n__RECIPE_END__\\n__RECIPE_RESULT__" . json_encode($__result === 1 ? null : $__result, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PARTIAL_OUTPUT_ON_ERROR) . "\\n";
} catch (\\Throwable $__e) {
    echo "\\n__RECIPE_END__\\n__RECIPE_ERROR__" . get_class($__e) . ': ' . str_replace("\\n", ' ', $__e->getMessage()) . ' (' . basename($__e->getFile()) . ':' . $__e->getLine() . ")\\n";
}
`;
      const t0 = Date.now();
      writeFileSync(join(dir, bodyFile), body);
      writeFileSync(join(dir, mainFile), main);
      let raw = '';
      try {
            const r = spawnSync('./vendor/bin/sail', ['artisan', 'tinker', mainFile], { cwd: dir, encoding: 'utf8', input: '', timeout: 180_000, maxBuffer: 32 << 20 });
            raw = `${r.stdout ?? ''}${r.stderr ?? ''}`;
            if (r.error) return { ok: false, output: '', error: `sail: ${r.error.message}`, ms: Date.now() - t0 };
      } finally {
            rmSync(join(dir, bodyFile), { force: true });
            rmSync(join(dir, mainFile), { force: true });
      }
      const ms = Date.now() - t0;
      const blocked = raw.match(/__RECIPE_BLOCKED__ (.*)/)?.[1];
      if (blocked !== undefined) return { ok: false, blocked, output: '', error: `la app de ${repo} apunta a la base «${blocked || '(vacío)'}», no a la del contenedor local: no se corre`, ms };
      const start = raw.indexOf('__RECIPE_START__');
      const end = raw.indexOf('__RECIPE_END__');
      if (start < 0 || end < 0) {
            const why = raw.split('\n').filter((l) => /error|exception|not running|cannot|refused/i.test(l)).slice(0, 4).join(' · ');
            return { ok: false, output: raw.trim().slice(-1500), error: why || 'tinker no corrió la receta (¿está arriba el contenedor? `./vendor/bin/sail ps`)', ms };
      }
      const output = raw.slice(start + '__RECIPE_START__'.length, end)
            .split('\n').filter((l) => !/Restricted Mode|DEPRECATED|Psy Shell|nullable is deprecated/.test(l)).join('\n').replace(/\n{3,}/g, '\n\n').trim();
      const err = raw.match(/__RECIPE_ERROR__(.*)/)?.[1];
      if (err) return { ok: false, output, error: err.trim(), ms };
      const json = raw.match(/__RECIPE_RESULT__(.*)/)?.[1] ?? 'null';
      let result: unknown = null;
      try { result = JSON.parse(json); } catch { result = json; }
      return { ok: true, output, result, ms };
}

// ── la consola ──────────────────────────────────────────────────────────────────────────────────────

function parseArgs(argv: string[]) {
      const flags: Record<string, string> = {};
      const positional: string[] = [];
      for (let i = 0; i < argv.length; i++) {
            const a = argv[i];
            if (a.startsWith('--')) {
                  const [k, v] = a.slice(2).split('=', 2);
                  if (v !== undefined) flags[k] = v;
                  else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) flags[k] = argv[++i];
                  else flags[k] = 'true';
            } else positional.push(a);
      }
      return { flags, positional };
}

// La línea que dice el veredicto (✓/✗) si la hay; si no, la última.
const verdictLine = (output: string) => { const ls = output.split('\n').map((l) => l.trim()).filter(Boolean); return [...ls].reverse().find((l) => /^[✓✗]/.test(l)) ?? ls.at(-1) ?? ''; }
const short = (v: unknown, n = 300) => { const s = typeof v === 'string' ? v : JSON.stringify(v); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

function main() {
      const { flags, positional } = parseArgs(process.argv.slice(2));
      const asJSON = flags.json === 'true' || process.env.JSON === '1';
      const name = positional[0];

      if (!name && !flags.code) {
            const all = listRecipes();
            if (asJSON) { console.log(JSON.stringify({ recipes: all.map(({ file, ...r }) => r), last: lastRuns() })); return 0; }
            console.log(`\n  ${all.length} recetas en harness/recipes (corren en LOCAL):\n`);
            for (const r of all) {
                  console.log(`  ${r.name.padEnd(26)} ${r.repo === 'legacy-backend' ? '' : `[${r.repo}] `}${r.writes ? '[escribe y limpia] ' : ''}${r.what}`);
                  for (const p of r.params) console.log(`  ${''.padEnd(26)}   --${p.name}  ${p.what}${p.optional ? ' (opcional)' : ''}`);
            }
            console.log(`\n  correr una: make harness-recipe NAME=<receta> ARGS='--param valor'  ·  PHP suelto: make harness-recipe CODE='return …;'\n`);
            return 0;
      }

      let recipe: Recipe | null = null;
      let body: string;
      let repo: string;
      if (flags.code) {
            const code = flags.code.trim();
            // Una expresión sola («App\Models\User::count()») se devuelve; un bloque con `;` va tal cual.
            body = `<?php\n${/;\s*$/.test(code) || /\breturn\b/.test(code) ? code : `return ${code};`}\n`;
            repo = flags.repo || 'legacy-backend';
      } else {
            const file = join(RECIPES, `${name}.php`);
            if (!existsSync(file)) {
                  console.error(`no hay receta «${name}». Las que hay: ${listRecipes().map((r) => r.name).join(', ')}`);
                  return 2;
            }
            recipe = parseRecipe(file);
            body = readFileSync(file, 'utf8');
            repo = flags.repo || recipe.repo;
            const missing = recipe.params.filter((p) => !p.optional && flags[p.name] === undefined).map((p) => `--${p.name} (${p.what})`);
            if (missing.length) { console.error(`la receta ${name} pide: ${missing.join(', ')}`); return 2; }
      }
      const params: Record<string, string> = {};
      for (const [k, v] of Object.entries(flags)) if (!['json', 'code', 'repo'].includes(k)) params[k] = v;

      const out = runPHP(repo, body, params);
      const label = recipe ? recipe.name : 'código suelto';
      if (recipe) {
            mkdirSync(RUNS, { recursive: true });
            writeFileSync(join(RUNS, `${recipe.name}.json`), JSON.stringify({ at: new Date().toISOString(), ok: out.ok, ms: out.ms, params,
                  summary: out.ok ? short(out.result ?? verdictLine(out.output), 200) : out.error }, null, 2));
      }
      if (asJSON) {
            console.log(JSON.stringify({ recipe: label, repo, ok: out.ok, ms: out.ms, result: out.result ?? null, output: out.output, error: out.error ?? null }));
      } else {
            if (out.output) console.log('\n' + out.output.split('\n').map((l) => '  ' + l).join('\n'));
            if (out.ok && out.result !== null && out.result !== undefined) console.log('\n  resultado: ' + JSON.stringify(out.result, null, 2).split('\n').join('\n  '));
            console.log(out.ok ? `\n  ✓ ${label} · ${repo} · ${(out.ms / 1000).toFixed(1)} s` : `\n  ✗ ${label}: ${out.error}`);
      }
      // El bloque: el comando con TARGET=local (el validador lo pide) y lo que dio.
      const cmdArgs = Object.entries(params).map(([k, v]) => `--${k} ${/\s/.test(v) ? `'${v}'` : v}`).join(' ');
      const cmd = recipe ? `make harness-recipe TARGET=local NAME=${recipe.name}${cmdArgs ? ` ARGS='${cmdArgs}'` : ''}`
            : `make harness-recipe TARGET=local CODE='${flags.code.replaceAll("'", "\\'")}'${flags.repo ? ` REPO=${flags.repo}` : ''}`;
      const evidence = out.ok ? [short(out.result ?? verdictLine(out.output), 600)] : [out.error ?? ''];
      // El título es la conclusión: qué receta, con qué, y qué dio (o por qué falló).
      emit(`${label}${cmdArgs ? ` ${cmdArgs}` : ''}: ${out.ok ? evidence[0] : `falló, ${out.error}`}`, cmd, evidence);
      return out.blocked !== undefined ? 2 : out.ok ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exit(main());
