// loki.ts — FORENSE de una solicitud contra los logs de legacy-backend.
//
// POR QUÉ EXISTE, y por qué NO es una fuente de aserción:
//   `trace.ts` contrasta el front con la BD: dice DÓNDE estuvo el usuario y en qué estado quedó la
//   solicitud. Lo que no puede decir es POR QUÉ. Una regla que excluyó un lender no mueve ningún estado;
//   un reintento de KYC que agotó el rate limit tampoco. Eso solo existe en los logs.
//   Acá se responde "por qué", y NADA más: el veredicto sigue siendo el de `trace.ts`. Afirmar sobre
//   logs fabrica tests flaky, porque la ausencia de una línea tiene cuatro causas indistinguibles
//   (no se logueó · el level la filtró · el batch no hizo flush · lag de ingesta). Por eso este módulo
//   IMPRIME y DEVUELVE, nunca lanza ni falla.
//
// EL JOIN ES DE DOS FASES, y no hay atajo (medido el 2026-08-04 contra producción):
//   · el `user_request_id` es lo que abarca el flujo, pero solo aparece en ~8% de las líneas, dentro del
//     `context` — no es etiqueta, así que no se puede buscar por índice;
//   · el `trace_id` SÍ es etiqueta (búsqueda indexada, barata), pero cubre UNA petición HTTP: ~18 líneas,
//     ~15s. Una solicitud real usa entre 6 y 15 traces distintos.
//   Entonces: (1) ANCLAS — buscar las líneas que traen el uReq y quedarse con sus trace_id; (2) EXPANSIÓN
//   — traer esos traces completos por etiqueta. En la medición eso llevó 85 líneas a 405 (×4.8).
//
// ⚠ SOLO legacy-backend. El trace_id NO se propaga entre servicios: `legacy-backend` y
//   `legacy-application` no comparten ni un trace, y los microservicios Go no emiten `trace_id` en
//   absoluto. Prometer "cruza los 15 servicios" sería mentira; se declara el límite y se muestra.
//
// ⚠ LA COBERTURA NO SE PUEDE PROBAR. Solo se descubren traces que tengan al menos UNA línea con el uReq
//   en su context. Una petición que nunca lo loguea es invisible acá, y no hay forma de contar las que
//   faltan. Por eso el bloque de cobertura dice de qué anclas salió cada trace: es lo único honesto.
//
// CONVENCIÓN: identificadores en inglés, comentarios y texto visible en español.

import { env, TARGET } from './env.ts';

// ─── configuración ──────────────────────────────────────────────────────────────────────────────────

export type LokiConfig = {
    enabled: boolean;
    url: string;
    user: string;
    token: string;
    /** Espera antes de consultar: LokiHandler batchea de a 100 y flushea al morir el proceso. */
    settleMs: number;
    /** Ensancha la ventana a los dos lados: el reloj del Mac y el del servidor no coinciden. */
    padMs: number;
    /**
     * Valores de `environment` de ESTE target, como alternativa de regex (`development|develop`).
     *
     * NO es un lujo: `dev` y `staging` comparten el stack de Loki Y la base de datos, así que un mismo
     * uReq tiene líneas de los DOS —`legacy-backend` (develop) y `legacy-backend-stg` (qa)— y sin
     * distinguirlas el forense mezcla qué CÓDIGO atendió la solicitud. Es la misma trampa que ya costó
     * corridas creyendo que un feature estaba roto cuando respondía la otra rama.
     *
     * Vacío = no filtrar. El desglose por ambiente se reporta SIEMPRE, filtre o no.
     */
    env: string;
};

export function lokiConfig(): LokiConfig {
    return {
        enabled: env('E2E_LOKI_ENABLED', 'false') === 'true',
        url: env('E2E_LOKI_URL').replace(/\/loki\/api\/.*$/, '').replace(/\/+$/, ''),
        user: env('E2E_LOKI_USER'),
        token: env('E2E_LOKI_TOKEN'),
        settleMs: Number(env('E2E_LOKI_SETTLE_MS', '10000')) || 0,
        padMs: Number(env('E2E_LOKI_PAD_MS', '60000')) || 0,
        env: env('E2E_LOKI_ENV').trim(),
    };
}

/**
 * Por qué no se puede consultar, en una frase lista para imprimir. `null` = se puede.
 *
 * La tercera guarda es la importante y no es obvia: **apuntar el target `local` a un Loki que no sea
 * `local` es peor que no tener forense.** La tentación es razonar como con la base de datos ("apunto a
 * dev y listo"), pero no es lo mismo: contra la BD leés las filas que TU corrida escribió; contra Loki
 * tu corrida local no escribió nada, así que leerías la corrida de otro cuyo `user_request_id` coincide.
 *
 * Y coincide, porque la BD local es un dump de dev: las dos secuencias de id viven en el mismo rango y
 * avanzan a la vez (medido el 2026-08-04: local en 464664, dev en 464620 — 44 de diferencia). Un forense
 * que muestra con seguridad los logs de la solicitud de otra persona es un diagnóstico falso, no un dato
 * incompleto. Se bloquea, con la misma forma que la guarda de escrituras a la BD compartida (F-53).
 */
