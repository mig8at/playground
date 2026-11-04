// recorridos.ts — el catálogo de RECORRIDOS (`harness/recorridos.json`) y el clasificador que lo MIDE.
//
// El catálogo nombra las piezas (canal, riel, producto, variación, desenlace); este módulo lee la base de un
// ambiente y dice en qué recorrido cae cada entidad. Lo que mide NO se guarda: el riel y las banderas de una
// misma entidad cambian entre ambientes, y un dato guardado diría «encaja» sobre una base vieja. El porqué de
// cada pieza, con sus fuentes en `main`: knowledge/origination-paths.
//
// ⚠ Las columnas y tablas que este clasificador lee no existen en todos los backends: `lenders.product` y el
// perfil del riel 4 (`delegated_origination_profiles`, CORE-918) faltan en algunas bases. Se pregunta antes por
// cada una y, si falta, la pieza sale como «sin dato» en vez de romper la consulta entera (F-64).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { query } from './db.ts';

export const CATALOG_FILE = fileURLToPath(new URL('../recorridos.json', import.meta.url));

interface Named { name: string }
export interface Catalog {
    version: number;
    knowledge: string;
    channels: Record<string, Named & { routes: string; harness?: string }>;
    rails: Record<string, Named & { policyOwner: string; origination: string; outcome: string }>;
    railAxes: Record<string, Named & { values: Record<string, string> }>;
    products: Record<string, Named>;
    variations: Record<string, Named & { scope: string; when: string; measured?: string; channels?: string[]; rails?: string[]; byChannel?: Record<string, string> }>;
    outcomes: Record<string, Named & { formalizations?: Record<string, string> }>;
    servicing: Named & { values: Record<string, string> };
    fields: Record<string, Named & { decidedBy: string; alliedIds?: number[]; lenderIds?: number[]; otherwise?: string }>;
    fit: Record<string, string>;
}

export function readCatalog(file = CATALOG_FILE): Catalog {
    return JSON.parse(readFileSync(file, 'utf8')) as Catalog;
}

/** Lo que se mide de una entidad en una base. `null` = la base no tiene esa columna o tabla. */
export interface LenderFacts {
    id: number;
    name: string;
    slug: string;
    rt: number;
    product: string | null;
    path: string;
    externallyServiced: number | null;
    lenderStatus: number;
    branchStatus?: number;
    abaco: boolean;
    manualApproval: boolean;
    cosignerCategory: boolean;
    initialFeeCategory: boolean;
    /** El perfil del riel 4: `undefined` si la base no tiene la tabla, `null` si no hay fila, o su `formalization`. */
    profileFormalization?: string | null;
    hasProfile?: boolean;
}

/** Un recorrido medido: las piezas con nombre y la línea que lo resume. */
export interface Path {
    lender: LenderFacts;
    rail: string;
    railName: string;
    policyOwner: string;
    origination: string;
    product: string;
    variations: Array<{ id: string; name: string; scope: string; conditional: boolean }>;
    outcome: string;
    servicing: string;
    line: string;
    /** Cómo se comporta una variación en el canal pedido. */
    notes: string[];
    warnings: string[];
}

async function columnExists(table: string, column: string): Promise<boolean> {
    const r = await query(
        'SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ? LIMIT 1',
        [table, column],
    );
    return r.length > 0;
}
async function tableExists(table: string): Promise<boolean> {
    const r = await query('SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ? LIMIT 1', [table]);
    return r.length > 0;
}

/**
 * Mide las entidades: las de una sucursal (`branchHash`) o las que se pidan por id. Con la sucursal, la lista es
 * la de `lenders_by_allied_branches`, la misma que el listado usa para decidir qué ve el comercio.
 */
