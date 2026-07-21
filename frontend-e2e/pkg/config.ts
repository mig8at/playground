import { env } from './env.ts';
/**
 * Datos de prueba reutilizables por todos los specs.
 *
 * Mantener todo aquí en lugar de duplicar literales en cada test. Si cambia
 * el partner hash o un teléfono base, se cambia solo en este archivo.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Credenciales Cognito MERCHANT para pruebas `/merchant/*` (asesor) por UI. Orden: env
 * (E2E_COGNITO_USER/PASS) → archivo gitignored `.cognito.json` (raíz de frontend-e2e). Nunca commitear.
 */
function loadCognitoCreds(): { user?: string; pass?: string } {
    if (process.env.E2E_COGNITO_USER) {
        return { user: process.env.E2E_COGNITO_USER, pass: process.env.E2E_COGNITO_PASS };
    }
    try {
        const raw = JSON.parse(readFileSync(join(process.cwd(), '.cognito.json'), 'utf8'));
        return { user: raw.user, pass: raw.pass };
    } catch {
        return {};
    }
}

export const cognitoCreds = loadCognitoCreds();

export const config = {
    /** URL del frontend. Por TARGET: local = Vite :5174 · dev/staging = el deploy correspondiente.
     *  Se lee con `env()` (no `process.env` pelado) para que valga ponerla en `env/<target>.env`. */
    feBaseUrl: env('E2E_BASE_URL', 'http://localhost:5174'),

    /** URL del backend: legacy-backend en MODO MOCK (el viejo mock-server :4000 fue eliminado). */
    mockUrl: env('E2E_MOCK_URL', 'http://localhost'),

    /** Hash de aliado válido para entrar al flujo (espejo de validation-driven). */
    partnerHash: env('E2E_PARTNER_HASH', '3e67eade'),
} as const;

/** Datos de un usuario sintético usado en happy-paths. */
export const happyUser = {
    phoneNumber: '3001234567',
    otpCode: '1234', // el mock acepta cualquier código en success scenario
    documentType: 'CC',
    documentNumber: '1000000000',
    name: 'JUAN',
    surname: 'PEREZ',
    email: 'juan.perez@example.com',
    expedition: { day: 1, month: 1, year: 2010 },
    amount: 1_500_000,
} as const;

/**
 * Escenarios fake del backend REAL (header `X-Fake-Scenario`), expuestos por `HttpFakeRegistrar`
 * cuando `ONBOARDING_FAKES_ALLOW_HEADER=true` y los drivers están en modo fake. Default global:
 * `ONBOARDING_FAKES_DEFAULT_SCENARIO` (típicamente `success`).
 *
 * Migración desde el viejo mock-server :4000 (eliminado): los nombres antiguos (`kyc-date-mismatch`,
 * `provider-down`, `provider-5xx`, etc.) NO existen en el backend real. Aquí están los reales,
 * agrupados por driver. Fuente: docs/REFERENCIA-FLUJOS.md [histórico: git show 159906a:docs/REFERENCIA-FLUJOS.md] §13 + backend-e2e/channel/negative.go.
 */
export const fakeScenarios = {
    /** Driver OTP fake (`ONBOARDING_DRIVER_OTP=fake`). */
    otp: {
        success: 'success',
        invalidCode: 'invalid-code',
        // Sin nombre canonical verificado para "expired"/"provider-*" en HttpFakeRegistrar — los specs
        // usan helper tolerante (pkg/error-shape) y verifican el sufijo en lugar del shape exacto.
        expired: 'expired',
        providerDown: 'provider-down',
        providerError: 'provider-5xx',
    },
    /** Driver TusDatos fake (KYC). */
    tusdatos: {
        success: 'success',
        issueDateMismatch: 'issue-date-mismatch',
        nameMismatch: 'name-mismatch',
        documentNotFound: 'document-not-found',
        amlFindings: 'aml-findings',
    },
    /** Driver Experian fake (riesgo/scoring). */
    experian: {
        success: 'success',
        poorScore: 'poor-score',
        noHit: 'no-hit',
        serverError: 'server-error',
        timeout: 'timeout',
    },
    /** @deprecated alias del mock-server :4000 eliminado — usar `tusdatos.*` arriba. Se mantiene por back-compat con specs viejos. */
    kyc: {
        dateMismatch: 'issue-date-mismatch',
        documentNotFound: 'document-not-found',
        nameMismatch: 'name-mismatch',
        providerError: 'server-error',
    },
} as const;

/** Subcódigos esperados en la respuesta del backend (deben coincidir con OBS-OTP-02 / OBS-KYC-03). */
export const expectedSubcodes = {
    otp: {
        codeInvalid: 'CODE_INVALID',
        codeExpired: 'CODE_EXPIRED',
        noPreviousOtp: 'NO_PREVIOUS_OTP',
        providerUnreachable: 'PROVIDER_UNREACHABLE',
        providerError: 'PROVIDER_ERROR',
    },
    kyc: {
        expeditionDateInvalid: 'EXPEDITION_DATE_INVALID',
        expeditionDateMismatch: 'EXPEDITION_DATE_MISMATCH',
        documentNotFound: 'DOCUMENT_NOT_FOUND',
        documentDuplicate: 'DOCUMENT_DUPLICATE',
        kycValidationFailed: 'KYC_VALIDATION_FAILED',
        providerError: 'PROVIDER_ERROR',
    },
} as const;
