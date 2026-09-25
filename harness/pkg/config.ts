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
    const path = `${process.env.HOME}/Desktop/CREDITOP/github/legacy-backend/.env`;
    const micro: string[] = [];
    const blade: string[] = [];
    try {
        for (const l of readFileSync(path, 'utf8').split('\n')) {
            const m = l.match(/^\s*DOC_GEN_([A-Z_0-9]+)\s*=\s*(\S+)/);
            if (!m) continue;
            (/microservice/i.test(m[2]) ? micro : blade).push(m[1].toLowerCase());
        }
        return { microservicio: micro, blade, leido: true };
    } catch {
        return { microservicio: [], blade: [], leido: false };
    }
}

/** El proyecto del pdf-mapper que el arnés le pone a las entidades que no tienen uno. El mock lo acepta
 *  cualquiera (`/api/projects/{slug}/…`), y es el mismo que ya tenía CrediPullman en la base local. */
export const MOCK_DOC_SLUG = 'harness-local';

/**
 * CON LOS PDF POR EL MOCK, TODA ENTIDAD NECESITA UN PROYECTO DEL PDF-MAPPER, y eso se cablea acá.
 *
 * El backend arma la ruta del microservicio con `lenders.pdf_mapper_project_slug`
 * (`EloquentLenderProjectSlugResolver`), y sin él tira `LenderDocumentSettingsMissingException` ANTES de
 * llamar al mock: `sign-documents` da 500 y la corrida se corta en la firma. En la base local sólo
 * CrediPullman lo tenía, puesto a mano, y por eso era la única entidad que cerraba. Medido el 2026-09-25
 * con Compucredit por la tienda: pagó la cuota inicial y murió firmando.
 *
 * Sólo en local, sólo con algún `DOC_GEN_*=microservice`, y sólo a las entidades SIN proyecto: una que ya
 * tiene uno no se toca. En producción ninguna lo tiene (los documentos van por las plantillas), así que
 * esto no copia nada de allá: es lo que el mock necesita para contestar.
 */
export async function wireMockDocProjects(target: string): Promise<string | null> {
    if (target !== 'local') return null;
    const d = docGenLocal();
    if (!d.leido || !d.microservicio.length) return null;
    // Import dinámico: un import estático de `db.ts` resuelve el TARGET al cargar este módulo (F-187).
    const { exec, isLocalDb } = await import('./db.ts');
    if (!isLocalDb()) return null;
    const r = await exec('UPDATE lenders SET pdf_mapper_project_slug = ? WHERE pdf_mapper_project_slug IS NULL', [MOCK_DOC_SLUG]);
    return r.affectedRows
        ? `PDF por el mock: ${r.affectedRows} entidad(es) sin proyecto del pdf-mapper quedaron en «${MOCK_DOC_SLUG}» (sin eso, la firma da 500)`
        : null;
}

/**
 * LAS CENTRALES DE RIESGO QUE LE FALTAN AL CATÁLOGO LOCAL, copiadas de producción (leídas el 2026-09-25).
 *
 * El dump local llega hasta la 9; prod tiene hasta la 13. La que duele es la **12, Ábaco**: la consulta
 * de Ábaco se guarda en `risk_central_user_data` con ese id, y la tabla tiene clave foránea a este
 * catálogo, así que en local el insert fallaba y el paso de Ábaco se volvía a pedir sin fin. Las otras
 * tres van por lo mismo: una consulta de crosscore, evidente o la de información abierta al cliente
 * moriría igual.
 *
 * Sólo en local, y sólo las que faltan (`INSERT IGNORE` por id): una que ya existe no se toca.
 */
