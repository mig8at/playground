import { expect, test } from '@playwright/test';
import { classifyVpn, vpnDev } from './vpn.ts';

/** La VPN se decide por si el nombre interno resuelve. Lógica pura + un resolvedor inyectado: sin red. */
test.describe('la VPN de dev', () => {
    test('con dirección, está arriba y dice cuál', () => {
        const s = classifyVpn('10.0.50.175');
        expect(s.arriba).toBe(true);
        expect(s.detalle).toContain('10.0.50.175');
    });

    test('sin dirección está abajo y explica qué se pierde', () => {
        const s = classifyVpn(null, 'ENOTFOUND');
        expect(s.arriba).toBe(false);
        expect(s.detalle).toContain('ENOTFOUND');
        expect(s.detalle).toContain('dev, qa y staging');
    });

    test('un resolvedor que resuelve → arriba', async () => {
        expect((await vpnDev(async () => ({ address: '10.0.0.9' }))).arriba).toBe(true);
    });

    test('un resolvedor que falla → abajo, y no revienta', async () => {
        const fail = async () => { throw Object.assign(new Error('x'), { code: 'ENOTFOUND' }); };
        expect((await vpnDev(fail)).arriba).toBe(false);
    });

    test('un resolvedor colgado → abajo por timeout, no espera para siempre', async () => {
        const t0 = Date.now();
        const s = await vpnDev(() => new Promise(() => {}), 200);
        expect(s.arriba).toBe(false);
        expect(Date.now() - t0).toBeLessThan(2000);
    });
});