export function porQueNo(c: LokiConfig): string | null {
    if (!c.enabled) return 'E2E_LOKI_ENABLED no está en true';
    if (!c.url) return 'falta E2E_LOKI_URL';
    // Un Loki local (Docker) no pide credenciales; Grafana Cloud sí. Exigirlas siempre obligaría a
    // inventar un usuario y un token falsos para el target local, que es peor que no pedirlos.
    if (!esLokiLocal(c.url)) {
        const faltan = (['user', 'token'] as const).filter((k) => !c[k]);
        if (faltan.length) return `falta ${faltan.map((k) => `E2E_LOKI_${k.toUpperCase()}`).join(', ')}`;
    }
    // La guarda mira la URL y no la etiqueta, porque el invariante es de DÓNDE se lee: con target local
    // apuntando a un Loki remoto, las líneas son de otra corrida (los id de uReq se solapan con dev
    // porque la BD local es su dump). Es el espejo de `esLocal()` en bin/preflight.ts.
    if (TARGET === 'local' && !esLokiLocal(c.url)) {
        return `target local leyendo un Loki REMOTO (${c.url}) — tu corrida local no escribió ahí, y los id `
            + 'de uReq se solapan con dev (la BD local es su dump), así que mostraría la solicitud de otro. '
            + 'Levantá el Loki local: bin/loki-local start';
    }
    return null;
}

/** ¿La URL apunta a un Loki de esta máquina? `host.docker.internal` cuenta: es cómo lo ve el contenedor. */
export const esLokiLocal = (u: string) =>
    /(^|\/\/)(localhost|127\.0\.0\.1|\[::1\]|host\.docker\.internal)(:|\/|$)/.test(u.trim());

// ─── transporte ─────────────────────────────────────────────────────────────────────────────────────

/** Una línea de Loki, ya parseada. `ctx` es el `context` de LokiHandler cuando es objeto. */
export type Linea = {
    ts: number;                   // epoch ms
    service: string;
    level: string;
    traceId: string;
    spanId: string;
    /** Convención Laravel (`LokiHandler`, viene de `APP_ENV`). */
    environment: string;
    /** Convención OTel de los microservicios Go. Conviven las dos, así que se guardan las dos. */
    deploymentEnvironment: string;
    msg: string;
    ctx: Record<string, unknown>;
    raw: string;
};

const ns = (ms: number) => `${Math.round(ms)}000000`;

