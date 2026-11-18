// CUÁNTO SE LE PREGUNTÓ A AI STUDIO, POR DÍA: el registro que deja cada pregunta (page.ts, `recordUse`), resumido.
// Sirve para medir cuánto deja Google con la cuenta de la persona (Miguel, 2026-11-17: «validamos qué tanto permite al
// día»): preguntas, cuántas salieron, cuántas cortó Google y a qué hora fue el primer corte, por día y modelo.
//   bin/aistudio usage [--days 7] [--json]
import fs from 'node:fs';
import { flag, JSON_OUT, USAGE_FILE } from './page.ts';

type Row = { at: string; model: string; thinking?: string; chars?: number; ms?: number; result: 'ok' | 'corte' | 'cupo-diario' | 'error'; error?: string };
const days = Number(flag('days') || 7);
const since = Date.now() - days * 86_400_000;
let rows: Row[] = [];
try {
    rows = fs.readFileSync(USAGE_FILE, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r: Row) => Date.parse(r.at) >= since);
} catch { /* sin registro todavía */ }

const day = (iso: string) => new Date(iso).toLocaleDateString('en-CA'); // AAAA-MM-DD, hora local
const hour = (iso: string) => new Date(iso).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
type Sum = { day: string; model: string; asked: number; ok: number; cuts: number; errors: number; chars: number; okMs: number; firstCut?: string; okBeforeFirstCut: number; dailyOut?: string; okBeforeDaily: number };
const sums = new Map<string, Sum>();
for (const r of rows) {
    const key = `${day(r.at)}|${r.model}`;
    const s = sums.get(key) || { day: day(r.at), model: r.model, asked: 0, ok: 0, cuts: 0, errors: 0, chars: 0, okMs: 0, okBeforeFirstCut: 0, okBeforeDaily: 0 };
    s.asked++;
    if (r.result === 'ok') { s.ok++; s.chars += r.chars || 0; s.okMs += r.ms || 0; if (!s.firstCut) s.okBeforeFirstCut++; if (!s.dailyOut) s.okBeforeDaily++; }
    else if (r.result === 'cupo-diario') { s.cuts++; s.dailyOut ||= hour(r.at); s.firstCut ||= hour(r.at); }
    else if (r.result === 'corte') { s.cuts++; s.firstCut ||= hour(r.at); }
    else s.errors++;
    sums.set(key, s);
}
const list = [...sums.values()].sort((a, b) => (a.day + a.model).localeCompare(b.day + b.model));
if (JSON_OUT) { console.log(JSON.stringify({ file: USAGE_FILE, days, summary: list })); process.exit(0); }
if (!list.length) { console.log(`Sin preguntas registradas en ${days} días (${USAGE_FILE}). Se registran desde el 2026-11-17.`); process.exit(0); }
console.log(`AI Studio por la web, últimos ${days} días (${USAGE_FILE})\n`);
for (const s of list) {
    const avg = s.ok ? `${Math.round(s.okMs / s.ok / 1000)} s de media` : '';
    const cut = (s.firstCut ? ` · primer corte ${s.firstCut}, tras ${s.okBeforeFirstCut} buenas` : ' · sin cortes')
        + (s.dailyOut ? ` · CUPO DIARIO agotado ${s.dailyOut}, tras ${s.okBeforeDaily} buenas` : '');
    console.log(`${s.day}  ${s.model.padEnd(20)} ${String(s.asked).padStart(3)} preguntas · ${s.ok} ok · ${s.cuts} cortes · ${s.errors} otros errores · ${Math.round(s.chars / 1000)}k car. enviados${avg ? ' · ' + avg : ''}${cut}`);
}
