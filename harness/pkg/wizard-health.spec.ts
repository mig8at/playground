// Qué se fija acá: los JUICIOS sobre si el wizard local quedó viejo. Son puros: no miran procesos, ni
// archivos, ni la red. Reiniciarlo de verdad se prueba corriéndolo (`make harness-wizard`).
//
// Se prueba porque el caso real del 2026-10-02 pasó las cuatro comprobaciones que ya tenía `bin/advisor`
// (respondía, era el suyo, apuntaba al backend correcto, no era más viejo que la rama) y aun así servía
// el login viejo: el `.env` se había editado después de arrancar. Si estos juicios fallan en silencio, el
// harness vuelve a decir «sano» de algo que no lo está.
import { expect, test } from '@playwright/test';
import { envValue, parseLstart, settle, stalenessOf, type Staleness, type WizardFacts } from './wizard-health.ts';

const T0 = 1_790_000_000;
const sano: WizardFacts = {
    up: true, startedAt: T0, envMtimes: { '.env': T0 - 100 },
    configuredAuthHost: 'merchant-develop.auth.us-east-2.amazoncognito.com',
    servedAuthHost: 'merchant-develop.auth.us-east-2.amazoncognito.com',
};

test.describe('¿el wizard está al día?', () => {
    test('sano: responde, su configuración es anterior al arranque y sirve el login que dice', () => {
        expect(stalenessOf(sano)).toEqual({ ok: true, reasons: [] });
    });

    test('caído: no hace falta mirar más', () => {
        const s = stalenessOf({ ...sano, up: false });
        expect(s.ok).toBe(false);
        expect(s.reasons).toEqual([expect.stringMatching(/no contesta/)]);
    });

    // 🔴 El caso del 2026-10-02: el `.env` se editó DESPUÉS de arrancar y Vite no lo relee.
    test('un .env editado después del arranque lo deja viejo, y nombra el archivo', () => {
        const s = stalenessOf({ ...sano, envMtimes: { '.env': T0 + 3600, '.env.local': T0 - 5 } });
        expect(s.ok).toBe(false);
        expect(s.reasons).toEqual([expect.stringMatching(/\.env se editó después/)]);
    });

    // 🔴 La prueba directa, que no depende de fechas: un `.env` restaurado con `mtime` viejo pasa el
    // control anterior, pero el wizard sigue mandando al login equivocado.
    test('si el login que sirve no es el de su .env, está viejo aunque las fechas cuadren', () => {
        const s = stalenessOf({ ...sano, servedAuthHost: 'login.creditop.com' });
        expect(s.ok).toBe(false);
        expect(s.reasons[0]).toMatch(/login\.creditop\.com/);
    });

    test('sin poder leer alguno de los dos datos, no inventa un motivo', () => {
        expect(stalenessOf({ ...sano, startedAt: null, servedAuthHost: null }).ok).toBe(true);
    });
});

test.describe('lectura de datos', () => {
    test('la fecha de arranque de ps se entiende, con el día de un dígito', () => {
        const t = parseLstart('Fri Oct  2 10:09:07 2026');
        expect(t).not.toBeNull();
        expect(new Date(t! * 1000).getFullYear()).toBe(2026);
        expect(parseLstart('no es una fecha')).toBeNull();
    });

    test('una clave del .env, con o sin comillas, y gana la primera definición', () => {
        const text = 'A=1\nCOGNITO_DOMAIN="x.example.com"\n# COGNITO_DOMAIN=otro\nB=2';
        expect(envValue(text, 'COGNITO_DOMAIN')).toBe('x.example.com');
        expect(envValue(text, 'NO_ESTA')).toBeNull();
    });
});

test.describe('esperar a que se asiente', () => {
    const down: Staleness = { ok: false, reasons: ['no contesta en :5174 (ECONNREFUSED)'] };
    const noWait = async () => {};

    // 🔴 El caso del 2026-10-02: justo después de reiniciar, el wizard tarda en contestar. Un único juicio
    // inmediato lo daba por caído aunque a los pocos segundos estuviera sano.
    test('si se recupera antes de agotar los intentos, queda sano', async () => {
        let n = 0;
        const r = await settle(async () => (++n < 3 ? down : { ok: true, reasons: [] }), { tries: 5, gapMs: 1, sleep: noWait });
        expect(r.ok).toBe(true);
        expect(n).toBe(3);
    });

    test('si nunca se recupera, devuelve el último motivo y no espera de más', async () => {
        let n = 0;
        const r = await settle(async () => { n += 1; return down; }, { tries: 4, gapMs: 1, sleep: noWait });
        expect(r).toEqual(down);
        expect(n).toBe(4);
    });
});
