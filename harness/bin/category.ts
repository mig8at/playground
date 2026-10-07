#!/usr/bin/env node
// category — en qué categoría cae el caso en cada entidad CreditopX (rt=2), y en cuál cayó de verdad.
//
//   echo '{"lenders":[{"id":168,"name":"Motai C"}],"case":{"score":560,"negatives":2}}' | node bin/category.ts predict
//   node bin/category.ts actual <user_id>
//
// `predict` NO reimplementa las reglas: corre el simulador del propio backend
// (`Modules\Backoffice\App\Services\LenderRulesSimulatorService`, el de la pantalla de reglas del backoffice)
// dentro del contenedor local, sin HTTP. Ese endpoint pide un token del pool STAFF de Cognito, que el harness no
// tiene; adentro del contenedor no hace falta, y el simulador no escribe nada (ni `users_category_log`, ni
// consulta centrales). Por eso es SÓLO LOCAL: en dev o staging no hay contenedor al que entrar.
//
// `actual` lee `users_category_log`, lo que el motor registró al evaluar de verdad durante la corrida. Es la vara
// del simulador: el simulador es una RÉPLICA del motor que mantiene el backend, y ya se apartó una vez (el
// 2026-09-09 se arregló porque leía la continuidad distinto). Si predicción y corrida no coinciden, eso es lo
// primero que hay que mirar.
import { execFile } from 'node:child_process';
import { env } from '../pkg/env.ts';
import { query, TARGET } from '../pkg/db.ts';
import { categoryApplicant, type CategoryCase } from '../pkg/inject.ts';

const CONTAINER = env('E2E_BACKEND_CONTAINER', 'legacy-backend-laravel.test-1');
const MARK = '__CATEGORY__';

// Los criterios del simulador, con el nombre que lleva la perilla del panel.
const LABEL: Record<string, string> = {
    occupation: 'ocupación', gender: 'género', age: 'edad', employmentContinuity: 'continuidad laboral',
    score: 'score', negativeReports12m: 'negativos 12m', currentDelinquencies: 'moras actuales',
    financialHistoryLength: 'antigüedad en el sector', inquiries6m: 'consultas 6m', creditCards: 'tarjetas',
    overdueVector: 'vector de mora', freeCapacity: 'capacidad libre', datacredito: 'sin buró (sin score)',
};
const label = (k: string) => LABEL[k] ?? k;

// Corre el simulador para todas las entidades en UNA arrancada de Laravel (tinker tarda ~2 s en bootear).
const PHP = `
$in = json_decode(getenv('SIM_INPUT'), true);
$sim = app(\\Modules\\Backoffice\\App\\Services\\LenderRulesSimulatorService::class);
$out = [];
foreach ($in['lenders'] as $id) {
  try { $r = $sim->simulate((int) $id, $in['applicant']); } catch (\\Throwable $e) { $r = ['error' => $e->getMessage()]; }
  if (is_array($r) && isset($r['matchedProfile']['id'])) {
    $c = \\App\\Models\\LenderUsersCategory::find($r['matchedProfile']['id']);
    $r['requiresCosigner'] = (bool) ($c->requires_cosigner ?? false);
  }
  $out[(string) $id] = $r;
}
echo '${MARK}' . json_encode($out, JSON_UNESCAPED_UNICODE);
`;

// Lo que el backend deriva de los datos GUARDADOS del usuario: el mismo solicitante que la pantalla de reglas
// precarga por cédula. Es lo que el motor leyó de verdad, y contra eso se explica una predicción que no acertó.
const PHP_READ = `
$r = app(\\Modules\\Backoffice\\App\\Services\\LenderRulesSimulatorService::class)->applicantFromDocument(getenv('SIM_DOC'));
echo '${MARK}' . json_encode($r['applicant'] ?? null, JSON_UNESCAPED_UNICODE);
`;

/**
 * EL BUSCADOR DE CATEGORÍA (`solve`): qué valores del caso hacen que esta entidad lo ponga en ESA categoría.
 *
 * Las categorías se evalúan EN ORDEN y gana la primera que se cumple, así que no alcanza con cumplir la elegida:
 * hay que NO cumplir ninguna de las de arriba. Para cada perilla se toman como candidatos el valor actual y el más
 * flojo que la categoría todavía acepta (su score mínimo, el máximo de negativos, de moras y de consultas, el
 * mínimo de tarjetas y de continuidad, los bordes de edad, las ocupaciones y géneros que admite): el más flojo es
 * el que más chances tiene de romper una categoría de arriba, que suele ser más estricta. Se prueban las
 * combinaciones de MENOS cambios a más, y el ORÁCULO es el simulador del backend: la primera que cae en la
 * elegida, gana. Si ninguna, se dice qué categoría de arriba la tapa o qué criterio no se alcanza.
 */
