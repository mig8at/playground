import { expect, test } from '@playwright/test';
import { credifamiliaFormFields, CREDIFAMILIA_FORM_FIELD as F, isCredifamilia } from './credifamilia-form.ts';

test.describe('los campos del formulario de Credifamilia para el cliente sintético', () => {
    test('cumple lo que el proveedor valida: activos > 1 SMLMV, pasivos <= activos, egresos < ingresos', () => {
        const v = credifamiliaFormFields(2_500_000);
        expect(Number(v[F.activos])).toBeGreaterThan(1_750_905);
        expect(Number(v[F.pasivos])).toBeLessThanOrEqual(Number(v[F.activos]));
        expect(Number(v[F.egresosMensuales])).toBeLessThan(2_500_000);
    });

    test('con un ingreso chico los egresos siguen por debajo del ingreso', () => {
        expect(Number(credifamiliaFormFields(1_000_000)[F.egresosMensuales])).toBeLessThan(1_000_000);
    });

    test('escribe las cuatro ciudades/dirección con el nombre exacto de country_cities', () => {
        const v = credifamiliaFormFields(2_500_000);
        for (const id of [F.ciudadResidencia, F.ciudadNacimiento, F.ciudadExpedicion]) expect(v[id]).toBe('Bogotá D.C.');
        expect(v[F.direccionResidencia]).toMatch(/^Calle /);
    });

    test('se reconoce a Credifamilia por el nombre de la entidad', () => {
        expect(isCredifamilia('Credifamilia')).toBe(true);
        expect(isCredifamilia('Welli')).toBe(false);
    });
});
