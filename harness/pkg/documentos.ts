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

/**
 * El TECHO numérico, que es una regla distinta del largo y por eso va en su propia tabla.
 *
 * ⚠ NO ES DEL DOCUMENTO: es del proveedor de KYC (TusDatos), y el backend lo dice con todas las letras
 * en los DOS módulos —`Modules/Onboarding/App/Http/Requests/PersonalInfoRequest.php:125` y
 * `Modules/OnboardingV2/App/Http/Requests/StorePersonalInfoRequest.php:164`, verificados contra `main` el
 * 2026-09-18—. Aplica **sólo a un `CC` numérico**, que hoy existe únicamente en Colombia; por eso la
 * tabla tiene una sola entrada y no hay que rellenarla «por simetría» con los otros países.
 *
 * El piso (10.000) lo cumple cualquier número de 5 dígitos o más con el primero distinto de 0, así que
 * no hace falta tabularlo: lo garantiza el armado.
 */
export const TECHO_DEL_DOCUMENTO: Record<string, number> = {
      COL: 3_000_000_000,
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

      const armado = (cuerpo + idx).slice(-largo);

      // ⚠ EL PRIMER DÍGITO SE CORRIGE POR DOS MOTIVOS DISTINTOS, y el segundo costó una corrida entera.
      //
      //   1. no puede ser 0: varios validadores lo leen como número y el largo se pierde;
      //   2. y donde hay TECHO tampoco puede ser cualquiera. Tomar la COLA de la base es justo lo que
      //      tira el prefijo que la hacía válida: el caminador arranca de `BASE_DOC ≈ 1.09e9` —elegida
      //      dentro del rango— y la cola de 8 dígitos de `1095536491` es `95536491`, o sea un documento
      //      de **9.553.649.100**, tres veces por encima del techo.
      //
      // Cómo se veía, el 2026-09-18 contra un comercio colombiano: `personal-info` devolvía **200** en
      // vez del 202 de redirección, con `errors.document_number` en el cuerpo, y la pantalla **no
      // mostraba nada** —el campo del documento vive en un sub-paso anterior del mismo formulario—. El
      // caminador reportaba «5 intentos sin que la pantalla avance» y citaba el texto de la casilla de
      // identidad, que mandaba a depurar el gate de identidad y los mocks de centrales. Es el mismo modo
      // de falla de F-231 y del caso dominicano de arriba: un hueco del arnés con cara de bug del
      // producto — sólo que esta vez ni siquiera había mensaje.
      //
      // Forzar el `1` alcanza mientras el techo esté por encima de 2·10^(largo-1) (con 10 dígitos, todo
      // lo que empiece en 1 es < 2e9 < 3e9). `documentos.spec.ts` fija el rango, no esta línea.
      const techo = TECHO_DEL_DOCUMENTO[(iso || '').toUpperCase()];
      const seExcede = techo !== undefined && Number(armado) > techo;

      return (armado.startsWith('0') || seExcede) ? `1${armado.slice(1)}` : armado;
}