async function query(c: LokiConfig, logql: string, fromMs: number, toMs: number, limit = 5000): Promise<Linea[]> {
    const qs = new URLSearchParams({
        query: logql, start: ns(fromMs), end: ns(toMs),
        limit: String(limit), direction: 'forward',
    });
    // Sin credenciales no se manda el header: un Loki local rechaza un Basic vacío en vez de ignorarlo.
    const headers: Record<string, string> = c.user && c.token
        ? { Authorization: `Basic ${Buffer.from(`${c.user}:${c.token}`).toString('base64')}` }
        : {};
    const res = await fetch(`${c.url}/loki/api/v1/query_range?${qs}`, {
        headers, signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
        // El cuerpo puede ser el HTML de error de Cloudflare (hostname inexistente → 530/1016). Volcarlo
        // entero tapa el resto de la salida y no dice nada: se traduce a la causa.
        const cuerpo = (await res.text()).trim();
        const detalle = /^\s*<(!doctype|html)/i.test(cuerpo)
            ? (/error code: (\d+)/i.exec(cuerpo)?.[0] ?? 'respuesta HTML, no JSON') + ' — ¿la URL no es la de Loki?'
            : cuerpo.replace(/\s+/g, ' ').slice(0, 180);
        throw new Error(`Loki ${res.status}: ${detalle}`);
    }
    const body = await res.json() as { data?: { result?: Array<{ stream: Record<string, string>; values: [string, string][] }> } };

    const out: Linea[] = [];
    for (const st of body.data?.result ?? []) {
        for (const [tsNano, raw] of st.values) {
            let msg = raw, ctx: Record<string, unknown> = {};
            try {
                const obj = JSON.parse(raw) as { message?: string; context?: unknown };
                if (typeof obj.message === 'string') msg = obj.message;
                if (obj.context && typeof obj.context === 'object' && !Array.isArray(obj.context)) {
                    ctx = obj.context as Record<string, unknown>;
                }
            } catch { /* línea no-JSON: se muestra cruda */ }
            out.push({
                ts: Number(tsNano.slice(0, 13)),
                service: st.stream.service_name ?? st.stream.app ?? '?',
                level: st.stream.level ?? st.stream.detected_level ?? '?',
                traceId: st.stream.trace_id ?? '',
                spanId: st.stream.span_id ?? '',
                environment: st.stream.environment ?? '',
                deploymentEnvironment: st.stream.deployment_environment ?? '',
                msg: msg.trim(), ctx, raw,
            });
        }
    }
    return out.sort((a, b) => a.ts - b.ts);
}

// ─── el join de dos fases ───────────────────────────────────────────────────────────────────────────

export type Cobertura = {
    lineasConTexto: number;                        // cuántas líneas mencionaban el uReq
    anclas: Record<string, string[]>;              // traceId → campos del context donde apareció
    traces: string[];
    lineas: number;
    /** Cuántas líneas por valor de `environment`. Si hay más de uno, el uReq lo tocaron dos ambientes. */
    ambientes: Record<string, number>;
    /** El filtro que se aplicó, para poder decir qué se dejó afuera. */
    filtroEnv: string;
    /** true = no había `trace_id`, así que solo se ven las líneas que nombran el uReq (ver `anclar`). */
    degradado: boolean;
    /** true = correlación por VENTANA DE TIEMPO, no por uReq. Solo con Loki local (ver `forense`). */
    porVentana: boolean;
};

/** El ambiente de una línea, mirando las DOS convenciones: Laravel usa `environment`, OTel
 *  `deployment_environment`, y en este stack conviven (más `develop` vs `development`, ya en los datos). */
const ambienteDe = (l: Linea) => l.environment || l.deploymentEnvironment || '(sin ambiente)';

/**
 * FASE 1 — anclas. Busca el uReq como TEXTO (es lo único que Loki puede filtrar sin índice) y después
 * confirma que aparezca como VALOR de un campo del context. Ese segundo filtro no es paranoia: sin él,
 * un `document_number` o un `user_id` que contenga los mismos dígitos ancla un trace ajeno, y el forense
 * termina explicando la solicitud de otra persona.
 */
async function anclar(c: LokiConfig, ureq: string, fromMs: number, toMs: number) {
    const crudas = await query(c, `{service_name=~".+"} |= "${ureq}"`, fromMs, toMs);
    const anclas: Record<string, string[]> = {};
    const sinTrace: Linea[] = [];
    for (const l of crudas) {
        const campos = Object.entries(l.ctx).filter(([, v]) => String(v) === ureq).map(([k]) => k);
        if (!campos.length) continue;
        // Sin `trace_id` no se puede expandir, pero la línea igual es del uReq: se guarda para el modo
        // degradado en vez de descartarla. Descartarla era decir "cero anclas" habiendo evidencia.
        if (!l.traceId) { sinTrace.push(l); continue; }
        anclas[l.traceId] = [...new Set([...(anclas[l.traceId] ?? []), ...campos])];
    }
    return { crudas, anclas, sinTrace };
}

/** FASE 2 — expansión: cada trace anclado, completo, por etiqueta (indexado y barato). */
export async function forense(c: LokiConfig, ureq: string | number, ventanaMs: number) {
    const toMs = Date.now() + c.padMs;
    const fromMs = toMs - ventanaMs - c.padMs;
    const id = String(ureq);

    const { crudas, anclas, sinTrace } = await anclar(c, id, fromMs, toMs);
    const traces = Object.keys(anclas);
    const vacia = (extra: Partial<Cobertura> = {}): Cobertura => ({
        lineasConTexto: crudas.length, anclas: {}, traces: [], lineas: 0,
        ambientes: {}, filtroEnv: c.env, degradado: false, porVentana: false, ...extra,
    });

    // MODO VENTANA — último recurso, y SOLO con un Loki local. Si no hay ni una línea que nombre el uReq,
    // en un Loki local igual se puede mostrar lo que se logueó en la ventana de la corrida: sos el único
    // que escribe ahí, así que "lo que pasó en esos minutos" es tu corrida. Contra un Loki compartido esto
    // sería una fuente de diagnósticos falsos (verías la corrida de otro), y por eso está atado a
    // `esLokiLocal` y NO a una perilla: una opción que se puede prender es una opción que alguien prende.
    // Se marca como correlación por TIEMPO, no por uReq, para que nadie lo lea como lo mismo.
    if (!traces.length && !sinTrace.length && esLokiLocal(c.url)) {
        const sel = c.env ? `{environment=~"${c.env}"}` : '{service_name=~".+"}';
        const todas = await query(c, sel, fromMs, toMs);
        if (todas.length) {
            const ambientes: Record<string, number> = {};
            for (const l of todas) { const a = ambienteDe(l); ambientes[a] = (ambientes[a] ?? 0) + 1; }
            return {
                lineas: todas,
                cobertura: {
                    lineasConTexto: crudas.length, anclas: {}, traces: [], lineas: todas.length,
                    ambientes, filtroEnv: c.env, degradado: true, porVentana: true,
                },
            };
        }
    }

    // MODO DEGRADADO — sin `trace_id` no hay fase 2, pero las líneas del uReq siguen siendo evidencia.
    // Pasa de verdad y no es un caso raro: el `trace_id` solo entra al log si Tempo/OTel está inicializado
    // (`GrafanaServiceProvider::configureLogging` lo agrega SOLO si `grafana.tempo.enabled`, y
    // `initializeOpenTelemetry` sale temprano sin `GRAFANA_TEMPO_ENDPOINT`). O sea: un backend que empuja a
    // Loki sin Tempo —el caso de una máquina local— produce líneas perfectamente útiles y no joinables.
    // Devolver "cero anclas" ahí sería mentir teniendo la evidencia en la mano.
    if (!traces.length) {
        if (!sinTrace.length) return { lineas: [] as Linea[], cobertura: vacia() };
        const ambientes: Record<string, number> = {};
        for (const l of sinTrace) { const a = ambienteDe(l); ambientes[a] = (ambientes[a] ?? 0) + 1; }
        const re = c.env ? new RegExp(`^(?:${c.env})$`) : null;
        const lineas = re ? sinTrace.filter((l) => re.test(ambienteDe(l))) : sinTrace;
        return {
            lineas,
            cobertura: {
                lineasConTexto: crudas.length, anclas: {}, traces: [],
                lineas: lineas.length, ambientes, filtroEnv: c.env, degradado: true, porVentana: false,
            },
        };
    }

    const todas = await query(c, `{trace_id=~"${traces.join('|')}"}`, fromMs, toMs);

    // El desglose por ambiente se calcula sobre TODO lo traído, antes de filtrar: es la única forma de
    // poder decir "también hay líneas de qa para este uReq" en vez de esconderlas.
    const ambientes: Record<string, number> = {};
    for (const l of todas) {
        const a = ambienteDe(l);
        ambientes[a] = (ambientes[a] ?? 0) + 1;
    }
    const re = c.env ? new RegExp(`^(?:${c.env})$`) : null;
    const lineas = re ? todas.filter((l) => re.test(ambienteDe(l))) : todas;

    return {
        lineas,
        cobertura: { lineasConTexto: crudas.length, anclas, traces, lineas: lineas.length, ambientes, filtroEnv: c.env, degradado: false, porVentana: false },
    };
}

// ─── el resumen ─────────────────────────────────────────────────────────────────────────────────────
//
// Las reglas de colapso NO son de gusto: salen de medir una solicitud real (405 líneas). Cada
// invocación de controller escribe 3-6 líneas ceremoniales (`entered` · `received input parameters` ·
// `forwarding to X`), el mismo error se repite en cada reintento, y cada lender evaluado gasta dos
// líneas (`Evaluando` + `Resultado`). Colapsando eso se pasa de 405 líneas a ~35 sin perder señal.

/** Líneas ceremoniales: no aportan por sí solas, marcan que un paso arrancó. */
const CEREMONIA = /:\s*(entered|received input parameters|forwarding to|calling |returning )/i;
/** `Clase::metodo` al inicio del mensaje — es el nombre del paso. */
const PASO = /^([A-Za-z][\w\\]*?(?:Controller|Service|Repository|Orchestrator))::(\w+)/;

export type Paso = { ts: number; nombre: string; lineas: number; durMs: number; error?: string };
export type Falla = { code: string; sub?: string; msg: string; veces: number; desde: number; hasta: number; ctx: Record<string, unknown> };

/**
 * Una entidad evaluada. `ruleId` es la regla del VEREDICTO y sale SOLO de la línea «Resultado de
 * evaluación de reglas para entidad» — no de cualquier línea que traiga un `rule_id`.
 *
 * Esa distinción no es cosmética: un lender puede tener además `CATEGORY_RULE_REJECTED` con OTRA regla.
 * Tomar el último `rule_id` visto mostraba «regla 95 · aprobado» para el lender 139, emparejando el
 * veredicto con la regla que justamente había rechazado una categoría. Las rechazadas van aparte, que es
 * su lugar: son un detalle interesante (una categoría cayó aunque la entidad quedó aprobada), no el fallo.
 */
export type Entidad = {
    lenderId: string;
    nombre?: string;
    ruleId?: string;
    result?: string;
    categoriasRechazadas: string[];
};

export type Resumen = {
    ureq: string;
    identidad: Record<string, string>;
    pasos: Paso[];
    fallas: Falla[];
    entidades: Entidad[];
    tramos: Array<{ traceId: string; ts: number; lineas: number; durMs: number; huecoMs: number }>;
    porNivel: Record<string, number>;
    cobertura: Cobertura;
};

/**
 * Etiqueta para una falla que NO trae `error_code`. Existe porque «(sin código)» repetido tres veces no
 * distingue un rate limit de un 401 de un proveedor — y son diagnósticos opuestos. Se saca del mensaje,
 * que en esos casos ya dice lo que pasó.
 */
function etiquetaFalla(msg: string): string {
    const http = /status code (\d{3})/.exec(msg);
    if (http) return `HTTP ${http[1]}`;
    const onb = /\b(ONB\d{3}|[A-Z]{2,}_[A-Z_]{3,})\b/.exec(msg);
    if (onb) return onb[1];
    return msg.split(/[:\n]/)[0].slice(0, 44).trim() || '(sin código)';
}

/** Saca el primer valor no vacío de una lista de claves del context. */
function pick(ctx: Record<string, unknown>, keys: string[]): string | undefined {
    for (const k of keys) {
        const v = ctx[k];
        if (v !== undefined && v !== null && String(v) !== '') return String(v);
    }
    return undefined;
}

export function resumir(ureq: string, lineas: Linea[], cobertura: Cobertura): Resumen {
    const identidad: Record<string, string> = {};
    const porNivel: Record<string, number> = {};
    const pasosMap = new Map<string, Paso>();
    const fallasMap = new Map<string, Falla>();
    const entidades = new Map<string, Entidad>();
    const porTrace = new Map<string, Linea[]>();

    for (const l of lineas) {
        porNivel[l.level] = (porNivel[l.level] ?? 0) + 1;
        porTrace.set(l.traceId, [...(porTrace.get(l.traceId) ?? []), l]);

        // Identidad: lo primero que aparezca gana; sirve para saber DE QUIÉN es esta solicitud.
        for (const [dst, keys] of [
            ['user_id', ['user_id', 'user.id']], ['documento', ['document_number']],
            ['tipo_doc', ['document_type']], ['sucursal', ['partner_branch_id']],
            ['telefono', ['cell_phone']], ['monto', ['amount']],
        ] as const) {
            if (!identidad[dst]) { const v = pick(l.ctx, keys as unknown as string[]); if (v) identidad[dst] = v; }
        }

        // ── pasos: una línea por invocación de controller/servicio, no 3-6 ──
        const m = PASO.exec(l.msg);
        if (m) {
            const nombre = `${m[1].split('\\').pop()}::${m[2]}`;
            const prev = pasosMap.get(nombre);
            const err = pick(l.ctx, ['error_code']);
            pasosMap.set(nombre, {
                ts: prev?.ts ?? l.ts,
                nombre,
                lineas: (prev?.lineas ?? 0) + 1,
                durMs: l.ts - (prev?.ts ?? l.ts),
                error: err ?? prev?.error,
            });
        }

        // ── fallas: deduplicadas por código, con contador y rango ──
        const code = pick(l.ctx, ['error_code']) ?? etiquetaFalla(l.msg);
        const esError = l.level === 'error';
        if (esError || pick(l.ctx, ['error_code'])) {
            const sub = pick(l.ctx, ['error_subcode', 'subcode']);
            const key = `${code}|${sub ?? ''}`;
            const prev = fallasMap.get(key);
            const limpio: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(l.ctx)) {
                if (k === 'headers' || typeof v === 'object') continue;
                limpio[k] = v;
            }
            fallasMap.set(key, {
                code, sub, msg: prev?.msg ?? l.msg,
                veces: (prev?.veces ?? 0) + 1,
                desde: prev?.desde ?? l.ts, hasta: l.ts,
                ctx: prev?.ctx ?? limpio,
            });
        }

        // ── entidades: `Evaluando`+`Resultado` colapsan a una fila por lender ──
        const lenderId = pick(l.ctx, ['lender_id']);
        if (lenderId && /reglas para entidad|CATEGORY_|RULE_|QUOTA_/i.test(l.msg)) {
            const prev = entidades.get(lenderId) ?? { lenderId, categoriasRechazadas: [] };
            const rule = pick(l.ctx, ['rule_id']);
            // El veredicto SOLO se lee de la línea «Resultado de evaluación»; las demás no lo tienen.
            const esVeredicto = /Resultado de evaluaci/i.test(l.msg);
            const rechazoCategoria = /CATEGORY_RULE_REJECTED/i.test(l.msg);
            entidades.set(lenderId, {
                lenderId,
                nombre: pick(l.ctx, ['lender_name']) ?? prev.nombre,
                ruleId: esVeredicto ? (rule ?? prev.ruleId) : prev.ruleId,
                result: esVeredicto ? (pick(l.ctx, ['result', 'resultado']) ?? prev.result) : prev.result,
                categoriasRechazadas: rechazoCategoria && rule && !prev.categoriasRechazadas.includes(rule)
                    ? [...prev.categoriasRechazadas, rule]
                    : prev.categoriasRechazadas,
            });
        }
    }

    // ── tramos: los traces en orden, con el silencio entre uno y otro (= el usuario en una pantalla) ──
    const tramos = [...porTrace.entries()]
        .map(([traceId, ls]) => ({ traceId, ts: ls[0].ts, fin: ls[ls.length - 1].ts, lineas: ls.length }))
        .sort((a, b) => a.ts - b.ts)
        .map((t, i, arr) => ({
            traceId: t.traceId, ts: t.ts, lineas: t.lineas,
            durMs: t.fin - t.ts,
            huecoMs: i === 0 ? 0 : t.ts - arr[i - 1].fin,
        }));

    return {
        ureq, identidad, porNivel, cobertura,
        pasos: [...pasosMap.values()].sort((a, b) => a.ts - b.ts),
        fallas: [...fallasMap.values()].sort((a, b) => a.desde - b.desde),
        entidades: [...entidades.values()],
        tramos,
    };
}

