import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * La corrida escrita como ANOTACIÓN del tablero, lista para pegar.
 *
 * POR QUÉ EXISTE, y es un hueco medido y no una simetría. El tablero PARSEA la evidencia de una
 * anotación: las líneas de cita que siguen al marcador son su `Como`, y de ahí `store.SourcesOf`
 * deriva **con qué** se comprobó y **contra qué ambiente** —el ambiente, sólo si hay un `TARGET=`
 * escrito—. Ese mecanismo está construido, con su UI, y el 2026-09-18 estaba vacío en el 86 % de los
 * casos: de 350 anotaciones, 308 tenían texto debajo y **51** dejaban una fuente reconocible.
 *
 * La causa probable es de herramienta, no de disciplina. El trazador emite su anotación ya escrita
 * (`MD=1`) y el arnés no tenía equivalente — y el arnés aparece en **33 de 68** tareas, el doble que el
 * trazador. Donde hay que escribirla a mano sale prosa; donde la emite la herramienta, sale el comando.
 *
 * ⚠ EL CONTRATO LO FIJA EL PARSER DEL TABLERO, no el gusto de acá: el marcador con tipo y fecha
 * arranca la primera línea, TODAS las líneas van dentro de la cita, y el comando cierra como
 * `Cómo se vuelve a comprobar`. Si esto deriva, la anotación se pega y la pestaña Hallazgos no la ve.
 * `anotacion.spec.ts` lo fija contra la misma forma que exige `store.Annotations`.
 *
 * ⚠ Y EL TIPO ES SIEMPRE `MEDICIÓN`, igual que en el trazador: esto sale de correr algo. Una `DECISIÓN`
 * o un `RIESGO` los escribe una persona — una herramienta que los generara estaría inventando el juicio.
 */

/** Lo que el shell no toca. Todo lo demás se entrecomilla: un `CASOS='a@b=c;d'` lleva `@`, `=` y `;`,
 *  y pegarlo sin comillas es un comando que falla en la cara de quien confió en él. */
const SEGURO_EN_SHELL = /^[A-Za-z0-9_@%+=:,./-]+$/;

const comillar = (v: string) => (SEGURO_EN_SHELL.test(v) ? v : `'${v.replaceAll("'", `'\\''`)}'`);

/**
 * El comando de `make` que reproduce la corrida.
 *
 * ⚠ VA EL `make`, NO EL RUNNER. `npx tsx dev/caso.ts …` no se corre desde la raíz del playground, que
 * es desde donde se corre todo lo demás; `make harness-caso CASOS=…` sí. Lo que una herramienta te pasa
 * tiene que ser pegable donde estás parado.
 *
 * ⚠ Y EL TARGET VA SIEMPRE, aunque sea el default — que acá además **no es `local`**: `E2E_TARGET` cae
 * en `dev` si nadie lo dice (`pkg/db.ts`). Una salida sin ambiente no se puede repetir ni contrastar, y
 * en esta casa dev y staging comparten la misma base: es la trampa de F-53 escrita en una anotación.
 */
export function cmdMake(nombre: string, target: string, kv: Record<string, string | number | undefined> = {}): string {
      const partes = [`make ${nombre}`];
      for (const [k, v] of Object.entries(kv)) {
            if (v === undefined || v === '' || v === 0) continue;
            partes.push(`${k}=${comillar(String(v))}`);
      }
      // El target al final y siempre: se lee como la firma de la corrida.
      partes.push(`TARGET=${target}`);
      return partes.join(' ');
}

/**
 * La anotación completa. `resumen` es UNA línea —lo que va a quedar escrito en la tarea— y `evidencia`
 * son las líneas de apoyo; una vacía deja un renglón en blanco DENTRO de la cita, que es como se separa
 * un bloque sin salirse de ella.
 */
export function anotacionMD(resumen: string, cmd: string, evidencia: string[] = []): string {
      const hoy = new Date().toLocaleDateString('sv-SE');  // sv-SE da YYYY-MM-DD en hora LOCAL
      const out = [`> **MEDICIÓN · ${hoy}** — ${resumen}`];
      for (const l of evidencia) out.push(l.trim() === '' ? '>' : `> ${l}`);
      out.push(`> **Cómo se vuelve a comprobar:** \`${cmd}\``);
      return out.join('\n') + '\n';
}

/** El pie que imprime cualquier corrida: cómo se la vuelve a sacar. Mismo glifo que el trazador (`↻`),
 *  porque es la misma promesa y se aprende una sola vez. */
export const pie = (cmd: string) => `\n     ↻ ${cmd}`;

