// RECETA · preguntarle a Gemini POR LA INTERFAZ de AI Studio, en tu Chrome y con tu cuenta, sin llave de API: usa el
// uso gratuito de la web (que deja pegar textos enormes, 400-500 mil tokens), no la cuota de una llave. Es lo mismo que
// pegar el texto y tocar Run a mano, pero desde la consola, y devuelve la respuesta en Markdown.
//
//   make jarvis-recipe APP=aistudio RECIPE=ask ARGS='--file contrato.md --model gemini-4-hydrogen'
//   bin/aistudio --file contrato.md --prompt 'Resumí las cláusulas de terminación' --out resumen.md
//   cat log.txt | bin/aistudio --prompt '¿Qué error se repite más?'
//
// Pasos: un chat nuevo (AI Studio lo abre como «Temporary chat»: no queda en tu History) → el modelo, si se pide (se
// busca por su id en el selector y queda elegido también para la próxima vez) → el texto en el campo → Run → espera a
// que «Stop» vuelva a ser «Run» → «Copy as markdown» del último turno, interceptado en la página: tu portapapeles no se
// toca. La pestaña se cierra al terminar salvo con --keep (para seguir la conversación a mano).
//
// Parámetros: --prompt "texto" · --file <archivo> (el texto va primero y el --prompt después, como pregunta) · o el
// texto por stdin · --model <id> (gemini-4-hydrogen, gemini-3.5-flash-lite…: los de la lista del selector) · --out
// <archivo> (guarda la respuesta) · --keep · --timeout <segundos> (600 por defecto) · --json
// Necesita: Jarvis conectado en Chrome, sin otra sesión de Jarvis manejándolo, y tu sesión de Google abierta.
// ⚠ Sólo lectura en tu cuenta: no guarda nada en AI Studio. El texto viaja a Google como cuando lo pegás a mano.
// ⚠ Un uso intenso y automatizado de la web puede verse como abuso: es para preguntas tuyas, no para tandas.
import '../args.ts';
import fs from 'node:fs';
import path from 'node:path';
import { openChrome } from '../recorder.ts';

const argv = process.argv.slice(2);
const flag = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const JSON_OUT = argv.includes('--json');
const KEEP = argv.includes('--keep');
const say = (s: string) => { if (!JSON_OUT) console.error(`  ${s}`); };   // el avance por stderr: stdout es la respuesta

const parts: string[] = [];
const file = flag('file');
if (file) parts.push(fs.readFileSync(path.resolve(process.env.INIT_CWD || process.cwd(), file), 'utf8'));
// stdin sólo si de verdad viene algo (un `|` o un `<`): desde un agente o un IDE suele ser un socket vacío, y leerlo
// da EAGAIN.
const stdin = (() => { try { const st = fs.fstatSync(0); return st.isFIFO() || st.isFile(); } catch { return false; } })();
if (!file && stdin) {
    const piped = fs.readFileSync(0, 'utf8');
    if (piped.trim()) parts.push(piped);
}
if (flag('prompt')) parts.push(flag('prompt')!);
const text = parts.join('\n\n').trim();
if (!text) {
    console.error('  uso: aistudio --prompt "…" | --file <archivo> [--prompt "pregunta"] | (texto por stdin) [--model <id>] [--out <archivo>] [--keep] [--json]');
    process.exit(2);
}
const model = flag('model');
const timeoutMs = Number(flag('timeout') || 600) * 1000;

const RUN = 'ms-run-button button';
// ⚠ Las esperas van como FUNCIÓN, no como texto: la página exige Trusted Types y niega evaluar un string.
const generating = () => /Stop/.test(document.querySelector('ms-run-button button')?.textContent || '');
const idle = () => !/Stop/.test(document.querySelector('ms-run-button button')?.textContent || '');

