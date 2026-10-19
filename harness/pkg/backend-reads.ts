// backend-reads.ts — las lecturas de la base de legacy-backend que una prueba necesita a mano, listas como funciones.
//
// No consultan la base desde acá: llaman al conector (`bin/pg … --json`), que es el único que sabe hablar con cada ambiente
// (MySQL directo, o Redash en prod), sólo deja leer y no acepta argumentos que no sean dígitos. Así una consulta vive en un
// solo lugar y se usa igual desde la consola, desde un runner y desde el modelo. Todas son de SÓLO LECTURA; `otpLast` además
// no corre contra producción.
//
//   clientState(doc)        el cliente activo de una cédula, sus bajas (-t<n>), solicitudes, centrales y quién decidió el nombre
//   clientFields(...)       los campos guardados del cliente con su nombre (situación laboral 29, ingreso 87, reportes negativos 160…)
//   requestTimeline(ureq)   los estados por los que pasó una solicitud, cuándo y quién la movió
//   experianCheck(hash)     si una sucursal va a consultar Experian y por qué (atajos, periodicidad, confirmación de cupo)
//   settingsDiff(targets)   en qué difieren las settings entre ambientes (las credenciales sólo se comparan por huella)
//   jobsFailed(hours)       los trabajos en cola que fallaron en una ventana, agrupados por clase y error
//   otpLast(phone)          los últimos OTP de un celular: si se mandaron, si se validaron y si fueron por el bypass de QA
import { runPg, lastLine } from './pg.ts';

export type Target = 'local' | 'dev' | 'qa' | 'staging' | 'prod';
type Row = Record<string, unknown>;

/** Corre `pg <args> --json` y devuelve el JSON; si el conector falla, tira con su mensaje de una línea. */
function pgJson<T>(args: string[]): T {
    const r = runPg([...args, '--json']);
    if (r.status !== 0) throw new Error(`pg ${args.slice(0, 2).join(' ')}: ${lastLine(r.stderr || r.stdout) || `salió ${r.status}`}`);
    try { return JSON.parse(r.stdout) as T; }
    catch { throw new Error(`pg ${args.slice(0, 2).join(' ')}: no devolvió JSON (${r.stdout.slice(0, 120)})`); }
}

export interface ClientState {
    target: string; source: string; document: string;
    accounts: Row[]; active?: Row; requests?: Row[]; centrals?: Row[]; nameChecks?: Row[]; notes?: string[];
}
/** El estado de una cédula. `active` falta si no hay cliente activo: el próximo registro crea uno y consulta las centrales. */
export function clientState(target: Target, document: string): ClientState {
    return pgJson<ClientState>(['client', 'state', '--target', target, '--document', document]);
}

/** Los campos del cliente activo de una cédula, o los de una solicitud. `fields` filtra por id de campo. */
export function clientFields(target: Target, who: { document: string } | { ureq: number }, fields: number[] = []): { userId: number; fields: Row[] } {
    const by = 'document' in who ? ['--document', who.document] : ['--ureq', String(who.ureq)];
    return pgJson(['client', 'fields', '--target', target, ...by, ...(fields.length ? ['--fields', fields.join(',')] : [])]);
}

/** La solicitud (comercio, entidad, flujo, estado de hoy) y su historial de estados en orden. */
export function requestTimeline(target: Target, ureq: number): { request: Row; records: Row[] } {
    return pgJson(['request', 'timeline', '--target', target, '--ureq', String(ureq)]);
}

export interface ExperianCheck { branch: Row; lenders: Row[]; verdict: string; why: string; caveats: string[]; frequency?: Row; count?: number }
/** Si la sucursal consulta Experian: `verdict` es SIEMPRE, NUNCA, NO o PASA LA PERIODICIDAD, y `why` dice por qué. */
export function experianCheck(target: Target, branchHash: string): ExperianCheck {
    return pgJson<ExperianCheck>(['experian', 'check', '--target', target, '--hash', branchHash]);
}

export interface SettingDiff { key: string; differs: boolean; values: Record<string, { value?: string; hash?: string; sensitive?: boolean }> }
/** Las settings que difieren entre ambientes (o todas, con `all`). Un ambiente sin la clave no aparece en `values`. */
export function settingsDiff(targets: Target[], opts: { key?: string; all?: boolean } = {}): SettingDiff[] {
    return pgJson<SettingDiff[]>(['settings', 'diff', '--targets', targets.join(','), ...(opts.key ? ['--key', opts.key] : []), ...(opts.all ? ['--all'] : [])]);
}

/** Los trabajos fallidos de la ventana, agrupados: `job`, `queue`, `error` (primera línea), `n` y `last`. */
export function jobsFailed(target: Target, hours = 24, limit = 20): { groups: Row[] } {
    return pgJson(['jobs', 'failed', '--target', target, '--hours', String(hours), '--limit', String(limit)]);
}

/** Los últimos OTP de un celular (el código va cifrado; sirve el estado: `validated`, `qa_bypass`). Nunca en prod. */
export function otpLast(target: Exclude<Target, 'prod'>, phone: string, limit = 3): { codes: Row[] } {
    if ((target as string) === 'prod') throw new Error('otpLast no lee producción');
    return pgJson(['otp', 'last', '--target', target, '--phone', phone, '--limit', String(limit)]);
}
