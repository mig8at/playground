// LAS GRABACIONES: los videos de las corridas con nombre (`make harness-run`), para verlos después en el panel.
//
// El índice es `.runs/recordings.json` (fuera de git, como los videos): lo ESCRIBE `dev/run.ts` al terminar cada corrida
// y lo LEE el panel (`/api/recordings`). No hay forma de agregar una desde la interfaz: las agrega el agente al correr.
// Un video de `.runs/videos/` que no está en el índice (los de antes de que existiera) sale igual, con lo que dice su
// nombre de archivo.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RUNS = path.join(ROOT, '.runs');
const INDEX = path.join(RUNS, 'recordings.json');
const VIDEOS = path.join(RUNS, 'videos');

export interface Recording {
    id: string;              // estable: el nombre del archivo sin extensión
    run: string;             // la clave en runs.json (`finandina`)
    name: string;            // cómo se muestra (`Finandina`)
    description?: string;
    target?: string;
    ureq?: number;           // la solicitud que creó
    lender?: string;
    closed?: boolean;        // ¿llegó al desenlace?
    screens?: number;
    seconds?: number;        // lo que duró la corrida
    at: string;              // cuándo terminó (ISO)
    video: string;           // relativo a la raíz del harness
}

function readIndex(): Recording[] {
    try { return (JSON.parse(fs.readFileSync(INDEX, 'utf8')).recordings ?? []) as Recording[]; } catch { return []; }
}

export function addRecordings(entries: Recording[]): void {
    if (!entries.length) return;
    const byId = new Map(readIndex().map((r) => [r.id, r]));
    for (const e of entries) byId.set(e.id, e);
    fs.mkdirSync(RUNS, { recursive: true });
    const tmp = `${INDEX}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ recordings: [...byId.values()] }, null, 2) + '\n');
    fs.renameSync(tmp, INDEX);
}

function walk(dir: string): string[] {
    let out: string[] = [];
    for (const d of fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : []) {
        const p = path.join(dir, d.name);
        if (d.isDirectory()) out = out.concat(walk(p));
        else if (/\.(mp4|webm)$/.test(d.name)) out.push(p);
    }
    return out;
}

/** Las grabaciones que tienen su video, la más nueva primero. */
export function listRecordings(): Recording[] {
    const indexed = readIndex().filter((r) => fs.existsSync(path.join(ROOT, r.video)));
    const known = new Set(indexed.map((r) => path.join(ROOT, r.video)));
    // Las de antes del índice: `finandina-20261119-201625.mp4` dice la corrida y la hora (UTC).
    const orphans = walk(VIDEOS).filter((f) => !known.has(f) && !/page@/.test(f)).map((f): Recording => {
        const base = path.basename(f).replace(/\.(mp4|webm)$/, '');
        const m = /^(.+?)-(\d{8})-(\d{6})(?:-\d+)?$/.exec(base);
        const run = m ? m[1] : base;
        const at = m ? `${m[2].slice(0, 4)}-${m[2].slice(4, 6)}-${m[2].slice(6)}T${m[3].slice(0, 2)}:${m[3].slice(2, 4)}:${m[3].slice(4)}Z` : fs.statSync(f).mtime.toISOString();
        return { id: base, run, name: run.charAt(0).toUpperCase() + run.slice(1), at, video: path.relative(ROOT, f) };
    });
    return [...indexed, ...orphans].sort((a, b) => b.at.localeCompare(a.at));
}

/** La ruta del video de una grabación, o null. Sólo lo que está bajo `.runs/videos/`: el id llega de la página. */
export function recordingVideo(id: string): string | null {
    const r = listRecordings().find((x) => x.id === id);
    if (!r) return null;
    const f = path.resolve(ROOT, r.video);
    return f.startsWith(VIDEOS + path.sep) && fs.existsSync(f) ? f : null;
}