const PHP_SOLVE = `
$in = json_decode(getenv('SIM_INPUT'), true);
$sim = app(\\Modules\\Backoffice\\App\\Services\\LenderRulesSimulatorService::class);
$state = app(\\Modules\\Backoffice\\App\\Services\\LenderRulesService::class)->getState((int) $in['lender']);
$profiles = $state['profiles'] ?? [];
$k = null; foreach ($profiles as $p) { if ((string) ($p['id'] ?? '') === (string) $in['target'] || mb_strtolower((string) $p['name']) === mb_strtolower((string) $in['target'])) { $k = $p; break; } }
if (!$k) { echo '${MARK}' . json_encode(['error' => 'la entidad no tiene esa categoría', 'categories' => array_map(fn ($p) => $p['name'], $profiles)], JSON_UNESCAPED_UNICODE); return; }
$ro = (array) ($k['readOnly'] ?? []);
$g = fn ($key) => $k[$key] ?? $ro[$key] ?? null;
$base = $in['applicant'];
$opts = [];
$uniq = fn (array $xs) => array_values(array_unique(array_filter($xs, fn ($x) => $x !== null), SORT_REGULAR));
$opts['score'] = $uniq([$base['score'] ?? null, $g('scoreMin')]);
if ($g('scoreMin') !== null) $opts['score'] = array_values(array_filter($opts['score'], fn ($v) => (int) $v >= (int) $g('scoreMin')));
foreach (['negativeReports12m', 'currentDelinquencies'] as $key) {
  $opts[$key] = $uniq([$base[$key] ?? 0, $g($key)]);
  if ($g($key) !== null) $opts[$key] = array_values(array_filter($opts[$key], fn ($v) => (int) $v <= (int) $g($key)));
}
$inq = $g('inquiries6m');
$opts['inquiries6m'] = ($inq !== null && (int) $inq < 100) ? array_values(array_filter($uniq([$base['inquiries6m'] ?? 1, (int) $inq]), fn ($v) => (int) $v <= (int) $inq)) : [$base['inquiries6m'] ?? 1];
$cards = (int) ($g('minCreditCards') ?? 0);
$opts['cards'] = array_values(array_filter($uniq([$base['activeCreditCards'] ?? 1, $cards]), fn ($v) => (int) $v >= $cards));
$cont = (int) ($g('employmentContinuity') ?? 0);
$level = 0; foreach ([0, 3, 6, 12] as $l) { if ($l >= $cont) { $level = $l; break; } }
$opts['employmentContinuity'] = array_values(array_filter($uniq([$base['employmentContinuity'] ?? 12, $level]), fn ($v) => (int) $v >= $cont));
$occs = (array) ($k['occupations'] ?? []);
// Si la ocupación la da un buró, sólo las que ese buró puede dar (Agildata: empleado o independiente).
if (!empty($in['occupations'])) $occs = array_values(array_intersect($occs, (array) $in['occupations']));
$opts['occupation'] = $uniq(array_merge(in_array($base['occupation'] ?? null, $occs, true) ? [$base['occupation']] : [], $occs));
$gens = (array) ($k['genders'] ?? []);
$opts['gender'] = $uniq(array_merge(in_array($base['gender'] ?? null, $gens, true) ? [$base['gender']] : [], $gens));
$amin = $g('ageMin'); $amax = $g('ageMax');
$ages = $uniq([$base['age'] ?? null, $amin !== null ? max(18, (int) $amin) : null, $amax !== null ? (int) $amax : null]);
$opts['age'] = array_values(array_filter($ages, fn ($v) => ($amin === null || (int) $v >= (int) $amin) && ($amax === null || (int) $v <= (int) $amax)));
foreach ($opts as $key => $vals) if (!$vals) $opts[$key] = [$base[$key] ?? null];
$keys = array_keys($opts);
$combos = [[]];
foreach ($keys as $key) { $next = []; foreach ($combos as $c) foreach ($opts[$key] as $i => $v) $next[] = $c + [$key => $i]; $combos = $next; }
// Se prefiere mover los BURÓS (score, negativos, moras, consultas, tarjetas, meses) antes que la ocupación, y ésta
// antes que la edad y el género, que son de la persona: «caer en Segunda oportunidad» es un score, no un cumpleaños.
$w = ['occupation' => 3, 'age' => 5, 'gender' => 5];
$cost = function ($c) use ($w) { $t = 0; foreach ($c as $key => $i) if ($i) $t += $w[$key] ?? 1; return $t; };
usort($combos, fn ($a, $b) => $cost($a) <=> $cost($b));
$tries = 0; $first = null; $found = null;
foreach ($combos as $c) {
  if (++$tries > 600) break;
  $a = $base;
  foreach ($c as $key => $i) {
    $v = $opts[$key][$i];
    if ($key === 'cards') { $a['activeCreditCards'] = (int) $v; $a['activeCreditCardsWithVector'] = (int) $v; } else { $a[$key] = $v; }
  }
  $r = $sim->simulate((int) $in['lender'], $a, $state);
  $m = $r['matchedProfile']['id'] ?? null;
  if ($first === null) $first = ['matched' => $r['matchedProfile']['name'] ?? null, 'policy' => array_values(array_map(fn ($x) => $x['label'] ?? '', array_filter($r['policy']['checks'] ?? [], fn ($x) => ($x['on'] ?? false) && ($x['passed'] ?? null) === false))),
    'targetFailed' => array_keys(array_filter((collect($r['profiles'] ?? [])->firstWhere('id', $k['id'])['criteria'] ?? []), fn ($v) => $v === false))];
  if ((string) $m === (string) $k['id']) { $found = $a; break; }
}
echo '${MARK}' . json_encode(['target' => ['id' => $k['id'], 'name' => $k['name']], 'found' => $found, 'tries' => $tries, 'first' => $first], JSON_UNESCAPED_UNICODE);
`;

