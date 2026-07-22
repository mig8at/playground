// bin/session-check.ts — chequeo REAL de validez del cache de sesión Cognito, por target.
//
// Lee `.auth/cognito-state.<target>.json`, arma el header `Cookie` con las cookies aplicables al FRONT
// del target y le pega a una ruta autenticada (`/merchant`) con `redirect: manual`. NO lanza browser: es
// un `fetch`. Imprime UNA línea JSON en stdout y sale 0 SIEMPRE (el panel lee el JSON, no el exit code):
//
//   { target, status: 'valid'|'invalid'|'missing'|'unreachable', detail }
//
//   valid       → el front deja pasar (sesión viva; el wizard pudo refrescar el token con el refresh token).
//   invalid     → el front rebota a Cognito/login (sin sesión, o refresh token revocado).
//   missing     → no hay cache, o el cache no tiene `__session` (la cookie de sesión del wizard).
//   unreachable → el front no respondió (p.ej. local/dev con el :5174 apagado; staging es el deploy).
//
// Por qué se pega al FRONT y no al backend: la sesión del asesor vive en la cookie `__session` del wizard
// (SSR), no en un header del backend. Ver F-66 y frontend-monorepo .../server/services/session.server.ts.
import { readFileSync, existsSync } from 'node:fs';
import { config } from '../pkg/config.ts';
import { TARGET } from '../pkg/env.ts';

// Espejo de pkg/cognito.ts::COGNITO_STATE_PATH. Se deriva acá (en vez de importar cognito.ts) para NO
// arrastrar `@playwright/test` a un CLI que solo hace un fetch. Si cambia allá, cambiar acá.
const COGNITO_STATE_PATH = `.auth/cognito-state.${TARGET}.json`;

/** ¿La cookie de `domain` viaja al `host`? host-only (`example.com`) → igualdad; con punto (`.creditop.com`) → subdominios. */
function hostMatchesDomain(host: string, domain: string): boolean {
    const d = String(domain || '').replace(/^\./, '');
    return !!d && (host === d || host.endsWith('.' + d));
}

function out(o: Record<string, unknown>): never {
    console.log(JSON.stringify({ target: TARGET, ...o }));
    process.exit(0);
}

async function main(): Promise<void> {
    // Leer el cache es best-effort: SIN cache igual se sondea el front, porque "no hay token" (missing,
    // warmable) y "el front está caído" (unreachable, NO warmable — p.ej. local/dev con el :5174 apagado)
    // piden reacciones opuestas del panel: al primero lo arregla el pre-login; al segundo no hay chequeo ni
    // warm posible y bloquear el launch por eso sería un falso muro (la corrida levanta el front y loguea).
    let cookies: Array<{ name: string; value: string; domain: string }> = [];
    let hayCache = false;
    if (existsSync(COGNITO_STATE_PATH)) {
        try {
            const state = JSON.parse(readFileSync(COGNITO_STATE_PATH, 'utf8'));
            cookies = Array.isArray(state.cookies) ? state.cookies : [];
            hayCache = true;
        } catch { /* cache ilegible = como si no existiera */ }
    }

    let host = '';
    try { host = new URL(config.feBaseUrl).host; } catch { out({ status: 'unreachable', detail: `E2E_BASE_URL inválida: ${config.feBaseUrl}` }); }

    // NO se filtra por NOMBRE de cookie: el deploy de staging usa `_session` (@.creditop.com) y el build
    // local `__session` (host-only) — el nombre de la sesión del wizard varía por deploy. La VERDAD es el
    // fetch de abajo: si el front deja pasar, la sesión vale (sea cual sea la cookie). Filtrar por nombre
    // daba un falso "missing" (buscaba `__session` y staging la llama `_session`).
    const applicable = cookies.filter((c) => hostMatchesDomain(host, c.domain));
    const cookieHeader = applicable.map((c) => `${c.name}=${c.value}`).join('; ');
    const url = `${config.feBaseUrl.replace(/\/$/, '')}/merchant`;
    let r: Response;
    try {
        r = await fetch(url, {
            headers: { ...(cookieHeader ? { cookie: cookieHeader } : {}), 'user-agent': 'harness-session-check', accept: 'text/html' },
            redirect: 'manual',
            signal: AbortSignal.timeout(15_000),
        });
    } catch (e) {
        out({ status: 'unreachable', detail: `el front no respondió (${config.feBaseUrl}) — ¿:5174 arriba? · ${e instanceof Error ? e.message : String(e)}` });
        return;
    }

    const loc = r.headers.get('location') || '';
    // `/merchant` con sesión válida → 302 a /merchant/{sucursal}/solicitar (o 200). Sin sesión → 302 a /login/Cognito.
    const toCognito = /login\.creditop\.com|auth\.[\w.-]*creditop\.com|amazoncognito|\/login(\?|$)|[?&]client_id=/i.test(loc);
    if (toCognito) {
        if (!applicable.length) out({ status: 'missing', detail: hayCache ? 'el cache no tiene cookies para el front — falta el pre-login' : 'sin cache de sesión (nunca se logueó en este target)' });
        out({ status: 'invalid', detail: `el front rebota a login → ${loc.slice(0, 80)}` });
    }
    if (r.status >= 200 && r.status < 400) out({ status: 'valid', detail: `HTTP ${r.status}${loc ? ` → ${loc.slice(0, 60)}` : ''}` });
    out({ status: 'invalid', detail: `HTTP ${r.status}` });
}

main().catch((e) => out({ status: 'unreachable', detail: String(e instanceof Error ? e.message : e) }));
