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

export type Ask = { think?: boolean; search?: boolean; timeoutMs?: number; log?: (s: string) => void };

/** Una pregunta en un chat nuevo: pone los interruptores, manda el texto y devuelve la respuesta en Markdown. */
export async function askDeepSeek(page: any, text: string, { think = true, search = false, timeoutMs = 600_000, log = () => {} }: Ask = {}) {
    const t0 = Date.now();
    try {
        await page.goto('https://chat.deepseek.com/', { waitUntil: 'domcontentloaded' });
        const box = page.getByRole('textbox', { name: 'Mensaje a DeepSeek' });
        await Promise.race([box.waitFor({ timeout: 30_000 }), page.waitForURL(/sign_in/, { timeout: 30_000 })]).catch(() => {});
        if (/sign_in/.test(page.url())) throw new Error('DeepSeek no tiene sesión en este Chrome: entrá a mano en chat.deepseek.com');
        await setToggle(page, /Pensamiento Profundo|DeepThink/i, think);
        await setToggle(page, /Búsqueda inteligente|Search/i, search);
        log(`deepseek · pensamiento ${think ? 'sí' : 'no'} · búsqueda ${search ? 'sí' : 'no'} · ${text.length.toLocaleString('es-CO')} caracteres`);

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
        log('esperando la respuesta…');

        // Terminó: hay un mensaje nuevo de DeepSeek, el botón ya no es «detener» y el texto no cambió en 2 s.
        const until = Date.now() + timeoutMs;
        let seen = '';
        let stableSince = Date.now();
        while (Date.now() < until) {
            const toast: string = await page.evaluate(() => [...document.querySelectorAll('.ds-toast, [role=alert]')].map((e) => (e as HTMLElement).innerText.trim()).join(' · '));
            if (toast && BUSY_TEXT.test(toast)) throw new Error(`DeepSeek: ${toast}`);
            const count = await page.locator('.ds-message').count();
            const { text: now, assistant } = await page.evaluate(lastAnswer);
            const running = await page.evaluate(busy);
            if (now !== seen || running || count <= before || !assistant) { seen = now; stableSince = Date.now(); }
            else if (now && Date.now() - stableSince >= 2000) break;
            await page.waitForTimeout(400);
        }
        if (!seen) throw new Error('DeepSeek no contestó');
        if (BUSY_TEXT.test(seen) && seen.length < 200) throw new Error(`DeepSeek: ${seen}`);

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
            const last = page.locator('.ds-message').last();
            // Los botones van debajo del mensaje, en el mismo bloque: el primero es «copiar».
            const copy = last.locator('xpath=..').locator('.ds-icon-button, [role=button]').first();
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
