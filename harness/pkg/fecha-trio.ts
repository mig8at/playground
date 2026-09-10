// fecha-trio.ts — QUÉ PARTE DE UNA FECHA ES CADA COMBO, Y QUÉ VALOR LE VA.
//
// POR QUÉ EXISTE. Un trío día/mes/año de Radix no se rellena «eligiendo la primera opción de cada
// uno»: eso produce `1 / Enero / <año actual>`, o sea el día de hoy — y como fecha de expedición de un
// documento es una fecha que ninguna validación de negocio acepta. Esa regla la sabía UN solo
// autorrelleno de los dos que tiene el harness, y el otro escribía la fecha inválida sin que nada
// avisara (medido el 2026-09-10: el caminado con navegador dejó al usuario de la uReq 502193 con
// `expedition_date = 2026-01-01`). Acá vive la DECISIÓN, una vez, y cada autorrelleno hace su parte
// mecánica con la respuesta:
//
//   · `pkg/autorelleno.ts` (una `r`) corre DENTRO de la página, inyectado — usa `fuenteInyectable()`.
//   · `pkg/autorrelleno.ts` (dos `r`) maneja Playwright desde afuera — importa las funciones.
//
// ⚠ NO se unificaron los dos ARCHIVOS, y es a propósito: uno vive en el DOM de la página y el otro
// habla por el protocolo de Playwright, así que juntarlos pediría una capa de indirección más grande
// que la duplicación que evita. Lo que no puede estar en dos lados es la REGLA, y eso es esto.

/**
 * LAS DOS FECHAS SINTÉTICAS, con años PLAUSIBLES y no «hoy».
 *
 * La de nacimiento tiene que pasar el rango de edad de las reglas duras (18–82) y la de expedición
 * tiene que ser posterior a la mayoría de edad. Una fecha de relleno que no pasa la validación no
 * ahorra tipeo: lo duplica — y peor, hace fallar la corrida por el dato que el arnés inventó y no por
 * el producto.
 *
 * ⚠ Viven acá, con la regla que las usa, porque los DOS autorrellenos las necesitan y antes sólo las
 * tenía uno. `process.env` sólo se lee de este lado: las funciones que se serializan para la página
 * están más abajo y reciben la fecha ya resuelta por parámetro.
 */
export function fechasSinteticas(): { nacimiento: string; expedicion: string } {
      return {
            nacimiento: process.env.E2E_SYNTH_NACIMIENTO || '1990-05-14',
            expedicion: process.env.E2E_SYNTH_EXPEDICION || '2010-08-20',
      };
}

