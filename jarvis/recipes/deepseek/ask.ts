// Preguntarle a DeepSeek por su web, sin abrirla: en tu Chrome con Jarvis y tu sesión de chat.deepseek.com, en la
// ventana aparte de Jarvis (minimizada). Como `bin/aistudio ask`, pero contra DeepSeek.
//   make jarvis-recipe APP=deepseek RECIPE=ask ARGS='--prompt "…"'
//   bin/deepseek --prompt '…' [--file doc.md] [--no-think] [--search] [--out r.md] [--keep] [--json]
//
// Parámetros: --prompt "texto" · --file <archivo> (el texto va primero y el --prompt después) · o el texto por stdin ·
// --no-think (sin «Pensamiento Profundo», que va prendido por defecto) · --search («Búsqueda inteligente», apagada por
// defecto) · --out <archivo> · --keep (deja la pestaña abierta) · --timeout <segundos> (600) · --json
// Necesita: Jarvis conectado en Chrome y tu sesión de DeepSeek abierta (el login lo hacés vos).
// ⚠ ESCRIBE en tu cuenta: cada pregunta queda como un chat en el historial de DeepSeek (no tiene chat temporal).
// ⚠ DeepSeek es una empresa china y lo que se manda queda en sus servidores: nada de datos de clientes, credenciales ni
//   código o contexto interno de CreditOp sin decidirlo.
import fs from 'node:fs';
import { flag, has, JSON_OUT, say, resolvePath, readInput } from '../aistudio/page.ts';
import { openDeepSeek, askDeepSeek, MODEL } from './page.ts';

const text = readInput('prompt');
if (!text) {
    console.error("  uso: deepseek --prompt '…' | --file <archivo> [--prompt 'pregunta'] | (texto por stdin) [--no-think] [--search] [--out <archivo>] [--keep] [--json]");
    process.exit(2);
}
const timeoutMs = Number(flag('timeout') || 600) * 1000;
const { page, close } = await openDeepSeek();
try {
    const r = await askDeepSeek(page, text, { think: !has('no-think'), search: has('search'), timeoutMs, log: say });
    say(`listo en ${(r.ms / 1000).toFixed(1)} s (${r.format}) · el chat quedó en ${r.url}`);
    if (flag('out')) fs.writeFileSync(resolvePath(flag('out')!), r.answer);
    if (JSON_OUT) console.log(JSON.stringify({ recipe: 'deepseek/ask', model: MODEL, chars: text.length, ms: r.ms, format: r.format, url: r.url, answer: r.answer }));
    else console.log(r.answer);
} catch (e: any) {
    console.error(`  ✗ ${e.message || e}`);
    process.exitCode = 1;
} finally {
    if (!has('keep')) await close();
}
