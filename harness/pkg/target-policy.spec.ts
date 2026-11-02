// Qué se fija acá: que prod sea de sólo lectura POR REGLA y que un target remoto no le hable al backend
// local. Lógica pura (y un fetch de mentira): no toca ningún ambiente.
//
// Se prueba porque las dos fallas son silenciosas: hasta el 2026-11-02 `TARGET=prod` corría contra
// `http://localhost` y lo reportaba como prod, y nada impedía un POST a prod salvo que faltara una variable.
import { expect, test } from '@playwright/test';
import { dbHostBlockReason, dbWriteBlockReason, installFetchGuard, policyFor, requestBlockReason } from './target-policy.ts';

test('prod y E2E_TARGET_READONLY no escriben ni por API ni en la base', () => {
    expect(policyFor('prod')).toEqual({ apiWrites: false, dbWrites: false });
    expect(policyFor('qa', '1')).toEqual({ apiWrites: false, dbWrites: false });
    expect(policyFor('local')).toEqual({ apiWrites: true, dbWrites: true });
    expect(policyFor('dev')).toEqual({ apiWrites: true, dbWrites: 'guarded' });
    expect(dbWriteBlockReason('prod')).toContain('SÓLO LECTURA');
    expect(dbWriteBlockReason('dev')).toBeNull();
});

test('un target remoto sin E2E_DB_HOST no abre la base local', () => {
    expect(dbHostBlockReason('prod', '')).toContain('bin/pg sql');
    expect(dbHostBlockReason('qa', '')).toContain('.env.qa');
    expect(dbHostBlockReason('local', '')).toBeNull();
    expect(dbHostBlockReason('dev', 'inertia-development.x')).toBeNull();
});

test('en prod sólo salen las lecturas', () => {
    const api = 'https://api.creditop.com/legacy-api/onboarding/phone/register';
    expect(requestBlockReason('prod', '', 'POST', api)).toContain('SÓLO LECTURA');
    expect(requestBlockReason('prod', '', 'delete', api)).toContain('SÓLO LECTURA');
    expect(requestBlockReason('prod', '', 'GET', api)).toBeNull();
    expect(requestBlockReason('prod', '', 'OPTIONS', api)).toBeNull();
    expect(requestBlockReason('dev', '', 'POST', 'https://api.dev.creditop.com/legacy-api/x')).toBeNull();
});

test('un target remoto no le habla al backend local; los mocks sí', () => {
    expect(requestBlockReason('dev', '', 'GET', 'http://localhost/api/loans/allied/abc')).toContain('backend LOCAL');
    expect(requestBlockReason('prod', '', 'GET', 'http://127.0.0.1:80/api/x')).toContain('backend LOCAL');
    expect(requestBlockReason('local', '', 'POST', 'http://localhost/api/x')).toBeNull();
    expect(requestBlockReason('dev', '', 'POST', 'http://127.0.0.1:8105/__mock/x')).toBeNull();
    expect(requestBlockReason('dev', '', 'GET', 'http://localhost:5174/')).toBeNull();
});

test('el guard envuelve fetch y rechaza antes de salir', async () => {
    const g = globalThis as any;
    const saved = g.fetch;
    const savedFlag = g[Symbol.for('harness.target-policy.fetch')];
    const sent: string[] = [];
    g.fetch = async (u: string, init?: any) => { sent.push(`${init?.method ?? 'GET'} ${u}`); return new Response('{}'); };
    g[Symbol.for('harness.target-policy.fetch')] = false;
    try {
        installFetchGuard('prod');
        await expect(fetch('https://api.creditop.com/x', { method: 'POST' })).rejects.toThrow('target-policy');
        await fetch('https://api.creditop.com/x');
        expect(sent).toEqual(['GET https://api.creditop.com/x']);
    } finally {
        g.fetch = saved;
        g[Symbol.for('harness.target-policy.fetch')] = savedFlag;
    }
});
