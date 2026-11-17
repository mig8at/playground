// Preguntarle a ChatGPT por su web, sin abrirlo: en tu Chrome con Jarvis y tu sesión de chatgpt.com, en la ventana
// aparte de Jarvis (minimizada) y en un CHAT TEMPORAL (no queda en tu historial). Como `bin/aistudio ask`.
//   make jarvis-recipe APP=chatgpt RECIPE=ask ARGS='--prompt "…"'
//   bin/chatgpt --prompt '…' [--file doc.md] [--think] [--keep-history] [--out r.md] [--keep] [--json]
//
// Parámetros: --prompt "texto" · --file <archivo> (el texto va primero y el --prompt después) · o el texto por stdin ·
// --think («Pensar», apagado por defecto) · --keep-history (un chat normal, que queda en el historial; por defecto es
// temporal) · --out <archivo> · --keep (deja la pestaña abierta) · --timeout <segundos> (600) · --json
// Necesita: Jarvis conectado en Chrome y tu sesión de ChatGPT abierta (el login lo hacés vos).
// ⚠ El chat temporal no queda en el historial, pero ChatGPT avisa que puede guardar una copia hasta 30 días, y puede
//   leer la memoria y las instrucciones personalizadas de la cuenta. Nada de datos de clientes ni credenciales.
import fs from 'node:fs';
import { flag, has, JSON_OUT, say, resolvePath, readInput } from '../aistudio/page.ts';
import { openChatGPT, askChatGPT, MODEL } from './page.ts';

const text = readInput('prompt');
if (!text) {
    console.error("  uso: chatgpt --prompt '…' | --file <archivo> [--prompt 'pregunta'] | (texto por stdin) [--think] [--keep-history] [--out <archivo>] [--keep] [--json]");
    process.exit(2);
}
const timeoutMs = Number(flag('timeout') || 600) * 1000;
const { page, close } = await openChatGPT();
try {
    const r = await askChatGPT(page, text, { think: has('think'), temporary: !has('keep-history'), timeoutMs, log: say });
    say(`listo en ${(r.ms / 1000).toFixed(1)} s (${r.format})`);
    if (flag('out')) fs.writeFileSync(resolvePath(flag('out')!), r.answer);
    if (JSON_OUT) console.log(JSON.stringify({ recipe: 'chatgpt/ask', model: MODEL, chars: text.length, ms: r.ms, format: r.format, answer: r.answer }));
    else console.log(r.answer);
} catch (e: any) {
    console.error(`  ✗ ${e.message || e}`);
    process.exitCode = 1;
} finally {
    if (!has('keep')) await close();
}
