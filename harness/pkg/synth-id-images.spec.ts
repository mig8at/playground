import { expect, test } from '@playwright/test';
import { synthIdImageUrl } from './synth-id-images.ts';

/** La cédula del sintético: falsa en local (el pdf-mapper es un mock) y descargable donde el pdf-mapper es real. */
test.describe('las fotos de la cédula del cliente sintético', () => {
    test('en local conservan la URL falsa de siempre, que se reconoce como sintética', () => {
        expect(synthIdImageUrl('frontal', '123', 'local')).toBe('https://mock-s3.local/front-web/users/documents/synth/123/frontal.jpg');
        expect(synthIdImageUrl('reverso', 123, 'local')).toContain('/123/reverso.jpg');
    });

    for (const target of ['dev', 'qa', 'staging']) {
        test(`en ${target} apuntan a una imagen real del bucket de dev, no a un host que no resuelve`, () => {
            const url = synthIdImageUrl('frontal', '123', target);
            expect(url).toBe('https://creditop-app-development-5yctskjv.s3.us-east-2.amazonaws.com/harness/synth/cedula-frontal.png');
            expect(url).not.toContain('mock-s3.local');
            expect(synthIdImageUrl('reverso', '123', target)).toMatch(/cedula-reverso\.png$/);
        });
    }

    test('E2E_SYNTH_ID_IMAGE_BASE cambia el lugar y tolera la barra final', () => {
        process.env.E2E_SYNTH_ID_IMAGE_BASE = 'https://ejemplo.test/x/';
        try {
            expect(synthIdImageUrl('frontal', '1', 'dev')).toBe('https://ejemplo.test/x/cedula-frontal.png');
        } finally {
            delete process.env.E2E_SYNTH_ID_IMAGE_BASE;
        }
    });
});