export async function measureLenders(opts: { branchHash?: string; lenderIds?: number[] }): Promise<LenderFacts[]> {
    const [hasProduct, hasServiced, hasRequirements, hasManual, hasProfiles] = await Promise.all([
        columnExists('lenders', 'product'),
        columnExists('lenders', 'externally_serviced'),
        tableExists('lender_requirements'),
        columnExists('lender_requirements', 'manual_approval'),
        tableExists('delegated_origination_profiles'),
    ]);
    const product = hasProduct ? "COALESCE(l.product, 'credit')" : 'NULL';
    const serviced = hasServiced ? 'l.externally_serviced' : 'NULL';
    const abaco = hasRequirements ? '(SELECT MAX(lr.abaco_is_enabled) FROM lender_requirements lr WHERE lr.lender_id = l.id)' : '0';
    const manual = hasManual ? '(SELECT MAX(lr.manual_approval) FROM lender_requirements lr WHERE lr.lender_id = l.id)' : '0';
    const profile = hasProfiles
        ? `(SELECT COUNT(*) FROM delegated_origination_profiles d WHERE d.lender_id = l.id) AS has_profile,
           (SELECT d.formalization FROM delegated_origination_profiles d WHERE d.lender_id = l.id LIMIT 1) AS formalization`
        : 'NULL AS has_profile, NULL AS formalization';
    const select = `SELECT l.id, COALESCE(l.name, '') AS name, COALESCE(l.slug, '') AS slug, l.response_type AS rt,
            ${product} AS product, COALESCE(p.name, 'default') AS path, ${serviced} AS serviced, l.status AS lender_status,
            ${abaco} AS abaco, ${manual} AS manual,
            EXISTS (SELECT 1 FROM lender_users_categories c WHERE c.lender_id = l.id AND c.active = 1 AND c.requires_cosigner = 1) AS cosigner,
            EXISTS (SELECT 1 FROM lender_users_categories c WHERE c.lender_id = l.id AND c.active = 1 AND c.min_initial_fee > 0) AS initial_fee,
            ${profile}`;
    let rows: any[];
    if (opts.branchHash) {
        rows = await query(
            `${select}, lab.status AS branch_status
             FROM allied_branches ab
             JOIN lenders_by_allied_branches lab ON lab.allied_branch_id = ab.id
             JOIN lenders l ON l.id = lab.lender_id
             LEFT JOIN paths p ON p.id = l.path_id
             WHERE ab.hash = ?
             ORDER BY l.response_type, l.name`,
            [opts.branchHash],
        );
    } else {
        const ids = (opts.lenderIds ?? []).filter((n) => Number.isFinite(n));
        if (!ids.length) return [];
        rows = await query(
            `${select} FROM lenders l LEFT JOIN paths p ON p.id = l.path_id WHERE l.id IN (${ids.map(() => '?').join(',')}) ORDER BY l.response_type, l.name`,
            ids,
        );
    }
    return rows.map((r) => ({
        id: Number(r.id),
        name: String(r.name),
        slug: String(r.slug),
        rt: Number(r.rt),
        product: r.product == null ? null : String(r.product),
        path: String(r.path),
        externallyServiced: r.serviced == null ? null : Number(r.serviced),
        lenderStatus: Number(r.lender_status),
        branchStatus: r.branch_status == null ? undefined : Number(r.branch_status),
        abaco: Number(r.abaco) === 1,
        manualApproval: Number(r.manual) === 1,
        cosignerCategory: Number(r.cosigner) === 1,
        initialFeeCategory: Number(r.initial_fee) === 1,
        profileFormalization: hasProfiles ? (r.formalization == null ? null : String(r.formalization)) : undefined,
        hasProfile: hasProfiles ? Number(r.has_profile) > 0 : undefined,
    }));
}

/** Ubica una entidad medida en el catálogo. `channel` limita las variaciones que dependen del canal. */
export function classify(f: LenderFacts, cat: Catalog, channel?: string): Path {
    const warnings: string[] = [];
    const notes: string[] = [];
    const rail = String(f.rt);
    const r = cat.rails[rail];
    if (!r) warnings.push(`response_type ${f.rt} no está en el catálogo: sería un riel nuevo`);
    const productName = f.product == null ? 'producto sin dato' : (cat.products[f.product]?.name ?? `producto «${f.product}» fuera del catálogo`);
    if (f.product != null && !cat.products[f.product]) warnings.push(`el producto «${f.product}» no está en el catálogo`);

    const variations: Path['variations'] = [];
    const add = (id: string, conditional: boolean) => {
        const v = cat.variations[id];
        if (!v) return;
        if (v.rails && !v.rails.includes(rail)) return;
        if (channel && v.channels && !v.channels.includes(channel)) return;
        // Sin canal fijado, una variación que sólo existe en algunos canales lo dice en el nombre.
        const only = !channel && v.channels ? ` (sólo ${v.channels.map((c) => cat.channels[c]?.name ?? c).join(', ').toLowerCase()})` : '';
        if (channel && v.byChannel?.[channel]) notes.push(`${v.name}: ${v.byChannel[channel]}`);
        variations.push({ id, name: v.name + only, scope: v.scope, conditional });
    };
    if (f.abaco) add('abaco', false);
    if (f.manualApproval) add('manual-approval', false);
    if (f.path === 'IMEI') add('imei', false);
    else if (f.path !== 'default') warnings.push(`la ruta «${f.path}» no está en el catálogo`);
    if (f.cosignerCategory) add('cosigner', true);
    if (f.initialFeeCategory) add('down-payment', true);

    let outcome = r ? (cat.outcomes[r.outcome]?.name ?? r.outcome) : 'desenlace sin dato';
    if (f.rt === 4) {
        // En main todo riel 4 radica como Credifamilia; con el perfil del riel (CORE-918) la formalización la
        // decide la fila de la entidad: vacía = ninguna, con clase = propia (o la radicación, si es la de Credifamilia).
        let formalization: string;
        if (f.profileFormalization === undefined) formalization = 'radicación (la base no tiene el perfil del riel)';
        else if (!f.hasProfile) {
            formalization = 'sin perfil del riel';
            warnings.push('riel 4 sin perfil en delegated_origination_profiles: con CORE-918 la autorización contesta 500');
        } else if (f.profileFormalization == null) formalization = 'ninguna';
        else formalization = /credifamilia/i.test(f.profileFormalization) ? 'radicación' : `propia (${f.profileFormalization})`;
        outcome = `${outcome}: ${formalization}`;
    }
    // La cobranza sólo es una pieza del recorrido cuando el crédito nace en casa: afuera la lleva la entidad.
    const servicing = r?.origination === 'afuera' ? ''
        : f.externallyServiced == null ? 'cobranza sin dato'
        : `cobranza ${cat.servicing.values[String(f.externallyServiced)] ?? '?'}`;
    if (f.lenderStatus !== 1) warnings.push('la entidad está apagada (lenders.status ≠ 1): no lista');

    const parts = [`riel ${rail}`, productName.toLowerCase(), ...variations.map((v) => `+${v.name.toLowerCase()}${v.conditional ? '?' : ''}`), outcome.toLowerCase(), servicing].filter(Boolean);
    return {
        lender: f,
        rail,
        railName: r?.name ?? 'riel desconocido',
        policyOwner: r ? cat.railAxes.policyOwner.values[r.policyOwner] : '?',
        origination: r ? r.origination : '?',
        product: productName,
        variations,
        outcome,
        servicing,
        line: parts.join(' · '),
        notes,
        warnings,
    };
}

