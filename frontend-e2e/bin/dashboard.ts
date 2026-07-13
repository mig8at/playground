#!/usr/bin/env node
// dashboard — vista rápida (HTML) del estado de un usuario: identidad + por qué centrales de riesgo /
// validaciones pasó (Experian, TusDatos, Agildata, Ado, Mareigua, Deceval — desde risk_central_user_data)
// + los lenders del comercio. Read-only contra dev (E2E_TARGET=dev por defecto).
//   node bin/dashboard.ts <telefono|documento|cognito_id|uReqID>
// Genera .auth/dashboard.html y lo abre.
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { spawn } from 'node:child_process';
import { query, one, close } from '../pkg/db.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const AUTH = join(ROOT, '.auth');

interface UserRow {
    id: number; full_name: string; document_number: string; document_type: string;
    cell_phone: string; email: string; date_of_birth: string | null; age: number | null;
    status: number; allied_id: number | null; allied_branch_id: number | null;
}
interface ProviderRow { id: number; name: string; score: number | null; has_data: number; created_at: string }
interface LenderRow { id: number; name: string; rt: number; branch_status: number }

const q = process.argv[2] ?? '';
if (!q.trim()) { console.error('uso: dashboard <telefono|documento|cognito_id|uReqID>'); process.exit(1); }

// resolver el usuario: por uReqID (si es numérico y existe el user_request) o por teléfono/doc/cognito.
async function resolveUser(qq: string): Promise<UserRow | null> {
    if (/^\d+$/.test(qq)) {
        const ur = await one<{ user_id: number }>('SELECT user_id FROM user_requests WHERE id=? LIMIT 1', [qq]);
        if (ur?.user_id) return userById(ur.user_id);
    }
    return one<UserRow>(
        `SELECT id, COALESCE(full_name,'') AS full_name, COALESCE(document_number,'') AS document_number,
                COALESCE(document_type,'') AS document_type, COALESCE(cell_phone,'') AS cell_phone,
                COALESCE(email,'') AS email, date_of_birth, age, COALESCE(status,0) AS status, allied_id, allied_branch_id
         FROM users WHERE cell_phone=? OR document_number=? OR cognito_id=? ORDER BY id DESC LIMIT 1`,
        [qq, qq, qq],
    );
}
const userById = (id: number) => one<UserRow>(
    `SELECT id, COALESCE(full_name,'') AS full_name, COALESCE(document_number,'') AS document_number,
            COALESCE(document_type,'') AS document_type, COALESCE(cell_phone,'') AS cell_phone,
            COALESCE(email,'') AS email, date_of_birth, age, COALESCE(status,0) AS status, allied_id, allied_branch_id
     FROM users WHERE id=? LIMIT 1`, [id]);

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
const money = (n: number | null | undefined) => (n == null ? '—' : '$ ' + Number(n).toLocaleString('es-CO'));
const rtTag = (rt: number) => rt === 2 ? 'Creditop X (rt=2)' : rt === 1 ? 'integración (rt=1)' : rt === 0 ? 'agregador (rt=0)' : rt === 4 ? 'externo (rt=4)' : `rt=${rt}`;

// agrupa los risk_centrals "crudos" en las familias que importan al negocio.
function family(name: string): string {
    const n = name.toLowerCase();
    if (n.includes('experian') || n.includes('datacred')) return 'Experian / DataCrédito';
    if (n.includes('tusdatos')) return 'TusDatos';
    if (n.includes('agil')) return 'Agildata';
    if (n.includes('mareigua') || n.includes('maregua')) return 'Mareigua';
    if (n.includes('ado')) return 'Ado (identidad)';
    if (n.includes('deceval')) return 'Deceval';
    return name;
}

