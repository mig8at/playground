import test from 'node:test';
import assert from 'node:assert/strict';
import { BOOTSTRAP_CACHE_KEY, readBootstrapCache, writeBootstrapCache } from '../src/bootstrap-cache.js';

const snapshot = {
  sprint: { id: 18, name: 'Sprint 18' },
  sprints: [{ id: 18, name: 'Sprint 18' }],
  issues: [{ Key: 'CORE-1', Summary: 'Carga inmediata' }],
  bySprint: [{ sprint: { id: 18 }, issues: [{ Key: 'CORE-1' }] }],
  site: 'https://example.atlassian.net',
};

test('el último estado correcto se restaura y después puede revalidarse', () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const now = Date.parse('2026-09-19T21:00:00-05:00');
  assert.equal(writeBootstrapCache(snapshot, storage, now), true);
  assert.deepEqual(readBootstrapCache(storage, now + 1000)?.issues, snapshot.issues);
  assert.match(values.get(BOOTSTRAP_CACHE_KEY), /Carga inmediata/);
});

test('una caché vieja, incompleta o bloqueada nunca impide abrir el tablero', () => {
  const old = new Map();
  const storage = { getItem: key => old.get(key) ?? null, setItem: (key, value) => old.set(key, value) };
  const now = Date.parse('2026-09-19T21:00:00-05:00');
  writeBootstrapCache(snapshot, storage, now - 8 * 24 * 60 * 60 * 1000);
  assert.equal(readBootstrapCache(storage, now), null);
  old.set(BOOTSTRAP_CACHE_KEY, '{incompleto');
  assert.equal(readBootstrapCache(storage, now), null);
  const denied = { getItem() { throw Error('denied'); }, setItem() { throw Error('denied'); } };
  assert.equal(readBootstrapCache(denied, now), null);
  assert.equal(writeBootstrapCache(snapshot, denied, now), false);
});
