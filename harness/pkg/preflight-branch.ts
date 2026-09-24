// preflight-branch.ts — ¿LA SUCURSAL QUE ANUNCIAMOS ES LA QUE VA A USAR EL WIZARD?
//
// POR QUÉ EXISTE. El panel anuncia, antes de correr, qué entidades le van a salir al cliente. Esas
// entidades NO están quemadas: las lee de la base (`dbops lenders-for <hash>` →
// `lenders_by_allied_branches`). Lo que estaba mal es **de qué sucursal** las lee, y ahí hay TRES
// fuentes que nadie compara:
//
//   1. `.flows.json` — un catálogo estático, mantenido a mano, que mapea `slug → branch_hash`. Es lo
//      que usa el panel para anunciar (`branchHashForSlug`) y lo que `bin/advisor` le pasa al wizard.
//   2. `E2E_ASESOR_SUB` de `.env.<target>` — el asesor con el que se va a loguear. Su sucursal REAL la
//      decide la base (`users.allied_branch_id`), y el wizard la lee por el backend.
//   3. La sesión de Cognito cacheada en `.auth/` — si quedó de otra corrida, el que loguea puede ser
//      OTRO asesor, con OTRA sucursal.
//
// Cuando desacuerdan, el panel anuncia las entidades de una sucursal y la corrida usa las de otra, sin
// un solo aviso. Medido el 2026-09-15 contra `qa` con Amoblando Pullman:
//
//   · `.flows.json` decía `13874eb6` (branch 659) → Sistecrédito · CrediPullman · Cierre X
//   · el wizard aterrizó en `ec977139` (branch 390) → Addi · Vanti · CrediPullman · Crédito 365
//
// Y peor: el `E2E_ASESOR_SUB` de `.env.qa` resuelve a `1bfb8cd0` (CeluRD Santo Domingo) y su email es
// de OTRA PERSONA. O sea que las tres fuentes daban tres respuestas distintas.
//
// ⚠ EL CHEQUEO QUE YA EXISTÍA NO ALCANZA. `bin/advisor` y el panel comparan
// `whois(SUB).matches[0].allied_branch_hash` contra el hash del catálogo y, si coinciden, imprimen «ya
// en X — sin write». Eso mira la BASE, que es un proxy: el wizard no usa `users.allied_branch_id`
// directamente, usa lo que le devuelve el backend para el sub que REALMENTE está logueado. Por eso la
// corrida del 15/9 imprimió «ya en 'pullman' (13874eb6) — sin write» y se fue a `ec977139`.
//
// QUÉ HACE ESTO, Y QUÉ NO. Es SÓLO LECTURA: no escribe en ninguna base, no reasigna a nadie, no
// invalida sesiones. Contesta una pregunta y devuelve el desajuste para que quien llama lo imprima y
// decida. La decisión de arreglarlo (reasignar, borrar la sesión) sigue siendo de quien corre.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { env } from './env.ts';

const ROOT = join(dirname(new URL(import.meta.url).pathname), '..');

/** El hash que declara `.flows.json` para un slug, por target. Espeja `branchHashForSlug` del panel. */
export function catalogHash(slug: string, target = 'local'): string {
      try {
            const j = JSON.parse(readFileSync(join(ROOT, '.flows.json'), 'utf8'));
            const m = j?.merchants?.[slug];
            const h = m?.por_target?.[target] ?? m?.branch_hash;
            if (h) return String(h);
      } catch {
            /* sin catálogo legible → cae al fallback */
      }
      // El buscador del panel deja elegir una sucursal que no está en el catálogo: ahí el "slug" ES el
      // hash, y entonces no hay catálogo con el que desacordar.
      const s = slug.trim().toLowerCase();
      return /^[0-9a-f]{8}$/.test(s) ? s : '';
}

/**
 * EL SUB DEL ASESOR, por la MISMA cadena que usa todo el harness: `E2E_ASESOR_SUB` del
 * `.env.<target>` y, si no está, `asesor.sub` de `.flows.json`.
 *
 * ⚠ Vive acá porque los tres que preguntan lo resolvían cada uno a su manera: `bin/advisor` con
 * `envget` + `fget`, el panel con `advisorSub()`, y el caminador leía sólo la variable de entorno — que
 * en `local` no está, así que su chequeo se saltaba sin decir nada y parecía que no había desajuste.
 * Tres implementaciones de la misma pregunta es como una se queda atrás.
 */
export function advisorSubject(): string {
      const fromEnv = env('E2E_ASESOR_SUB').trim();
      if (fromEnv) return fromEnv;
      try {
            const j = JSON.parse(readFileSync(join(ROOT, '.flows.json'), 'utf8'));
            return String(j?.asesor?.sub ?? '').trim();
      } catch {
            return '';
      }
}

/** La base del backend para un target, la misma cadena que usa el resto del harness. */
function apiBase(): string {
      const b = env('E2E_API_BASE_URL') || `${env('E2E_MOCK_URL', 'http://localhost').replace(/\/$/, '')}/api`;
      return b.replace(/\/+$/, '').replace(/\/api$/, '');
}

export interface AdvisorBranch {
      userId: number | null;
      hash: string;
      nombre: string;
      email: string;
}