async function main() {
    const user = await resolveUser(q);
    if (!user) { console.error(`✗ no encontré usuario para ${JSON.stringify(q)}`); await close(); process.exit(1); }

    const ureq = await one<{ id: number; amount: number; allied_branch_id: number; user_request_status_id: number; created_at: string }>(
        'SELECT id, amount, allied_branch_id, user_request_status_id, created_at FROM user_requests WHERE user_id=? ORDER BY id DESC LIMIT 1', [user.id]);
    const branchId = ureq?.allied_branch_id ?? user.allied_branch_id;
    const comercio = branchId ? await one<{ name: string; hash: string; allied: string }>(
        `SELECT ab.name, COALESCE(ab.hash,'') AS hash, a.name AS allied FROM allied_branches ab JOIN allieds a ON a.id=ab.allied_id WHERE ab.id=? LIMIT 1`, [branchId]) : null;

    // TODAS las centrales (para ver también las que NO pasó) + lo del usuario
    const all = await query<{ id: number; name: string }>('SELECT id, name FROM risk_centrals ORDER BY id');
    const passed = await query<ProviderRow>(
        `SELECT rc.id, rc.name, rcud.score, CASE WHEN rcud.data IS NULL THEN 0 ELSE 1 END AS has_data, rcud.created_at
         FROM risk_central_user_data rcud JOIN risk_centrals rc ON rc.id=rcud.risk_central_id
         WHERE rcud.user_id=? AND rcud.deleted_at IS NULL ORDER BY rc.id`, [user.id]);
    const passedById = new Map(passed.map((p) => [p.id, p]));

    const lenders = branchId ? await query<LenderRow>(
        `SELECT l.id, COALESCE(l.name,'') AS name, l.response_type AS rt, lab.status AS branch_status
         FROM lenders_by_allied_branches lab JOIN lenders l ON l.id=lab.lender_id
         WHERE lab.allied_branch_id=? AND l.status=1 ORDER BY l.response_type, l.name`, [branchId]) : [];

    const html = render({ user, ureq, comercio, all, passedById, lenders });
    mkdirSync(AUTH, { recursive: true });
    const out = join(AUTH, 'dashboard.html');
    writeFileSync(out, html);
    console.log(`▶ dashboard de '${user.full_name || user.document_number || q}' → ${out}`);
    spawn('open', [out], { stdio: 'ignore' }).on('error', () => console.log(`  (abrí a mano: ${out})`));
    await close();
}

function pill(text: string, tone: 'ok' | 'warn' | 'off') {
    const c = tone === 'ok' ? '#0F6E56;background:#E1F5EE' : tone === 'warn' ? '#854F0B;background:#FAEEDA' : '#5F5E5A;background:#F1EFE8';
    return `<span style="display:inline-block;padding:3px 10px;border-radius:999px;font-size:12px;font-weight:600;color:${c}">${esc(text)}</span>`;
}

