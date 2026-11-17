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
// texto por stdin · --model <id> (gemini-3.8-flash por defecto, como Wally: el Flash más inteligente, sin «Paid»;
// gemini-4-hydrogen para lo difícil; los ids son los del selector) · --out
// <archivo> (guarda la respuesta) · --keep · --timeout <segundos> (600 por defecto) · --json
// Necesita: Jarvis conectado en Chrome, sin otra sesión de Jarvis manejándolo, y tu sesión de Google abierta.
// ⚠ Sólo lectura en tu cuenta: no guarda nada en AI Studio. El texto viaja a Google como cuando lo pegás a mano.
// ⚠ Un uso intenso y automatizado de la web puede verse como abuso: es para preguntas tuyas, no para tandas.
import '../args.ts';
import fs from 'node:fs';
import { flag, has, JSON_OUT, say, resolvePath, readInput, openChrome, runAndWait, waitStableAnswer, copyLastAsMarkdown, noteFailure } from './page.ts';

const KEEP = has('keep');
const text = readInput('prompt');
if (!text) {
    console.error('  uso: aistudio --prompt "…" | --file <archivo> [--prompt "pregunta"] | (texto por stdin) [--model <id>] [--out <archivo>] [--keep] [--json]');
    process.exit(2);
}
const model = flag('model') || 'gemini-3.8-flash';
const timeoutMs = Number(flag('timeout') || 600) * 1000;

const { page, close } = await openChrome(model);
let ok = false;
try {
    const t0 = Date.now();
    // El modelo va por la URL (`?model=`), y SIEMPRE: AI Studio recuerda el último elegido, y si fue uno que no es de
    // chat (la transcripción, después de `transcribe`) la página que abre no tiene el campo para preguntar.
    await page.goto(`https://aistudio.google.com/prompts/new_chat?model=${encodeURIComponent(model)}`, { waitUntil: 'domcontentloaded' });
    const box = page.getByRole('textbox', { name: 'Enter a prompt' });
    try {
        await box.waitFor({ timeout: 30_000 });
    } catch {
        throw new Error(`no apareció el campo para preguntar (¿sesión de Google cerrada, o «${model}» no es un modelo de chat?): ${page.url()}`);
    }

    // El id del elegido: el texto de la tarjeta que empieza con gemini- o gemma- (el nombre va en otro elemento; su
    // texto entero viene pegado, «Hydrogengemini-4-hydrogenAn…»).
    const card = page.locator('ms-model-selector button').first();
    const modelId: string = await card.evaluate((el: Element) => {
        const leaf = [...el.querySelectorAll('*')].find((e) => !e.children.length && /^(gemini|gemma)-[\w.-]+$/.test((e.textContent || '').trim()));
        return (leaf?.textContent || el.textContent || '').trim().slice(0, 60);
    });
    if (modelId !== model) throw new Error(`quedó elegido «${modelId}», no «${model}» (¿existe ese id? son los del selector de AI Studio)`);
    // El chat temporal («Temporary chat»: no queda en el History) es lo que AI Studio abre por defecto; si alguien lo
    // cambió, se avisa en vez de llenar el History con consultas sueltas.
    if (!(await page.getByText('Temporary chat').first().isVisible().catch(() => false))) {
        say('⚠ el chat NO está en modo temporal: esta consulta va a quedar en tu History de AI Studio');
    }
    say(`modelo: ${modelId} · ${text.length.toLocaleString('es-CO')} caracteres`);

    // ⚠ Un texto grande NO va de una: con 1,2 MB en un solo `fill`, el puente de Chrome cortó la conexión (con 280 mil
    // caracteres anduvo). Viaja en pedazos a una variable de la página y al final se pone en el campo, con el evento
    // `input` que escucha Angular.
    const CHUNK = 200_000;
    if (text.length <= CHUNK) await box.fill(text);
    else {
        await page.evaluate(() => { (window as any).__jarvisText = ''; });
        for (let i = 0; i < text.length; i += CHUNK) {
            await page.evaluate((piece: string) => { (window as any).__jarvisText += piece; }, text.slice(i, i + CHUNK));
        }
        await box.evaluate((el: HTMLTextAreaElement) => {
            el.focus();
            el.value = (window as any).__jarvisText;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            delete (window as any).__jarvisText;
        });
        const got = await box.evaluate((el: HTMLTextAreaElement) => el.value.length);
        if (got !== text.length) throw new Error(`el campo quedó con ${got} caracteres de ${text.length}`);
    }
    const turnsBefore = await page.locator('ms-chat-turn').count();
    say('esperando la respuesta…');
    await runAndWait(page, timeoutMs);
    // Que vuelva «Run» no alcanza: espera a que el texto quede quieto, y corta ya si AI Studio muestra un error.
    const seen = await waitStableAnswer(page, timeoutMs);
    const turns = await page.locator('ms-chat-turn').count();
    if (turns < turnsBefore + 2 || !seen) throw new Error('AI Studio no contestó');

    // «Copy as markdown»; si no entrega, la respuesta sale del texto de la página (sin el Markdown de origen) y se avisa.
    let answer = await copyLastAsMarkdown(page);
    let format: 'markdown' | 'text' = 'markdown';
    if (!answer.trim()) {
        answer = seen;
        format = 'text';
        say('«Copy as markdown» no entregó la respuesta: sale como texto de la página (sin el Markdown de origen)');
    }
    const ms = Date.now() - t0;
    if (!answer.trim()) throw new Error('la respuesta llegó vacía');

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
