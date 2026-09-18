/**
 * El NÚMERO DE DOCUMENTO sintético, con la forma que pide el país del comercio.
 *
 * POR QUÉ EXISTE. El caminador generaba siempre un documento de 10 dígitos —forma colombiana— y lo
 * usaba en todos los comercios. Contra CeluRD (República Dominicana) el recorrido moría en
 * `request-personal-info` repitiendo **«La cédula debe tener exactamente 11 dígitos»**: un mensaje del
 * producto para un hueco del harness, que es el modo de falla más caro porque manda a depurar el lado
 * equivocado. Medido el 2026-09-18. Es el mismo caso que **F-231**, pero con el documento en vez del
 * teléfono — y por eso vive acá y no dentro de un runner: la lección ya se pagó una vez.
 *
 * ⚠ DÓNDE VIVE LA VERDAD, Y POR QUÉ NO SE LEE DE AHÍ. La regla autoritativa es la tabla
 * `document_type_rules` del backend: el front la consulta por tipo de documento y, si no está, cae a un
 * respaldo de 6 a 11 dígitos (`document-number-rule.ts`). **Esa tabla no existe en el dump local**
 * —comprobado el 2026-09-18—, así que no hay de dónde leerla y esto es una copia. Si algún día aparece,
 * lo correcto es derivar de ella y borrar esta tabla, no ampliarla.
 *
 * ⚠ Y `countries` NO sirve para esto: declara `document_types` (los códigos: `CC`/`CE`/`PEP`,
 * `CED`/`NUI`, `DNI`/`CE`) pero **no el largo**. Quien vaya a buscarlo ahí no lo va a encontrar.
 */

/** Cuántos dígitos pide cada país. La clave es el ISO-3 que devuelve `formaDeLaSucursal`. */
export const LARGO_DEL_DOCUMENTO: Record<string, number> = {
      COL: 10,   // cédula de ciudadanía
      DOM: 11,   // cédula dominicana — el front lo valida como EXACTAMENTE 11
      PER: 8,    // DNI
};

/** El largo por defecto cuando el país no está en la tabla: el respaldo que usa el front. */
export const LARGO_POR_DEFECTO = 10;

/**
 * Un documento con la forma del país, distinto por caso y reproducible dentro de una corrida.
 *
 * Los DOS ÚLTIMOS dígitos son el índice del caso —igual que en `telefonoSintetico`— porque es lo que
 * garantiza uno por caso, que es la condición para correr en paralelo. El resto sale de la base.
 */
export function documentoSintetico(iso: string, indice: number, base: number): string {
      const largo = LARGO_DEL_DOCUMENTO[(iso || '').toUpperCase()] ?? LARGO_POR_DEFECTO;
      const idx = String(indice % 100).padStart(2, '0');
      // Se repite la base para tener siempre dígitos de sobra, y se toma la COLA: lo que varía entre
      // corridas está al final (misma razón que en `telefonoSintetico`; rellenar desde el principio hace
      // que dos tandas del mismo día produzcan casi el mismo número y choquen de usuario).
      const digitos = String(base).replace(/\D/g, '').repeat(3);
      const cuerpo = digitos.slice(digitos.length - Math.max(largo - idx.length, 0));

      // ⚠ El primer dígito no puede ser 0: varios validadores lo leen como número y el largo se pierde.
      const armado = (cuerpo + idx).slice(-largo);
      return (armado.startsWith('0') ? `1${armado.slice(1)}` : armado);
}