/** Los meses en minúsculas y sin acentos, en el orden del calendario (índice 0 = enero). */
export const MESES = [
      'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
      'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

/** Qué parte de una fecha es un combo. `null` = no parece parte de una fecha. */
export type ParteDeFecha = 'dia' | 'mes' | 'anio';

// ───────────────────────────────────────────────────────────────────────────────────────────────────
// ⚠ LAS CUATRO FUNCIONES DE ABAJO SE SERIALIZAN con `Function.prototype.toString()` para inyectarlas
// en la página (`fuenteInyectable`). Eso impone dos reglas, y romperlas falla en el navegador y no
// acá:
//
//   1 · no pueden cerrar sobre NADA de este módulo — ni `MESES`, que se les pasa por parámetro;
//   2 · su cuerpo tiene que sobrevivir el borrado de tipos de Node, que reemplaza las anotaciones por
//       espacios. Hoy sobrevive; `fecha-trio.spec.ts` lo comprueba evaluando la fuente generada, así
//       que si una versión de Node cambia eso, se cae una prueba en vez de un flujo.
// ───────────────────────────────────────────────────────────────────────────────────────────────────

/** Minúsculas y sin acentos: la pista de un campo llega escrita de las dos formas. */
export function normalizarTexto(s: string): string {
      return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

/**
 * Qué parte de la fecha es este combo, deducido por TRES señales en orden de confianza. Ninguna sola
 * alcanza, y por eso están las tres:
 *
 *   1 · EL VALOR QUE MUESTRA. Un nombre de mes es el mes; cuatro dígitos, el año; uno o dos, el día.
 *       Es la señal del trío que nace con un default puesto (`1 / Enero / 2026`), que es lo que ve el
 *       autorrelleno inyectado.
 *   2 · EL PLACEHOLDER O LA ETIQUETA. Cuando el combo está VACÍO no muestra ningún valor, sino
 *       «Día*», «Mes*», «Año*» — que es lo que ve el autorrelleno de Playwright, y por lo que la
 *       señal 1 no le servía.
 *   3 · LA POSICIÓN. Último recurso, y honesto sobre lo que asume: día, mes, año en el orden del DOM,
 *       que es el de este front. Si algún día una pantalla los pone al revés, esta es la señal que
 *       miente — y las otras dos la tapan mientras haya valor o etiqueta.
 */
export function parteDeCombo(
      texto: string, etiqueta: string, indice: number, meses: string[],
): ParteDeFecha | null {
      const norma = (s: string) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
      const t = norma(texto);

      // 1 · por el valor que muestra
      if (meses.indexOf(t) >= 0) return 'mes';
      if (/^\d{4}$/.test(t)) return 'anio';
      if (/^\d{1,2}$/.test(t)) return 'dia';

      // 2 · por el placeholder o la etiqueta
      const e = norma(etiqueta) + ' ' + t;
      if (/\bmes\b|\bmonth\b/.test(e)) return 'mes';
      if (/\bano\b|\banio\b|\byear\b/.test(e)) return 'anio';
      if (/\bdia\b|\bday\b/.test(e)) return 'dia';

      // 3 · por la posición
      if (indice === 0) return 'dia';
      if (indice === 1) return 'mes';
      if (indice === 2) return 'anio';
      return null;
}

/**
 * Los textos que sirven para elegir esa parte, del más probable al menos. Se devuelven VARIOS porque
 * el mismo día se escribe `5` o `05` según la pantalla, y el mes puede venir por nombre o por número.
 */
export function valorBuscado(parte: ParteDeFecha, fecha: string, meses: string[]): string[] {
      const partes = (fecha || '').split('-');
      const aa = partes[0] || '';
      const mm = partes[1] || '';
      const dd = partes[2] || '';
      if (parte === 'anio') return [aa];
      if (parte === 'mes') return [meses[Number(mm) - 1] || '', String(Number(mm)), mm].filter(Boolean);
      return [String(Number(dd)), dd].filter(Boolean);
}

/**
 * CUÁL de las dos fechas pide esta pantalla. Se decide por el texto de arriba porque es la única
 * señal que hay: los combos no traen `name` ni `id`.
 *
 * ⚠ Límite conocido, heredado y sin resolver: si una pantalla pidiera las DOS fechas a la vez, esto
 * no las distinguiría. Hoy no existe, y el día que exista la señal tiene que venir del componente.
 */
export function fechaDeLaPantalla(textoDeArriba: string, nacimiento: string, expedicion: string): string {
      const norma = (s: string) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
      return /expedicion|expedid|issue/.test(norma(textoDeArriba)) ? expedicion : nacimiento;
}

/**
 * ¿Este combo ya muestra lo que queremos? Es lo que hace el relleno IDEMPOTENTE, y reemplaza a
 * recordar qué elementos se tocaron: Radix REEMPLAZA el nodo del trigger al cambiar su valor, así que
 * una memoria por elemento no sobrevive a la segunda pasada — y la fecha se volvía a elegir. Eso es lo
 * que se veía como «la fecha de expedición cambia dos veces».
 */
export function yaMuestra(texto: string, buscado: string[]): boolean {
      const norma = (s: string) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
      const t = norma(texto);
      return t !== '' && buscado.some((b) => norma(b) === t);
}

/**
 * ¿Estos combos son un trío de fecha, o uno suelto que casualmente muestra un número? Se exige que
 * haya al menos tres y que entre ellos aparezcan las tres partes distintas — con un solo combo que
 * diga «5» no se puede afirmar nada.
 */
export function esTrioDeFecha(partes: Array<ParteDeFecha | null>): boolean {
      const vistas = partes.filter(Boolean);
      return vistas.length >= 3
            && vistas.indexOf('dia') >= 0 && vistas.indexOf('mes') >= 0 && vistas.indexOf('anio') >= 0;
}

/**
 * La fuente de las funciones de arriba, como texto, para inyectarla en la página con
 * `addInitScript({ content })`. Deja un solo global, `window.__trioFecha`.
 *
 * ⚠ Esto existe porque el autorrelleno del camino visual se SERIALIZA: `addInitScript(fn)` manda la
 * función como texto, así que no puede importar. La alternativa era duplicar la regla, que es
 * exactamente lo que este módulo vino a evitar.
 */
export function fuenteInyectable(): string {
      return `window.__trioFecha = {
    MESES: ${JSON.stringify(MESES)},
    normalizarTexto: ${normalizarTexto},
    parteDeCombo: ${parteDeCombo},
    valorBuscado: ${valorBuscado},
    fechaDeLaPantalla: ${fechaDeLaPantalla},
    yaMuestra: ${yaMuestra},
    esTrioDeFecha: ${esTrioDeFecha},
};`;
}
