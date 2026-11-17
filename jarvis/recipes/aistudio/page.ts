// Lo que comparten las recetas de AI Studio (ask, speak, transcribe): abrir la página en el Chrome de la persona con
// Jarvis, esperar a que el botón Run termine, leer el texto de un argumento, un archivo o stdin, y sacar bytes de la
// página. No es una receta: no tiene línea de uso.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openChrome as openJarvisChrome } from '../recorder.ts';

export const argv = process.argv.slice(2);
export const flag = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
export const has = (n: string) => argv.includes(`--${n}`);
export const JSON_OUT = has('json');
/** El avance va por stderr: stdout queda para la respuesta. */
export const say = (s: string) => { if (!JSON_OUT) console.error(`  ${s}`); };
/** Las rutas se resuelven desde donde se corrió el comando. */
export const resolvePath = (p: string) => path.resolve(process.env.INIT_CWD || process.cwd(), p);

/** El texto de entrada: `--file`, después stdin (sólo si de verdad viene un `|` o un `<`) y al final `--<name>`. */
export function readInput(name: string): string {
    const parts: string[] = [];
    const file = flag('file');
    if (file) parts.push(fs.readFileSync(resolvePath(file), 'utf8'));
    // Desde un agente o un IDE stdin suele ser un socket vacío, y leerlo da EAGAIN.
    const piped = (() => { try { const st = fs.fstatSync(0); return st.isFIFO() || st.isFile(); } catch { return false; } })();
    if (!file && piped) {
        const s = fs.readFileSync(0, 'utf8');
        if (s.trim()) parts.push(s);
    }
    if (flag(name)) parts.push(flag(name)!);
    return parts.join('\n\n').trim();
}

// ⚠ Las esperas van como FUNCIÓN, no como texto: la página exige Trusted Types y niega evaluar un string.
export const generating = () => /Stop/.test(document.querySelector('ms-run-button button')?.textContent || '');
export const idle = () => !/Stop/.test(document.querySelector('ms-run-button button')?.textContent || '');

/** Run y la espera: «Stop» mientras genera, «Run» al terminar. */
export async function runAndWait(page: any, timeoutMs: number) {
    await page.locator('ms-run-button button').click();
    await page.waitForFunction(generating, null, { timeout: 60_000 }).catch(() => {});
    await page.waitForFunction(idle, null, { timeout: timeoutMs });
}

/**
 * El aviso «Start creating with media in Google AI Studio» sale la primera vez que se sube o genera multimedia: dice que
 * lo subido puede usarse para mejorar productos de Google. Aceptarlo es una decisión de la persona: la receta NO lo
 * toca. Trae la pestaña al frente, avisa y espera (5 min) a que la persona lo acepte en su Chrome; después sigue.
 */
export async function waitMediaConsent(page: any) {
    const dialog = page.locator('mat-dialog-container', { hasText: 'Start creating with media' });
    // Ya aceptado, AI Studio igual lo arma un instante y lo cierra solo: sólo cuenta si sigue a la vista 2 s después.
    if (!(await dialog.isVisible().catch(() => false))) return;
    await page.waitForTimeout(2000);
    if (!(await dialog.isVisible().catch(() => false))) return;
    await page.bringToFront().catch(() => {});
    say('⚠ AI Studio pide aceptar su aviso de multimedia (lo que subas o generes puede usarse para mejorar productos de Google).');
    say('  Si estás de acuerdo, tocá «Acknowledge» en la pestaña de AI Studio de tu Chrome; espero 5 min.');
    try {
        await dialog.waitFor({ state: 'hidden', timeout: 5 * 60_000 });
    } catch {
        throw new Error('nadie aceptó el aviso de multimedia de AI Studio en 5 min');
    }
    say('aviso aceptado: sigo');
}

