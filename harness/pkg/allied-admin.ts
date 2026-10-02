import { AdminClient, alliedIdFromLocation } from './admin-http.ts';
import { exec, query, withSeedScope } from './db.ts';
import { TEST_ADVISOR_EMAIL, findTestAdvisor, type TestAdvisor } from './login-probe.ts';

/**
 * Crear un COMERCIO de prueba por el admin real, y desarmarlo después.
 *
 * El alta del admin ya crea sola la sucursal y el asesor de prueba (y su cuenta en el pool de Cognito); esto
 * sólo hace lo que haría una persona con el formulario, y devuelve lo que el admin le mostró. Es la API que
 * usan `dev/allied-create.ts` (la consola) y quien quiera simular el alta desde otro runner.
 *
 * ⚠ EL ALTA ESCRIBE. En dev crea el comercio en la base COMPARTIDA con qa y staging, y sube una imagen al
 * bucket del admin: es lo mismo que hacer el alta a mano. Por eso lleva un prefijo propio en el nombre
 * (`AUTO_PREFIX`), y es lo único que el borrado reconoce.
 */

/** El nombre de todo comercio que crea la automatización. El permiso angosto de borrado exige este prefijo. */
export const AUTO_PREFIX = 'PRUEBA AUTO';

/** Un PNG válido de 1×1: el admin exige imagen (`image|mimes:png,jpg,jpeg,bmp`) y no importa cuál. */
export const ONE_PIXEL_PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
);

