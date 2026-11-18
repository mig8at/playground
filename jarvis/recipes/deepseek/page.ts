// Lo que comparten las recetas de DeepSeek: preguntarle a chat.deepseek.com por su web, en el Chrome de la persona con
// Jarvis y con su sesión, como las de AI Studio (jarvis/recipes/aistudio/). No es una receta: no tiene línea de uso.
//
// Aprendido el 2026-11-17 con Jarvis (el flujo: jarvis/flows/chat-deepseek-com/):
// - `/` es un chat nuevo; sin sesión manda a `/sign_in` (el login lo hace la persona, a mano).
// - El campo es el textbox «Mensaje a DeepSeek»; Enter manda.
// - Dos interruptores `.ds-toggle-button` con `aria-pressed`: «Pensamiento Profundo» (razonar antes de contestar) y
//   «Búsqueda inteligente» (buscar en la web). DeepSeek recuerda el último estado: la receta los pone en cada pregunta.
// - Cada mensaje es un `.ds-message`; la respuesta va en `.ds-markdown.ds-assistant-message-main-content` (el
//   razonamiento, en otro bloque). El botón de enviar (el círculo) queda `ds-button--disabled` con el campo vacío, y
//   mientras genera es «detener».
// - ⚠ La conversación es una lista VIRTUAL (`.ds-virtual-list-visible-items`), como AI Studio: lo que queda fuera de la
//   pantalla puede no estar dibujado. Se trae el último mensaje a la vista antes de leerlo.
// - ⚠ A diferencia de AI Studio, NO hay chat temporal: cada pregunta queda en el historial de la cuenta.
// - Un mensaje de ~130 mil caracteres no entra («El contenido es demasiado largo»; 109 mil sí): lo largo va en trozos en
//   el mismo chat (`splitText`, `CHUNK`), los primeros con «no contestes, respondé OK».
import { openWorkPage, recordUse } from '../aistudio/page.ts';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const MODEL = 'deepseek-web';

/** Conecta con Chrome por Jarvis y abre una pestaña en la ventana aparte (como el pool de AI Studio). */
export async function openDeepSeek() {
    const status = await (await fetch('http://127.0.0.1:5203/api/chrome')).json();
    if (!status.connected) throw new Error('Jarvis no está conectado en Chrome (abrí Chrome o tocá el ícono de Jarvis)');
    if (status.driving) throw new Error('hay una sesión de Jarvis manejando Chrome: cerrala (bin/jarvis close)');
    const cache = path.join(os.homedir(), 'Library/Caches/ms-playwright-go');
    const version = fs.readdirSync(cache).filter((d) => fs.existsSync(path.join(cache, d, 'package'))).sort().pop()!;
    const { chromium } = await import(path.join(cache, version, 'package', 'index.mjs'));
    const browser = await chromium.connectOverCDP('ws://127.0.0.1:5203/api/chrome/cdp', { timeout: 20_000 });
    const page = await openWorkPage(browser);
    const close = async () => { await page.close().catch(() => {}); await browser.close().catch(() => {}); };
    return { browser, page, close };
}

/** Prende o apaga un interruptor («Pensamiento Profundo», «Búsqueda inteligente») según `on`. */
async function setToggle(page: any, name: RegExp, on: boolean): Promise<boolean> {
    const toggle = page.locator('.ds-toggle-button').filter({ hasText: name }).first();
    if (!(await toggle.count())) return false;
    const pressed = async () => (await toggle.getAttribute('aria-pressed')) === 'true';
    if ((await pressed()) !== on) await toggle.click();
    if ((await pressed()) !== on) throw new Error(`no pude ${on ? 'prender' : 'apagar'} «${name.source}»`);
    return on;
}

// El texto de la última respuesta (sin el razonamiento), con el mensaje traído a la vista.
const lastAnswer = () => {
    const msgs = [...document.querySelectorAll('.ds-message')];
    const last = msgs[msgs.length - 1] as HTMLElement | undefined;
    if (!last) return { text: '', assistant: false };
    last.scrollIntoView({ block: 'end' });
    const main = last.querySelector('.ds-assistant-message-main-content') as HTMLElement | null;
    return { text: main?.innerText.trim() || '', assistant: !!main };
};
// Genera mientras el botón de enviar NO está deshabilitado con el campo vacío (es «detener»).
const busy = () => {
    const box = document.querySelector('textarea') as HTMLTextAreaElement | null;
    const send = [...document.querySelectorAll('.ds-button--circle')].pop();
    return !!send && !send.classList.contains('ds-button--disabled') && !(box?.value.trim());
};
// Lo que DeepSeek contesta cuando no puede (servidor ocupado, límite): sale como respuesta o como aviso.
const BUSY_TEXT = /server is busy|servidor (está )?ocupado|try again later|inténtalo (de nuevo )?más tarde|too many requests|rate limit/i;