function simulate(lenderIds: number[], applicant: Record<string, unknown>): Promise<Record<string, any>> {
    return runPhp(PHP, { SIM_INPUT: JSON.stringify({ lenders: lenderIds, applicant }) });
}

function runPhp(code: string, vars: Record<string, string>): Promise<any> {
    const envArgs = Object.entries(vars).flatMap(([k, v]) => ['-e', `${k}=${v}`]);
    return new Promise((ok, fail) => {
        execFile('docker', ['exec', ...envArgs, CONTAINER, 'php', 'artisan', 'tinker', '--execute', code],
            { timeout: 60000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
                const at = stdout.lastIndexOf(MARK);
                if (at < 0) return fail(new Error((err?.message || stderr || stdout || 'sin respuesta').split('\n').slice(0, 3).join(' ').slice(0, 300)));
                try { ok(JSON.parse(stdout.slice(at + MARK.length))); } catch (e) { fail(e); }
            });
    });
}

// Una fila por entidad: dónde cae, qué la bajó de las categorías de arriba y qué quedó sin evaluar.
function summarize(lender: { id: number; name: string }, r: any) {
    if (!r || r.error) return { id: lender.id, name: lender.name, verdict: 'error', error: r?.error || 'el simulador no devolvió nada' };
    const above: { name: string; failed: string[] }[] = [];
    for (const p of r.profiles || []) {
        if (p.eligible) break;
        above.push({ name: p.name, failed: Object.entries(p.criteria || {}).filter(([, v]) => v === false).map(([k]) => label(k)) });
    }
    const matched = (r.profiles || []).find((p: any) => p.eligible);
    // Una entidad SIN perfiles no «queda sin categoría»: el motor la decide por puntaje (el camino de
    // scoring, que el simulador no evalúa). Decirlo como un rechazo sería afirmar algo que no se simuló.
    const noRules = r.verdict === 'no_profile' && !(r.profiles || []).length;
    return {
        id: lender.id, name: lender.name,
        verdict: (noRules ? 'no_rules' : r.verdict) as 'approved' | 'rejected' | 'no_profile' | 'no_rules',
        category: r.matchedProfile?.name ?? null,
        // Todas sus categorías, en orden: el selector del panel elige entre éstas (las no evaluadas no se ofrecen).
        categories: (r.profiles || []).filter((p: any) => p.evaluated !== false).map((p: any) => p.name),
        // El detalle de CADA categoría, para las tarjetas del panel: si la cumple, qué criterios no, y sus condiciones.
        categoryDetail: (r.profiles || []).filter((p: any) => p.evaluated !== false).map((p: any) => ({
            name: p.name, eligible: !!p.eligible, conditions: p.conditions ?? null,
            failed: Object.entries(p.criteria || {}).filter(([, v]) => v === false).map(([k]) => label(k)),
        })),
        position: r.matchedProfile?.position ?? null,
        conditions: r.conditions ?? null,
        requiresCosigner: !!r.requiresCosigner,
        complete: r.simulationComplete !== false,
        notSimulated: matched?.notSimulated ?? [],
        above,
        // La política dura: si un chequeo encendido no pasa, la entidad ni siquiera aparece.
        policyFailed: (r.policy?.checks || []).filter((c: any) => c.on && c.passed === false).map((c: any) => `${c.label}: ${c.actual} (pide ${c.expected})`),
    };
}

async function readStdin(): Promise<string> {
    let s = '';
    for await (const chunk of process.stdin) s += chunk;
    return s;
}