/* ─── LA CORRIDA COMO BLOQUE DE LA PILA DE UNA TAREA (`BLOQUE=<tarea>`) ─────────────────────────────
 *
 * Desde el 2026-09-23 la pila de una tarea es de BLOQUES: un título —la conclusión, en una línea— y una
 * descripción en prosa, donde cada comando va en su caja con su `Resultado:`. Con `BLOQUE=<id|slug>` la
 * corrida se agrega sola a la pila de esa tarea, con `via: harness`: lo que la emite es la herramienta,
 * no alguien que la copió, y eso cambia cuánto se le cree.
 *
 * ⚠ El bloque NO se valida acá: entra por `make tarea-bloque`, que lo pasa por el validador del tablero
 * (server/internal/taskcontext/block.go). Una copia de sus reglas en TypeScript derivaría en silencio;
 * `anotacion.spec.ts` le pregunta al validador de verdad, en seco.
 */

/** La raíz del playground: `harness/pkg/` → `harness/` → playground. Desde ahí se corre `make`. */
export const PLAYGROUND = fileURLToPath(new URL('../../', import.meta.url));

/** Lo que el validador rechazaría por forma, no por contenido: HTML y rutas de esta máquina. */
const limpiar = (s: string) => s.replace(/[\r\n]+/g, ' ').replaceAll('<', '‹').replaceAll('>', '›')
      .replace(/\/(?:Users|home)\/[^/\s]+\//g, '…/').replace(/(^|\s)~\//g, '$1…/').trim();

/** El título es la conclusión en UNA línea de hasta 120 caracteres: el resumen de la corrida. */
export function tituloBloque(resumen: string): string {
      const t = limpiar(resumen).replace(/\.$/, '');
      return [...t].length <= 120 ? t : [...t].slice(0, 119).join('') + '…';
}

/**
 * El bloque en el Markdown que recibe `make tarea-bloque`: `# título`, y el comando en su caja con lo que
 * dio. `resultado` es la evidencia por caso, en una línea; sin evidencia, el resumen.
 */
export function bloqueMD(resumen: string, cmd: string, evidencia: string[] = []): string {
      const resultado = evidencia.map(limpiar).filter(Boolean).join('; ') || limpiar(resumen);
      const corto = [...resultado].length <= 2000 ? resultado : [...resultado].slice(0, 1999).join('') + '…';
      return `# ${tituloBloque(resumen)}\n\n\`\`\`harness\n${cmd}\n\`\`\`\nResultado: ${corto}\n`;
}

/**
 * Lo agrega a la pila de la tarea por la puerta de siempre. `seco` valida sin escribir.
 *
 * ⚠ Con el entorno de `make` LIMPIO: esto corre adentro de un target del harness, y un `make` hijo hereda
 * por MAKEFLAGS las variables de la línea de comando del padre (`TARGET=`, `CASOS=`…). No rompería hoy,
 * pero un `N=` o un `SECO=` que viniera de afuera cambiaría a qué tarea va el bloque sin decirlo.
 */
export function agregarBloque(tarea: string, md: string, seco = false): { ok: boolean; salida: string } {
      const env = { ...process.env };
      for (const k of ['MAKEFLAGS', 'MFLAGS', 'MAKELEVEL', 'MAKEOVERRIDES']) delete env[k];
      const r = spawnSync('make', ['-s', '-C', PLAYGROUND, 'tarea-bloque', `N=${tarea}`, 'ARCHIVO=-', 'VIA=harness',
            ...(seco ? ['SECO=1'] : [])], { input: md, encoding: 'utf8', env });
      return { ok: r.status === 0, salida: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim() };
}

/**
 * La salida de una corrida para la tarea: la anotación con `MD=1` y el bloque con `BLOQUE=<tarea>`.
 * Un bloque que no entra no cambia el desenlace de la corrida —la corrida pasó o no pasó igual—, pero
 * se dice fuerte, porque «no se agregó» leído como «se agregó» es una tarea sin su prueba.
 */
export function emitir(resumen: string, cmd: string, evidencia: string[] = []): void {
      if (process.env.MD === '1') console.log('\n' + anotacionMD(resumen, cmd, evidencia));
      const tarea = process.env.BLOQUE;
      if (!tarea) return;
      const { ok, salida } = agregarBloque(tarea, bloqueMD(resumen, cmd, evidencia));
      console.log(ok ? `\n  ▸ bloque agregado a la pila de la tarea ${tarea}`
            : `\n  ✗ el bloque NO se agregó a la tarea ${tarea}:\n     ${salida.split('\n').slice(-3).join('\n     ')}`);
}
