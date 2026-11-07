// EL MAPA DE UNA HERRAMIENTA — sus pantallas y sus elementos con un nombre nuestro y el localizador que Jarvis ya
// verificó. Es lo que el harness sabe del wizard (`phone-input`, `otp-input`…), llevado a las herramientas de todos los
// días (el admin de VTEX, …): una receta por pantalla lo usa en vez de buscar qué tocar.
//
//   node jarvis/dev/map.ts save <app> <pantalla> [--title "…"] [--frame '#iframe' | --no-frame]
//                                                                     la pestaña de Jarvis, tal como está, al mapa
//   node jarvis/dev/map.ts verify <app> [pantalla]                    cada pantalla sigue teniendo sus elementos
//   node jarvis/dev/map.ts show <app>                                 el mapa, legible
//   (los nombres de antes del 2026-11-07 —guardar, verificar, ver, --titulo, --marco, --sin-marco— siguen andando)
//
// El mapa vive en `jarvis/maps/<app>/map.json`, versionado. `save` toma el análisis de la sesión de Jarvis (la de
// JARVIS_SESSION, o la última): no adivina nada, cada localizador es uno que el análisis contó (aparece una sola vez) y
// probó. Un elemento sin un localizador estable (sólo CSS por posición, o un nombre como «span» o «button») queda
// marcado `fragile`: está, pero una receta no debería depender de él. `verify` abre cada pantalla en la misma sesión
// y dice qué elemento ya no está: VTEX cambia su admin, y un mapa viejo tiene que fallar fuerte, no trabar una receta.
//
// `--frame '#raccoon-iframe'` guarda sólo lo que vive en ese iframe (el contenido de una pantalla del admin nuevo de
// VTEX) y `--no-frame` sólo lo de afuera (el armazón: la barra lateral, que es igual en todas y se guarda una vez como
// pantalla `admin`). Lo que se repite por fila de una lista (`.first()`, `.nth(…)`) es un dato, no estructura: no entra.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const API = process.env.JARVIS_API || 'http://127.0.0.1:5203';
const TAB = process.env.JARVIS_SESSION || process.env.JARVIS_SESION || '';
const OLD: Record<string, string> = { guardar: 'save', verificar: 'verify', ver: 'show' };
const [rawCmd, app, screen] = process.argv.slice(2);
const cmd = OLD[rawCmd] ?? rawCmd;
const flag = (name: string, old?: string) => { for (const n of [name, old]) { const i = n ? process.argv.indexOf(`--${n}`) : -1; if (i >= 0) return process.argv[i + 1]; } return undefined; };
if (!cmd || !app) {
    console.error('  uso: map.ts save <app> <pantalla> [--title …] [--frame …|--no-frame] · verify <app> [pantalla] · show <app>');
    process.exit(2);
}

type Loc = { kind: string; code: string; count?: number; works?: boolean };
type Control = { kind: string; name: string; role: string; frame?: string; locators?: Loc[] };
type Element = { kind: string; text: string; locator: string; fragile?: true; conditional?: string };
type Screen = { url: string; title: string; saved: string; elements: Record<string, Element> };
type Map = { app: string; screens: Record<string, Screen> };

const file = path.join(ROOT, 'jarvis', 'maps', app, 'map.json');
const load = (): Map => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { app, screens: {} });
const save = (m: Map) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(m, null, 2) + '\n'); };

