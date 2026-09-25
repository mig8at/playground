// trace.ts — traza CONTRASTADA frontend ↔ base de datos.
//
// POR QUÉ EXISTE:
//   El navegador muestra la PRETENSIÓN del flujo; la BD tiene lo que realmente pasó. Toda la clase de
//   bugs más cara de esta sesión vive exactamente en esa brecha: la uReq 464498 recorrió Ábaco entero,
//   llegó a una pantalla de éxito y estaba CANCELADA en la BD (findings F-50). Un log que solo dice
//   `nav → /loan-approved` no distingue eso de un cierre real.
//
//   Acá cada navegación del wizard se acompaña del estado REAL de la solicitud en ese instante, y se
//   marca cuándo la BD se movió y cuándo no. Un tramo largo de pantallas sin una sola transición de
//   estado es la firma de un flujo que avanza en pantalla sin persistir nada.
//
// DISEÑO:
//   · Una sola query por paso (local ~2-5ms). Serializada en una cadena de promesas para que las
//     líneas salgan EN ORDEN — `framenavigated` es sync y dispararla suelta mezclaba la salida.
//   · Best-effort: si la BD falla, la traza se degrada a "—" y NUNCA tumba la corrida.
//   · La solicitud todavía no existe en los primeros pasos: eso se muestra, no se oculta.
//
// ⚠ POR QUÉ HAY INSTANCIAS Y NO ESTADO DE MÓDULO (2026-09-03):
//   Hasta hoy el estado (`uReq`, contador, alertas, la cola) vivía en el módulo, o sea UNA traza por
//   proceso. Correcto para los tres runners que la usaban —cada uno sigue UNA solicitud— y **roto** para
//   cualquier corrida en PARALELO: N casos compartirían contador, alertas y cola, y la salida saldría
//   entrelazada con el `uReq` del último que llamó. Se descubrió construyendo `dev/walk-wizard.ts`,
//   que por eso arrancó con su propia copia de esta lógica — exactamente la duplicación que
//   `harness/CLAUDE.md` prohíbe («tener dos definiciones de pasó es como empiezan a derivar»).
//
//   Ahora: `createTrace()` devuelve una instancia con su propio estado, y las funciones de módulo
//   (`paso`, `traceUReq`, `resumen`, `veredicto`, `drenar`) siguen existiendo como delegación a UNA
//   instancia por defecto. No son dos implementaciones: es la misma clase, invocada de dos maneras. Los
//   runners de un caso no cambian una línea; los paralelos piden una instancia por caso.
//
//   Y la instancia acepta `salida`: en paralelo, cada caso ACUMULA sus líneas y las imprime juntas al
//   terminar. Escribir a consola desde N casos a la vez produce un log que no se puede leer.

import { one } from './db.ts';

