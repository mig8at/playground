// SÓLO LECTURA · un hilo de Gmail entero, en capturas numeradas, para dejar evidencia (en los artifacts de una tarea,
// por ejemplo). Abre el hilo en tu Chrome con Jarvis y saca la página completa bajando el scroll del panel del correo
// (`shot --full`): una página por pantalla, a la resolución de la pantalla, con un poco de solape entre una y otra.
//
//   make jarvis-recipe APP=gmail RECIPE=thread-capture ARGS='--thread 1a18463f41850926 --out tablero/tasks/integracion-shopify/artifacts --name correo-shopify'
//
// Salió de capturar el reenvío del hilo con Shopify Payments Partnerships (tarea integracion-shopify, 2026-11-13): en
// Gmail lo que se desplaza es un panel, no la página, y la captura común sólo sacaba lo visible.
//
// Parámetros: --thread <id del hilo o del correo, o la URL de Gmail> (obligatorio) · --out <carpeta> (por defecto
// el scratch de la sesión, /tmp) · --name <base del archivo> (por defecto «hilo-<id>») · --json
// Necesita: Jarvis conectado en Chrome y la sesión de Gmail abierta en Chrome. El id lo dan `bin/correo list` y
// `bin/pg gmail search`.
// Sólo lectura: abre el hilo y saca fotos; no marca, no mueve, no contesta.
import '../args.ts';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const argv = process.argv.slice(2);
const flag = (n: string) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const JSON_OUT = argv.includes('--json');
const say = (s: string) => { if (!JSON_OUT) console.log(`  ${s}`); };

const raw = (flag('thread') || '').trim();
if (!raw) {
    console.error('  uso: thread-capture --thread <id o URL de Gmail> [--out <carpeta>] [--name <base>] [--json]');
    process.exit(2);
}
// La URL se acepta tal cual; un id va a «Todos los correos» (#all/<id>), que abre el hilo esté donde esté.
const url = /^https?:\/\//.test(raw) ? raw : `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(raw)}`;
const id = /#[^/]+\/([\w-]+)$/.exec(url)?.[1] || 'hilo';
const outDir = path.resolve(ROOT, flag('out') || path.join(os.tmpdir(), 'jarvis-capturas'));
const base = flag('name') || `hilo-${id}`;
fs.mkdirSync(outDir, { recursive: true });

const jarvis = (...args: string[]) => execFileSync(path.join(ROOT, 'bin/jarvis'), args, { encoding: 'utf8', timeout: 240_000 });
say(`abro el hilo · ${url}`);
jarvis('open', url);
let files: string[] = [];
try {
    // Gmail pinta el hilo después de la página: se espera el botón «Responder» del pie (o «Reply»).
    try { jarvis('wait', 'Responder', '20'); } catch { jarvis('wait', 'Reply', '20'); }
    // Gmail colapsa los mensajes anteriores del hilo y su «Expandir todo» no es un botón accesible: se despliega cada uno
    // haciendo clic en el comienzo de su texto, como una persona. El comienzo de cada mensaje sale de la API de Gmail
    // (`bin/pg gmail thread`); el último ya está abierto. Si alguno no se encuentra, se sigue: la captura igual sale.
    if (!/^https?:/.test(raw)) {
        try {
            const msgs = JSON.parse(execFileSync(path.join(ROOT, 'bin/pg'), ['gmail', 'thread', raw, '--json'], { encoding: 'utf8' })) as { snippet: string }[];
            let opened = 0;
            for (const m of msgs.slice(0, -1)) {
                const start = (m.snippet || '').replace(/\s+/g, ' ').trim().split(' ').slice(0, 6).join(' ');
                if (!start) continue;
                try { jarvis('click', start); opened++; } catch { /* ya abierto, o el texto cambió */ }
            }
            if (opened) say(`despliego ${opened} mensaje(s) colapsado(s) del hilo`);
        } catch { say('no pude leer el hilo por la API de Gmail: capturo como está (con los anteriores colapsados)'); }
    }
    const out = jarvis('shot', '--full', path.join(outDir, `${base}.png`));
    files = out.split('\n').map((l) => l.trim()).filter((l) => l.endsWith('.png'));
    say(`${files.length} captura(s):`);
    for (const f of files) say(`   ${path.relative(ROOT, f).startsWith('..') ? f : path.relative(ROOT, f)}`);
} finally {
    try { jarvis('close'); } catch { /* ya estaba cerrada */ }
}
if (JSON_OUT) console.log(JSON.stringify({ recipe: 'gmail/thread-capture', url, files }));
