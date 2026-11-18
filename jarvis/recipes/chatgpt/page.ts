// Lo que comparten las recetas de ChatGPT: preguntarle a chatgpt.com por su web, en el Chrome de la persona con Jarvis
// y con su sesión, como las de AI Studio y DeepSeek. No es una receta: no tiene línea de uso.
//
// Aprendido el 2026-11-17 (Jarvis para la sesión, el resto por script: su análisis ve un modal donde no hay):
// - Wally NO usa el temporal (2026-11-17): sigue el chat de cada conversación (`chatUrl`, `/c/<id>`) y manda sólo lo
//   nuevo, porque la web gratis acepta ~40 mil caracteres por mensaje. `bin/chatgpt` sigue en temporal.
// - `/?temporary-chat=true` abre un CHAT TEMPORAL: no aparece en el historial (ChatGPT avisa que puede guardar una copia
//   hasta 30 días, por seguridad) y puede consultar la memoria y las instrucciones personalizadas de la cuenta.
// - El campo es un editor ProseMirror (contenteditable), el textbox «Preguntar a ChatGPT»; el botón «Enviar» manda.
//   Ya no tiene el `#prompt-textarea` de antes, ni `data-message-author-role` en los mensajes.
// - Hay un `section[role=dialog]` invisible («New chat») siempre en la página: por eso el análisis de Jarvis decía
//   «detrás de un modal» y no dejaba escribir. Playwright directo no tiene esa guarda.
// - La respuesta va en `[data-markdown-text-style="assistant-message"]`, y el turno dice cuándo terminó
//   (`data-talvt-turn-state="complete"`). Sus botones traen «Copiar» (`aria-label`), que copia el Markdown.
// - «Pensar» (al lado del micrófono) es el modo de razonar.
import { assertChatHasHistory } from '../deepseek/page.ts';
import { openWorkPage, recordUse } from '../aistudio/page.ts';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const MODEL = 'chatgpt-web';