// ── LA PAUSA: no insistirle a Google cuando corta ─────────────────────────────────────────────────────────────────
// El 2026-11-17 AI Studio contestó «Permiso denegado. Verifica los permisos de tu cuenta…» con Hydrogen (tras ~40
// consultas de prueba en una hora), con la imagen y, después, con Flash Lite: a las 9:48 contestó y a las 9:49, la
// pregunta siguiente, ya no. No es por modelo: es la CUENTA, por el ritmo. Seguir pidiendo es la forma de que dure
// más (Miguel: «no intentar durante un tiempo»), así que un error así pausa TODO (`*`) y anota el modelo; mientras
// dure, ninguna receta abre AI Studio (`--force` la saltea). Cuánto: AL AZAR ENTRE 1 Y 5 MIN (Miguel, 2026-11-17: la
// primera versión fijaba 30 min, un número sin medir, y era demasiado). Nadie sabe cuánto dura el corte de Google; la
// pausa sólo evita insistir en el acto.
export const PAUSE_FILE = path.join(os.homedir(), '.cache', 'my-tools', 'aistudio-pausa.json');
/** La pausa: entre 1 y 5 min, al azar (que no vuelva todo al mismo segundo). */
const pauseMs = () => (60 + Math.floor(Math.random() * 241)) * 1000;
const LIMIT_ERROR = /permiso denegado|permission|denied|\b403\b|\b429\b|quota|cuota|rate.?limit|l[ií]mite|exceeded|too many|resource.?exhausted/i;

type Pause = { until: number; reason: string; at: string };
function readPauses(): Record<string, Pause> {
    try { return JSON.parse(fs.readFileSync(PAUSE_FILE, 'utf8')); } catch { return {}; }
}

/** Las pausas vigentes, por modelo. */
export function currentPauses(): Record<string, Pause> {
    return Object.fromEntries(Object.entries(readPauses()).filter(([, p]) => p && p.until > Date.now()));
}

/** Si el error es de Google cortando (permiso, cuota, límite), pausa ese modelo. Devuelve el mensaje, con la pausa dicha. */
export function noteFailure(message: string, model: string): string {
    if (!LIMIT_ERROR.test(message)) return message;
    const until = Date.now() + pauseMs();
    const pauses = currentPauses();
    const pause = { until, reason: message.slice(0, 300), at: new Date().toISOString() };
    pauses['*'] = { ...pause, reason: `${model}: ${pause.reason}` };
    pauses[model] = pause;
    fs.mkdirSync(path.dirname(PAUSE_FILE), { recursive: true });
    fs.writeFileSync(PAUSE_FILE, JSON.stringify(pauses, null, 2));
    const hour = new Date(until).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
    const minutes = Math.round((until - Date.now()) / 60_000) || 1;
    return `${message}\n  ⏸ Google está cortando: bin/aistudio queda en pausa ${minutes} min, con todos los modelos (hasta las ${hour}). `
        + 'Antes de volver, probá a mano en aistudio.google.com. --force la saltea';
}

/** Abre una pestaña del Chrome de la persona con Jarvis, salvo que `model` esté en pausa (sale con 3). */
export async function openChrome(model?: string) {
    const all = currentPauses();
    const pause = all['*'] || (model ? all[model] : undefined);
    if (pause && !has('force')) {
        const left = Math.ceil((pause.until - Date.now()) / 1000);
        const wait = left >= 60 ? `${Math.floor(left / 60)} min ${left % 60} s` : `${left} s`;
        console.error(`  ⏸ bin/aistudio está en pausa ${wait} más: ${pause.reason.split('\n')[0]}`);
        console.error(`    (para no insistirle a Google con la cuenta cortada; --force la saltea · ${PAUSE_FILE})`);
        process.exit(3);
    }
    return openJarvisChrome();
}

/** Abre AI Studio en una pestaña nueva del Chrome de la persona; con `prepare`, un script antes de que cargue la página. */
export async function openAIStudio(url: string, model: string, prepare?: () => void) {
    const { page, close } = await openChrome(model);
    if (prepare) await page.addInitScript(prepare);
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    return { page, close };
}