const useColor = process.env.FORCE_COLOR !== '0' && (!!process.stdout.isTTY || !!process.env.FORCE_COLOR);
const c = (code: string, s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const green = (s: string) => c('32', s);
const red = (s: string) => c('31', s);
const yellow = (s: string) => c('33', s);
const gray = (s: string) => c('90', s);
const bold = (s: string) => c('1', s);

/** Estados que sellan un desenlace: llegar acá es el objetivo. */
const SEALED = new Set([11, 28]);
/** Estados de muerte: llegar acá sin pedirlo es un fallo, no un matiz. */
const BAD = new Set([6, 8]);
/** Rutas que el front presenta como éxito — si la BD no acompaña, es F-50. */
const SUCCESS_PATH = /loan-approved|credito-aprobado|solicitud-aprobada/i;

type Snap = { st: number | null; estado: string | null; lender: string | null; ctpx: number };
type Step = { n: number; ventana: string; ruta: string; st: number | null; estado: string | null; cambio: boolean };

export type Verdict = {
    existe: boolean;
    st: number | null;
    estado: string | null;
    lender: string | null;
    ok: boolean;        // llegó exactamente al estado pedido
    malo: boolean;      // desenlace de muerte sin haberlo pedido
    miente: string[];   // el front afirmó éxito sin respaldo en la BD (F-50)
};

/**
 * Estado esperado según el desenlace pedido (E2E_RESULT). Mismo mapa en los dos caminos.
 *
 * `facturacion` = el desenlace del canal QR / Corbeta, y es una excepción que hay que entender:
 * **ese flujo NUNCA llega al 11**. BNPL/Consumo devuelven `PENDIENTE DESEMBOLSO`/`pendiente`, el
 * controller sella **25 «Pendiente de facturación»** para los allieds de `Setting('corbeta_allieds')`
 * y ahí se emite el código de compra. El desembolso ocurre DESPUÉS y por afuera: el cliente factura en
 * la caja y los crons de conciliación de `application` mueven la solicitud a **26 (Facturado)**.
 * Se agrega acá —y no en un veredicto propio del runner— porque la regla de la casa es que "pasó"
 * tenga UNA sola definición: dos definiciones es como los dos caminos empiezan a derivar.
 */
export const EXPECTED_STATUS: Record<string, number> = { success: 11, rejected: 6, pending: 10, facturacion: 25 };

export type TraceOpts = {
    /** A dónde van las líneas. Por defecto a consola; en paralelo, al buffer del caso. */
    salida?: (linea: string) => void;
    /** Prefijo para distinguir de quién es la línea cuando varias trazas comparten salida. */
    prefijo?: string;
    /** Ancho de la columna izquierda (paso + ventana + ruta) antes del `│ BD`. El default sirve para
     *  el runner visual, cuyas rutas son cortas; el de endpoints camina rutas con flujo, hash y query,
     *  y con 54 la columna se desalinea. */
    ancho?: number;
};

/** UNA traza: una solicitud, su contador, sus alertas y su cola. Instanciá una por caso. */
/** Lo que se sabe de un paso al registrarlo: lo lee la tarjeta flotante del harness en el wizard. */
export type StepInfo = {
    n: number; window: string; path: string;
    st: number | null; estado: string | null; cambio: boolean;
    /** La alerta de ESTE paso (desenlace malo, éxito sin respaldo en BD), si hubo. */
    alerta?: string;
    /** No hay solicitud todavía, o la solicitud no está en la BD. */
    sinSolicitud?: boolean;
};

export class Trace {
    private uReq = 0;
    private listener: ((s: StepInfo) => void) | null = null;
    private n = 0;
    private previo: Snap | null = null;
    private readonly linea: Step[] = [];
    /** Las alertas en caliente. Las lee `veredicto()` para el patrón F-50. */
    readonly alertas: string[] = [];
    private cola: Promise<void> = Promise.resolve();
    private readonly salida: (l: string) => void;
    private readonly prefijo: string;
    private readonly ancho: number;

    constructor(opts: TraceOpts = {}) {
        this.salida = opts.salida ?? ((l) => console.log(l));
        this.prefijo = opts.prefijo ?? '';
        this.ancho = opts.ancho ?? (useColor ? 62 : 54);
    }

    /** Cuántos pasos lleva registrados (ya drenados o no). */
    get pasos(): number { return this.n; }
    /** La solicitud que está siguiendo, o 0 si todavía no apareció. */
    get solicitud(): number { return this.uReq; }

    private log(s: string): void { this.salida(s ? `  ▸ ${this.prefijo}${s}` : ''); }

    trazarUReq(id: number | string): void {
        const v = Number(id);
        if (v && v !== this.uReq) {
            this.uReq = v;
            this.log(gray(`traza: a partir de acá cada paso se contrasta contra la BD (uReq ${v})`));
        }
    }

    private async snap(): Promise<Snap | null> {
        if (!this.uReq) return null;
        try {
            const r = await one<Snap>(
                `SELECT ur.user_request_status_id AS st, s.name AS estado, l.name AS lender,
                        (SELECT COUNT(*) FROM creditop_x_user_requests_records x WHERE x.user_request_id = ur.id) AS ctpx
                   FROM user_requests ur
                   LEFT JOIN user_request_statuses s ON s.id = ur.user_request_status_id
                   LEFT JOIN lenders l ON l.id = ur.lender_id
                  WHERE ur.id = ?`, [this.uReq]);
            return r ? { ...r, ctpx: Number(r.ctpx) || 0 } : null;
        } catch {
            return null;   // la traza es un extra: nunca frena la corrida
        }
    }

    /** Quien quiere enterarse de cada paso (la tarjeta del wizard). Se llama ANTES del screenshot, así la
     *  tarjeta ya dice el paso cuando se esconde para la foto. Un error de quien escucha no rompe la traza. */
    onStep(fn: ((s: StepInfo) => void) | null): void { this.listener = fn; }
    private notify(s: StepInfo): void { try { this.listener?.(s); } catch { /* la traza no depende de esto */ } }

    /** Registra una navegación y la contrasta con la BD. Se llama desde `framenavigated`; no hay que await-earla.
     *  `foto` (opcional, solo el runner visual): saca el screenshot DENTRO de la cola —así la línea 📸 sale
     *  pegada a SU navegación y no mezclada— y devuelve el nombre del archivo, o null si no pudo.
     *  `sufijo` (opcional): se pega al final de la línea. Lo usan los runners que además tienen algo que
     *  decir de ESE paso (el HTTP y el tiempo, en el caminador por endpoints). */
    paso(window: string, path: string, snapshot?: (n: number) => Promise<string | null>, suffix?: string): void {
        this.cola = this.cola.then(async () => {
            this.n += 1;
            const n = this.n;
            const s = await this.snap();
            const idx = String(n).padStart(2, '0');
            // `ventana` vacía es legítima (el runner de endpoints no tiene A/B): sin esto queda un
            // espacio doble en cada línea.
            const left = `${idx} ${window ? `${bold(window)} ` : ''}${path}`.padEnd(this.ancho);
            const queue = suffix ? `   ${gray(suffix)}` : '';
            const snapshot_ = async () => {
                if (!snapshot) return;
                const f = await snapshot(n).catch(() => null);
                this.log(f ? `     📸 ${f}` : red(`     📸 ✗ (el screenshot del paso ${n} falló)`));
            };

            if (!this.uReq) {
                this.log(`${left}${gray('│ BD  —  (sin solicitud todavía)')}${queue}`);
                this.linea.push({ n, ventana: window, ruta: path, st: null, estado: null, cambio: false });
                this.notify({ n, window, path, st: null, estado: null, cambio: false, sinSolicitud: true });
                await snapshot_();
                return;
            }
            if (!s) {
                this.log(`${left}${red('│ BD  ✗ la solicitud no está en la BD')}${queue}`);
                this.linea.push({ n, ventana: window, ruta: path, st: null, estado: null, cambio: false });
                this.notify({ n, window, path, st: null, estado: null, cambio: false, sinSolicitud: true, alerta: 'la solicitud no está en la BD' });
                await snapshot_();
                return;
            }

            const change = !this.previo || this.previo.st !== s.st;
            const label = `${s.st} «${s.estado ?? '?'}»`;
            let der: string;
            if (!this.previo) der = `│ BD  ${label}`;
            else if (change) der = `│ BD  ${green(`${this.previo.st} → ${label}`)}  ▲`;
            else der = gray(`│ BD  ${label}`);

            // ── detectores en caliente (no esperan al final) ──
            let stepAlert: string | undefined;
            if (s.st !== null && BAD.has(s.st) && (!this.previo || !BAD.has(this.previo.st ?? -1))) {
                this.alertas.push(`la solicitud pasó a estado ${s.st} «${s.estado}» en el paso ${n} (${window} ${path})`);
                der += red('  ← DESENLACE MALO');
                stepAlert = `desenlace malo: la solicitud pasó a ${s.st} «${s.estado}»`;
            }
            if (SUCCESS_PATH.test(path) && s.st !== null && !SEALED.has(s.st)) {
                this.alertas.push(`pantalla de ÉXITO (${path}) con la BD en estado ${s.st} «${s.estado}» — el front miente (ver F-50)`);
                der += red('  ← ÉXITO SIN RESPALDO EN BD');
                stepAlert = `éxito sin respaldo en BD: la pantalla dice éxito y la solicitud está en ${s.st} «${s.estado}»`;
            }
            this.notify({ n, window, path, st: s.st, estado: s.estado ?? null, cambio: change && !!this.previo, alerta: stepAlert });

            this.log(`${left}${der}${queue}`);
            this.linea.push({ n, ventana: window, ruta: path, st: s.st, estado: s.estado, cambio: change });
            this.previo = s;
            await snapshot_();
        }).catch(() => { /* nunca romper la corrida por la traza */ });
    }

    /** Espera a que la cola de trazas termine (antes de imprimir el resumen). */
    async drenar(): Promise<void> { await this.cola; }

    /** Resumen final: solo las TRANSICIONES + los tramos ciegos + las alertas. */
    async resumen(): Promise<{ alertas: string[]; transiciones: number }> {
        await this.drenar();
        const trans = this.linea.filter((p) => p.cambio);
        this.salida('');
        this.log(bold('── TRAZA CONTRASTADA · resumen ──'));
        this.log(`   ${this.linea.length} pasos de front · ${trans.length} transiciones de estado en BD`);

        if (trans.length) {
            for (const t of trans) this.log(`   ${String(t.n).padStart(2, '0')} ${t.ventana} ${t.ruta}  ⇒  ${t.st} «${t.estado}»`);
        } else if (this.uReq) {
            this.log(yellow('   ⚠ ninguna transición: el flujo avanzó en pantalla sin mover la BD'));
        }

        // Tramo ciego = pantallas seguidas sin ninguna transición. Un tramo largo suele ser un flujo que
        // "se ve bien" pero no persiste, o un muro donde el usuario da vueltas.
        let streak = 0, worst = 0, worstSince = '';
        for (const p of this.linea) {
            if (p.cambio) { streak = 0; continue; }
            streak += 1;
            if (streak > worst) { worst = streak; worstSince = p.ruta; }
        }
        if (worst >= 5) this.log(yellow(`   ⚠ tramo ciego más largo: ${worst} pantallas sin transición (hasta ${worstSince})`));

        if (this.alertas.length) {
            this.salida('');
            this.log(red(bold(`── ${this.alertas.length} ALERTA(S) ──`)));
            for (const a of this.alertas) this.log(red(`   ✗ ${a}`));
        }
        return { alertas: this.alertas, transiciones: trans.length };
    }

    /**
     * VEREDICTO — la única definición de "pasó", compartida por el camino RÁPIDO (dev/sweep.ts), el
     * VISUAL (dev/guided.spec.ts) y el de endpoints (dev/walk-wizard.ts). Que todos afirmen lo mismo
     * es lo que hace que una divergencia entre ellos sea informativa: mismas aserciones + distinto
     * transporte ⇒ la diferencia ES el frontend.
     *
     * No lanza ni falla: imprime y devuelve. Cada camino decide cómo señalar el fallo (expect / exit code).
     */
    async veredicto(uReqID: number | string, result = 'success'): Promise<Verdict> {
        await this.drenar();
        const id = Number(uReqID);
        const expected = EXPECTED_STATUS[result] ?? 11;
        const empty: Verdict = { existe: false, st: null, estado: null, lender: null, ok: false, malo: false, miente: [] };

        const r = await one<{ id: number; st: number; estado: string | null; lender: string | null }>(
            `SELECT ur.id, ur.user_request_status_id AS st, s.name AS estado, l.name AS lender
               FROM user_requests ur
               LEFT JOIN user_request_statuses s ON s.id = ur.user_request_status_id
               LEFT JOIN lenders l ON l.id = ur.lender_id
              WHERE ur.id = ?`, [id]).catch(() => null);

        this.salida('');
        if (!r) {
            this.log(yellow(`⚠ VEREDICTO: la uReq ${id} no está en la BD (¿la borró un scrub posterior? ver .runs/)`));
            return empty;
        }

        const ok = r.st === expected;
        const badOne = BAD.has(r.st) && !(result === 'rejected' && r.st === 6);
        const lies = this.alertas.filter((a) => /éxito/i.test(a));

        this.log(bold('── VEREDICTO (BD, no navegador) ──'));
        this.log(`   uReq ${r.id} · lender ${r.lender ?? '?'} · estado ${r.st} «${r.estado ?? '?'}»`);
        this.log(`   esperado para result=${result}: ${expected} · ${ok ? green('✓ coincide') : red('✗ NO coincide')}`);
        if (badOne) this.log(red(`   ✗ desenlace de muerte: la solicitud terminó en «${r.estado}»`));
        else if (!ok) this.log(gray('   (a mitad de flujo — legítimo si cortaste el guiado a mano)'));

        return { existe: true, st: r.st, estado: r.estado, lender: r.lender, ok, malo: badOne, miente: lies };
    }
}

/** Una traza nueva, con su propio estado. Es lo que piden los runners que corren varios casos a la vez. */
export function createTrace(opts: TraceOpts = {}): Trace { return new Trace(opts); }

// ─── la instancia POR DEFECTO, para los runners de un solo caso ─────────────────────────────────
// No es una segunda implementación: es esta misma clase con una instancia compartida por el proceso.
// `dev/guided.spec.ts`, `dev/sweep.ts` y `dev/qr-corbeta.ts` siguen un solo flujo cada uno, así que
// para ellos el estado de proceso es correcto y no tienen que cambiar nada.
const byDefault = new Trace();

export const traceUReq = (id: number | string): void => byDefault.trazarUReq(id);
export const step = (window: string, path: string, snapshot?: (n: number) => Promise<string | null>, suffix?: string): void =>
    byDefault.paso(window, path, snapshot, suffix);
export const drain = (): Promise<void> => byDefault.drenar();
export const onStep = (fn: ((s: StepInfo) => void) | null): void => byDefault.onStep(fn);
export const summary = (): Promise<{ alertas: string[]; transiciones: number }> => byDefault.resumen();
export const verdict = (uReqID: number | string, result = 'success'): Promise<Verdict> =>
    byDefault.veredicto(uReqID, result);
/** Las alertas de la traza por defecto (mismo array, no una copia). */
export const alerts = byDefault.alertas;