const PROD_RISK_CENTRALS: ReadonlyArray<[number, string]> = [
    [10, 'crosscore - Experian'],
    [11, 'evidente - Experian'],
    [12, 'Abaco'],
    [13, 'Experian - Información Crediticia Abierta Al Cliente'],
];
export async function wireRiskCentrals(target: string): Promise<string | null> {
    if (target !== 'local') return null;
    const { exec, isLocalDb } = await import('./db.ts');
    if (!isLocalDb()) return null;
    let added = 0;
    for (const [id, name] of PROD_RISK_CENTRALS) {
        const r = await exec('INSERT IGNORE INTO risk_centrals (id, name, country_id, enabled, created_at, updated_at) VALUES (?, ?, 47, 1, NOW(), NOW())', [id, name]);
        added += r.affectedRows;
    }
    return added ? `catálogo de centrales: ${added} que tiene prod y faltaban en local (Ábaco, la 12, sin la cual su consulta no se guarda)` : null;
}

/** Lo que el harness deja listo en la base LOCAL antes de correr. Lo llaman los tres runners. */
export async function wireLocal(target: string): Promise<string[]> {
    const said: string[] = [];
    for (const step of [wireMockDocProjects, wireRiskCentrals]) {
        const r = await step(target).catch((e: any) => `⚠ no pude preparar la base local (${step.name}): ${e?.message ?? e}`);
        if (r) said.push(r);
    }
    return said;
}

/** La línea de aviso, o `null` si no hay nada que advertir. La imprimen los runners en su cabecera. */
export function docGenNotice(target: string): string | null {
    if (target !== 'local') return null;
    const d = docGenLocal();
    if (!d.leido || !d.microservicio.length) return null;
    return `⚠ PDF por el MOCK (${d.microservicio.join(', ')}): la corrida es 3-4× más rápida y NO ejercita las plantillas Blade`
        + ' — un «Undefined variable» en el render no se atrapa acá (F-150). Para validar documentos: DOC_GEN_*=blade.';
}

/**
 * ¿LOS ERRORES DEL BACKEND LOCAL SE ESTÁN PERDIENDO? El diagnóstico, no una suposición.
 *
 * POR QUÉ EXISTE. `harness/CLAUDE.md` ya documenta la trampa y la llama por su nombre: con
 * `LOG_CHANNEL=loki` y Loki abajo, los errores de runtime **se pierden en silencio** — el handler se
 * traga su propio fallo y el fallback a `storage/logs` nunca dispara. Es «el peor de los dos mundos»:
 * ni archivo ni Loki. Y es la combinación NORMAL de trabajo, porque el `.env` queda con `loki` y el
 * stack de observabilidad no se levanta para cada corrida.
 *
 * Medido el 2026-09-15: `LOG_CHANNEL=loki`, `:3100` sin contestar, y el último `laravel.log` era del
 * **13 de septiembre** — o sea que los errores de backend de todas las corridas del día se perdieron,
 * incluido un 422 del OTP de firma y un `errorCode: unexpected` que hubo que ir a buscar con `curl`.
 *
 * Se diagnostica en vez de avisar siempre: si Loki ESTÁ arriba no hay nada que advertir, y un aviso
 * que sale igual en los dos casos se aprende a ignorar.
 */
export interface BackendLogs {
      canal: string;
      lokiArriba: boolean | null;   // `null` = no se pudo probar
      sePierden: boolean;
}

export async function localBackendLogs(): Promise<BackendLogs> {
      const out: BackendLogs = { canal: '', lokiArriba: null, sePierden: false };
      try {
            const env = readFileSync(`${process.env.HOME}/Desktop/CREDITOP/github/legacy-backend/.env`, 'utf8');
            out.canal = (env.match(/^\s*LOG_CHANNEL\s*=\s*(\S+)/m)?.[1] ?? '').trim();
      } catch {
            return out;   // sin `.env` legible no se afirma nada
      }
      if (!/loki/i.test(out.canal)) return out;   // con `stack`/`single` el archivo recibe: nada que avisar

      try {
            const res = await fetch('http://localhost:3100/ready', { signal: AbortSignal.timeout(2500) });
            out.lokiArriba = res.ok;
      } catch {
            out.lokiArriba = false;
      }
      out.sePierden = out.lokiArriba === false;
      return out;
}

/**
 * El aviso, o `null` si no hay nada que advertir. Lo imprimen los runners CUANDO UN CASO FALLA: ahí es
 * cuando se va a buscar la causa, y es el momento en que enterarse de que no quedó rastro cambia lo
 * que hacés después.
 *
 * Incluye el comando que SÍ funciona sin observabilidad —repedirle el endpoint, que devuelve la causa
 * en el cuerpo— con la solicitud ya puesta, igual que hacen los avisos de PostHog y de Loki.
 */
