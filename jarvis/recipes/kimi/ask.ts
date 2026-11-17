// Preguntarle a Kimi (Moonshot) por su web, sin abrirlo: en tu Chrome con Jarvis y tu sesión de kimi.ai, en la ventana
// aparte de Jarvis (minimizada). Prueba de mejor a peor (K3.1 Pro, K3, K2.8 Preview, Instantáneo) y contesta el primero
// que no dé el aviso de «muchas personas están chateando» del plan gratis.
//   make jarvis-recipe APP=kimi RECIPE=ask ARGS='--prompt "…"'
//   bin/kimi --prompt '…' [--file doc.md] [--model 'K3'] [--out r.md] [--keep] [--json]
//
// Parámetros: --prompt "texto" · --file <archivo> (el texto va primero y el --prompt después) · o el texto por stdin ·
// --model <nombre> (sólo ése, sin bajar a otro) · --out <archivo> · --keep (deja la pestaña abierta) ·
// --timeout <segundos> (600) · --json
// Necesita: Jarvis conectado en Chrome y tu sesión de Kimi abierta en kimi.ai (el login lo hacés vos, con Google).
// ⚠ ESCRIBE en tu cuenta: cada pregunta queda como un chat en el historial de Kimi (no tiene chat temporal).
// ⚠ Kimi es de Moonshot, una empresa china: lo que se manda queda en sus servidores. Nada de datos de clientes,
//   credenciales ni contexto o código interno de CreditOp sin decidirlo.
import fs from 'node:fs';
import { flag, has, JSON_OUT, say, resolvePath, readInput } from '../aistudio/page.ts';
import { openKimi, askKimi, MODEL, KIMI_MODELS } from './page.ts';

const text = readInput('prompt');
if (!text) {
    console.error("  uso: kimi --prompt '…' | --file <archivo> [--prompt 'pregunta'] | (texto por stdin) [--model 'K3'] [--out <archivo>] [--keep] [--json]");
    process.exit(2);
}
const timeoutMs = Number(flag('timeout') || 600) * 1000;
const { page, close } = await openKimi();
try {
    const r = await askKimi(page, text, { models: flag('model') ? [flag('model')!] : KIMI_MODELS, timeoutMs, log: say });
    say(`listo en ${(r.ms / 1000).toFixed(1)} s con ${r.model} (${r.format})`);
    if (flag('out')) fs.writeFileSync(resolvePath(flag('out')!), r.answer);
    if (JSON_OUT) console.log(JSON.stringify({ recipe: 'kimi/ask', model: `${MODEL}:${r.model}`, chars: text.length, ms: r.ms, format: r.format, url: r.url, answer: r.answer }));
    else console.log(r.answer);
} catch (e: any) {
    console.error(`  ✗ ${e.message || e}`);
    process.exitCode = 1;
} finally {
    if (!has('keep')) await close();
}