const { page, close } = await openChrome();
let ok = false;
try {
    const t0 = Date.now();
    await page.goto('https://aistudio.google.com/prompts/new_chat', { waitUntil: 'domcontentloaded' });
    const box = page.getByRole('textbox', { name: 'Enter a prompt' });
    try {
        await box.waitFor({ timeout: 30_000 });
    } catch {
        throw new Error(`no apareció el campo para preguntar (¿sesión de Google cerrada? la página está en ${page.url()})`);
    }

    const card = page.locator('ms-model-selector button').first();
    if (model) {
        await card.click();
        const search = page.getByRole('textbox', { name: 'Search' });
        await search.waitFor({ timeout: 10_000 });
        await search.fill(model);
        // La tarjeta lleva el id del modelo en un elemento propio; se toca la que lo tiene EXACTO (gemini-3.5-flash no
        // es gemini-3.5-flash-lite). Su texto entero viene pegado («Hydrogengemini-4-hydrogenAn…»): por eso no se
        // busca en él.
        const option = page.locator('ms-model-carousel-row button.content-button').filter({ has: page.getByText(model, { exact: true }) }).first();
        await option.waitFor({ timeout: 5_000 }).catch(() => {});
        if (!(await option.count())) {
            await page.keyboard.press('Escape');
            throw new Error(`no hay un modelo «${model}» en el selector de AI Studio (el id es el que figura debajo del nombre)`);
        }
        await option.click();
        await page.locator('mat-dialog-container').waitFor({ state: 'detached', timeout: 10_000 }).catch(() => {});
    }
    // El id del elegido: el texto de la tarjeta que empieza con gemini- o gemma- (el nombre va en otro elemento).
    const modelId: string = await card.evaluate((el: Element) => {
        const leaf = [...el.querySelectorAll('*')].find((e) => !e.children.length && /^(gemini|gemma)-[\w.-]+$/.test((e.textContent || '').trim()));
        return (leaf?.textContent || el.textContent || '').trim().slice(0, 60);
    });
    if (model && modelId !== model) throw new Error(`quedó elegido «${modelId}», no «${model}»`);
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
    await page.locator(RUN).click();
    // Mientras genera, el botón dice «Stop»; al terminar vuelve a «Run».
    await page.waitForFunction(generating, null, { timeout: 60_000 }).catch(() => {});
    say('esperando la respuesta…');
    await page.waitForFunction(idle, null, { timeout: timeoutMs });

    // ⚠ «Run» no alcanza para saber que terminó: entre los «Thoughts» y la respuesta hay un instante en que el botón no
    // dice «Stop» (2026-11-17: una pregunta de Miguel se leyó a medias y la copia no llegó). Se espera, además, a que el
    // texto de la respuesta quede quieto 1,5 s y el botón siga en «Run».
    const answerText = () => {
        const turns = [...document.querySelectorAll('ms-chat-turn')];
        const last = turns[turns.length - 1];
        if (!last) return '';
        return [...last.querySelectorAll('ms-text-chunk')]
            .filter((c) => !c.closest('ms-thought-chunk'))
            .map((c) => (c as HTMLElement).innerText.trim())
            .filter(Boolean)
            .join('\n\n');
    };
    let seen = '';
    let stableSince = Date.now();
    const settleUntil = Date.now() + timeoutMs;
    while (Date.now() < settleUntil) {
        const now: string = await page.evaluate(answerText);
        const running = await page.evaluate(generating);
        if (now !== seen || running) { seen = now; stableSince = Date.now(); }
        else if (now && Date.now() - stableSince >= 1500) break;
        await page.waitForTimeout(300);
    }

    // Un error de la web (cuota, texto demasiado largo, filtro) sale en un aviso abajo, no como turno.
    const notice = await page.locator('mat-snack-bar-container, .mat-mdc-snack-bar-container').first().textContent({ timeout: 1500 }).catch(() => null);
    const turns = await page.locator('ms-chat-turn').count();
    if (turns < turnsBefore + 2 || !seen) throw new Error(`AI Studio no contestó${notice ? `: ${notice.replace(/\s+/g, ' ').trim()}` : ''}`);

    // «Copy as markdown», interceptado: la página escribe en una variable en vez del portapapeles. Si no llega (el menú
    // no abrió, o la copia fue por otro lado), la respuesta sale del texto de la página: sin el Markdown de origen,
    // pero entera, y se avisa.
    let answer = '';
    let format: 'markdown' | 'text' = 'markdown';
    for (let attempt = 1; attempt <= 2 && !answer; attempt++) {
        try {
            await page.evaluate(() => {
                const w = window as any;
                w.__jarvisCopied = null;
                if (!w.__jarvisHooked) {
                    w.__jarvisHooked = true;
                    const exec = document.execCommand.bind(document);
                    (document as any).execCommand = (cmd: string, ...rest: any[]) => {
                        if (cmd === 'copy') { const el = document.activeElement as any; w.__jarvisCopied = el?.value ?? String(getSelection()); return true; }
                        return exec(cmd, ...rest);
                    };
                    if (navigator.clipboard) (navigator.clipboard as any).writeText = async (t: string) => { w.__jarvisCopied = t; };
                }
            });
            const last = page.locator('ms-chat-turn').last();
            await last.scrollIntoViewIfNeeded().catch(() => {});
            await last.hover();
            await last.locator('button[aria-label="Open options"]').click({ timeout: 5_000 });
            await page.getByRole('menuitem', { name: /Copy as markdown/ }).click({ timeout: 5_000 });
            await page.waitForFunction(() => (window as any).__jarvisCopied !== null, null, { timeout: 5_000 });
            answer = (await page.evaluate(() => (window as any).__jarvisCopied)) || '';
        } catch {
            await page.keyboard.press('Escape').catch(() => {});
        }
    }
    if (!answer.trim()) {
        answer = seen;
        format = 'text';
        say('«Copy as markdown» no entregó la respuesta: sale como texto de la página (sin el Markdown de origen)');
    }
    const ms = Date.now() - t0;
    if (!answer.trim()) throw new Error('la respuesta llegó vacía');

    const out = flag('out');
    if (out) fs.writeFileSync(path.resolve(process.env.INIT_CWD || process.cwd(), out), answer);
    say(`respondió en ${(ms / 1000).toFixed(1)} s${out ? ` · guardada en ${out}` : ''}`);
    if (JSON_OUT) console.log(JSON.stringify({ recipe: 'aistudio/ask', model: modelId, chars: text.length, ms, format, answer }));
    else if (!out) console.log(answer);
    ok = true;
} catch (e: any) {
    console.error(`  ✗ ${e.message || e}`);
    process.exitCode = 1;
} finally {
    if (KEEP && ok) say('la pestaña queda abierta en tu Chrome para seguir la conversación');
    else await close();
    if (KEEP && ok) process.exit(0);
}