/** `PRUEBA AUTO 1002-130512`: único por segundo, legible y con el prefijo. */
export function autoName(now: Date = new Date()): string {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${AUTO_PREFIX} ${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
}

/** Las opciones de un selector llegan de dos formas: `{id, name}` y `{value, title}` (los selectores de Vuetify, como el país). */
type Option = { id?: number; value?: number; name?: string; title?: string };
const idOf = (o: Option): number => Number(o.id ?? o.value);

/** El valor que pide el formulario: el pedido, y si no, el preferido (Colombia = 47) o el primero que haya. */
export function pickOption(options: Option[] | undefined, wanted?: number, preferred?: number): number {
    const ids = (options ?? []).map(idOf).filter((n) => Number.isFinite(n));
    if (!ids.length) throw new Error('el formulario del admin no trajo opciones para un campo obligatorio');
    if (wanted !== undefined) {
        if (!ids.includes(wanted)) throw new Error(`la opción ${wanted} no existe en el formulario (hay: ${ids.join(', ')})`);
        return wanted;
    }
    return preferred !== undefined && ids.includes(preferred) ? preferred : ids[0];
}

/** Lo que el admin muestra tras el alta: el asesor de prueba y qué pasó con su cuenta de Cognito. */
export interface TestAdvisorFlash {
    created: boolean;
    existed: boolean;
    /** `created` · `already_exists` · `skipped` (ambiente sin pool) · `failed`. */
    cognito: 'created' | 'already_exists' | 'skipped' | 'failed' | string;
    email: string | null;
    /** `true` si la clave es la compartida del ambiente (no se muestra). */
    passwordFixed: boolean;
    branchName: string | null;
    notes: string[];
}

export function flashOf(props: Record<string, any> | undefined): TestAdvisorFlash | null {
    const f = props?.testAdvisor;
    if (!f || typeof f !== 'object') return null;
    return {
        created: !!f.created, existed: !!f.existed, cognito: String(f.cognito ?? ''), email: f.email ?? null,
        passwordFixed: !!f.passwordFixed, branchName: f.branchName ?? null, notes: Array.isArray(f.notes) ? f.notes.map(String) : [],
    };
}

export interface CreateOptions {
    name?: string;
    typeId?: number;
    industryId?: number;
    countryId?: number;
    price?: number;
}

export interface CreatedAllied {
    id: number;
    name: string;
    /** Lo que el admin mostró del asesor de prueba. `null` si no mostró nada (versión sin la función). */
    flash: TestAdvisorFlash | null;
    ms: number;
}

/** Los errores de validación que dejó el admin en la sesión, en una línea. */
function errorsOf(props: Record<string, any> | undefined): string {
    const e = props?.errors;
    if (!e || typeof e !== 'object') return '';
    return Object.entries(e).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(' ') : v}`).join(' · ');
}

/** Crea el comercio por el formulario del admin. Lanza si el admin no lo acepta, diciendo por qué. */
export async function createAllied(client: AdminClient, opts: CreateOptions = {}): Promise<CreatedAllied> {
    const started = Date.now();
    const name = opts.name ?? autoName();
    if (!name.startsWith(AUTO_PREFIX)) throw new Error(`el nombre del comercio de prueba tiene que empezar por «${AUTO_PREFIX}»: es lo que permite borrarlo después sin riesgo`);

    const form = await client.get('/aliados/crear');
    const settings = form.page?.props?.settings;
    if (!settings) throw new Error(`el formulario de alta no trajo sus opciones (HTTP ${form.status}, ¿cambió la pantalla?)`);

    const body = new FormData();
    body.append('name', name);
    body.append('description', 'Comercio de prueba creado por la automatización del harness');
    body.append('allied_type_id', String(pickOption(settings.alliedTypes, opts.typeId)));
    body.append('allied_industry_id', String(pickOption(settings.alliedIndustries, opts.industryId)));
    body.append('country_id', String(pickOption(settings.countries, opts.countryId, 47)));
    body.append('price', String(opts.price ?? 1_000_000));
    body.append('image', new Blob([new Uint8Array(ONE_PIXEL_PNG)], { type: 'image/png' }), 'prueba.png');

    const posted = await client.postForm('/aliados', body, '/aliados/crear');
    if (posted.status === 419) throw new Error('el admin rechazó el token CSRF (HTTP 419): la sesión caducó o la cookie XSRF no viajó');
    if (!posted.location) throw new Error(`el alta no redirigió (HTTP ${posted.status}): el admin no la aceptó`);

    // Si volvió al formulario, hubo errores de validación: están en la página a la que redirige.
    if (/\/aliados\/crear/.test(posted.location)) {
        const back = await client.follow(posted.location);
        throw new Error(`el admin rechazó el formulario: ${errorsOf(back.page?.props) || 'sin detalle'}`);
    }

    const id = alliedIdFromLocation(posted.location);
    if (!id) throw new Error(`el alta redirigió a ${posted.location} y no pude sacar el id del comercio`);

    // El flash del asesor de prueba vive en la sesión y sale en la página a la que redirige el alta, una sola vez.
    const landing = await client.follow(posted.location);
    return { id, name, flash: flashOf(landing.page?.props), ms: Date.now() - started };
}

export interface VerifiedAdvisor {
    advisor: TestAdvisor | null;
    /** Qué sigue mal, en cristiano. Vacío si todo está como debe. */
    problems: string[];
}

/**
 * ¿Quedó el asesor de prueba como debe, leído de la BASE y no de lo que dijo la pantalla?
 * `needsCognito`: en un ambiente con pool (todo menos local) la fila tiene que traer `cognito_id`.
 */
export async function verifyAdvisor(alliedId: number, needsCognito: boolean): Promise<VerifiedAdvisor> {
    const advisor = await findTestAdvisor(alliedId);
    const problems: string[] = [];
    if (!advisor) problems.push('el comercio no tiene asesor de prueba en la base');
    else {
        if (!advisor.branchHash) problems.push('el asesor no quedó ligado a una sucursal');
        if (needsCognito && !advisor.hasSub) problems.push('el asesor existe pero su fila no tiene cognito_id');
    }
    return { advisor, problems };
}

export interface CleanupResult {
    allied: number;
    /** Correos de las cuentas del pool que hay que borrar aparte (el pool no es la base). */
    emails: string[];
    deleted: { roles: number; users: number; branches: number; allieds: number };
}

/**
 * Borra el comercio de prueba, su sucursal y su asesor, por id exacto. NO toca nada que no sea de la prueba:
 *  · el comercio tiene que llevar el prefijo de la automatización (lo exigen también la sentencia y su permiso);
 *  · si tiene solicitudes, usuarios ajenos o más de una sucursal «normal», NO se borra y se dice por qué;
 *  · el borrado de personas va dentro del ámbito del asesor encontrado, como el resto del harness.
 */
export async function cleanupAllied(alliedId: number): Promise<CleanupResult> {
    const allied = (await query<{ id: number; name: string }>('SELECT id, name FROM allieds WHERE id = ?', [alliedId]))[0];
    if (!allied) throw new Error(`el comercio ${alliedId} no existe`);
    if (!allied.name.startsWith(AUTO_PREFIX)) throw new Error(`el comercio ${alliedId} («${allied.name}») no lo creó la automatización: no se borra`);

    const users = await query<{ id: number; email: string }>('SELECT id, email FROM users WHERE allied_id = ?', [alliedId]);
    const foreign = users.filter((u) => !TEST_ADVISOR_EMAIL.test(u.email));
    if (foreign.length) throw new Error(`el comercio ${alliedId} tiene usuarios que no son de prueba (${foreign.map((u) => u.id).join(', ')}): no se borra`);

    const requests = Number((await query<{ n: number }>('SELECT COUNT(*) AS n FROM user_requests WHERE allied_id = ?', [alliedId]))[0]?.n ?? 0);
    if (requests > 0) throw new Error(`el comercio ${alliedId} tiene ${requests} solicitud(es): no se borra`);

    const branches = await query<{ id: number; name: string }>('SELECT id, name FROM allied_branches WHERE allied_id = ?', [alliedId]);
    const odd = branches.filter((b) => !/^b.*-fake$/.test(b.name));
    if (odd.length) throw new Error(`el comercio ${alliedId} tiene sucursales que no son de prueba (${odd.map((b) => b.id).join(', ')}): no se borra`);

    const deleted = { roles: 0, users: 0, branches: 0, allieds: 0 };
    for (const u of users) {
        await withSeedScope([u.id], async () => {
            deleted.roles += (await exec("DELETE FROM model_has_roles WHERE model_type LIKE '%User' AND model_id = ?", [u.id], { permiso: 'prueba-asesor', usuario: u.id })).affectedRows;
            deleted.users += (await exec("DELETE FROM users WHERE id = ? AND allied_id = ? AND email LIKE 'c%-fake@%'", [u.id, alliedId], { permiso: 'prueba-asesor', usuario: u.id })).affectedRows;
        });
    }
    for (const b of branches) {
        deleted.branches += (await exec("DELETE FROM allied_branches WHERE id = ? AND allied_id = ? AND name LIKE 'b%-fake'", [b.id, alliedId], { permiso: 'prueba-comercio' })).affectedRows;
    }
    deleted.allieds += (await exec("DELETE FROM allieds WHERE id = ? AND name LIKE 'PRUEBA AUTO %'", [alliedId], { permiso: 'prueba-comercio' })).affectedRows;

    return { allied: alliedId, emails: users.map((u) => u.email), deleted };
}