// ─── expectativa por ramal ──────────────────────────────────────────────────────────────────────────
//
// El mapa del recorrido NO se duplica acá: los nombres de ramal son los de `panel/steps.json`
// (agregador · creditopx · redirect) y el ramal se resuelve del `response_type` del lender en la BD,
// como ya lo hace `pkg/close.ts`. Lo único que vive acá es qué se ESPERA ver en los logs por ramal, y a
// nivel `service_name` —no de clase— porque la instrumentación no es global: `Modules\Loans` no emite
// Starting/Ending, así que exigir clases produciría falsas alarmas en cascada.

export type Ramal = 'creditopx' | 'agregador' | 'redirect';

export function ramalDeRt(rt: number): Ramal {
    if (rt === 2 || rt === 3 || rt === 4) return 'creditopx';
    if (rt === 1) return 'agregador';
    return 'redirect';
}

export const ESPERADO: Record<Ramal, { nota: string }> = {
    creditopx: { nota: 'decide in-platform en legacy-backend; preapprovals-service no es central' },
    agregador: { nota: 'la API externa del lender decide: debería haber consulta al proveedor' },
    redirect: { nota: 'el desenlace es externo (UTM/redirect): puede no haber decisión en los logs' },
};

// ─── disparo automático al cerrar una corrida ───────────────────────────────────────────────────────

