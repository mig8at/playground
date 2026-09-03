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
 * Credenciales Cognito MERCHANT para pruebas `/merchant/*` (asesor) por UI. Orden: la CADENA por target
 * (`process.env` > `.env.<target>` > `env/<target>.env`) → archivo gitignored `.cognito.json`. Nunca commitear.
 *
 * Van por target, no globales: **staging entra por otro pool de Cognito** que dev
 * (`auth.merchant.creditop.com` vs `login.creditop.com`), así que necesita su propia cuenta. Un único
 * `.cognito.json` obligaría a pisar las de dev para probar staging y viceversa (F-61).
 */
function loadCognitoCreds(): { user?: string; pass?: string } {
    const user = env('E2E_COGNITO_USER');
    if (user) return { user, pass: env('E2E_COGNITO_PASS') };
    try {
        const raw = JSON.parse(readFileSync(join(process.cwd(), '.cognito.json'), 'utf8'));
        return { user: raw.user, pass: raw.pass };
    } catch {
        return {};
    }
}

export const cognitoCreds = loadCognitoCreds();

/**
 * Credenciales del ADMIN de `legacy-application` (el panel de operaciones). Mismo orden que las de
 * Cognito: la cadena por target → archivo gitignored `.admin.json` (`{"user":"…","pass":"…"}`).
 *
 * ⚠ **No es Cognito.** `legacy-application` autentica con **Fortify**: correo + contraseña contra la
 * tabla `users`, sesión de Laravel. Verificado el 2026-08-08 — `config/auth.php` declara un solo guard
 * `web` con provider `users`, y no hay una sola referencia a Cognito en el repo. Por eso estas
 * credenciales van aparte y NO se pueden reusar con `cognitoLogin`.
 *
 * ⚠ Y la contraseña tiene que existir **en la base contra la que apuntás**. Con la copia local eso
 * significa que el hash del dump debe corresponder a esa contraseña: una cuenta de staging sólo entra
 * en local si el dump vino de staging. Si el login falla con credenciales correctas, es la primera
 * hipótesis — no un bug del script.
 */
function loadAdminCreds(): { user?: string; pass?: string } {
    const user = env('E2E_ADMIN_USER');
    if (user) return { user, pass: env('E2E_ADMIN_PASS') };
    try {
        const raw = JSON.parse(readFileSync(join(process.cwd(), '.admin.json'), 'utf8'));
        return { user: raw.user, pass: raw.pass };
    } catch {
        return {};
    }
}

export const adminCreds = loadAdminCreds();

/**
 * ¿Los documentos de esta corrida los fabrica dompdf con las plantillas Blade, o los devuelve el mock
 * del pdf-mapper? Se lee del `.env` del backend LOCAL, que es el único que podemos ver desde acá.
 *
 * POR QUÉ EXISTE ESTA FUNCIÓN Y NO ES SÓLO UNA NOTA EN LA DOCUMENTACIÓN. Enrutar los PDF al mock hace
 * la corrida 3-4× más rápida (medido 2026-09-03: un caso de 73 s a 20 s; seis en paralelo de 112 s a
 * 27 s), y a cambio la corrida **deja de ejercitar las plantillas Blade**. O sea que deja de atrapar la
 * clase de bug de F-150 — un builder que produce claves que la plantilla no espera revienta con
 * «Undefined variable» en pleno render, que no es un documento con huecos sino una FIRMA CAÍDA.
 *
 * Y no es hipotético: el 2026-09-02, en qa, el Rent to Own murió exactamente así
 * (`Undefined variable $nombre_cliente` en `contrato_rto_con_codeudor.blade.php`). Una corrida con el
 * mock prendido habría cerrado en verde sobre ese mismo bug. Por eso el estado se IMPRIME: una perilla
 * que cambia lo que la corrida prueba no puede estar invisible en el `.env` de otro repo.
 */
export function docGenLocal(): { microservicio: string[]; blade: string[]; leido: boolean } {
    const ruta = `${process.env.HOME}/Desktop/CREDITOP/github/legacy-backend/.env`;
    const micro: string[] = [];
    const blade: string[] = [];
    try {
        for (const l of readFileSync(ruta, 'utf8').split('\n')) {
            const m = l.match(/^\s*DOC_GEN_([A-Z_0-9]+)\s*=\s*(\S+)/);
            if (!m) continue;
            (/microservice/i.test(m[2]) ? micro : blade).push(m[1].toLowerCase());
        }
        return { microservicio: micro, blade, leido: true };
    } catch {
        return { microservicio: [], blade: [], leido: false };
    }
}

/** La línea de aviso, o `null` si no hay nada que advertir. La imprimen los runners en su cabecera. */
export function avisoDocGen(target: string): string | null {
    if (target !== 'local') return null;
    const d = docGenLocal();
    if (!d.leido || !d.microservicio.length) return null;
    return `⚠ PDF por el MOCK (${d.microservicio.join(', ')}): la corrida es 3-4× más rápida y NO ejercita las plantillas Blade`
        + ' — un «Undefined variable» en el render no se atrapa acá (F-150). Para validar documentos: DOC_GEN_*=blade.';
}

export const config = {
    /** URL del frontend. Por TARGET: local = Vite :5174 · dev/staging = el deploy correspondiente.
     *  Se lee con `env()` (no `process.env` pelado) para que valga ponerla en `env/<target>.env`. */
    feBaseUrl: env('E2E_BASE_URL', 'http://localhost:5174'),

    /**
     * URL del BACKEND DEL TARGET. El nombre es histórico (del viejo mock-server :4000, ya eliminado):
     * hoy es "el backend contra el que corre esta prueba".
     *
     * Antes caía a `http://localhost` SIEMPRE, en los tres targets, porque `E2E_MOCK_URL` no está
     * definida en ninguno. Con target=dev eso hacía que el sembrado headless registrara al cliente en
     * el backend LOCAL, se trajera un `users.id` de la base local y lo insertara en la base de DEV: la
     * solicitud quedaba HUÉRFANA y /lenders moría con 500 (F-65). Ahora sale de la cadena por target,
     * igual que `WIZ_API` en bin/asesor; `E2E_MOCK_URL` sigue mandando si está, como override explícito.
     */
    mockUrl: (env('E2E_MOCK_URL') || env('E2E_API_BASE_URL', 'http://localhost'))
        .replace(/\/api\/?$/, '').replace(/\/$/, ''),

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
        /** SEGUNDO apellido «no coincide» (match_code 0) con el resto en coincidencia — el caso
         *  de la uReq 523201. Distinto de `nameMismatch`, que pega en el PRIMER nombre/apellido:
         *  la tolerancia de los campos SEGUNDOS es donde vivía el defecto. Ver dev/kyc-apellido.ts. */
        secondSurnameMismatch: 'second-surname-mismatch',
        /** Cliente de UN nombre y UN apellido, todo coincidente (campos segundos AUSENTES).
         *  Es la red: esta persona debe seguir pasando. */
        singleNameAndSurname: 'single-name-and-surname',
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
