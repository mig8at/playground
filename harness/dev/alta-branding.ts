// dev/alta-branding.ts — pone el COLOR y el TEMA de Alta Fleet (y quita el salto de línea a mano del titular).
//
//   E2E_TARGET=qa node dev/alta-branding.ts [--hash ea2fe316]            # SIMULA: muestra antes y después, no escribe
//   I_KNOW_THIS_TOUCHES_SHARED_DEV=1 E2E_TARGET=qa node dev/alta-branding.ts --apply
//   … --background https://ct-app-dev.s3.us-east-2.amazonaws.com/<ruta>.png    # además apunta la foto de fondo a esa URL
//
// POR QUÉ EXISTE. La bienvenida del comercio pinta con el `--primary` del tema, y el backend sólo devuelve
// `token_overrides` si `theme_key = 'allied-custom'` (`PartnerBrandingController@show`). Alta en qa tenía los dos
// en NULL, así que la pantalla salía en el azul por defecto de Creditop (#4c39ff) y no en el de su diseño
// (#013aff). Medido el 2026-09-30 contra qa.
//
// Sólo toca TRES cosas de UNA fila de `allieds` (la del comercio de la sucursal dada):
//   · theme_key            → 'allied-custom'
//   · token_overrides      → primary #013aff (conserva cualquier otra llave que ya tuviera)
//   · pages.welcome.description → sin el salto de línea a mano: con él el titular sale en tres líneas.
//   · pages.welcome.background → la URL dada con `--background` (opcional). NO sube la foto: esa es un archivo
//     (S3) y la sube quien tenga permiso de escritura en el bucket. La URL tiene que responder 200 y ser una
//     imagen: se comprueba ANTES de escribir, porque una URL muerta deja la bienvenida sin foto.
import { one, exec, close, TARGET, isLocalDb } from '../pkg/db.ts';

const arg = (n: string, d = '') => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? (process.argv[i + 1] ?? d) : d; };
const APPLY = process.argv.includes('--apply');
const HASH = arg('hash', 'ea2fe316');
const PRIMARY = '#013aff';
const BACKGROUND = arg('background');
if (BACKGROUND && !/^https:\/\//.test(BACKGROUND)) throw new Error('--background tiene que ser una URL https');

if (TARGET === 'prod') throw new Error('alta-branding NUNCA corre contra producción.');

const row = await one<any>(
    `SELECT a.id, a.name, a.theme_key, a.token_overrides, a.pages
       FROM allieds a JOIN allied_branches ab ON ab.allied_id=a.id WHERE ab.hash=? LIMIT 1`, [HASH]);
if (!row) throw new Error(`no hay sucursal con hash ${HASH} en ${TARGET}`);
if (!/^alta/i.test(row.name)) throw new Error(`la sucursal ${HASH} es de «${row.name}», no de Alta: no se toca`);

const pages = typeof row.pages === 'string' ? JSON.parse(row.pages) : row.pages;
const before = String(pages?.welcome?.description ?? '');
const after = before.replace(/\s*\n\s*/g, ' ').trim();

console.log(`\n  ${TARGET}${isLocalDb() ? '' : ' ⚠ COMPARTIDA'} · ${row.name} (allied ${row.id}) · sucursal ${HASH}\n`);
console.log(`  theme_key        ${JSON.stringify(row.theme_key)}  →  "allied-custom"`);
console.log(`  token_overrides  ${JSON.stringify(row.token_overrides)}  →  primary ${PRIMARY} (+ lo que ya tuviera)`);
console.log(`  descripción      ${JSON.stringify(before)}\n              →  ${JSON.stringify(after)}`);
if (BACKGROUND) console.log(`  foto de fondo    ${JSON.stringify(pages?.welcome?.background ?? null)}\n              →  ${JSON.stringify(BACKGROUND)}`);
console.log('');

if (!APPLY) { console.log('  SIMULACIÓN: no se escribió nada. Con --apply escribe (y en una base compartida pide I_KNOW_THIS_TOUCHES_SHARED_DEV=1).\n'); await close(); process.exit(0); }

if (BACKGROUND) {
    const head = await fetch(BACKGROUND, { method: 'HEAD', signal: AbortSignal.timeout(15_000) }).catch(() => null);
    if (!head || !head.ok || !/^image\//.test(head.headers.get('content-type') ?? '')) {
        throw new Error(`la foto ${BACKGROUND} no responde como imagen (HTTP ${head?.status ?? 'sin respuesta'}): no se escribe nada`);
    }
}

// Una sola sentencia, acotada por id Y por nombre: si la fila cambió de dueño no toca nada.
const res = await exec(
    `UPDATE allieds
        SET theme_key='allied-custom',
            token_overrides=JSON_SET(COALESCE(token_overrides, JSON_OBJECT()), '$.primary', ?),
            pages=JSON_SET(pages, '$.welcome.description', ?${BACKGROUND ? ", '$.welcome.background', ?" : ''}),
            updated_at=NOW()
      WHERE id=? AND name=?`, [PRIMARY, after, ...(BACKGROUND ? [BACKGROUND] : []), row.id, row.name]);
console.log(`  ✓ ${res.affectedRows} fila(s) actualizada(s)`);

const now = await one<any>('SELECT theme_key, token_overrides, JSON_EXTRACT(pages, "$.welcome.description") d, JSON_EXTRACT(pages, "$.welcome.background") bg FROM allieds WHERE id=?', [row.id]);
console.log(`  ahora: theme_key=${JSON.stringify(now?.theme_key)} · token_overrides=${JSON.stringify(now?.token_overrides)} · descripción=${now?.d} · fondo=${now?.bg}\n`);
console.log('  ⚠ El wizard guarda la info del comercio 10 min en memoria: el cambio se ve cuando venza la caché.\n');
await close();