/** El texto visible de la última respuesta (sin los «Thoughts»): las piezas de texto del último turno. */
export const lastAnswerText = () => {
    const turns = [...document.querySelectorAll('ms-chat-turn')];
    const last = turns[turns.length - 1];
    if (!last) return '';
    return [...last.querySelectorAll('ms-text-chunk')]
        .filter((c) => !c.closest('ms-thought-chunk'))
        .map((c) => (c as HTMLElement).innerText.trim())
        .filter(Boolean)
        .join('\n\n');
};

/**
 * Espera a que la última respuesta quede quieta 1,5 s sin «Stop» y la devuelve como texto. ⚠ «Run» no alcanza: la
 * respuesta sigue llegando un instante después (entre los «Thoughts» y el texto, y en la transcripción por segmentos).
 */
export async function waitStableAnswer(page: any, timeoutMs: number): Promise<string> {
    let seen = '';
    let stableSince = Date.now();
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
        // Un error de AI Studio («Failed to generate content: …») sale en un aviso abajo y nunca llega texto: se corta
        // ya, con su mensaje, en vez de esperar al tope.
        // También en rojo dentro del turno (`.model-error`): «Permiso denegado. Verifica los permisos de tu cuenta…» es
        // como Google corta una cuenta que hizo demasiadas consultas seguidas (2026-11-17).
        const failed: string | null = await page.evaluate(() => {
            const turns = [...document.querySelectorAll('ms-chat-turn')];
            const inTurn = turns[turns.length - 1]?.querySelector('.model-error') as HTMLElement | null;
            if (inTurn?.innerText.trim()) return inTurn.innerText.replace(/\s+/g, ' ').trim();
            const bar = document.querySelector('mat-snack-bar-container') as HTMLElement | null;
            const t = bar?.innerText.replace(/\s+/g, ' ').replace(/\b(error|close)\b/g, '').trim() || '';
            return /failed|error|quota|limit/i.test(bar?.innerText || '') ? t : null;
        });
        if (failed) throw new Error(`AI Studio: ${failed}`);
        const now: string = await page.evaluate(lastAnswerText);
        const running: boolean = await page.evaluate(generating);
        if (now !== seen || running) { seen = now; stableSince = Date.now(); }
        else if (now && Date.now() - stableSince >= 1500) break;
        await page.waitForTimeout(300);
    }
    return seen;
}

/** «Copy as markdown» del último turno, interceptado en la página (el portapapeles no se toca). Vacío si no llegó. */
export async function copyLastAsMarkdown(page: any): Promise<string> {
    for (let attempt = 1; attempt <= 2; attempt++) {
        try {
            await page.evaluate(() => {
                const w = window as any;
                w.__jarvisCopied = null;
                if (w.__jarvisHooked) return;
                w.__jarvisHooked = true;
                const exec = document.execCommand.bind(document);
                (document as any).execCommand = (cmd: string, ...rest: any[]) => {
                    if (cmd === 'copy') { const el = document.activeElement as any; w.__jarvisCopied = el?.value ?? String(getSelection()); return true; }
                    return exec(cmd, ...rest);
                };
                if (navigator.clipboard) (navigator.clipboard as any).writeText = async (t: string) => { w.__jarvisCopied = t; };
            });
            const last = page.locator('ms-chat-turn').last();
            await last.scrollIntoViewIfNeeded().catch(() => {});
            await last.hover();
            await last.locator('button[aria-label="Open options"]').click({ timeout: 5_000 });
            await page.getByRole('menuitem', { name: /Copy as markdown/ }).click({ timeout: 5_000 });
            await page.waitForFunction(() => (window as any).__jarvisCopied !== null, null, { timeout: 5_000 });
            const text: string = (await page.evaluate(() => (window as any).__jarvisCopied)) || '';
            if (text.trim()) return text;
        } catch {
            await page.keyboard.press('Escape').catch(() => {});
        }
    }
    return '';
}