/** Lo que pide el formulario en una sucursal: un renglón por campo, con el porqué. */
export interface FieldReading { id: string; name: string; asked: boolean | null; why: string }

/**
 * Mide los CAMPOS de una sucursal. Cada uno se decide en un lugar distinto (columna del comercio, setting o
 * una lista de ids del backend), así que cada renglón dice de dónde salió. `asked: null` = la base no tiene
 * el dato para decidirlo.
 */
export async function measureFields(branchHash: string, cat: Catalog): Promise<FieldReading[]> {
    const [hasExp, hasEmp] = await Promise.all([
        columnExists('allieds', 'collect_expedition_date'),
        columnExists('allieds', 'collect_employment_info'),
    ]);
    const row = (await query(
        `SELECT ab.id AS branch_id, a.id AS allied_id,
                ${hasExp ? 'a.collect_expedition_date' : 'NULL'} AS exp, ${hasEmp ? 'a.collect_employment_info' : 'NULL'} AS emp
         FROM allied_branches ab JOIN allieds a ON a.id = ab.allied_id WHERE ab.hash = ? LIMIT 1`,
        [branchHash],
    ))[0];
    if (!row) return [];
    const f = cat.fields;
    const out: FieldReading[] = [];

    // Vacío = se recauda: es el `?? true` de OnboardingFieldsGate.
    const flag = (v: any) => (v == null ? true : Number(v) === 1);
    out.push({ id: 'expedition-date', name: f['expedition-date'].name, asked: hasExp ? flag(row.exp) : null,
        why: hasExp ? (row.exp == null ? 'el comercio no lo dice: se recauda' : 'collect_expedition_date del comercio') : 'la base no tiene la columna' });

    const birth = f['birth-date'];
    const byAllied = (birth.alliedIds ?? []).includes(Number(row.allied_id));
    const lenderHits = byAllied ? [] : (await query(
        `SELECT lab.lender_id AS id FROM lenders_by_allied_branches lab WHERE lab.allied_branch_id = ? AND lab.lender_id IN (${(birth.lenderIds ?? [0]).map(() => '?').join(',')})`,
        [row.branch_id, ...(birth.lenderIds ?? [0])],
    )).map((r: any) => Number(r.id));
    const typed = byAllied || lenderHits.length > 0;
    out.push({ id: 'birth-date', name: birth.name, asked: typed,
        why: byAllied ? `el comercio ${row.allied_id} está en la lista del backend`
            : typed ? `la sucursal ofrece ${lenderHits.map((i) => '#' + i).join(', ')}, de la lista del backend`
            : (birth.otherwise ?? 'no se escribe') });

    const stratum = (await query("SELECT value FROM settings WHERE `key` = 'stratum_field_allieds' LIMIT 1"))[0];
    let stratumIds: number[] = [];
    try { stratumIds = (typeof stratum?.value === 'string' ? JSON.parse(stratum.value) : stratum?.value)?.allieds ?? []; } catch { /* sin setting legible */ }
    out.push({ id: 'stratum', name: f.stratum.name, asked: stratum ? stratumIds.map(Number).includes(Number(row.allied_id)) : null,
        why: stratum ? 'setting stratum_field_allieds' : 'la base no tiene el setting' });

    out.push({ id: 'employment', name: f.employment.name, asked: hasEmp ? flag(row.emp) : null,
        why: hasEmp ? `${row.emp == null ? 'el comercio no lo dice: se recauda' : 'collect_employment_info del comercio'}; sólo si no contestó Ágil Data ni Mareigua` : 'la base no tiene la columna' });
    return out;
}
