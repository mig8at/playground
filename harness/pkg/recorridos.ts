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
    rails: Record<string, Named & { policyOwner: string; origination: string; outcome: string;
        steps?: Array<{ name: string; tie: 'rail' | 'config' | 'credifamilia'; note?: string }>;
        credifamiliaLenderIds?: { production: number[]; other: number[] } }>;
    railAxes: Record<string, Named & { values: Record<string, string> }>;
    products: Record<string, Named>;
    variations: Record<string, Named & { scope: string; when: string; measured?: string; channels?: string[]; rails?: string[]; byChannel?: Record<string, string> }>;
    outcomes: Record<string, Named & { formalizations?: Record<string, string> }>;
    servicing: Named & { values: Record<string, string> };
    fields: Record<string, Named & { decidedBy: string; alliedIds?: number[]; lenderIds?: number[]; otherwise?: string }>;
    identity: { providers: Record<string, string>; withoutProvider: string };
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
    /** Los puntos del formulario adicional que tiene encendidos (`post_lender_selection`, `pre_sign_documents`). */
    dynamicForms: string[];
    /** Los proveedores de identidad activos, en orden (slugs de identity_validation_types). `null` = la base no tiene la tabla. */
    identityProviders: string[] | null;
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
    const [hasProduct, hasServiced, hasRequirements, hasManual, hasProfiles, hasPlacements, hasIdentity, hasFormLender, hasDynFlag] = await Promise.all([
        columnExists('lenders', 'product'),
        columnExists('lenders', 'externally_serviced'),
        tableExists('lender_requirements'),
        columnExists('lender_requirements', 'manual_approval'),
        tableExists('delegated_origination_profiles'),
        tableExists('dynamic_form_placements'),
        tableExists('lender_identity_validation_types'),
        columnExists('form_types', 'lender_id'),
        columnExists('lender_requirements', 'dynamic_form_is_enabled'),
    ]);
    // El formulario adicional, con la precedencia de LenderFormPlacementResolver: si la tabla central tiene filas de
    // la entidad para ese punto, manda (encendida o apagada); si no, se hereda del respaldo de cada punto.
    const central = (placement: string, fallback: string) => hasPlacements
        ? `CASE WHEN EXISTS (SELECT 1 FROM dynamic_form_placements dp WHERE dp.scope_type = 'lender' AND dp.scope_id = l.id AND dp.placement = '${placement}')
                THEN EXISTS (SELECT 1 FROM dynamic_form_placements dp WHERE dp.scope_type = 'lender' AND dp.scope_id = l.id AND dp.placement = '${placement}' AND dp.is_enabled = 1)
                ELSE ${fallback} END`
        : fallback;
    const formPost = central('post_lender_selection', hasDynFlag
        ? 'EXISTS (SELECT 1 FROM lender_requirements lr WHERE lr.lender_id = l.id AND lr.dynamic_form_is_enabled = 1 AND lr.dynamic_form_type_id IS NOT NULL)' : '0');
    const formPre = central('pre_sign_documents', hasFormLender
        ? 'EXISTS (SELECT 1 FROM form_types ft WHERE ft.lender_id = l.id AND ft.status = 1)' : '0');
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
            (${formPost}) AS form_post, (${formPre}) AS form_pre,
            ${hasIdentity ? `(SELECT GROUP_CONCAT(ivt.slug ORDER BY litv.\`order\` SEPARATOR ',') FROM lender_identity_validation_types litv
                JOIN identity_validation_types ivt ON ivt.id = litv.identity_validation_type_id
                WHERE litv.lender_id = l.id AND litv.status = 1)` : 'NULL'} AS identity,
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
        identityProviders: hasIdentity ? (r.identity ? String(r.identity).split(',') : []) : null,
        dynamicForms: [Number(r.form_post) === 1 ? 'post_lender_selection' : '', Number(r.form_pre) === 1 ? 'pre_sign_documents' : ''].filter(Boolean),
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
    if (f.dynamicForms.length) {
        const places = cat.variations['dynamic-form'] as { placements?: Record<string, string> };
        add('dynamic-form', false);
        const last = variations[variations.length - 1];
        if (last?.id === 'dynamic-form') last.name += ` (${f.dynamicForms.map((p) => places.placements?.[p] ?? p).join(' y ')})`;
    }
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
    if (r?.origination === 'en-casa' && f.identityProviders && !f.identityProviders.length)
        warnings.push(`sin proveedor de identidad: ${cat.identity.withoutProvider}`);

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

// ─── en el LOG de una corrida ───────────────────────────────────────────────────────────────────────
// Cada navegación del caminador dice a qué pieza del recorrido pertenece. Sale del mismo mapa del panel
// (`panel/steps.json`), así que lo que dibuja el panel y lo que dice el log no pueden divergir. Las rutas del
// mapa son PLANTILLAS (`/{flow}/{hash}/{ur}/lenders`): se comparan convertidas a expresión regular.

const STEPS_FILE = fileURLToPath(new URL('../panel/steps.json', import.meta.url));

