// La decisión de saltear una suite: por ambiente (`"ambientes"`) o por ser de otro runner. Lógica pura: no
// toca base ni red. Lo que fija es lo que, roto, volvería a pintar de rojo una suite que no es del ambiente, o
// —peor— dejaría de correr una que sí lo es sin avisar.
import { test, expect } from '@playwright/test';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { suiteScope, suiteTargets, EXIT_NOT_FOR_TARGET } from './suite-scope.ts';

const caso = { comercio: 'pullman', lender: null };

test.describe('suiteTargets', () => {
    test('sin la clave vale en todos', () => {
        expect(suiteTargets({ casos: [caso] })).toBeNull();
    });
    test('una lista vacía o un ambiente desconocido es un error, no «no corre en ningún lado»', () => {
        expect(() => suiteTargets({ ambientes: [] })).toThrow(/no vacía/);
        expect(() => suiteTargets({ ambientes: 'local' })).toThrow(/no vacía/);
        expect(() => suiteTargets({ ambientes: ['local', 'develop'] })).toThrow(/develop/);
    });
});

test.describe('suiteScope', () => {
    test('sin `ambientes` corre en cualquier target', () => {
        for (const t of ['local', 'dev', 'qa', 'staging']) expect(suiteScope({ casos: [caso] }, t)).toEqual({ kind: 'run' });
    });
    test('con `ambientes` corre sólo en los suyos, y el resto la saltea diciendo dónde vale', () => {
        const s = { ambientes: ['local', 'qa'], casos: [caso] };
        expect(suiteScope(s, 'local')).toEqual({ kind: 'run' });
        expect(suiteScope(s, 'QA')).toEqual({ kind: 'run' });
        expect(suiteScope(s, 'dev')).toEqual({ kind: 'not-for-target', targets: ['local', 'qa'] });
    });
    test('las del canal ecommerce y las que no tienen casos son de otro runner', () => {
        expect(suiteScope({ porDefecto: { espera: { vinculada: true } }, casos: [{ comercio: 'x' }] }, 'local').kind).toBe('other-runner');
        expect(suiteScope({ casos: [{ comercio: 'x', espera: { prefill: ['email'] } }] }, 'local').kind).toBe('other-runner');
        expect(suiteScope({ checks: [] }, 'local').kind).toBe('other-runner');
    });
    test('una clave mal escrita del runner de casos NO se aparta como «otro runner»: case.ts la rechaza', () => {
        expect(suiteScope({ casos: [{ comercio: 'x', espera: { catgoria: 1 } }] }, 'local')).toEqual({ kind: 'run' });
    });
    test('el código de salida no choca con verde, rojo ni prevuelo', () => {
        expect([0, 1, 2]).not.toContain(EXIT_NOT_FOR_TARGET);
    });
});

// Las suites del repo, leídas (no corridas): lo que la regresión haría con cada una en local y en qa.
test('las suites del repo se clasifican sin tirar', () => {
    const dir = resolve(import.meta.dirname, '../suites');
    const plan: Record<string, Record<string, string>> = {};
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.json'))) {
        const json = JSON.parse(readFileSync(resolve(dir, f), 'utf8'));
        plan[f] = Object.fromEntries(['local', 'qa'].map((t) => [t, suiteScope(json, t).kind]));
    }
    expect(plan['credifamilia-materiales-qa.json']).toEqual({ local: 'not-for-target', qa: 'run' });
    expect(plan['credifamilia-materiales.json']).toEqual({ local: 'run', qa: 'not-for-target' });
    expect(plan['paises.json']).toEqual({ local: 'run', qa: 'run' });
    expect(plan['ecommerce.json'].local).toBe('other-runner');
    expect(plan['ecommerce-sala-de-espera.json'].local).toBe('other-runner');
    expect(plan['qa-restore.json'].local).toBe('other-runner');
});