const [cmd, ...args] = process.argv.slice(2);
try {
    if (TARGET !== 'local') throw new Error(`sólo en local (el target es ${TARGET}): el simulador corre adentro del contenedor del backend`);
    if (cmd === 'predict') {
        const input = JSON.parse(await readStdin() || '{}') as { lenders: { id: number; name: string }[]; case: CategoryCase };
        const lenders = input.lenders || [];
        const applicant = categoryApplicant(input.case || {});
        const raw = lenders.length ? await simulate(lenders.map((l) => l.id), applicant) : {};
        console.log(JSON.stringify({ applicant, lenders: lenders.map((l) => summarize(l, raw[String(l.id)])) }));
    } else if (cmd === 'solve') {
        // echo '{"lender":77,"target":"Segunda oportunidad","case":{…}}' | node bin/category.ts solve
        const input = JSON.parse(await readStdin() || '{}') as { lender: number; target: string | number; occupations?: string[]; case: CategoryCase & { continuity?: number; creditCards?: number } };
        const c = input.case || {};
        const applicant = { ...categoryApplicant(c), ...(c.continuity != null ? { employmentContinuity: c.continuity } : {}),
            ...(c.creditCards != null ? { activeCreditCards: c.creditCards, activeCreditCardsWithVector: c.creditCards } : {}) };
        const r = await runPhp(PHP_SOLVE, { SIM_INPUT: JSON.stringify({ lender: Number(input.lender), target: input.target, occupations: input.occupations || [], applicant }) });
        if (r.error) throw new Error(`${r.error}${r.categories ? ': ' + r.categories.join(', ') : ''}`);
        if (!r.found) {
            const why = r.first?.matched && r.first.matched !== r.target.name ? `con los valores más flojos de «${r.target.name}» igual cae antes en «${r.first.matched}»`
                : r.first?.policy?.length ? `no pasa la política de la entidad (${r.first.policy.join(', ')})`
                : r.first?.targetFailed?.length ? `no se alcanza con las perillas del caso: ${r.first.targetFailed.map(label).join(', ')}`
                : 'ninguna combinación de las perillas la alcanza';
            console.log(JSON.stringify({ ok: false, target: r.target, tries: r.tries, reason: why }));
        } else {
            const f = r.found;
            // Lo que hay que poner en cada lugar: Experian (Acierta), Agildata (ocupación y meses) y el caso.
            const months = Number(f.employmentContinuity) >= 12 ? 13 : Number(f.employmentContinuity) >= 6 ? 7 : Number(f.employmentContinuity) >= 3 ? 4 : 2;
            const values = { score: f.score, negatives: f.negativeReports12m, delinquencies: f.currentDelinquencies, consulted: f.inquiries6m,
                creditCards: f.activeCreditCards, occupation: f.occupation, continuity: f.employmentContinuity, months, age: f.age, gender: f.gender };
            const changed = Object.entries(values).filter(([k, v]) => k !== 'months' && String(v) !== String((applicant as any)[{ negatives: 'negativeReports12m', delinquencies: 'currentDelinquencies', consulted: 'inquiries6m', creditCards: 'activeCreditCards', continuity: 'employmentContinuity' }[k] || k])).map(([k]) => k);
            console.log(JSON.stringify({ ok: true, target: r.target, tries: r.tries, values, changed }));
        }
    } else if (cmd === 'actual') {
        const [userId] = args;
        if (!userId) throw new Error('uso: node bin/category.ts actual <user_id>');
        // La ÚLTIMA evaluación de cada entidad: el listado evalúa una vez por entidad, pero confirmar el cupo la
        // vuelve a evaluar, y la que vale es la última. Se filtra por usuario y no por hora: el usuario sintético
        // es nuevo en cada corrida, y comparar horas mezclaría la zona de la base (Bogotá) con la del panel.
        const rows = await query<any>(
            `SELECT g.lender_id, l.name AS lender, c.name AS category, g.created_at
               FROM users_category_log g
               JOIN lenders l ON l.id = g.lender_id
               LEFT JOIN lender_users_categories c ON c.id = g.lender_users_category_id
              WHERE g.user_id = ?
              ORDER BY g.id`, [Number(userId)]);
        const last = new Map<number, any>();
        for (const r of rows) last.set(Number(r.lender_id), { lenderId: Number(r.lender_id), lender: r.lender, category: r.category ?? null, at: r.created_at });
        // Y lo que el motor leyó: si la predicción no acertó, casi siempre es porque un dato no era el del caso
        // (el buró que contestó el mock pisó el inyectado, la ocupación que devolvió Agildata).
        const doc = (await query<any>('SELECT document_number AS d FROM users WHERE id = ?', [Number(userId)]))[0]?.d;
        const read = doc ? await runPhp(PHP_READ, { SIM_DOC: String(doc) }).catch(() => null) : null;
        console.log(JSON.stringify({ lenders: [...last.values()], read }));
    } else {
        throw new Error('uso: node bin/category.ts predict | solve | actual <user_id>');
    }
} catch (e) {
    console.log(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
    process.exitCode = 1;
}
process.exit();
