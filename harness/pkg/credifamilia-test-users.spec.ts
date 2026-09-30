import { expect, test } from '@playwright/test';
import { credifamiliaTestUser, credifamiliaTestUsers, dateParts } from './credifamilia-test-users.ts';

test.describe('los clientes de prueba de Credifamilia', () => {
    test('son 6 aprobados y 6 negados, con cédula y celular únicos', () => {
        const u = credifamiliaTestUsers();
        expect(u.filter((x) => x.resultado === 'aprobado')).toHaveLength(6);
        expect(u.filter((x) => x.resultado === 'negado')).toHaveLength(6);
        expect(new Set(u.map((x) => x.documento)).size).toBe(12);
        expect(new Set(u.map((x) => x.celular)).size).toBe(12);
    });

    test('el OTP inicial es el final del celular, que es el que usa el harness', () => {
        for (const x of credifamiliaTestUsers()) expect(x.celular.slice(-4)).toBe(x.otpInicial);
    });

    test('se busca por cédula y una inexistente lanza con la lista', () => {
        expect(credifamiliaTestUser('79799966').nombres).toBe('EDUARD');
        expect(() => credifamiliaTestUser('123')).toThrow(/79799966/);
    });

    test('la fecha ISO se parte en día, mes y año', () => {
        expect(dateParts('1994-10-31')).toEqual({ day: 31, month: 10, year: 1994 });
    });
});
