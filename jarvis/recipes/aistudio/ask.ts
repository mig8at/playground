// RECETA · preguntarle a Gemini POR LA INTERFAZ de AI Studio, en tu Chrome y con tu cuenta, sin llave de API: usa el
// uso gratuito de la web (que deja pegar textos enormes, 400-500 mil tokens), no la cuota de una llave. Es lo mismo que
// pegar el texto y tocar Run a mano, pero desde la consola, y devuelve la respuesta en Markdown.
//
//   make jarvis-recipe APP=aistudio RECIPE=ask ARGS='--file contrato.md --model gemini-4-hydrogen'
//   bin/aistudio --file contrato.md --prompt 'Resumí las cláusulas de terminación' --out resumen.md
//   cat log.txt | bin/aistudio --prompt '¿Qué error se repite más?'
//
// Pasos: un chat nuevo con el modelo en la URL (AI Studio lo abre como «Temporary chat»: no queda en tu History; el
// modelo queda elegido también para la próxima vez que lo abras a mano) → el texto en el campo → Run → espera a
// que «Stop» vuelva a ser «Run» → «Copy as markdown» del último turno, interceptado en la página: tu portapapeles no se
// toca. La pestaña se cierra al terminar salvo con --keep (para seguir la conversación a mano).
//
// Parámetros: --prompt "texto" · --file <archivo> (el texto va primero y el --prompt después, como pregunta) · o el
// texto por stdin · --model <id> (gemini-4-hydrogen por defecto desde el 2026-11-17, como Wally; gemini-3.8-flash
// para lo rápido; los ids son los del selector) · --thinking low|medium|high (high por defecto) · --out
// <archivo> (guarda la respuesta) · --keep · --timeout <segundos> (600 por defecto) · --json
// Necesita: Jarvis conectado en Chrome, sin otra sesión de Jarvis manejándolo, y tu sesión de Google abierta.
// ⚠ Sólo lectura en tu cuenta: no guarda nada en AI Studio. El texto viaja a Google como cuando lo pegás a mano.
// ⚠ Un uso intenso y automatizado de la web puede verse como abuso: es para preguntas tuyas, no para tandas.
import '../args.ts';
import fs from 'node:fs';
import { flag, has, JSON_OUT, say, resolvePath, readInput, openChrome, askOn, noteFailure, DEFAULT_MODEL } from './page.ts';

const KEEP = has('keep');
const text = readInput('prompt');
if (!text) {
    console.error('  uso: aistudio --prompt "…" | --file <archivo> [--prompt "pregunta"] | (texto por stdin) [--model <id>] [--thinking low|medium|high] [--out <archivo>] [--keep] [--json]');
    process.exit(2);
}
if (flag('thinking')) process.env.AISTUDIO_THINKING = flag('thinking');
const model = flag('model') || DEFAULT_MODEL;
const timeoutMs = Number(flag('timeout') || 600) * 1000;

const { page, close } = await openChrome(model);
let ok = false;
try {
    const { answer, format, modelId, ms } = await askOn(page, model, text, timeoutMs, say);

    const out = flag('out');
    if (out) fs.writeFileSync(resolvePath(out), answer);
    say(`respondió en ${(ms / 1000).toFixed(1)} s${out ? ` · guardada en ${out}` : ''}`);
    if (JSON_OUT) console.log(JSON.stringify({ recipe: 'aistudio/ask', model: modelId, chars: text.length, ms, format, answer }));
    else if (!out) console.log(answer);
    ok = true;
} catch (e: any) {
    console.error(`  ✗ ${noteFailure(String(e.message || e), model)}`);
    process.exitCode = 1;
} finally {
    if (KEEP && ok) say('la pestaña queda abierta en tu Chrome para seguir la conversación');
    else await close();
    if (KEEP && ok) process.exit(0);
}