// El aviso de la web cuando el mensaje no entra («El contenido es demasiado largo. Por favor, acórtalo…»). Va debajo
// del mensaje, no como respuesta: sin reconocerlo, la receta esperaba los 10 min (2026-11-17, Ditto con ~130 mil car.).
const TOO_LONG = /contenido es demasiado largo|acórtalo e inténtalo|content is too long|message is too long/i;
const tooLongShown = (re: string) => [...document.querySelectorAll('body *')].some((e) => {
    const el = e as HTMLElement;
    return el.childElementCount === 0 && el.innerText && el.innerText.length < 200 && new RegExp(re, 'i').test(el.innerText);
});

/** Cuánto va en un mensaje (`DEEPSEEK_CHUNK`). Medido el 2026-11-17: 109 mil caracteres entraron de una vez y ~130 mil
 *  no; se deja margen. */
export const CHUNK = Number(process.env.DEEPSEEK_CHUNK || 100_000);

/** Parte un texto en trozos de hasta `size`, cortando en un fin de renglón cuando se puede. */
export function splitText(text: string, size = CHUNK): string[] {
    const parts: string[] = [];
    let rest = text;
    while (rest.length > size) {
        let cut = rest.lastIndexOf('\n', size);
        if (cut < size * 0.5) cut = size;
        parts.push(rest.slice(0, cut));
        rest = rest.slice(cut);
    }
    if (rest) parts.push(rest);
    return parts;
}

/** `chatUrl`: seguir ESE chat (`/a/chat/s/<id>`) en vez de abrir uno nuevo: Wally manda sólo lo nuevo. */
/** Lo que va en cada trozo de un mensaje partido: los primeros piden «no contestes, respondé OK»; el último, contestar.
 *  Lo usan DeepSeek (adentro de su receta) y el pool para ChatGPT (un trozo por llamada, en el mismo chat). */
export function chunkBodies(parts: string[]): string[] {
    const n = parts.length;
    if (n === 1) return parts;
    return parts.map((p, i) => i === n - 1
        ? `[Trozo ${i + 1} de ${n}, el último] Ya tenés el mensaje entero (los trozos anteriores y éste, en orden). Ahora sí: leelo todo como UN solo mensaje y contestá lo que pide.\n\n${p}`
        : `[Trozo ${i + 1} de ${n}] Te mando un mensaje largo en ${n} trozos. NO contestes todavía ni lo resumas: guardalo y respondé sólo «OK ${i + 1}/${n}».\n\n${p}`);
}

export type Ask = { think?: boolean; search?: boolean; chatUrl?: string; chunk?: number; timeoutMs?: number; log?: (s: string) => void };

/** Escribe un mensaje en el chat abierto, lo manda y espera la respuesta; devuelve su texto visible. */
async function sendAndWait(page: any, text: string, timeoutMs: number): Promise<string> {
    const box = page.getByRole('textbox', { name: 'Mensaje a DeepSeek' });
    await box.waitFor({ timeout: 30_000 });
    // Un texto grande va por una variable de la página y el evento `input` (como en AI Studio: un `fill` enorme
    // cortaba el puente de Chrome).
    if (text.length <= 200_000) await box.fill(text);
    else {
        await page.evaluate(() => { (window as any).__jarvisText = ''; });
        for (let i = 0; i < text.length; i += 200_000) await page.evaluate((p: string) => { (window as any).__jarvisText += p; }, text.slice(i, i + 200_000));
        await box.evaluate((el: HTMLTextAreaElement) => {
            const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
            set.call(el, (window as any).__jarvisText);
            el.dispatchEvent(new Event('input', { bubbles: true }));
            delete (window as any).__jarvisText;
        });
    }
    const got = await box.evaluate((el: HTMLTextAreaElement) => el.value.length);
    if (got !== text.length) throw new Error(`el campo quedó con ${got} caracteres de ${text.length}`);
    const before = await page.locator('.ds-message').count();
    await box.press('Enter');

    // Terminó: hay un mensaje nuevo de DeepSeek, el botón ya no es «detener» y el texto no cambió en 2 s.
    const until = Date.now() + timeoutMs;
    let seen = '';
    let stableSince = Date.now();
    while (Date.now() < until) {
        const toast: string = await page.evaluate(() => [...document.querySelectorAll('.ds-toast, [role=alert]')].map((e) => (e as HTMLElement).innerText.trim()).join(' · '));
        if (toast && BUSY_TEXT.test(toast)) throw new Error(`DeepSeek: ${toast}`);
        if (await page.evaluate(tooLongShown, TOO_LONG.source)) throw new Error(`DeepSeek: el mensaje es demasiado largo para su web (${text.length.toLocaleString('es-CO')} caracteres): bajá DEEPSEEK_CHUNK`);
        const count = await page.locator('.ds-message').count();
        const { text: now, assistant } = await page.evaluate(lastAnswer);
        const running = await page.evaluate(busy);
        if (now !== seen || running || count <= before || !assistant) { seen = now; stableSince = Date.now(); }
        else if (now && Date.now() - stableSince >= 2000) break;
        await page.waitForTimeout(400);
    }
    if (!seen) throw new Error('DeepSeek no contestó');
    if (BUSY_TEXT.test(seen) && seen.length < 200) throw new Error(`DeepSeek: ${seen}`);
    return seen;
}

