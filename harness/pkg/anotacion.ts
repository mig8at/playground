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
