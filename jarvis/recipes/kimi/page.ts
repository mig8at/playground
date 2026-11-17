// Lo que comparten las recetas de Kimi: preguntarle a Kimi (Moonshot) por su web, en el Chrome de la persona con Jarvis
// y con su sesión, como las de DeepSeek y ChatGPT. No es una receta: no tiene línea de uso.
//
// Aprendido el 2026-11-17 (Jarvis para la sesión y el selector, el resto por script):
// - kimi.com es la versión china (entrar con WeChat o un celular +86); con Google es `kimi.ai`, en español.
// - Sin sesión no contesta: pide entrar. Con sesión, cada chat queda en el historial de la cuenta (no hay temporal).
// - El campo es `.chat-input-editor` (contenteditable, `data-testid=chat-editor`); Enter manda.
// - El modelo se elige abajo (`model-select-trigger`): `model-option` K3.1 Pro, K2.8 Preview, Instantáneo, y K3 en «Más
//   modelos» (`model-more-trigger`); el esfuerzo de razonamiento, en `model-effort-item` (viene en Alto).
// - ⚠ En el plan gratis, con mucha gente, K3.1 Pro, K3 y K2.8 Preview contestan con un aviso (`confirm-dialog`:
//   «Muchas personas están chateando con Kimi… Suscríbete») y NO mandan la pregunta; Instantáneo sí contesta. La receta
//   prueba de mejor a peor y, con el aviso, lo cierra («Entendido») y baja al siguiente, con el texto que ya está escrito.
// - La respuesta va en `.segment-assistant` → `.markdown` (el razonamiento queda plegado en «Thinking process» y no
//   entra); sus botones, en `.segment-assistant-actions` (leer en voz alta, copiar, regenerar…).
import { openWorkPage, recordUse } from '../aistudio/page.ts';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const MODEL = 'kimi-web';
/** De mejor a peor: el primero que no dé el aviso de «mucha gente» es el que contesta. */
export const KIMI_MODELS = ['K3.1 Pro', 'K3', 'K2.8 Preview', 'Instantáneo'];

