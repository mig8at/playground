// Preguntarle a Groq por su web (Groq Chat), sin abrirlo: en tu Chrome con Jarvis, en la ventana aparte de Jarvis
// (minimizada). Es el ULTRA RÁPIDO: modelos abiertos a ~480 tokens por segundo. Como `bin/aistudio ask`.
//   make jarvis-recipe APP=groq RECIPE=ask ARGS='--prompt "…"'
//   bin/groq --prompt '…' [--file doc.md] [--model openai/gpt-oss-120b] [--out r.md] [--keep] [--json]
//
// Parámetros: --prompt "texto" · --file <archivo> (el texto va primero y el --prompt después) · o el texto por stdin ·
// --model <id de Groq> (openai/gpt-oss-120b por defecto; también openai/gpt-oss-20b, qwen/…) · --out <archivo> ·
// --keep (deja la pestaña abierta) · --timeout <segundos> (300) · --json
// Necesita: Jarvis conectado en Chrome. Groq Chat no tiene historial.
// ⚠ Para tareas cortas y repetidas (clasificar, resumir, sacar campos): razona menos que Hydrogen. Lo que se manda
//   pasa por los servidores de Groq: nada de datos de clientes ni credenciales.
import fs from 'node:fs';
import { flag, has, JSON_OUT, say, resolvePath, readInput } from '../aistudio/page.ts';
import { openGroq, askGroq, DEFAULT_GROQ_MODEL } from './page.ts';

const text = readInput('prompt');
if (!text) {
    console.error("  uso: groq --prompt '…' | --file <archivo> [--prompt 'pregunta'] | (texto por stdin) [--model <id>] [--out <archivo>] [--keep] [--json]");
    process.exit(2);
}
const timeoutMs = Number(flag('timeout') || 300) * 1000;
const { page, close } = await openGroq();
try {
    const r = await askGroq(page, text, { model: flag('model') || DEFAULT_GROQ_MODEL, timeoutMs, log: say });
    say(`listo en ${(r.ms / 1000).toFixed(1)} s (${r.format}${r.speed ? ', ' + r.speed : ''})`);
    if (flag('out')) fs.writeFileSync(resolvePath(flag('out')!), r.answer);
    if (JSON_OUT) console.log(JSON.stringify({ recipe: 'groq/ask', model: r.model, chars: text.length, ms: r.ms, speed: r.speed, format: r.format, answer: r.answer }));
    else console.log(r.answer);
} catch (e: any) {
    console.error(`  ✗ ${e.message || e}`);
    process.exitCode = 1;
} finally {
    if (!has('keep')) await close();
}