/** Rutas que el mapa no tiene como nodo pero son de una variación del catálogo. */
const EXTRA_PIECES: Array<[RegExp, string]> = [
    [/\/cosigner(\/|$)/, 'variación Codeudor'],
    [/\/down-payment(\/|$)|\/initial-fee-payment|\/down-payment-validation/, 'variación Cuota inicial'],
    [/\/dynamic-form\/|\/formulario\//, 'variación Formulario adicional'],
    [/\/imei(\/|$)/, 'variación IMEI'],
    [/\/manual-approval-pending/, 'variación Aprobación manual'],
    [/\/additional-identity-validation/, 'en casa · Identidad: cuestionario (Evidente)'],
    [/\/identity-validation-status|\/retry-validation/, 'en casa · Identidad: resultado'],
    [/\/bancolombia\//, 'canal Bancolombia'],
];

let routeIndex: Array<{ re: RegExp; piece: string }> | null = null;

function buildRouteIndex(): Array<{ re: RegExp; piece: string }> {
    const steps = JSON.parse(readFileSync(STEPS_FILE, 'utf8'));
    const out: Array<{ re: RegExp; piece: string }> = [];
    const add = (pasos: any[] | undefined, prefix: string) => {
        for (const p of pasos ?? []) {
            // Una ruta con texto al lado («… (sin navegación)», «… → URL externa») no es una pantalla propia.
            const raw = String(p?.ruta ?? '');
            if (!raw.startsWith('/') || /\s/.test(raw)) continue;
            const ruta = raw.split('?')[0];
            const re = new RegExp('^' + ruta.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{[^}]+\}/g, '[^/]+') + '/?$');
            out.push({ re, piece: `${prefix} · ${p.label}` });
        }
    };
    // Primero lo específico (desvíos, ramas, entradas) y al final el tramo común: una ruta del tronco
    // con plantilla genérica no debe tapar a una de una variación.
    for (const [, d] of Object.entries<any>(steps.desvios ?? {})) add(d.pasos, `variación ${d.label}`);
    for (const [k, r] of Object.entries<any>(steps.ramales ?? {})) add(r.pasos, k === 'creditopx' ? 'en casa' : r.label);
    for (const [, e] of Object.entries<any>(steps.extensiones ?? {})) add(e.pasos, 'desenlace');
    for (const [k, e] of Object.entries<any>(steps.entradas ?? {})) if (!k.startsWith('_')) add(e.pasos, `canal ${e.canal === 'auto' ? 'Tienda' : e.label}`);
    add(steps.terminales?.pasos, 'terminal');
    add(steps.tronco, 'tramo común');
    return out;
}

/** La pieza del recorrido de una ruta del asistente («tramo común · Oferta», «variación Ábaco · Plataformas»…), o null. */
export function pieceOfRoute(path: string): string | null {
    const clean = path.split('?')[0].split('#')[0];
    for (const [re, piece] of EXTRA_PIECES) if (re.test(clean)) return piece;
    try { routeIndex ??= buildRouteIndex(); } catch { return null; }
    return routeIndex.find((x) => x.re.test(clean))?.piece ?? null;
}

/** El canal del catálogo para el `FLOW` del caminador (merchant · self-service · ecommerce). */
export function channelOfFlow(flow: string): string {
    return flow === 'ecommerce' ? 'store' : flow === 'self-service' ? 'self-service' : 'advisor';
}

/**
 * Las líneas que el log de una corrida imprime al elegir la entidad: el recorrido que le toca, con los
 * campos del formulario de la sucursal y lo que hay que saber para leer el resto. No consulta nada que no
 * consulte `make harness-recorrido`; si la base no contesta, devuelve una sola línea que lo dice.
 */
export async function routeSummary(lenderId: number, branchHash: string, flow: string): Promise<string[]> {
    try {
        const cat = readCatalog();
        const channel = channelOfFlow(flow);
        const [facts] = await measureLenders({ lenderIds: [lenderId] });
        if (!facts) return [`recorrido: la entidad ${lenderId} no está en esta base`];
        const p = classify(facts, cat, channel);
        const out = [
            `recorrido: ${cat.channels[channel]?.name.toLowerCase() ?? channel} · ${p.line}`,
            `   riel ${p.rail} ${p.railName}: política ${p.policyOwner}, se origina ${p.origination.replace('-', ' ')}`,
        ];
        // El riel 4, paso a paso: qué sirve para cualquier entidad del riel y qué está atado a Credifamilia en main.
        const rail = cat.rails[p.rail];
        if (rail?.steps?.length) {
            out.push(`   paso a paso: ${rail.steps.map((s) => s.name + (s.tie === 'credifamilia' ? '*' : '')).join(' → ')}`);
            const ids = rail.credifamiliaLenderIds;
            const isCf = ids ? [...ids.production, ...ids.other].includes(lenderId) : false;
            const tied = rail.steps.filter((s) => s.tie === 'credifamilia').map((s) => s.name);
            out.push(isCf
                ? '   * = atado a Credifamilia en main; esta entidad es de Credifamilia, así que corre por ahí'
                : `   ⚠ * = atado a Credifamilia en main: con esta entidad, ${tied.join(', ')} se resuelven como Credifamilia o fallan`);
        }
        if (p.origination === 'en-casa' && facts.identityProviders?.length)
            out.push(`   identidad: ${facts.identityProviders.map((x) => cat.identity.providers[x] ?? x).join(' → ')}`);
        for (const n of p.notes) out.push(`   ${n}`);
        for (const w of p.warnings) out.push(`   ⚠ ${w}`);
        const fields = await measureFields(branchHash, cat).catch(() => []);
        const asked = fields.filter((f) => f.asked).map((f) => f.name.toLowerCase());
        if (fields.length) out.push(`   formulario: ${asked.length ? asked.join(', ') : 'sólo lo básico'}`);
        const birth = fields.find((f) => f.id === 'birth-date');
        if (birth && !birth.asked) out.push(`   fecha de nacimiento: ${birth.why}`);
        if (p.variations.some((v) => v.conditional)) out.push('   `?` = la pide la categoría que le toque al cliente');
        return out;
    } catch (e: any) {
        return [`recorrido: no se pudo medir (${e?.message ?? e})`];
    }
}
