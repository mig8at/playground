// Prueba de `linesSince` (panel/log-lines.ts) sin levantar el panel ni tocar red o base: sólo archivos temporales.
//   node panel/log-lines.selftest.mjs
// ⚠ No se llama `.test.` ni `.spec.` a propósito: `playwright.config.ts` tiene `testDir: '.'` y lo levantaría como spec.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, appendFileSync, rmSync, renameSync, openSync, writeSync, closeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { linesSince, resetLineCursors } from './log-lines.ts';

const dir = mkdtempSync(join(tmpdir(), 'log-lines-'));
test.after(() => rmSync(dir, { recursive: true, force: true }));
const fresh = (name) => { resetLineCursors(); return join(dir, name); };

test('sin archivo: vacío', () => {
    assert.deepEqual(linesSince(fresh('no-existe.log'), 0), { total: 0, from: 0, lines: [] });
});

test('sólo líneas completas, y la cola llega entera en la consulta siguiente', () => {
    const f = fresh('a.log');
    writeFileSync(f, 'uno\ndos\ntres a med');
    assert.deepEqual(linesSince(f, 0), { total: 2, from: 0, lines: ['uno', 'dos'] });
    assert.deepEqual(linesSince(f, 2), { total: 2, from: 2, lines: [] });
    appendFileSync(f, 'io\n');
    assert.deepEqual(linesSince(f, 2), { total: 3, from: 2, lines: ['tres a medio'] });
});

test('de a UNA línea (los celulares): no se pierde ninguna ni llega un renglón vacío (2026-10-09)', () => {
    const f = fresh('b.log');
    writeFileSync(f, '');
    let total = 0; const seen = [];
    for (let i = 0; i < 5; i++) {
        appendFileSync(f, `linea ${i}\n`);
        const r = linesSince(f, total);
        seen.push(...r.lines); total = r.total;
    }
    assert.deepEqual(seen, ['linea 0', 'linea 1', 'linea 2', 'linea 3', 'linea 4']);
});

test('quita ANSI y conserva las líneas vacías', () => {
    const f = fresh('c.log');
    writeFileSync(f, '\x1b[32mverde\x1b[0m\n\nfin\n');
    assert.deepEqual(linesSince(f, 0).lines, ['verde', '', 'fin']);
});

test('UTF-8 partido en el borde: el carácter no se decodifica roto', () => {
    const f = fresh('d.log');
    const bytes = Buffer.from('paso ▸ uno\nsegunda «línea» 📸\n', 'utf8');
    const cut = bytes.indexOf(Buffer.from('📸')) + 2;   // en medio de los 4 bytes del emoji
    writeFileSync(f, bytes.subarray(0, cut));
    assert.deepEqual(linesSince(f, 0), { total: 1, from: 0, lines: ['paso ▸ uno'] });
    const fd = openSync(f, 'a'); writeSync(fd, bytes.subarray(cut)); closeSync(fd);
    assert.deepEqual(linesSince(f, 1), { total: 2, from: 1, lines: ['segunda «línea» 📸'] });
});

test('pedir de ANTES del cursor (from=0, o un from intermedio) devuelve lo mismo que leer todo', () => {
    const f = fresh('e.log');
    writeFileSync(f, 'a\nb\nc\n');
    linesSince(f, 0);
    appendFileSync(f, 'd\n');
    assert.deepEqual(linesSince(f, 1), { total: 4, from: 1, lines: ['b', 'c', 'd'] });
    assert.deepEqual(linesSince(f, 0), { total: 4, from: 0, lines: ['a', 'b', 'c', 'd'] });
    assert.deepEqual(linesSince(f, 4), { total: 4, from: 4, lines: [] });
});

test('un from más allá del total devuelve todo desde 0 (el cliente resetea)', () => {
    const f = fresh('f.log');
    writeFileSync(f, 'a\nb\n');
    assert.deepEqual(linesSince(f, 9), { total: 2, from: 0, lines: ['a', 'b'] });
});

test('el archivo se pisa y queda MÁS CORTO: el total baja', () => {
    const f = fresh('g.log');
    writeFileSync(f, 'vieja 1\nvieja 2\nvieja 3\n');
    assert.equal(linesSince(f, 0).total, 3);
    writeFileSync(f, 'nueva\n');
    assert.deepEqual(linesSince(f, 3), { total: 1, from: 0, lines: ['nueva'] });
});

test('el archivo se pisa y ya creció MÁS que el anterior: igual se reinicia', () => {
    const f = fresh('h.log');
    writeFileSync(f, 'vieja 1\nvieja 2\n');
    assert.equal(linesSince(f, 0).total, 2);
    writeFileSync(f, 'otra corrida, bastante más larga que la anterior\ncon su segunda línea\n');   // mismo inodo, más bytes
    assert.deepEqual(linesSince(f, 2), { total: 2, from: 2, lines: [] });
    assert.deepEqual(linesSince(f, 0).lines, ['otra corrida, bastante más larga que la anterior', 'con su segunda línea']);
});

test('el archivo se reemplaza por otro (otro inodo)', () => {
    const f = fresh('i.log');
    writeFileSync(f, 'a\nb\nc\n');
    linesSince(f, 0);
    writeFileSync(f + '.new', 'a\nb\nc\nd\ne\n');
    renameSync(f + '.new', f);
    assert.deepEqual(linesSince(f, 3), { total: 5, from: 3, lines: ['d', 'e'] });
});

test('igual que la versión que leía el archivo entero, con escrituras al azar', () => {
    const f = fresh('j.log');
    writeFileSync(f, '');
    let whole = ''; let total = 0;
    const old = (from) => { const all = whole.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').split('\n').slice(0, -1);
        const since = from > 0 && from <= all.length ? from : 0; return { total: all.length, from: since, lines: all.slice(since) }; };
    let seed = 7; const rnd = (n) => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n;
    const pieces = ['á', '\n', 'x\x1b[1m', 'línea │ BD', '\n\n', '📸 shot.png', ' ', '\x1b[0m\n'];
    for (let i = 0; i < 400; i++) {
        const chunk = Array.from({ length: 1 + rnd(4) }, () => pieces[rnd(pieces.length)]).join('');
        appendFileSync(f, chunk); whole += chunk;
        const from = rnd(5) === 0 ? rnd(total + 3) : total;
        const got = linesSince(f, from);
        assert.deepEqual(got, old(from), `paso ${i}, from=${from}`);
        total = got.total;
    }
});