/** Conecta con Chrome por Jarvis y abre una pestaña en la ventana aparte (como el pool de AI Studio). */
export async function openKimi() {
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

/** Elige un modelo en el selector de abajo (K3 está en «Más modelos»). Devuelve lo que quedó escrito en el botón. */
async function chooseModel(page: any, name: string): Promise<string> {
    await page.getByTestId('model-select-trigger').click();
    let option = page.locator('[data-testid="model-option"]').filter({ hasText: new RegExp(`^\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`) }).first();
    if (!(await option.count())) {
        await page.getByTestId('model-more-trigger').hover().catch(() => {});
        await page.getByTestId('model-more-trigger').click().catch(() => {});
        await page.waitForTimeout(400);
        option = page.getByText(name, { exact: true }).last();
    }
    await option.click({ timeout: 5000 });
    await page.waitForTimeout(300);
    return (await page.getByTestId('model-select-trigger').innerText()).replace(/\s+/g, ' ').trim();
}

const BUSY = /muchas personas|suscr[ií]bete|subscribe|too many|busy/i;

export type Ask = { models?: string[]; timeoutMs?: number; log?: (s: string) => void };

/** Una pregunta en un chat nuevo: prueba los modelos en orden y devuelve la respuesta y con cuál salió. */
export async function askKimi(page: any, text: string, { models = KIMI_MODELS, timeoutMs = 600_000, log = () => {} }: Ask = {}) {
    const t0 = Date.now();
    try {
        await page.addInitScript(() => {
            const w = window as any;
            w.__jarvisCopied = null;
            try {
                const cb = navigator.clipboard as any;
                if (cb) {
                    cb.writeText = async (t: string) => { w.__jarvisCopied = t; };
                    cb.write = async (items: any[]) => { for (const it of items) if (it.types.includes('text/plain')) w.__jarvisCopied = await (await it.getType('text/plain')).text(); };
                }
            } catch { /* sin portapapeles: queda el texto de la página */ }
        });
        await page.goto('https://www.kimi.ai/', { waitUntil: 'domcontentloaded' });
        await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
        const editor = page.locator('.chat-input-editor').first();
        await editor.waitFor({ timeout: 30_000 }).catch(() => {});
        if (!(await editor.count()) || !(await page.getByTestId('model-select-trigger').count())) {
            throw new Error('Kimi no tiene sesión en este Chrome (o cambió la página): entrá a mano en kimi.ai con Google');
        }
        await editor.click();
        await page.keyboard.insertText(text);
        const got: number = await editor.evaluate((el: HTMLElement) => el.innerText.replace(/\n+$/, '').length);
        if (got < text.length * 0.98) throw new Error(`el campo quedó con ${got} caracteres de ${text.length}`);
        const before = await page.locator('.segment-assistant').count();

        // De mejor a peor: si sale el aviso de «mucha gente», no se mandó nada; se cierra y se baja al siguiente.
        let used = '';
        for (const name of models) {
            const shown = await chooseModel(page, name).catch((e) => { log(`no pude elegir ${name}: ${String(e.message || e).split('\n')[0]}`); return ''; });
            if (!shown) continue;
            log(`kimi · ${shown} · ${text.length.toLocaleString('es-CO')} caracteres`);
            await editor.click();
            await page.keyboard.press('Enter');
            const sentOrBusy = await Promise.race([
                page.getByTestId('confirm-dialog').waitFor({ timeout: 8000 }).then(() => 'busy', () => ''),
                page.waitForFunction((n: number) => document.querySelectorAll('.segment-assistant').length > n, before, { timeout: 8000 }).then(() => 'sent', () => ''),
            ]);
            if (sentOrBusy === 'busy' || (await page.getByTestId('confirm-dialog').count())) {
                const notice = (await page.getByTestId('confirm-dialog').innerText().catch(() => '')).replace(/\s+/g, ' ');
                log(`${name}: ${BUSY.test(notice) ? 'mucha gente (plan gratis)' : notice.slice(0, 80)}; pruebo el siguiente`);
                await page.getByTestId('confirm-dialog-cancel').click().catch(() => page.keyboard.press('Escape'));
                await page.waitForTimeout(400);
                continue;
            }
            used = shown.replace(/\s+(Alto|Medio|Bajo)$/i, '');
            break;
        }
        if (!used) throw new Error(`Kimi: ningún modelo aceptó la pregunta (${models.join(', ')}): «muchas personas están chateando», el plan gratis no entra`);
        log('esperando la respuesta…');

        // Terminó: está la respuesta nueva con sus botones y su texto no cambió en 2 s.
        const until = Date.now() + timeoutMs;
        let seen = '';
        let stableSince = Date.now();
        while (Date.now() < until) {
            const r = await page.evaluate((n: number) => {
                const segs = [...document.querySelectorAll('.segment-assistant')];
                if (segs.length <= n) return { text: '', done: false };
                const last = segs[segs.length - 1] as HTMLElement;
                last.scrollIntoView({ block: 'end' });
                const md = [...last.querySelectorAll('.markdown')].pop() as HTMLElement | undefined;
                return { text: md?.innerText.trim() || '', done: !!last.querySelector('.segment-assistant-actions') };
            }, before);
            if (r.text !== seen || !r.done) { seen = r.text; stableSince = Date.now(); }
            else if (seen && Date.now() - stableSince >= 2000) break;
            await page.waitForTimeout(400);
        }
        if (!seen) throw new Error('Kimi no contestó');

        // El «copiar» de la respuesta: el botón de sus acciones que no es «Leer en voz alta».
        let answer = '';
        try {
            await page.evaluate(() => { (window as any).__jarvisCopied = null; });
            const handle = await page.evaluateHandle(() => {
                const last = [...document.querySelectorAll('.segment-assistant')].pop();
                const items = [...(last?.querySelectorAll('.segment-assistant-actions-content > *') || [])] as HTMLElement[];
                return items.find((b) => !b.classList.contains('speech-button') && !b.querySelector('.speech-button')) || null;
            });
            const btn = handle.asElement();
            if (btn) {
                await btn.click({ timeout: 4000 });
                await page.waitForFunction(() => (window as any).__jarvisCopied !== null, null, { timeout: 3000 });
                answer = (await page.evaluate(() => (window as any).__jarvisCopied)) || '';
            }
        } catch { /* sin el Markdown: el texto de la página */ }
        const format = answer.trim() ? 'markdown' : 'text';
        if (!answer.trim()) answer = seen;
        const ms = Date.now() - t0;
        recordUse({ model: `${MODEL}:${used}`, chars: text.length, ms, result: 'ok' });
        return { answer, format, ms, model: used, url: page.url() };
    } catch (e: any) {
        const message = String(e?.message || e);
        recordUse({ model: MODEL, result: BUSY.test(message) ? 'corte' : 'error', error: message });
        throw e;
    }
}