/**
 * LA SUCURSAL QUE EL BACKEND LE DA A ESE ASESOR — no la que dice la base.
 *
 * ⚠ La diferencia importa: `users.allied_branch_id` es de dónde SALE el dato, pero el wizard lo pide
 * por `GET /api/onboarding/loan-application/user` con el header `x-cognito-identity-id: <sub>` y usa
 * `data.user.allied_branch.hash` (`user.server.ts` → `default-layout.tsx`). Preguntarle al backend es
 * preguntar por lo que el wizard va a hacer; leer la tabla es adivinarlo.
 *
 * Devuelve `null` si el backend no contesta o no reconoce al sub (sin inventar nada).
 */
export async function advisorBranch(sub: string, timeoutMs = 20_000): Promise<AdvisorBranch | null> {
      if (!sub.trim()) return null;
      try {
            const res = await fetch(`${apiBase()}/api/onboarding/loan-application/user`, {
                  method: 'GET',
                  headers: { Accept: 'application/json', 'x-cognito-identity-id': sub },
                  signal: AbortSignal.timeout(timeoutMs),
            });
            if (!res.ok) return null;
            const j = (await res.json()) as any;
            const u = j?.data?.user;
            if (!u) return null;
            return {
                  userId: Number(u.id) || null,
                  hash: String(u.allied_branch?.hash ?? ''),
                  nombre: String(u.allied_branch?.name ?? ''),
                  email: String(u.email ?? ''),
            };
      } catch {
            return null;
      }
}

export interface Mismatch {
      /** `true` sólo cuando se pudo comprobar Y coinciden. Un `false` con `motivo` de «no se pudo» NO es un desajuste. */
      coincide: boolean;
      /** `true` cuando se comprobó de verdad (el backend contestó). */
      comprobado: boolean;
      slug: string;
      target: string;
      esperada: string;
      asesor: AdvisorBranch | null;
      sub: string;
      motivo: string;
}

/**
 * Compara lo que vamos a ANUNCIAR contra lo que el backend le da a ESE asesor.
 *
 * No es el chequeo completo —falta la tercera fuente, la sesión cacheada, que no se puede leer sin
 * loguear (el `storageState` guarda cookies cifradas, no un JWT)—, y por eso existe además
 * `redirectNotice()`: esa mitad se caza EN la corrida, cuando el wizard redirige.
 */
export async function preflightBranch(slug: string, target: string, sub: string): Promise<Mismatch> {
      const expectedOne = catalogHash(slug, target);
      const base: Mismatch = {
            coincide: false, comprobado: false, slug, target, esperada: expectedOne, asesor: null, sub, motivo: '',
      };
      if (!expectedOne) return { ...base, motivo: `no sé el hash de la sucursal de '${slug}'` };
      if (!sub.trim()) return { ...base, motivo: `sin E2E_ASESOR_SUB para ${target}: no hay a quién preguntarle` };

      const advisor = await advisorBranch(sub);
      if (!advisor) {
            return { ...base, motivo: `el backend de ${target} no contestó, o no reconoce ese sub — no se pudo comprobar` };
      }
      if (!advisor.hash) {
            return { ...base, comprobado: true, asesor: advisor, motivo: 'el asesor no tiene sucursal asignada' };
      }
      return {
            ...base,
            comprobado: true,
            coincide: advisor.hash === expectedOne,
            asesor: advisor,
            motivo: advisor.hash === expectedOne ? 'coinciden' : 'el catálogo y el backend dan sucursales distintas',
      };
}

/**
 * El aviso, en líneas listas para imprimir. Vacío cuando coinciden (no se anuncia lo que está bien).
 *
 * Se devuelve como texto y no se imprime acá porque los dos que llaman formatean distinto: el panel lo
 * mete en su rastro y `bin/advisor` lo saca por stdout.
 */
export function mismatchNotice(d: Mismatch): string[] {
      if (d.coincide) return [];
      if (!d.comprobado) return [`⚠ sucursal sin verificar: ${d.motivo}`];
      const real = d.asesor?.hash ? `${d.asesor.hash} (${d.asesor.nombre || '?'})` : '(ninguna)';
      return [
            `⚠ LA SUCURSAL ANUNCIADA NO ES LA QUE VA A USAR EL WIZARD, así que las entidades de arriba`,
            `  pueden no ser las que veas:`,
            `    · el catálogo (.flows.json) dice   ${d.esperada}`,
            `    · el backend le da a este asesor   ${real}`,
            `      (users#${d.asesor?.userId ?? '?'} · ${d.asesor?.email || 'sin email'})`,
            `  El wizard usa la del backend y te va a redirigir ahí. Para alinearlas: asigná el asesor a`,
            `  la sucursal que querés correr, o corré contra la que ya tiene.`,
      ];
}

/**
 * LA OTRA MITAD, y la que caza el caso sin importar cuál de las tres fuentes esté mal: si el wizard
 * REDIRIGE a otra sucursal, lo anunciado ya no vale.
 *
 * `bin/advisor` y los runners ya ven ese 302 y lo imprimen como un salto más de la navegación. Esto lo
 * convierte en lo que es: el aviso de que el anuncio caducó.
 */
export function redirectNotice(requested: string, landed: string): string[] {
      if (!requested || !landed || requested === landed) return [];
      return [
            `⚠ EL WIZARD TE MOVIÓ DE SUCURSAL: pediste ${requested} y aterrizaste en ${landed}.`,
            `  Las entidades que anunció el panel son las de ${requested} — las que vas a ver son las de`,
            `  ${landed}. Es la sucursal que el backend tiene asignada al asesor logueado, y gana`,
            `  siempre sobre la del catálogo. Si la sesión de .auth/ quedó de otra corrida, puede ser`,
            `  incluso otro asesor: borrala y volvé a loguear.`,
      ];
}
