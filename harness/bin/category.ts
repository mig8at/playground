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
        throw new Error('uso: node bin/category.ts predict | actual <user_id>');
    }
} catch (e) {
    console.log(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
    process.exitCode = 1;
}
process.exit();
