// La traducción de los flags viejos (en español) a los nuevos. No persigue cobertura: fija lo que, roto,
// haría que un comando guardado en una tarea corriera OTRA cosa sin avisar.
import { test, expect } from '@playwright/test';
import { normalizeArgv, canonicalFlag } from './cli-aliases.ts';

const quiet = () => {};

test.describe('normalizeArgv', () => {
    test('un flag viejo pasa a su nombre nuevo, y el valor que lo sigue queda igual', () => {
        expect(normalizeArgv(['node', 'x.ts', '--casos', '#abc:77', '--cerrar'], quiet))
            .toEqual(['node', 'x.ts', '--cases', '#abc:77', '--close']);
    });

    test('el motor viejo sigue eligiendo el navegador: si no, caería al HTTP sin decir nada', () => {
        expect(normalizeArgv(['--motor', 'navegador'], quiet)).toEqual(['--engine', 'browser']);
        expect(normalizeArgv(['--engine=navegador'], quiet)).toEqual(['--engine=browser']);
        expect(normalizeArgv(['--gate', 'rechazado'], quiet)).toEqual(['--gate', 'rejected']);
    });

    test('un valor sólo se traduce detrás del flag que lo usa: «navegador» suelto es un dato', () => {
        expect(normalizeArgv(['--merchant', 'navegador'], quiet)).toEqual(['--merchant', 'navegador']);
    });

    test('los nombres nuevos pasan sin tocar, y el aviso sale sólo con viejos', () => {
        const said: string[] = [];
        expect(normalizeArgv(['--cases', 'x', '--parallel'], (s) => said.push(s))).toEqual(['--cases', 'x', '--parallel']);
        expect(said).toEqual([]);
        normalizeArgv(['--paralelo'], (s) => said.push(s));
        expect(said.join('')).toContain('--paralelo → --parallel');
    });

    test('una suite vieja que pide «cerrar» sigue prendiendo el cierre', () => {
        expect(canonicalFlag('cerrar')).toBe('close');
        expect(canonicalFlag('lambda')).toBe('lambda');
    });
});