/**
 * La forma del veredicto de `trace.ts`, declarada estructuralmente en vez de importada a propósito:
 * `trace.ts` arrastra `db.ts` (driver de MySQL) y este módulo es HTTP puro. La dependencia iría al revés
 * de lo que conviene — el forense no debe poder romperse porque la BD no responde.
 */
export type VeredictoMin = { existe: boolean; ok: boolean; malo: boolean; miente: string[] };

/**
 * Lo llaman los dos runners DESPUÉS de `veredicto()`, y no cambia nada de él: si la corrida cerró bien,
 * ni consulta. Explicar un éxito no le sirve a nadie y cada corrida pagaría el settle + la query.
 *
 * Es best-effort de punta a punta: cualquier error se traga. Un forense que tumba la corrida que venía a
 * explicar es peor que no tenerlo.
 */
export async function forenseAlCerrar(
    ureq: number | string,
    v: VeredictoMin,
    opts: { ramal?: Ramal; ventanaMs?: number; pii?: boolean } = {},
): Promise<void> {
    const fallo = !v.existe || v.malo || v.miente.length > 0;
    const aMitad = v.existe && !v.ok && !v.malo;
    if (!fallo && !aMitad) return;                       // cerró como se pedía: no hay nada que explicar
    if (!ureq || Number(ureq) <= 0) return;

    const c = lokiConfig();
    const no = porQueNo(c);
    if (no) {
        console.log('');
        log(gray(`(sin forense de logs: ${no})`));
        return;
    }

    try {
        if (c.settleMs > 0) {
            // El aviso importa: 10s de silencio después del veredicto se leen como que el proceso se colgó.
            log(gray(`esperando ${Math.round(c.settleMs / 1000)}s el flush de logs antes de consultar Loki…`));
            await new Promise((r) => setTimeout(r, c.settleMs));
        }
        const { lineas, cobertura } = await forense(c, ureq, opts.ventanaMs ?? 2 * 3600_000);
        if (!lineas.length) {
            console.log('');
            log(gray(`(el forense no encontró logs para el uReq ${ureq}: `
                + `${cobertura.lineasConTexto} líneas lo mencionaban, ${cobertura.traces.length} traces anclados)`));
            return;
        }
        imprimirForense(resumir(String(ureq), lineas, cobertura), opts.ramal, { pii: opts.pii });
    } catch (e) {
        console.log('');
        log(gray(`(el forense de logs falló, y no afecta el veredicto: ${(e as Error).message.slice(0, 120)})`));
    }
}

