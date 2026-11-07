// EL MAPA DE UNA HERRAMIENTA — sus pantallas y sus elementos con un nombre nuestro y el localizador que Jarvis ya
// verificó. Es lo que el harness sabe del wizard (`phone-input`, `otp-input`…), llevado a las herramientas de todos los
// días (el admin de VTEX, …): una receta por pantalla lo usa en vez de buscar qué tocar.
//
//   node jarvis/dev/mapa.ts guardar <app> <pantalla> [--titulo "…"] [--marco '#iframe' | --sin-marco]
//                                                                     la pestaña de Jarvis, tal como está, al mapa
//   node jarvis/dev/mapa.ts verificar <app> [pantalla]                 cada pantalla sigue teniendo sus elementos
//   node jarvis/dev/mapa.ts ver <app>                                  el mapa, legible
//
// El mapa vive en `jarvis/mapas/<app>/mapa.json`, versionado. `guardar` toma el análisis de la sesión de Jarvis (la de
// JARVIS_SESION, o la última): no adivina nada, cada localizador es uno que el análisis contó (aparece una sola vez) y
// probó. Un elemento sin un localizador estable (sólo CSS por posición, o un nombre como «span» o «button») queda
// marcado `fragil`: está, pero una receta no debería depender de él. `verificar` abre cada pantalla en la misma sesión
// y dice qué elemento ya no está: VTEX cambia su admin, y un mapa viejo tiene que fallar fuerte, no trabar una receta.
//
// `--marco '#raccoon-iframe'` guarda sólo lo que vive en ese iframe (el contenido de una pantalla del admin nuevo de
// VTEX) y `--sin-marco` sólo lo de afuera (el armazón: la barra lateral, que es igual en todas y se guarda una vez como
// pantalla `admin`). Lo que se repite por fila de una lista (`.first()`, `.nth(…)`) es un dato, no estructura: no entra.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const API = process.env.JARVIS_API || 'http://127.0.0.1:5203';
const TAB = process.env.JARVIS_SESION || '';
const [cmd, app, screen] = process.argv.slice(2);
const flag = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : undefined; };
if (!cmd || !app) {
    console.error('  uso: mapa.ts guardar <app> <pantalla> [--titulo …] · verificar <app> [pantalla] · ver <app>');
    process.exit(2);
}

type Loc = { kind: string; code: string; count?: number; works?: boolean };
type Control = { kind: string; name: string; role: string; frame?: string; locators?: Loc[] };
type Element = { tipo: string; texto: string; localizador: string; fragil?: true };
type Screen = { url: string; titulo: string; guardado: string; elementos: Record<string, Element> };
type Map = { app: string; pantallas: Record<string, Screen> };

const file = path.join(ROOT, 'jarvis', 'mapas', app, 'mapa.json');
const load = (): Map => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { app, pantallas: {} });
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
function best(c: Control): { code: string; fragil: boolean } | null {
    const ok = (c.locators ?? []).filter((l) => l.works !== false && (l.count ?? 1) === 1);
    const pick = ok.find((l) => !POSITIONAL.test(l.code)) ?? ok[0];
    if (!pick) return null;
    return { code: pick.code, fragil: POSITIONAL.test(pick.code) || JUNK.test(c.name.trim()) };
}

async function current(): Promise<{ url: string; title: string; controls: Control[] }> {
    const st = await api('GET', '/api/live/state?fresh=1');
    if (!st.active) throw new Error('no hay una sesión de Jarvis abierta (bin/jarvis empezar --url … primero)');
    return { url: st.url, title: st.title, controls: st.page?.controls ?? [] };
}

/** La URL de la pantalla sin lo que cambia de una vez a otra (ids, query): es la que `verificar` abre. */
const urlOf = (u: string) => u.replace(/[?#].*$/, '');

if (cmd === 'guardar') {
    if (!screen) { console.error('  falta el nombre de la pantalla'); process.exit(2); }
    const { url, title, controls } = await current();
    const elements: Record<string, Element> = {};
    let fragile = 0;
    const frame = flag('marco');
    const outside = process.argv.includes('--sin-marco');
    for (const c of controls) {
        if (frame && c.frame !== frame) continue;
        if (outside && c.frame) continue;
        const b = best(c);
        if (!b || /\.(first|nth)\(/.test(b.code)) continue;
        // Una fila de una lista: un enlace «Nombre del producto 10» (el texto termina en su id). Es un dato, no una pieza.
        if (c.kind === 'link' && /\s\d+$/.test(c.name.trim())) continue;
        let key = slug(c.name);
        for (let n = 2; elements[key]; n++) key = `${slug(c.name)}-${n}`;
        elements[key] = { tipo: TYPES[c.kind] ?? c.kind, texto: c.name, localizador: b.code, ...(b.fragil ? { fragil: true as const } : {}) };
        if (b.fragil) fragile++;
    }
    const m = load();
    m.pantallas[screen] = { url: urlOf(url), titulo: flag('titulo') || title, guardado: new Date().toISOString().slice(0, 10), elementos: elements };
    save(m);
    console.log(`  ${screen}: ${Object.keys(elements).length} elementos (${fragile} frágiles) · ${urlOf(url)} → ${path.relative(ROOT, file)}`);
} else if (cmd === 'verificar') {
    const m = load();
    const names = screen ? [screen] : Object.keys(m.pantallas);
    let broken = 0;
    for (const name of names) {
        const s = m.pantallas[name];
        if (!s) { console.log(`  ✗ ${name}: no está en el mapa`); broken++; continue; }
        await api('POST', '/api/live/nav', { action: 'goto', url: s.url });
        await new Promise((r) => setTimeout(r, 4000));
        const { controls } = await current();
        const codes = new Set(controls.flatMap((c) => (c.locators ?? []).filter((l) => (l.count ?? 1) === 1).map((l) => l.code)));
        const missing = Object.entries(s.elementos).filter(([, e]) => !e.fragil && !codes.has(e.localizador));
        broken += missing.length;
        console.log(`  ${missing.length ? '✗' : '✓'} ${name}: ${Object.keys(s.elementos).length - missing.length}/${Object.keys(s.elementos).length} elementos${missing.length ? ' · faltan: ' + missing.map(([k]) => k).join(', ') : ''}`);
    }
    process.exit(broken ? 1 : 0);
} else if (cmd === 'ver') {
    const m = load();
    for (const [name, s] of Object.entries(m.pantallas)) {
        console.log(`\n  ${name} · ${s.titulo} · ${s.url} (guardado ${s.guardado})`);
        for (const [k, e] of Object.entries(s.elementos)) if (!e.fragil) console.log(`    ${k.padEnd(32)} ${e.tipo.padEnd(10)} ${e.localizador}`);
        const f = Object.values(s.elementos).filter((e) => e.fragil).length;
        if (f) console.log(`    (+${f} frágiles, sin localizador estable)`);
    }
} else {
    console.error(`  no conozco «${cmd}»`);
    process.exit(2);
}
