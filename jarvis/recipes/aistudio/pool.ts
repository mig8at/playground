// EL POOL DE AI STUDIO: varias preguntas a la vez, cada una en su pestaña, por UNA conexión a Chrome. No es una
// receta: lo arranca Wally (wally/server/pool.go) y le habla por stdin/stdout, una línea JSON por mensaje.
//
//   entra:  {"id": "a1", "model": "gemini-3.8-flash", "text": "…", "timeout": 600}
//   sale:   {"id": "a1", "ok": true, "answer": "…", "format": "markdown", "model": "gemini-3.8-flash", "ms": 8123}
//           {"id": "a1", "ok": false, "error": "…", "paused": true}
//
// Por qué un proceso aparte y no `bin/aistudio` por pregunta: el puente de Jarvis acepta UNA sola conexión de Playwright
// (una segunda se rechaza con «ya hay otra conexión de Playwright»), pero esa conexión maneja varias pestañas en
// paralelo (medido el 2026-11-17: tres pestañas, 2,1 s cada una, a la vez). El pool:
//   - abre la conexión cuando llega trabajo y la suelta a los 20 s sin nada, para que `bin/aistudio` desde la consola
//     pueda usarla mientras tanto;
//   - corre hasta WALLY_POOL_MAX preguntas a la vez (2) y escalona los comienzos WALLY_POOL_GAP segundos (20): Google
//     corta por el ritmo de la cuenta, no por pestaña (2026-11-17, con la cuenta cansada tras un día de pruebas: con 8 s
//     entre las dos, la segunda ya recibió «Permiso denegado»);
//   - respeta la pausa de la cuenta (page.ts): con una pausa vigente, no abre AI Studio y contesta `paused`.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { askOn, currentPauses, noteFailure, openWorkPage, windowMode } from './page.ts';

const MAX = Number(process.env.WALLY_POOL_MAX || 2);
const GAP_MS = Number(process.env.WALLY_POOL_GAP || 20) * 1000;
const IDLE_MS = 20_000;

type Job = { id: string; model: string; text: string; timeout?: number };
const queue: Job[] = [];
let active = 0;
let lastStart = 0;
let browser: any = null;
let idleTimer: NodeJS.Timeout | null = null;

const send = (o: unknown) => process.stdout.write(JSON.stringify(o) + '\n');
const log = (s: string) => process.stderr.write(`[pool] ${s}\n`);

async function connect() {
    if (browser?.isConnected?.()) return browser;
    const status = await (await fetch('http://127.0.0.1:5203/api/chrome')).json();
    if (!status.connected) throw new Error('Jarvis no está conectado en Chrome (abrí Chrome o tocá el ícono de Jarvis)');
    if (status.driving) throw new Error('hay una sesión de Jarvis manejando Chrome: cerrala (bin/jarvis close)');
    const cache = path.join(os.homedir(), 'Library/Caches/ms-playwright-go');
    const version = fs.readdirSync(cache).filter((d) => fs.existsSync(path.join(cache, d, 'package'))).sort().pop()!;
    const { chromium } = await import(path.join(cache, version, 'package', 'index.mjs'));
    browser = await chromium.connectOverCDP('ws://127.0.0.1:5203/api/chrome/cdp', { timeout: 20_000 });
    log('conectado a Chrome');
    return browser;
}

function scheduleIdle() {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(async () => {
        if (active === 0 && queue.length === 0 && browser) {
            await browser.close().catch(() => {});
            browser = null;
            log('conexión suelta (20 s sin trabajo)');
        }
    }, IDLE_MS);
}

// Abrir pestañas de a una y con reintento: con una pestaña cargando AI Studio, crear otra por el puente a veces falla en
// Playwright con «Cannot read properties of undefined (reading '_page')» (2026-11-17, el primer grupo de Wally: M-O
// perdió su tema por eso mientras EVA trabajaba). Un segundo intento, ya sin la carrera, anda.
let opening: Promise<unknown> = Promise.resolve();
function openPage(b: any): Promise<any> {
    const next = opening.then(async () => {
        for (let attempt = 1; ; attempt++) {
            try {
                return await openWorkPage(b);
            } catch (e: any) {
                if (attempt >= 3) throw e;
                log(`no abrió la pestaña (${String(e?.message || e).split('\n')[0]}); reintento ${attempt}`);
                await new Promise((r) => setTimeout(r, 1500 * attempt));
            }
        }
    });
    opening = next.catch(() => {});
    return next;
}

async function run(job: Job) {
    const pause = currentPauses()['*'] || currentPauses()[job.model];
    if (pause) {
        const hour = new Date(pause.until).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
        send({ id: job.id, ok: false, paused: true, until: pause.until, error: `bin/aistudio está en pausa hasta las ${hour}: ${pause.reason.split('\n')[0]}` });
        return;
    }
    let page: any = null;
    try {
        const b = await connect();
        page = await openPage(b);
        const r = await askOn(page, job.model, job.text, (job.timeout || 600) * 1000, (s) => log(`${job.id}: ${s}`));
        send({ id: job.id, ok: true, answer: r.answer, format: r.format, model: r.modelId, ms: r.ms });
    } catch (e: any) {
        const message = noteFailure(String(e?.message || e), job.model);
        // Con el corte, la hora en que vence la pausa: sin ella, quien pregunta vuelve antes de tiempo y gasta reintentos.
        const now = currentPauses()['*'];
        send({ id: job.id, ok: false, error: message, paused: !!now, until: now?.until });
        // Una conexión rota no se reusa: la próxima pregunta abre otra.
        if (!browser?.isConnected?.()) browser = null;
    } finally {
        await page?.close().catch(() => {});
    }
}

function pump() {
    while (active < MAX && queue.length) {
        const wait = Math.max(0, lastStart + GAP_MS - Date.now());
        if (wait > 0) {
            setTimeout(pump, wait);
            return;
        }
        const job = queue.shift()!;
        active += 1;
        lastStart = Date.now();
        run(job).finally(() => {
            active -= 1;
            pump();
            if (active === 0 && queue.length === 0) scheduleIdle();
        });
    }
}

readline.createInterface({ input: process.stdin }).on('line', (line) => {
    if (!line.trim()) return;
    try {
        const job = JSON.parse(line) as Job;
        if (!job.id || !job.model || !job.text) throw new Error('falta id, model o text');
        queue.push(job);
        if (idleTimer) clearTimeout(idleTimer);
        pump();
    } catch (e: any) {
        send({ id: null, ok: false, error: `línea inválida: ${e.message}` });
    }
}).on('close', async () => {
    await browser?.close().catch(() => {});
    process.exit(0);
});
log(`listo: hasta ${MAX} a la vez, ${GAP_MS / 1000} s entre comienzos, ventana: ${windowMode()}`);
