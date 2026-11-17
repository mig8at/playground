// RECETA · texto a voz POR LA INTERFAZ de AI Studio, en tu Chrome y con tu cuenta, sin llave de API: escribe el texto en
// «Generate speech», toca Run y guarda el audio en un WAV.
//
//   make jarvis-recipe APP=aistudio RECIPE=speak ARGS='--text "Hola" --out hola.wav'
//   bin/aistudio speak --text 'Bienvenido a CreditOp' --voice Enzo --out bienvenida.wav
//   cat guion.txt | bin/aistudio speak --out guion.wav
//
// Pasos: Generate speech con el modelo → «Create new dialog» → la voz, si se pide (Speaker settings: se busca por
// nombre y se comprueba «Current voice») → el texto → Run → el audio. AI Studio lo reproduce mientras lo genera, en
// pedacitos de 40-120 ms por Web Audio: la receta lo SILENCIA (una ganancia en 0 antes de los parlantes) y junta esos
// pedacitos en orden en un WAV mono de 24 kHz. El botón «Download» de la página no sirve acá: con la pestaña manejada
// no baja nada.
//
// Parámetros: --text "texto" · --file <archivo> · o el texto por stdin · --out <archivo.wav> (obligatorio) · --voice
// <nombre> (sin ella, la que AI Studio tenga puesta; hay más de 2.000: Enzo, Riko, Bodi, Lumi, Koda, Nika…) · --model (gemini-3.8-flash-tts;
// también gemini-3.8-flash-lite-tts, gemini-2.5-pro-preview-tts…) · --timeout <segundos> (300) · --json
// Necesita: Jarvis conectado en Chrome, sin otra sesión de Jarvis manejándolo, y tu sesión de Google abierta.
// ⚠ Sólo lectura en tu cuenta. El texto viaja a Google como cuando lo escribís a mano.
import '../args.ts';
import fs from 'node:fs';
import { flag, JSON_OUT, say, resolvePath, readInput, runAndWait, waitMediaConsent, openAIStudio, noteFailure } from './page.ts';

const text = readInput('text');
const out = flag('out');
if (!text || !out) {
    console.error('  uso: aistudio speak --text "…" | --file <archivo> | (texto por stdin) --out <archivo.wav> [--voice <nombre>] [--model <id>] [--json]');
    process.exit(2);
}
const model = flag('model') || 'gemini-3.8-flash-tts';
const voice = flag('voice');
const timeoutMs = Number(flag('timeout') || 300) * 1000;

// Antes de que cargue la página: silenciar lo que va a los parlantes y guardar cada pedacito de audio que se reproduce.
function prepare() {
    const w = window as any;
    w.__jarvisAudio = [];
    const connect = AudioNode.prototype.connect as any;
    AudioNode.prototype.connect = function (dest: any, ...rest: any[]) {
        if (dest instanceof AudioDestinationNode) {
            const ctx = dest.context as any;
            if (!ctx.__jarvisMute) { ctx.__jarvisMute = ctx.createGain(); ctx.__jarvisMute.gain.value = 0; connect.call(ctx.__jarvisMute, dest); }
            return connect.call(this, ctx.__jarvisMute, ...rest);
        }
        return connect.call(this, dest, ...rest);
    } as any;
    const desc = Object.getOwnPropertyDescriptor(AudioBufferSourceNode.prototype, 'buffer')!;
    Object.defineProperty(AudioBufferSourceNode.prototype, 'buffer', {
        get() { return desc.get!.call(this); },
        set(b) { if (b) w.__jarvisAudio.push(b); desc.set!.call(this, b); },
        configurable: true,
    });
}

