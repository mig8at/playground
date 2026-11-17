// ¿ESTÁN LISTOS LOS PROVEEDORES? Abre cada web en la pestaña que se le pasa y mira si está el campo para preguntar
// con sesión, SIN preguntar nada (no gasta cupo). Lo usa el pool (`{"type": "check"}`) cuando Wally arranca y cuando
// se pide desde su configuración. No es una receta: no tiene línea de uso.
//
// Lo que dice cada una: `listo` (está el campo), `sin-sesion` (la web pide entrar: lo hace la persona, a mano) o
// `error` (no cargó, o cambió la página). El cupo y las pausas no se ven acá: los dice el aviso de la última pregunta,
// que la receta guarda en la pausa (page.ts) y Wally le suma al resultado.

export type ProviderCheck = { state: 'listo' | 'sin-sesion' | 'error'; detail: string; ms: number };

type Probe = { id: string; url: string; ready: (page: any) => any; login: RegExp; name: string };

const PROBES: Probe[] = [
    { id: 'aistudio', name: 'Gemini', url: 'https://aistudio.google.com/prompts/new_chat?model=gemini-4-hydrogen',
      ready: (p) => p.getByRole('textbox', { name: 'Enter a prompt' }), login: /accounts\.google\.com/ },
    { id: 'deepseek', name: 'DeepSeek', url: 'https://chat.deepseek.com/',
      ready: (p) => p.getByRole('textbox', { name: 'Mensaje a DeepSeek' }), login: /sign_in/ },
    { id: 'chatgpt', name: 'ChatGPT', url: 'https://chatgpt.com/?temporary-chat=true',
      ready: (p) => p.getByRole('textbox', { name: 'Preguntar a ChatGPT' }), login: /auth|login/ },
    { id: 'groq', name: 'Groq', url: 'https://chat.groq.com/?model=openai/gpt-oss-120b',
      ready: (p) => p.getByRole('textbox', { name: 'Try it' }), login: /accounts\.google|stytch/ },
];

/** Mira los cuatro, de a uno, en la misma pestaña. */
export async function checkProviders(page: any, log: (s: string) => void = () => {}): Promise<Record<string, ProviderCheck>> {
    const out: Record<string, ProviderCheck> = {};
    for (const p of PROBES) {
        const t0 = Date.now();
        try {
            await page.goto(p.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
            const box = p.ready(page);
            await Promise.race([
                box.waitFor({ timeout: 25_000 }),
                page.waitForURL(p.login, { timeout: 25_000 }),
            ]).catch(() => {});
            if (p.login.test(page.url())) out[p.id] = { state: 'sin-sesion', detail: `${p.name} pide entrar: hacelo a mano en tu Chrome`, ms: Date.now() - t0 };
            else if (await box.count()) out[p.id] = { state: 'listo', detail: `${p.name} con sesión`, ms: Date.now() - t0 };
            else out[p.id] = { state: 'error', detail: `${p.name} no mostró el campo para preguntar (¿cambió la página o pide entrar?)`, ms: Date.now() - t0 };
        } catch (e: any) {
            out[p.id] = { state: 'error', detail: `${p.name}: ${String(e?.message || e).split('\n')[0].slice(0, 160)}`, ms: Date.now() - t0 };
        }
        log(`check ${p.id}: ${out[p.id].state} (${out[p.id].ms} ms)`);
    }
    return out;
}
