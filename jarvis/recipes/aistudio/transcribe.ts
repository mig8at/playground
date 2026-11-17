// RECETA · audio a texto POR LA INTERFAZ de AI Studio (Gemini 3.5 Transcribe), en tu Chrome y con tu cuenta, sin
// llave de API: sube el audio, toca «Transcribe» y devuelve la transcripción en Markdown, por segmentos con la hora y
// quién habla.
//
//   make jarvis-recipe APP=aistudio RECIPE=transcribe ARGS='reunion.m4a --out reunion.md'
//   bin/aistudio transcribe llamada.wav
//   bin/aistudio transcribe entrevista.mp3 --plain --vocabulary 'CreditOp, Addi, Sistecrédito' --out entrevista.md
//
// Pasos: el chat con el modelo de transcripción (temporal: no queda en el History) → las opciones del panel derecho,
// si se piden → «Upload» con el archivo → «Transcribe» → espera a que el texto quede quieto → «Copy as markdown» del
// resultado (interceptado: tu portapapeles no se toca).
//
// Parámetros: <audio> (o --file <audio>) · --out <archivo> · --plain (sin marcas de tiempo por palabra ni etiquetas
// de quién habla) · --smart (la «Smart transcription» de AI Studio) · --vocabulary 'término, término' (nombres propios
// que tiene que escribir bien; implica --plain: AI Studio no deja combinarlos) · --model (gemini-3.5-transcribe) · --timeout <segundos> (900) · --json
// Necesita: Jarvis conectado en Chrome, sin otra sesión de Jarvis manejándolo, tu sesión de Google abierta y el aviso
// de multimedia de AI Studio ya aceptado por la persona (la receta no lo acepta: si aparece, lo cancela y para).
// ⚠ El audio SUBE A GOOGLE: AI Studio lo guarda en tu Google Drive y, según su aviso, puede usarse para mejorar sus
// productos. No subas grabaciones con datos de clientes.
import '../args.ts';
import fs from 'node:fs';
import path from 'node:path';
import { argv, flag, has, JSON_OUT, say, resolvePath, refuseMediaConsent, openAIStudio, waitStableAnswer, copyLastAsMarkdown } from './page.ts';

const valued = new Set(['--out', '--file', '--model', '--timeout', '--vocabulary']);
const positional = argv.filter((a, i) => !a.startsWith('--') && !valued.has(argv[i - 1]));
const input = flag('file') || positional[0];
if (!input) {
    console.error('  uso: aistudio transcribe <audio> [--out <archivo>] [--plain] [--smart] [--vocabulary "a, b"] [--json]');
    process.exit(2);
}
const audio = resolvePath(input);
if (!fs.existsSync(audio)) { console.error(`  ✗ no existe ${audio}`); process.exit(2); }
const model = flag('model') || 'gemini-3.5-transcribe';
const timeoutMs = Number(flag('timeout') || 900) * 1000;

/** Prende o apaga un interruptor del panel derecho («Word timestamps»…) según cómo tiene que quedar. */
async function setSwitch(page: any, name: string, on: boolean) {
    // Un interruptor de Material: `button[role=switch]` con su estado en `aria-checked`.
    const sw = page.locator(`button[role="switch"][aria-label="${name}"]`).first();
    if (!(await sw.count())) throw new Error(`no encontré el interruptor «${name}»`);
    const isOn = async () => (await sw.getAttribute('aria-checked')) === 'true';
    if ((await isOn()) === on) return;
    await sw.click();
    for (let i = 0; i < 10 && (await isOn()) !== on; i++) await page.waitForTimeout(200);
    if ((await isOn()) !== on) throw new Error(`«${name}» no quedó ${on ? 'prendido' : 'apagado'}`);
}

const { page, close } = await openAIStudio(`https://aistudio.google.com/prompts/new_chat?model=${encodeURIComponent(model)}`);
try {
    const t0 = Date.now();
    const upload = page.getByRole('button', { name: 'Upload', exact: true });
    try { await upload.waitFor({ timeout: 30_000 }); } catch {
        throw new Error(`no apareció la pantalla de transcripción (¿sesión de Google cerrada, o «${model}» no transcribe?): ${page.url()}`);
    }
    if (has('plain')) {
        await setSwitch(page, 'Word timestamps', false);
        await setSwitch(page, 'Speaker labels', false);
    }
    if (has('smart')) await setSwitch(page, 'Smart transcription', true);
    if (flag('vocabulary')) {
        // ⚠ AI Studio no acepta vocabulario propio ni con marcas de tiempo por palabra ni con quién habla
        // («custom_vocabulary is incompatible with word timestamps / with diarization»): con --vocabulary es --plain.
        // El campo es de etiquetas: cada término se carga con Enter.
        if (!has('plain')) {
            await setSwitch(page, 'Word timestamps', false);
            await setSwitch(page, 'Speaker labels', false);
            say('con --vocabulary va sin marcas de tiempo ni quién habla: AI Studio no deja combinarlos');
        }
        const field = page.getByRole('textbox', { name: 'Custom vocabulary' });
        for (const term of flag('vocabulary')!.split(',').map((t) => t.trim()).filter(Boolean)) {
            await field.fill(term);
            await field.press('Enter');
        }
    }

    const size = fs.statSync(audio).size;
    say(`modelo: ${model} · ${path.basename(audio)} (${(size / 1024 / 1024).toFixed(1)} MB) · subiendo…`);
    const [chooser] = await Promise.all([page.waitForEvent('filechooser', { timeout: 10_000 }), upload.click()]);
    await chooser.setFiles(audio);
    const transcribe = page.getByRole('button', { name: 'Transcribe', exact: true });
    // Mientras sube, el botón todavía no está; el aviso de multimedia, si sale, sale acá.
    const until = Date.now() + 5 * 60_000;
    while (!(await transcribe.isVisible().catch(() => false))) {
        await refuseMediaConsent(page);
        if (Date.now() > until) throw new Error('el audio no terminó de subir en 5 min');
        await page.waitForTimeout(500);
    }
    await transcribe.click();
    say('transcribiendo…');
    await page.locator('ms-chat-turn').nth(1).waitFor({ timeout: 120_000 }).catch(() => {});
    const seen = await waitStableAnswer(page, timeoutMs);
    if (!seen) {
        const notice = await page.locator('mat-snack-bar-container').first().textContent({ timeout: 1000 }).catch(() => null);
        throw new Error(`AI Studio no devolvió la transcripción${notice ? `: ${notice.replace(/\s+/g, ' ').trim()}` : ''}`);
    }
    let text = await copyLastAsMarkdown(page);
    let format: 'markdown' | 'text' = 'markdown';
    if (!text.trim()) { text = seen; format = 'text'; say('«Copy as markdown» no entregó: sale como texto de la página'); }

    const ms = Date.now() - t0;
    const out = flag('out');
    if (out) fs.writeFileSync(resolvePath(out), text);
    say(`listo en ${(ms / 1000).toFixed(1)} s${out ? ` · guardada en ${out}` : ''}`);
    if (JSON_OUT) console.log(JSON.stringify({ recipe: 'aistudio/transcribe', model, audio, bytes: size, ms, format, text }));
    else if (!out) console.log(text);
} catch (e: any) {
    console.error(`  ✗ ${e.message || e}`);
    process.exitCode = 1;
} finally {
    await close();
}