const { page, close } = await openAIStudio(`https://aistudio.google.com/generate-speech?model=${encodeURIComponent(model)}`, model, prepare);
try {
    const t0 = Date.now();
    const create = page.getByText('Create new dialog');
    try { await create.waitFor({ timeout: 30_000 }); } catch {
        throw new Error(`no apareció «Generate speech» (¿sesión de Google cerrada, o «${model}» no es un modelo de voz?): ${page.url()}`);
    }
    await create.click();
    const box = page.getByRole('textbox', { name: 'Speech block text' });
    await box.waitFor({ timeout: 10_000 });

    if (voice) {
        await page.getByRole('button', { name: 'Open voice settings' }).click();
        const search = page.getByRole('textbox', { name: /Search .*voices/ });
        await search.waitFor({ timeout: 10_000 });
        await search.fill(voice);
        await page.waitForTimeout(1200);
        // La fila de una voz: su nombre exacto en un elemento propio, con la descripción debajo.
        const row = page.getByText(voice, { exact: true }).last();
        if (!(await row.count())) throw new Error(`no hay una voz «${voice}» (el nombre es el que aparece en Speaker settings)`);
        await row.click();
        await page.waitForTimeout(800);
        const current = await page.evaluate(() => (document.body.innerText.match(/Current voice\s+(\S+)/) || [])[1] || '');
        if (current.toLowerCase() !== voice.toLowerCase()) throw new Error(`quedó la voz «${current}», no «${voice}»`);
        await page.keyboard.press('Escape');
        await page.waitForTimeout(500);
    }
    const chosenVoice = await page.locator('button', { hasText: 'Speaker 1 -' }).first().textContent()
        .then((t: string | null) => (t || '').replace(/.*Speaker 1 -\s*/, '').replace(/arrow_drop_down/, '').trim()).catch(() => voice || '');
    say(`modelo: ${model} · voz: ${chosenVoice} · ${text.length.toLocaleString('es-CO')} caracteres`);

    await box.fill(text);
    say('generando la voz…');
    await runAndWait(page, timeoutMs);
    await waitMediaConsent(page);

    // Los pedacitos siguen llegando un instante después de «Run»: se espera a que el conteo quede quieto 1,5 s.
    let count = -1;
    let stableSince = Date.now();
    while (Date.now() - stableSince < 1500) {
        const n: number = await page.evaluate(() => (window as any).__jarvisAudio.length);
        if (n !== count) { count = n; stableSince = Date.now(); }
        await page.waitForTimeout(250);
    }
    if (!count) {
        const notice = await page.locator('mat-snack-bar-container').first().textContent({ timeout: 1000 }).catch(() => null);
        throw new Error(`AI Studio no devolvió audio${notice ? `: ${notice.replace(/\s+/g, ' ').trim()}` : ''}`);
    }

    // Los pedacitos, en orden, en un WAV PCM 16 bits (mono, a la frecuencia del primero).
    const wav: { b64: string; seconds: number; rate: number } = await page.evaluate(() => {
        const bufs: AudioBuffer[] = (window as any).__jarvisAudio;
        const rate = bufs[0].sampleRate;
        const total = bufs.reduce((n, b) => n + b.length, 0);
        const view = new DataView(new ArrayBuffer(44 + total * 2));
        const tag = (o: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
        tag(0, 'RIFF'); view.setUint32(4, 36 + total * 2, true); tag(8, 'WAVE'); tag(12, 'fmt ');
        view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
        view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
        tag(36, 'data'); view.setUint32(40, total * 2, true);
        let o = 44;
        for (const b of bufs) {
            const ch = b.getChannelData(0);
            for (let i = 0; i < ch.length; i++, o += 2) { const v = Math.max(-1, Math.min(1, ch[i])); view.setInt16(o, v < 0 ? v * 0x8000 : v * 0x7fff, true); }
        }
        const u = new Uint8Array(view.buffer);
        let s = '';
        for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
        return { b64: btoa(s), seconds: total / rate, rate };
    });
    const file = resolvePath(out);
    fs.writeFileSync(file, Buffer.from(wav.b64, 'base64'));
    const ms = Date.now() - t0;
    say(`listo en ${(ms / 1000).toFixed(1)} s · ${wav.seconds.toFixed(1)} s de audio · ${out}`);
    if (JSON_OUT) console.log(JSON.stringify({ recipe: 'aistudio/speak', model, voice: chosenVoice, chars: text.length, ms, seconds: wav.seconds, rate: wav.rate, out: file }));
} catch (e: any) {
    console.error(`  ✗ ${noteFailure(String(e.message || e), model)}`);
    process.exitCode = 1;
} finally {
    await close();
}