function render(d: {
    user: UserRow; ureq: { id: number; amount: number; user_request_status_id: number; created_at: string } | null;
    comercio: { name: string; hash: string; allied: string } | null;
    all: { id: number; name: string }[]; passedById: Map<number, ProviderRow>; lenders: LenderRow[];
}): string {
    const { user, ureq, comercio, all, passedById, lenders } = d;
    const providerCards = all.map((rc) => {
        const p = passedById.get(rc.id);
        const tone = p ? (p.has_data ? 'ok' : 'warn') : 'off';
        const status = p ? (p.has_data ? 'consultado' : 'consultado · sin data') : 'no consultado';
        const score = p?.score != null ? `<div style="font-size:22px;font-weight:700;color:#26215C;margin-top:6px">${p.score}</div><div style="font-size:11px;color:#6b6a66">score</div>` : '';
        const when = p?.created_at ? `<div style="font-size:11px;color:#6b6a66;margin-top:8px">${esc(p.created_at)}</div>` : '';
        return `<div style="border:1px solid #e9e7df;border-radius:14px;padding:14px;background:#fff;${p ? '' : 'opacity:.6'}">
            <div style="font-weight:600;color:#26215C;font-size:14px">${esc(family(rc.name))}</div>
            <div style="font-size:11px;color:#6b6a66;margin-bottom:8px">${esc(rc.name)}</div>
            ${pill(status, tone)}${score}${when}</div>`;
    }).join('');

    const lenderRows = lenders.length ? lenders.map((l) => `<tr style="border-top:1px solid #eee">
        <td style="padding:8px 10px">#${l.id}</td>
        <td style="padding:8px 10px;font-weight:500">${esc(l.name)}${Number(l.branch_status) !== 1 ? ' <span style="color:#A32D2D;font-size:11px">[off sucursal]</span>' : ''}</td>
        <td style="padding:8px 10px;color:#5F5E5A">${rtTag(l.rt)}</td></tr>`).join('')
        : '<tr><td colspan="3" style="padding:12px;color:#6b6a66">— sin lenders en la sucursal —</td></tr>';

    const field = (k: string, v: string) => `<div><div style="font-size:11px;color:#6b6a66">${esc(k)}</div><div style="font-weight:500;color:#2C2A29">${esc(v) || '—'}</div></div>`;

    return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Dashboard usuario · ${esc(user.full_name || user.document_number)}</title>
<style>
  body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;background:#fbfaf6;color:#2C2A29;padding:24px}
  .wrap{max-width:1000px;margin:0 auto}
  h1{font-size:20px;margin:0 0 2px} h2{font-size:15px;margin:26px 0 12px;color:#26215C}
  .card{background:#fff;border:1px solid #e9e7df;border-radius:16px;padding:18px}
  .grid{display:grid;gap:12px} .g4{grid-template-columns:repeat(auto-fill,minmax(200px,1fr))} .g3{grid-template-columns:repeat(auto-fit,minmax(180px,1fr))}
  table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #e9e7df;border-radius:12px;overflow:hidden;font-size:14px}
  .demo{background:repeating-linear-gradient(45deg,#ffe9a8,#ffe9a8 12px,#ffe08a 12px,#ffe08a 24px);color:#6b4e00;font-weight:700;text-align:center;padding:6px;font-size:12px;border-radius:8px;margin-bottom:16px}
</style></head><body><div class="wrap">
  <div class="demo">🔎 vista rápida (read-only · dev) — datos de risk_central_user_data + lenders_by_allied_branches</div>
  <div class="card">
    <h1>${esc(user.full_name || '(sin nombre)')}</h1>
    <div style="font-size:12px;color:#6b6a66;margin-bottom:14px">user #${user.id} · ${user.status === 1 ? 'activo' : 'status ' + user.status}</div>
    <div class="grid g3">
      ${field('Documento', `${user.document_type} ${user.document_number}`)}
      ${field('Teléfono', user.cell_phone)}
      ${field('Email', user.email)}
      ${field('Edad', user.age != null ? String(user.age) : (user.date_of_birth ?? ''))}
      ${field('Comercio', comercio ? `${comercio.allied} · ${comercio.name} (${comercio.hash})` : '—')}
      ${field('Última solicitud', ureq ? `#${ureq.id} · ${money(ureq.amount)} · estado ${ureq.user_request_status_id}` : '—')}
    </div>
  </div>

  <h2>Centrales de riesgo / validaciones</h2>
  <div class="grid g4">${providerCards}</div>

  <h2>Lenders de la sucursal (${lenders.length})</h2>
  <table><thead><tr style="background:#f7f6f1;text-align:left">
    <th style="padding:8px 10px">id</th><th style="padding:8px 10px">lender</th><th style="padding:8px 10px">tipo</th>
  </tr></thead><tbody>${lenderRows}</tbody></table>
  <p style="color:#6b6a66;font-size:11px;margin-top:18px">verde = consultado con data · ámbar = consultado sin data · gris = no consultado. Lenders = pre-reglas (group rules/datacrédito/modo refinan después).</p>
</div></body></html>`;
}

main().catch(async (e) => { console.error('✗', e instanceof Error ? e.message : String(e)); await close(); process.exit(1); });