async function api(method: string, p: string, body?: unknown): Promise<any> {
    const r = await fetch(API + p, { method, headers: { 'content-type': 'application/json', 'X-Jarvis-Client': 'cli', ...(TAB ? { 'X-Jarvis-Tab': TAB } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body) });
    const t = await r.text();
    try { return JSON.parse(t); } catch { return { error: t }; }
}

const JUNK = /^(span|div|button|a|svg|i|\[object object\]|[a-z]?)$/i;
const POSITIONAL = /nth-of-type|> div|locator\('(body|#[\w-]+) >/;
const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/<[^>]+>/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'elemento';
const TYPES: Record<string, string> = { field: 'campo', select: 'desplegable', check: 'casilla', button: 'botón', link: 'enlace', scroll: 'zona con scroll', file: 'archivo' };

/** El mejor localizador del control: el primero que el análisis probó y aparece una sola vez. */
function best(c: Control): { code: string; fragile: boolean } | null {
    const ok = (c.locators ?? []).filter((l) => l.works !== false && (l.count ?? 1) === 1);
    const pick = ok.find((l) => !POSITIONAL.test(l.code)) ?? ok[0];
    if (!pick) return null;
    return { code: pick.code, fragile: POSITIONAL.test(pick.code) || JUNK.test(c.name.trim()) };
}

async function current(): Promise<{ url: string; title: string; controls: Control[] }> {
    const st = await api('GET', '/api/live/state?fresh=1');
    if (!st.active) throw new Error('no hay una sesión de Jarvis abierta (bin/jarvis start --url … primero)');
    return { url: st.url, title: st.title, controls: st.page?.controls ?? [] };
}

/** La URL de la pantalla sin lo que cambia de una vez a otra (ids, query): es la que `verify` abre. */
const urlOf = (u: string) => u.replace(/[?#].*$/, '');

if (cmd === 'save') {
    if (!screen) { console.error('  falta el nombre de la pantalla'); process.exit(2); }
    const { url, title, controls } = await current();
    const elements: Record<string, Element> = {};
    let fragile = 0;
    const frame = flag('frame', 'marco');
    const outside = process.argv.includes('--no-frame') || process.argv.includes('--sin-marco');
    for (const c of controls) {
        if (frame && c.frame !== frame) continue;
        if (outside && c.frame) continue;
        const b = best(c);
        if (!b || /\.(first|nth)\(/.test(b.code)) continue;
        // Una fila de una lista: un enlace «Nombre del producto 10» (el texto termina en su id). Es un dato, no una pieza.
        if (c.kind === 'link' && /\s\d+$/.test(c.name.trim())) continue;
        let key = slug(c.name);
        for (let n = 2; elements[key]; n++) key = `${slug(c.name)}-${n}`;
        elements[key] = { kind: TYPES[c.kind] ?? c.kind, text: c.name, locator: b.code, ...(b.fragile ? { fragile: true as const } : {}) };
        if (b.fragile) fragile++;
    }
    const m = load();
    m.screens[screen] = { url: urlOf(url), title: flag('title', 'titulo') || title, saved: new Date().toISOString().slice(0, 10), elements };
    save(m);
    console.log(`  ${screen}: ${Object.keys(elements).length} elementos (${fragile} frágiles) · ${urlOf(url)} → ${path.relative(ROOT, file)}`);
} else if (cmd === 'verify') {
    const m = load();
    const names = screen ? [screen] : Object.keys(m.screens);
    let broken = 0;
    for (const name of names) {
        const s = m.screens[name];
        if (!s) { console.log(`  ✗ ${name}: no está en el mapa`); broken++; continue; }
        await api('POST', '/api/live/nav', { action: 'goto', url: s.url });
        await new Promise((r) => setTimeout(r, 4000));
        const { controls } = await current();
        const codes = new Set(controls.flatMap((c) => (c.locators ?? []).filter((l) => (l.count ?? 1) === 1).map((l) => l.code)));
        // Los condicionales (un «Save» que aparece sólo con cambios) no están en la pantalla recién abierta: no se exigen.
        const missing = Object.entries(s.elements).filter(([, e]) => !e.fragile && !e.conditional && !codes.has(e.locator));
        broken += missing.length;
        console.log(`  ${missing.length ? '✗' : '✓'} ${name}: ${Object.keys(s.elements).length - missing.length}/${Object.keys(s.elements).length} elementos${missing.length ? ' · faltan: ' + missing.map(([k]) => k).join(', ') : ''}`);
    }
    process.exit(broken ? 1 : 0);
} else if (cmd === 'show') {
    const m = load();
    for (const [name, s] of Object.entries(m.screens)) {
        console.log(`\n  ${name} · ${s.title} · ${s.url} (guardado ${s.saved})`);
        for (const [k, e] of Object.entries(s.elements)) if (!e.fragile) console.log(`    ${k.padEnd(32)} ${e.kind.padEnd(10)} ${e.locator}`);
        const f = Object.values(s.elements).filter((e) => e.fragile).length;
        if (f) console.log(`    (+${f} frágiles, sin localizador estable)`);
    }
} else {
    console.error(`  no conozco «${rawCmd}»`);
    process.exit(2);
}
