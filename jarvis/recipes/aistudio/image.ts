// RECETA · crear una imagen POR LA INTERFAZ de AI Studio (Nano Banana 2 Lite, el modelo de imágenes sin «Paid»), en tu
// Chrome y con tu cuenta, sin llave de API: escribe el pedido en el chat, toca Run y guarda la imagen que devuelve.
//
//   make jarvis-recipe APP=aistudio RECIPE=image ARGS='--prompt "Un robot regando una planta" --out robot.png'
//   bin/aistudio image --prompt 'Logo minimalista de una hoja verde' --aspect 1:1 --out hoja.png
//
// Pasos: un chat temporal con el modelo en la URL → «Images only» y la proporción, si se piden → el pedido → Run →
// la imagen más grande del último turno, leída desde la página.
// ⚠ SIN PROBAR DE PUNTA A PUNTA (2026-11-17): el primer intento contestó «Permiso denegado» para este modelo mientras
// el texto andaba. Cómo se guarda la imagen (el `src` de la imagen del turno, leído con fetch en la página) falta
// confirmarlo con una generación real.
//
// Parámetros: --prompt "pedido" (o --file / stdin) · --out <archivo> (la extensión la decide el formato que llega) ·
// --aspect <1:1|16:9|9:16|4:3|3:4…> · --only-images · --model (gemini-3.1-flash-lite-image) · --timeout <s> (300) ·
// --json
// Necesita: Jarvis conectado en Chrome y tu sesión de Google. Si sale el aviso de multimedia, lo acepta la persona.
import '../args.ts';
import fs from 'node:fs';
import path from 'node:path';
import { flag, has, JSON_OUT, say, resolvePath, readInput, openAIStudio, runAndWait, waitMediaConsent, noteFailure } from './page.ts';

const text = readInput('prompt');
const out = flag('out');
if (!text || !out) {
    console.error('  uso: aistudio image --prompt "…" --out <archivo> [--aspect 1:1] [--only-images] [--model <id>] [--json]');
    process.exit(2);
}
const model = flag('model') || 'gemini-3.1-flash-lite-image';
const timeoutMs = Number(flag('timeout') || 300) * 1000;

const { page, close } = await openAIStudio(`https://aistudio.google.com/prompts/new_chat?model=${encodeURIComponent(model)}`, model);
try {
    const t0 = Date.now();
    const box = page.getByRole('textbox', { name: 'Enter a prompt' });
    try { await box.waitFor({ timeout: 30_000 }); } catch {
        throw new Error(`no apareció el campo del pedido (¿sesión de Google cerrada, o «${model}» no hace imágenes?): ${page.url()}`);
    }
    if (has('only-images')) await page.getByRole('button', { name: /Images only/ }).click();
    const aspect = flag('aspect');
    if (aspect) {
        await page.getByRole('combobox', { name: 'Aspect ratio' }).click();
        const option = page.getByRole('option', { name: aspect, exact: true });
        if (!(await option.count())) { await page.keyboard.press('Escape'); throw new Error(`AI Studio no ofrece la proporción «${aspect}»`); }
        await option.click();
    }
    say(`modelo: ${model}${aspect ? ` · ${aspect}` : ''} · pidiendo la imagen…`);
    await box.fill(text);
    await runAndWait(page, timeoutMs);
    await waitMediaConsent(page);

    // La imagen: la más grande del último turno, cuando ya cargó. Un error sale en rojo en el turno.
    const until = Date.now() + timeoutMs;
    let found = false;
    while (Date.now() < until && !found) {
        const state = await page.evaluate(() => {
            const turns = [...document.querySelectorAll('ms-chat-turn')];
            const last = turns[turns.length - 1];
            const err = (last?.querySelector('.model-error') as HTMLElement | null)?.innerText.replace(/\s+/g, ' ').trim();
            const big = last ? [...last.querySelectorAll('img')].some((im) => im.complete && im.naturalWidth > 200) : false;
            return { err, big };
        });
        if (state.err) throw new Error(`AI Studio: ${state.err.replace(/^error\s*/i, '')}`);
        found = state.big;
        if (!found) await page.waitForTimeout(500);
    }
    if (!found) throw new Error('AI Studio no devolvió una imagen');
    const img: { b64: string; type: string; w: number; h: number; caption: string } = await page.evaluate(async () => {
        const turns = [...document.querySelectorAll('ms-chat-turn')];
        const last = turns[turns.length - 1]!;
        const im = [...last.querySelectorAll('img')].sort((a, b) => b.naturalWidth * b.naturalHeight - a.naturalWidth * a.naturalHeight)[0];
        const res = await fetch(im.src);
        const buf = new Uint8Array(await res.arrayBuffer());
        let s = '';
        for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
        const caption = [...last.querySelectorAll('ms-text-chunk')].map((c) => (c as HTMLElement).innerText.trim()).filter(Boolean).join('\n');
        return { b64: btoa(s), type: res.headers.get('content-type') || 'image/png', w: im.naturalWidth, h: im.naturalHeight, caption };
    });
    // La extensión la decide lo que llegó: un .png con un JPEG adentro confunde a más de un programa.
    const ext = ({ 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp' } as Record<string, string>)[img.type] || path.extname(out) || '.png';
    const file = resolvePath(path.extname(out) === ext ? out : out.replace(/\.[a-z0-9]+$/i, '') + ext);
    fs.writeFileSync(file, Buffer.from(img.b64, 'base64'));
    const ms = Date.now() - t0;
    say(`listo en ${(ms / 1000).toFixed(1)} s · ${img.w}×${img.h} · ${path.relative(process.cwd(), file) || file}`);
    if (img.caption && !JSON_OUT) say(`el modelo dijo: ${img.caption.slice(0, 300)}`);
    if (JSON_OUT) console.log(JSON.stringify({ recipe: 'aistudio/image', model, ms, width: img.w, height: img.h, type: img.type, out: file, caption: img.caption }));
} catch (e: any) {
    console.error(`  ✗ ${noteFailure(String(e.message || e), model)}`);
    process.exitCode = 1;
} finally {
    await close();
}