// ─── render ─────────────────────────────────────────────────────────────────────────────────────────
//
// El renderer vive acá y no en el runner por la misma razón que `veredicto()` vive en trace.ts: si el
// camino rápido y el post-mortem imprimen distinto, comparar dos corridas deja de ser diagnóstico.

const useColor = process.env.FORCE_COLOR !== '0' && (!!process.stdout.isTTY || !!process.env.FORCE_COLOR);
const c = (code: string, s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = (s: string) => c('1', s);
const gray = (s: string) => c('90', s);
const red = (s: string) => c('31', s);
const yellow = (s: string) => c('33', s);
const green = (s: string) => c('32', s);

const log = (s = '') => console.log(s ? `  ▸ ${s}` : '');
const hora = (ms: number) => new Date(ms).toLocaleTimeString('es-CO', { hour12: false }) +
    '.' + String(ms % 1000).padStart(3, '0');
const dur = (ms: number) => (ms >= 10_000 ? `${(ms / 1000).toFixed(0)}s` : ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`);

/**
 * Imprime el bloque forense. NO decide nada: el veredicto es el de `trace.ts`. El orden está pensado
 * para leerse de arriba hacia abajo y parar cuando ya entendiste — primero QUÉ falló, después el
 * recorrido, y al final la cobertura con sus límites.
 */
export function imprimirForense(r: Resumen, ramal?: Ramal, opts: { pii?: boolean } = {}): void {
    console.log('');
    log(bold(`── FORENSE · uReq ${r.ureq} · Loki (legacy-backend) ──`));

    // Cédula y teléfono van enmascarados por default: contra producción esto es data de una persona
    // real, y un bloque forense termina pegado en un ticket o en una captura. El sidecar de .runs/
    // guarda el valor completo (es local y ya es el convenio para el volcado), y `--pii` lo muestra
    // acá cuando de verdad hace falta correlacionar a mano.
    const enmascarar = (v: string) => (v.length <= 6 ? v : `${v.slice(0, 3)}${'*'.repeat(v.length - 6)}${v.slice(-3)}`);
    // Por NOMBRE de clave y no por lista fija de campos: el mismo dato aparece como `documento` en la
    // cabecera y como `document_number` dentro del context de una falla. Enmascarar solo uno de los dos
    // es no enmascarar nada.
    // Las dos lenguas a propósito: las claves del context son en inglés (`document_number`, `cell_phone`)
    // y las de la cabecera que arma `resumir()` son en español (`documento`, `telefono`). Cubrir solo una
    // deja la mitad de los datos sensibles al aire — que es justo lo que pasó en la primera versión.
    const esSensible = (k: string) => /document|cedula|phone|cell|telefono|email|correo/i.test(k);
    const vista = (k: string, v: string) => (!opts.pii && esSensible(k) ? enmascarar(v) : v);
    // Los mensajes traen JSON multilínea (el 401 de un proveedor, por ejemplo) y eso rompe el bloque.
    const plano = (s: string, n: number) => s.replace(/\s+/g, ' ').trim().slice(0, n);

    const idPartes = Object.entries(r.identidad).map(([k, v]) => `${k} ${vista(k, v)}`);
    if (idPartes.length) log(`   ${idPartes.join(' · ')}${!opts.pii ? gray('   (--pii para ver cédula/teléfono)') : ''}`);
    if (ramal) log(gray(`   ramal ${ramal}: ${ESPERADO[ramal].nota}`));

    const niveles = Object.entries(r.porNivel).map(([k, v]) => `${k} ${v}`).join(' · ');
    log(gray(`   ${r.cobertura.lineas} líneas en ${r.cobertura.traces.length} traces · ${niveles}`));

    // ── FALLAS primero: es la razón por la que alguien abre esto ──
    if (r.fallas.length) {
        console.log('');
        log(red(bold(`── ${r.fallas.length} FALLA(S) ──`)));
        for (const f of r.fallas) {
            const rango = f.veces > 1 ? ` ${yellow(`×${f.veces}`)} (${hora(f.desde)} → ${hora(f.hasta)})` : ` (${hora(f.desde)})`;
            const cod = f.code + (f.sub ? `/${f.sub}` : '');
            log(`   ${red(cod)}${rango}`);
            log(gray(`      ${plano(f.msg, 130)}`));
            const ctx = Object.entries(f.ctx).filter(([k]) => !/^(user_request_id|user_id)$/.test(k));
            if (ctx.length) log(gray(`      ${plano(ctx.map(([k, v]) => `${k}=${vista(k, String(v))}`).join(' '), 160)}`));
        }
    } else {
        console.log('');
        log(green('── sin fallas en los logs de esta solicitud ──'));
    }

    // ── decisiones por entidad: la cascada que la BD no muestra ──
    if (r.entidades.length) {
        console.log('');
        log(bold(`── ${r.entidades.length} ENTIDAD(ES) EVALUADA(S) ──`));
        for (const e of r.entidades) {
            const res = e.result === 'aprobado' ? green(e.result) : e.result ? yellow(e.result) : gray('(sin veredicto)');
            const cat = e.categoriasRechazadas.length
                ? gray(`  ${e.categoriasRechazadas.length} categoría(s) rechazada(s): regla ${e.categoriasRechazadas.join(', ')}`)
                : '';
            log(`   ${String(e.lenderId).padStart(4)} ${(e.nombre ?? '?').slice(0, 38).padEnd(38)} regla ${String(e.ruleId ?? '—').padEnd(6)} ${res}${cat}`);
        }
    }

    // ── recorrido del backend: un renglón por paso, no las 3-6 líneas ceremoniales ──
    if (r.pasos.length) {
        console.log('');
        log(bold('── RECORRIDO (backend) ──'));
        for (const p of r.pasos) {
            const err = p.error ? red(`  ← ${p.error}`) : '';
            log(`   ${hora(p.ts)}  ${p.nombre.slice(0, 52).padEnd(52)} ${gray(`${p.lineas} líneas`)}${err}`);
        }
    }

    // ── tramos: los huecos son el usuario mirando una pantalla ──
    if (r.tramos.length > 1) {
        console.log('');
        log(bold('── TRAMOS (una petición HTTP cada uno) ──'));
        for (const t of r.tramos) {
            const hueco = t.huecoMs > 3000 ? yellow(`  +${dur(t.huecoMs)} de silencio antes`) : '';
            log(gray(`   ${hora(t.ts)}  ${t.traceId.slice(0, 12)}…  ${String(t.lineas).padStart(3)} líneas  ${dur(t.durMs).padStart(6)}`) + hueco);
        }
    }

    // ── cobertura: lo que NO se puede probar, dicho ──
    console.log('');
    log(bold('── COBERTURA (leer antes de concluir de una ausencia) ──'));
    log(gray(`   ${r.cobertura.lineasConTexto} líneas mencionaban «${r.ureq}» → ${r.cobertura.traces.length} traces anclados → ${r.cobertura.lineas} líneas`));
    const campos = [...new Set(Object.values(r.cobertura.anclas).flat())];
    log(gray(`   anclado por: ${campos.join(', ') || '(ninguno)'}`));

    // Dev y staging comparten stack Y base de datos: si el mismo uReq tiene líneas de dos ambientes, eso
    // NO es ruido — es que dos ramas de código tocaron la misma solicitud, y hay que saberlo.
    const amb = Object.entries(r.cobertura.ambientes);
    log(gray(`   ambientes: ${amb.map(([k, v]) => `${k} ${v}`).join(' · ') || '(ninguno)'}` +
        (r.cobertura.filtroEnv ? `  · filtro E2E_LOKI_ENV=${r.cobertura.filtroEnv}` : '  · sin filtro')));
    const fuera = amb.filter(([k]) => r.cobertura.filtroEnv && !new RegExp(`^(?:${r.cobertura.filtroEnv})$`).test(k));
    if (fuera.length) {
        log(yellow(`   ⚠ este uReq TAMBIÉN tiene líneas en ${fuera.map(([k, v]) => `${k} (${v})`).join(', ')} — `
            + 'dev y staging comparten la BD, así que lo tocaron dos ramas de código. Filtradas acá.'));
    } else if (amb.length > 1 && !r.cobertura.filtroEnv) {
        log(yellow('   ⚠ hay más de un ambiente y no hay filtro: estás mirando dos ramas de código mezcladas. '
            + 'Definí E2E_LOKI_ENV para este target.'));
    }
    if (r.cobertura.porVentana) {
        log(yellow('   ⚠ CORRELACIÓN POR VENTANA DE TIEMPO, no por uReq: ninguna línea nombra la solicitud,'));
        log(yellow(`     así que esto es TODO lo que se logueó en esos minutos. Vale porque el Loki es local`));
        log(yellow('     y sos el único que escribe; en un Loki compartido serían corridas ajenas.'));
    } else if (r.cobertura.degradado) {
        log(yellow('   ⚠ MODO DEGRADADO: estas líneas NO tienen trace_id, así que no se pudo expandir — solo'));
        log(yellow('     ves las que nombran el uReq, no la petición completa. Falta Tempo/OTel en el backend'));
        log(yellow('     que las emitió (sin GRAFANA_TEMPO_ENDPOINT no se inicializa y el trace nunca entra).'));
    }
    log(gray('   ⚠ solo legacy-backend: el trace_id no se propaga a otros servicios (los Go no lo emiten).'));
    log(gray('   ⚠ solo se ven traces con al menos una línea que traiga el uReq; los demás son invisibles'));
    log(gray('     y no se pueden contar. Una ausencia acá NO prueba que no pasó.'));
}
