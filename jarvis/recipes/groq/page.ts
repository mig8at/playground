// Lo que comparten las recetas de Groq: preguntarle a Groq Chat (chat.groq.com) por su web, en el Chrome de la persona
// con Jarvis, como las de AI Studio, DeepSeek y ChatGPT. Groq es el ULTRA RÁPIDO: corre modelos abiertos en su chip
// (LPU) a ~480 tokens por segundo. No es una receta: no tiene línea de uso.
//
// Aprendido el 2026-11-17 (Jarvis para encontrarlo, el resto por script):
// - groq.com ya no tiene chat en su portada (es una «neocloud» para desarrolladores); el chat es `chat.groq.com`, y el
//   modelo va en la URL: `/?model=openai/gpt-oss-120b`. Sin `model` puede quedar en uno de voz que pide aceptar
//   términos. Los de texto que mostraba: GPT OSS 120B y 20B (los abiertos de OpenAI), Qwen 3.8 27B, y otros.
// - El campo es un textarea «Try it»; Enter manda. ⚠ La página termina de cargar DESPUÉS de que aparece el campo y lo
//   redibuja: lo escrito antes se pierde a medias y el botón queda deshabilitado. Se espera a que la red quede quieta,
//   se escribe y se comprueba que el texto quedó entero antes de mandar.
// - La respuesta va en un bloque `.font-inter` (las clases son utilitarias: no hay nombres de rol), con el razonamiento
//   plegado aparte («Reasoning»); el primer botón después de la respuesta copia. Arriba dice la velocidad («472 T/s»).
// - No tiene historial: sólo «Clear chat». La cuenta de la persona aparece abajo (Groq con Google).
import { openWorkPage, recordUse } from '../aistudio/page.ts';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const MODEL = 'groq-web';
export const DEFAULT_GROQ_MODEL = 'openai/gpt-oss-120b';

/** Conecta con Chrome por Jarvis y abre una pestaña en la ventana aparte (como el pool de AI Studio). */
export async function openGroq() {
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

const LIMIT_TEXT = /rate limit|too many requests|limit (reached|exceeded)|try again later|something went wrong|error/i;

export type Ask = { model?: string; timeoutMs?: number; log?: (s: string) => void };

/** Una pregunta en un chat nuevo de Groq Chat: devuelve la respuesta (Markdown si el «copiar» la entrega). */
export async function askGroq(page: any, text: string, { model = DEFAULT_GROQ_MODEL, timeoutMs = 300_000, log = () => {} }: Ask = {}) {
    const t0 = Date.now();
    const usageModel = `${MODEL}:${model}`;
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
        await page.goto(`https://chat.groq.com/?model=${encodeURIComponent(model)}`, { waitUntil: 'domcontentloaded' });
        const box = page.getByRole('textbox', { name: 'Try it' });
        await box.waitFor({ timeout: 30_000 });
        await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
        await page.waitForTimeout(1500);
        if (/terms are required/i.test(await page.evaluate(() => document.body.innerText))) throw new Error(`Groq pide aceptar los términos del modelo «${model}»: elegí otro (--model) o aceptalos a mano`);
        log(`groq · ${model} · ${text.length.toLocaleString('es-CO')} caracteres`);

        // Escribir y comprobar que quedó entero (la página redibuja el campo al terminar de cargar).
        for (let i = 0; i < 3 && (await box.inputValue()) !== text; i++) {
            await box.fill(text);
            await page.waitForTimeout(700);
        }
        if ((await box.inputValue()) !== text) throw new Error('el texto no quedó entero en el campo de Groq');
        const submit = page.locator('form').filter({ has: box }).locator('button[type=submit]');
        await submit.waitFor({ state: 'attached', timeout: 5000 }).catch(() => {});
        if (await submit.isDisabled().catch(() => false)) throw new Error('el botón de enviar de Groq quedó deshabilitado');
        const before = await page.locator('.font-inter').count();
        await box.press('Enter');
        log('esperando la respuesta…');

        // Terminó: hay una respuesta nueva y su texto no cambió en 1,2 s (a ~480 tokens/s, llega de golpe).
        const until = Date.now() + timeoutMs;
        let seen = '';
        let stableSince = Date.now();
        while (Date.now() < until) {
            const count = await page.locator('.font-inter').count();
            const now: string = count > before ? await page.locator('.font-inter').last().evaluate((el: HTMLElement) => { el.scrollIntoView({ block: 'end' }); return el.innerText.trim(); }) : '';
            if (!now && Date.now() - t0 > 8000) {
                const body: string = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
                const m = body.match(/[^.]*(rate limit|too many requests|limit (reached|exceeded)|something went wrong)[^.]*\.?/i);
                if (m) throw new Error(`Groq: ${m[0].trim()}`);
            }
            if (now !== seen) { seen = now; stableSince = Date.now(); }
            else if (seen && Date.now() - stableSince >= 1200) break;
            await page.waitForTimeout(300);
        }
        if (!seen) throw new Error('Groq no contestó');
        const speed: string = await page.evaluate(() => (document.body.innerText.match(/[\d.]+\s*T\/s/) || [''])[0]);

        let answer = '';
        try {
            await page.evaluate(() => { (window as any).__jarvisCopied = null; });
            await page.locator('.font-inter').last().locator('xpath=following::button[1]').click({ timeout: 5000 });
            await page.waitForFunction(() => (window as any).__jarvisCopied !== null, null, { timeout: 3000 });
            answer = (await page.evaluate(() => (window as any).__jarvisCopied)) || '';
        } catch { /* sin el Markdown: el texto de la página */ }
        const format = answer.trim() ? 'markdown' : 'text';
        if (!answer.trim()) answer = seen;
        const ms = Date.now() - t0;
        recordUse({ model: usageModel, chars: text.length, ms, result: 'ok' });
        return { answer, format, ms, speed, model };
    } catch (e: any) {
        const message = String(e?.message || e);
        recordUse({ model: usageModel, result: LIMIT_TEXT.test(message) && /rate|limit|many/i.test(message) ? 'corte' : 'error', error: message });
        throw e;
    }
}