/** Una pregunta en un chat nuevo: pone los interruptores, manda el texto y devuelve la respuesta en Markdown.
 *  Si no entra en un mensaje (`CHUNK`), va en TROZOS en el mismo chat: cada uno menos el último pide «no contestes,
 *  respondé sólo OK» (sin Pensamiento Profundo, para que sea rápido), y el último trae lo que hay que contestar. */
export async function askDeepSeek(page: any, text: string, { think = true, search = false, chatUrl = '', chunk = CHUNK, timeoutMs = 600_000, log = () => {} }: Ask = {}) {
    const t0 = Date.now();
    try {
        await page.goto(chatUrl || 'https://chat.deepseek.com/', { waitUntil: 'domcontentloaded' });
        const box = page.getByRole('textbox', { name: 'Mensaje a DeepSeek' });
        await Promise.race([box.waitFor({ timeout: 30_000 }), page.waitForURL(/sign_in/, { timeout: 30_000 })]).catch(() => {});
        if (/sign_in/.test(page.url())) throw new Error('DeepSeek no tiene sesión en este Chrome: entrá a mano en chat.deepseek.com');
        const parts = splitText(text, chunk || Infinity);
        const bodies = chunkBodies(parts);
        if (chatUrl) log('deepseek · sigue su chat');
        log(`deepseek · pensamiento ${think ? 'sí' : 'no'} · búsqueda ${search ? 'sí' : 'no'} · ${text.length.toLocaleString('es-CO')} caracteres${parts.length > 1 ? ` en ${parts.length} trozos` : ''}`);
        let seen = '';
        for (let i = 0; i < parts.length; i++) {
            const last = i === parts.length - 1;
            await setToggle(page, /Pensamiento Profundo|DeepThink/i, last ? think : false);
            await setToggle(page, /Búsqueda inteligente|Search/i, last ? search : false);
            const n = parts.length;
            const body = bodies[i];
            if (n > 1) log(`trozo ${i + 1}/${n} · ${body.length.toLocaleString('es-CO')} caracteres`);
            seen = await sendAndWait(page, body, last ? timeoutMs : 180_000);
        }
        log('listo');

        // El Markdown de origen: el botón «copiar» de la respuesta, con el portapapeles interceptado en la página.
        let answer = '';
        try {
            await page.evaluate(() => {
                const w = window as any;
                w.__jarvisCopied = null;
                if (navigator.clipboard) (navigator.clipboard as any).writeText = async (t: string) => { w.__jarvisCopied = t; };
                const exec = document.execCommand.bind(document);
                (document as any).execCommand = (cmd: string, ...rest: any[]) => (cmd === 'copy' ? ((w.__jarvisCopied = String(getSelection())), true) : exec(cmd, ...rest));
            });
            // El «copiar» del MENSAJE: el primer botón del bloque que NO está dentro del Markdown. Un bloque de código trae su
            // propio «copiar» adentro, y tomar ése copiaba sólo el código, sin el texto ni sus ``` (2026-11-17, Pikachu: sus
            // comandos llegaron sin ```comando y Wally no vio ninguno).
            const handle = await page.evaluateHandle(() => {
                const msgs = [...document.querySelectorAll('.ds-message')];
                const last = msgs[msgs.length - 1];
                const scope = last?.parentElement;
                return [...(scope?.querySelectorAll('.ds-icon-button, [role=button]') || [])].find((b) => !b.closest('.ds-markdown')) || null;
            });
            const copy = handle.asElement();
            if (!copy) throw new Error('sin «copiar» del mensaje');
            await copy.click({ timeout: 5000 });
            await page.waitForFunction(() => (window as any).__jarvisCopied !== null, null, { timeout: 5000 });
            answer = (await page.evaluate(() => (window as any).__jarvisCopied)) || '';
        } catch { /* sin el Markdown: el texto de la página */ }
        const format = answer.trim() ? 'markdown' : 'text';
        if (!answer.trim()) answer = seen;
        const ms = Date.now() - t0;
        recordUse({ model: MODEL, thinking: think ? 'deepthink' : 'no', chars: text.length, ms, result: 'ok' });
        return { answer, format, ms, url: page.url() };
    } catch (e: any) {
        const message = String(e?.message || e);
        recordUse({ model: MODEL, result: BUSY_TEXT.test(message) ? 'corte' : 'error', error: message });
        throw e;
    }
}
