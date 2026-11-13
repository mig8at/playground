// log-lines.ts — las líneas de un log «desde la N», leyendo sólo lo NUEVO del archivo.
//
// POR QUÉ EXISTE. `linesSince` vivía en `server.ts` y en cada consulta (la consola pregunta cada 2 s, y la del SSR
// también) leía el archivo ENTERO, le pasaba la regex de ANSI y lo partía en líneas. El log del SSR llega a megabytes
// (medido: 2,9 MB), así que cada tick pagaba el archivo completo para devolver, casi siempre, cero o dos líneas.
// Ahora se guarda por archivo un CURSOR —hasta qué byte se leyó y cuántas líneas completas había hasta ahí— y la
// consulta normal («dame desde el total que ya tengo») lee sólo la cola nueva.
//
// EL CONTRATO NO CAMBIA: `{ total, from, lines }`, con `total` = líneas COMPLETAS del archivo y `lines` = las que van
// desde `from`. Si `from` es 0 o se pasa del total, van todas (el cliente resetea). Vive aparte de `server.ts` para
// poder probarlo sin levantar el panel: `node panel/log-lines.selftest.mjs`.
import { closeSync, fstatSync, openSync, readSync } from 'node:fs';

const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;
/** Cuántos bytes de ANTES del cursor se recuerdan para reconocer que el archivo sigue siendo el mismo. */
const GUARD_BYTES = 64;

type Cursor = {
    ino: number;
    /** Byte siguiente al último '\n' leído: todo lo anterior son líneas completas ya contadas. */
    offset: number;
    /** Líneas completas hasta `offset`. */
    count: number;
    /** Los últimos bytes antes de `offset`: si al volver no están ahí, el archivo se reescribió. */
    guard: Buffer;
};
const cursors = new Map<string, Cursor>();

function readRange(fd: number, start: number, end: number): Buffer {
    const buf = Buffer.allocUnsafe(Math.max(0, end - start));
    let got = 0;
    while (got < buf.length) {
        const n = readSync(fd, buf, got, buf.length - got, start + got);
        if (n <= 0) break;   // el archivo se achicó entre el stat y la lectura: se usa lo que hubo
        got += n;
    }
    return got === buf.length ? buf : buf.subarray(0, got);
}

/** Las líneas COMPLETAS de un bloque, sin ANSI, y cuántos bytes ocupan (hasta el último '\n' incluido).
 *  ⚠ Se corta en el BYTE '\n' antes de decodificar: 0x0A nunca es parte de un carácter UTF-8 de varios bytes, así que
 *  un carácter partido en el borde del bloque queda del lado de la línea a medio escribir y no se decodifica roto.
 *  Y quitar ANSI por bloque da lo mismo que sobre el archivo entero: la secuencia no puede cruzar un '\n'. */
function completeLines(buf: Buffer): { lines: string[]; bytes: number } {
    const end = buf.lastIndexOf(0x0a);
    if (end < 0) return { lines: [], bytes: 0 };
    // Mismo partido que antes (`split('\n').slice(0, -1)`): el '' que deja el '\n' final no es una línea.
    return { lines: buf.toString('utf8', 0, end).replace(ANSI, '').split('\n'), bytes: end + 1 };
}

/** Sólo líneas COMPLETAS. El archivo termina en '\n', así que partirlo deja un '' al final que antes contaba en el
 *  total: el cliente pedía «desde el total» y la PRIMERA línea de cada tanda nueva se perdía y en su lugar llegaba un
 *  renglón vacío. En una corrida casi no se notaba (las líneas llegan de a muchas); los celulares escriben de a UNA y
 *  se perdían todas: la excepción de PostHog quedó en el archivo y la consola mostraba un blanco (2026-10-09). Una
 *  línea a medio escribir (sin su '\n') tampoco se manda: llega entera en la consulta siguiente. */
export function linesSince(file: string, from: number): { total: number; from: number; lines: string[] } {
    let fd: number;
    try { fd = openSync(file, 'r'); } catch { cursors.delete(file); return { total: 0, from: 0, lines: [] }; }
    try {
        const st = fstatSync(fd);
        let cur = cursors.get(file);
        // ¿Sigue siendo el mismo archivo? Estos logs se PISAN al arrancar otra corrida: si cambió el inodo, si mide menos
        // que lo ya leído o si los bytes de antes del cursor son otros (se reescribió y ya creció más allá), se empieza
        // de cero. Sin la tercera comprobación, un log pisado que crece rápido seguiría sumando al conteo viejo.
        if (cur && (cur.ino !== st.ino || st.size < cur.offset
            || !readRange(fd, cur.offset - cur.guard.length, cur.offset).equals(cur.guard))) cur = undefined;

        // Lo nuevo desde el cursor (o todo, si no hay cursor).
        const start = cur ? cur.offset : 0;
        const fresh = completeLines(readRange(fd, start, st.size));
        const before = cur ? cur.count : 0;
        const total = before + fresh.lines.length;
        const offset = start + fresh.bytes;
        if (fresh.bytes > 0 || !cur) {
            cursors.set(file, { ino: st.ino, offset, count: total, guard: readRange(fd, Math.max(0, offset - GUARD_BYTES), offset) });
        }

        const since = from > 0 && from <= total ? from : 0;
        // El caso de siempre: piden desde donde quedó el cursor (o más adelante) y alcanza con lo recién leído.
        if (since >= before) return { total, from: since, lines: fresh.lines.slice(since - before) };
        // Piden líneas de ANTES del cursor (abrir la pestaña, `from=0`, un cliente que resetea): no se guardan en
        // memoria —serían megabytes por archivo—, así que esta vez se lee hasta el cursor. Es la consulta rara.
        const all = completeLines(readRange(fd, 0, offset)).lines;
        return { total, from: since, lines: all.slice(since, total) };
    } finally { closeSync(fd); }
}

/** Olvida los cursores (para las pruebas). */
export function resetLineCursors(): void { cursors.clear(); }
