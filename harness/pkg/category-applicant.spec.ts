// La traducción del caso del panel al solicitante del simulador de reglas del backend. No persigue cobertura:
// fija las dos cosas que harían que la predicción de categoría y la corrida no hablen del mismo cliente.
import { test, expect } from '@playwright/test';
import { categoryApplicant } from './inject.ts';

test.describe('categoryApplicant', () => {
    test('la mora actual vacía es igual a los negativos, como la inyecta datacreditoData', () => {
        // Si la predicción la mandara en 0 y la inyección en 2, el criterio de moras vigentes diría otra cosa.
        expect(categoryApplicant({ negatives: 2 }).currentDelinquencies).toBe(2);
        expect(categoryApplicant({ negatives: 2, delinquencies: 0 }).currentDelinquencies).toBe(0);
    });

    test('lo que la inyección trae fijo va declarado, así la predicción no queda «sin simular»', () => {
        const a = categoryApplicant({ score: 700 }, new Date('2026-09-25T12:00:00'));
        expect(a).toMatchObject({ activeCreditCards: 1, activeCreditCardsWithVector: 1, overdueVectorClean: true, employmentContinuity: 12 });
        expect(a.financialSectorMonths).toBe(140);   // desde 2015-01 (MATURATION_SINCE) hasta 2026-09
    });

    test('un PEP no tiene buró: sin score, el simulador rechaza los perfiles como el motor', () => {
        const a = categoryApplicant({ documentType: 'PEP', score: 700, negatives: 1 });
        expect(a.score).toBeUndefined();
        expect(a.negativeReports12m).toBeUndefined();
    });
});