/** Conecta con Chrome por Jarvis y abre una pestaña en la ventana aparte (como el pool de AI Studio). */
export async function openChatGPT() {
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

// La última respuesta: su texto (traída a la vista) y si su turno ya terminó.
const lastAnswer = () => {
    const all = [...document.querySelectorAll('[data-markdown-text-style="assistant-message"]')];
    const last = all[all.length - 1] as HTMLElement | undefined;
    if (!last) return { text: '', done: false, count: 0 };
    last.scrollIntoView({ block: 'end' });
    const turn = last.closest('[data-talvt-turn-state]') || document.querySelector('[data-talvt-turn-state]:last-of-type');
    const states = [...document.querySelectorAll('[data-talvt-turn-state]')].map((e) => e.getAttribute('data-talvt-turn-state'));
    return { text: last.innerText.trim(), done: (turn?.getAttribute('data-talvt-turn-state') || states[states.length - 1]) === 'complete', count: all.length };
};
// Lo que dice ChatGPT cuando no deja seguir (el límite del plan gratis, o un error de la página).
const LIMIT_TEXT = /reached (our|your|the) .*limit|límite de (uso|mensajes)|alcanzaste el límite|has alcanzado|try again later|inténtalo (de nuevo )?más tarde|something went wrong|algo salió mal|too many requests/i;

/** `chatUrl`: seguir ESE chat (uno con historial, `/c/<id>`) en vez de abrir uno nuevo: Wally manda sólo lo nuevo. */
export type Ask = { think?: boolean; temporary?: boolean; chatUrl?: string; timeoutMs?: number; log?: (s: string) => void };

/** Una pregunta en un chat nuevo (temporal por defecto): manda el texto y devuelve la respuesta en Markdown. */
export async function askChatGPT(page: any, text: string, { think = false, temporary = true, chatUrl = '', timeoutMs = 600_000, log = () => {} }: Ask = {}) {
    const t0 = Date.now();
    try {
        // El portapapeles se intercepta ANTES de que cargue ChatGPT: si no, su «Copiar» usa la referencia que guardó al
        // cargar y la copia no se ve (el primer intento devolvió texto, sin el Markdown).
        await page.addInitScript(() => {
            const w = window as any;
            w.__jarvisCopied = null;
            const keep = async (t: string) => { w.__jarvisCopied = t; };
            try {
                const cb = navigator.clipboard as any;
                if (cb) {
                    cb.writeText = keep;
                    cb.write = async (items: any[]) => {
                        for (const it of items) if (it.types.includes('text/plain')) w.__jarvisCopied = await (await it.getType('text/plain')).text();
                    };
                }
            } catch { /* sin portapapeles: queda el texto de la página */ }
            const exec = document.execCommand.bind(document);
            (document as any).execCommand = (cmd: string, ...rest: any[]) => (cmd === 'copy' ? ((w.__jarvisCopied = String(getSelection())), true) : exec(cmd, ...rest));
        });
        await page.goto(chatUrl || (temporary ? 'https://chatgpt.com/?temporary-chat=true' : 'https://chatgpt.com/'), { waitUntil: 'domcontentloaded' });
        const box = page.getByRole('textbox', { name: 'Preguntar a ChatGPT' });
        await box.waitFor({ timeout: 30_000 }).catch(() => {});
        if (!(await box.count()) || /auth|login/.test(page.url())) throw new Error('ChatGPT no tiene sesión en este Chrome (o cambió la página): entrá a mano en chatgpt.com');
        // Seguir un chat: que sea ESE y que tenga la conversación (ver la receta de DeepSeek).
        if (chatUrl) await assertChatHasHistory(page, chatUrl, '[data-message-author-role]');
        if (think) {
            const thinkButton = page.getByRole('button', { name: 'Pensar', exact: true }); // «Pensar» es el texto de la web de ChatGPT
            if (await thinkButton.count()) await thinkButton.click();
            else log('no está «Pensar» en esta cuenta: sigo sin él');
        }
        log(`chatgpt · ${chatUrl ? 'sigue su chat' : temporary ? 'chat temporal' : 'con historial'} · pensar ${think ? 'sí' : 'no'} · ${text.length.toLocaleString('es-CO')} caracteres`);

        await box.click();
        if (text.length <= 200_000) await box.fill(text);
        else for (let i = 0; i < text.length; i += 200_000) await page.keyboard.insertText(text.slice(i, i + 200_000));
        const got: number = await box.evaluate((el: HTMLElement) => el.innerText.replace(/\n+$/, '').length);
        if (got < text.length * 0.98) throw new Error(`el campo quedó con ${got} caracteres de ${text.length}`);
        const before = await page.evaluate(() => document.querySelectorAll('[data-markdown-text-style="assistant-message"]').length);
        await page.getByRole('button', { name: 'Enviar', exact: true }).click();
        log('esperando la respuesta…');

        // Terminó: hay una respuesta nueva, su turno dice «complete» y el texto no cambió en 1,5 s.
        const until = Date.now() + timeoutMs;
        let seen = '';
        let stableSince = Date.now();
        while (Date.now() < until) {
            const r = await page.evaluate(lastAnswer);
            if (r.count <= before) {
                const body: string = await page.evaluate(() => document.querySelector('main')?.innerText.slice(-600) || '');
                if (LIMIT_TEXT.test(body) && Date.now() - t0 > 4000) throw new Error(`ChatGPT: ${body.replace(/\s+/g, ' ').trim().slice(-240)}`);
            } else if (r.text !== seen || !r.done) { seen = r.text; stableSince = Date.now(); }
            else if (seen && Date.now() - stableSince >= 1500) break;
            await page.waitForTimeout(400);
        }
        if (!seen) throw new Error('ChatGPT no contestó');

        // El Markdown de origen: el «Copiar» de la respuesta, con el portapapeles interceptado en la página.
        let answer = '';
        try {
            await page.evaluate(() => { (window as any).__jarvisCopied = null; });
            await page.locator('button[aria-label="Copiar"]').last().click({ timeout: 5000 });
            await page.waitForFunction(() => (window as any).__jarvisCopied !== null, null, { timeout: 5000 });
            answer = (await page.evaluate(() => (window as any).__jarvisCopied)) || '';
        } catch { /* sin el Markdown: el texto de la página */ }
        const format = answer.trim() ? 'markdown' : 'text';
        if (!answer.trim()) answer = seen;
        const ms = Date.now() - t0;
        recordUse({ model: MODEL, thinking: think ? 'think' : 'no', chars: text.length, ms, result: 'ok' });
        return { answer, format, ms, url: page.url() };
    } catch (e: any) {
        const message = String(e?.message || e);
        recordUse({ model: MODEL, result: LIMIT_TEXT.test(message) ? 'corte' : 'error', error: message });
        throw e;
    }
}