export async function backendLogsNotice(target: string, uReq?: number | string | null): Promise<string[]> {
      if (target !== 'local') return [];
      const d = await localBackendLogs();
      if (!d.sePierden) return [];
      return [
            `⚠ LOS ERRORES DEL BACKEND DE ESTA CORRIDA NO QUEDARON EN NINGUNA PARTE.`,
            `   \`LOG_CHANNEL=${d.canal}\` en el .env de legacy-backend y Loki (:3100) no contesta: el handler se`,
            `   traga su propio fallo y el fallback a storage/logs NO dispara. Ni archivo ni Loki.`,
            `   Para ver la causa de un 500 sin levantar nada, pedile el endpoint de nuevo — el cuerpo la trae:`,
            uReq
                  ? `     curl -s -w '\\nHTTP %{http_code}\\n' http://localhost/api/loans/requests/promissory-note/${uReq}`
                  : `     curl -s -w '\\nHTTP %{http_code}\\n' http://localhost/api/loans/requests/promissory-note/<ureq>`,
            `   O levantá el stack: \`make harness-obs-up\` (y entonces \`make harness-loki UREQ=…\` sirve).`,
      ];
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
     * igual que `WIZ_API` en bin/advisor; `E2E_MOCK_URL` sigue mandando si está, como override explícito.
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
         *  la tolerancia de los campos SEGUNDOS es donde vivía el defecto. Ver dev/kyc-surname.ts. */
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

/**
 * ¿ESTÁ CONFIGURADO EL PROVEEDOR DE IDENTIDAD (ADO)? — F-220.
 *
 * POR QUÉ EXISTE. Sin `ADO_HOST` en el `.env` del backend, el endpoint de inscripción responde **200**
 * con un destino a medias —sólo el path del proveedor, sin host—, el contrato del front lo acepta
 * (`z.string()`, no url) y el helper de redirección lo reinterpreta como **un segmento de ruta del
 * flujo**, así que lo cuelga del prefijo del comercio. El router no matchea nada y queda una pantalla
 * que se ve bien y no responde. Ninguna de las tres capas se queja.
 *
 * Medido el 2026-09-15: la variable no está en el `.env` ni declarada en el `.env.example`, y el
 * contenedor resuelve la configuración como `NULL`. En los ambientes desplegados sí está — cero
 * apariciones del síntoma en 30 días—, así que esto es de local.
 *
 * Se lee el `.env` del OTRO repo con el mismo idiom que `localBackendLogs`: una perilla que cambia
 * qué puede probar la corrida no puede estar invisible.
 */
export function configuredIdentityProvider(): boolean | null {
      try {
            const env = readFileSync(`${process.env.HOME}/Desktop/CREDITOP/github/legacy-backend/.env`, 'utf8');
            const v = (env.match(/^\s*ADO_HOST\s*=\s*(.*)$/m)?.[1] ?? '').trim().replace(/^["']|["']$/g, '');
            return v !== '';
      } catch {
            return null;   // sin `.env` legible no se afirma nada
      }
}

/**
 * El aviso, o vacío si no hay nada que advertir. Sólo habla cuando el target es `local` y la variable
 * falta: contra un ambiente desplegado el proveedor está puesto y avisar ahí sería ruido.
 */
export function identityWithoutProviderNotice(target: string): string[] {
      if (target !== 'local') return [];
      if (configuredIdentityProvider() !== false) return [];
      return [
            '⚠ el proveedor de identidad (ADO) NO está configurado en local: sin `ADO_HOST` en el .env del',
            '  backend, la pantalla de validación de identidad termina en una ruta inventada y queda MUERTA',
            '  («No routes matched» · F-220). No es un bug del flujo: es la variable, que tampoco está en el',
            '  .env.example. El arnés aprueba la identidad a mano para poder pasar — y lo dice al hacerlo.',
      ];
}
