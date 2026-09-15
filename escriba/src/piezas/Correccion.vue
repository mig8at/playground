<script setup>
/* La corrección. Es la pieza por la que existe esta herramienta.
 *
 * Decir «está mal» no enseña nada — lo sabías en cuanto viste el color. Lo que enseña son tres
 * cosas, y van en este orden a propósito:
 *
 *   1. DÓNDE: las dos escrituras alineadas, letra debajo de letra, con el hueco justo debajo de la
 *      que falta. Contesta «¿en qué me equivoqué?» sin que tengas que comparar a ojo.
 *   2. QUÉ CLASE de error fue, en cuatro palabras: «es la tilde», «va junto», «acá va b, no v». En
 *      español el error casi siempre tiene nombre, y el nombre se repite en cientos de palabras.
 *   3. POR QUÉ, o sea la regla. Es lo único que te llevás cuando cierres esto: la palabra suelta se
 *      olvida, la regla decide las próximas doscientas.
 *
 * Y la gemela al final, cuando la hay: la mitad de los errores del español no son «esto se escribe
 * así» sino «esto es OTRA palabra que existe y significa otra cosa». Verla al lado es lo que
 * convierte el error en una distinción.
 */
const props = defineProps({ veredicto: Object, ficha: Object })

// La misma columna se pinta distinto arriba que abajo: lo que en tu línea sobra, en la de abajo es
// un hueco, y al revés.
const clase = (p, fila) =>
  p.estado === 'ok' ? 'ok'
  : fila === 'tuyo' ? (p.t ? 'malo' : 'hueco')
  : (p.c ? 'bueno' : 'hueco')
</script>

<template>
  <div class="correccion" :class="veredicto.bien ? 'bien' : 'mal'">
    <div class="cab">
      <span v-if="veredicto.bien" class="marca">✓</span>
      <span class="palabra">{{ ficha.va }}</span>
      <span v-if="!veredicto.bien && veredicto.diagnostico" class="clase">
        {{ veredicto.diagnostico }}
      </span>
    </div>

    <div v-if="!veredicto.bien" class="diff">
      <div class="linea">
        <span class="rot tenue">escribiste</span>
        <span class="celdas">
          <b v-for="(p, n) in veredicto.pasos" :key="n" :class="['c', clase(p, 'tuyo')]">{{ p.t ?? '·' }}</b>
        </span>
      </div>
      <div class="linea">
        <span class="rot tenue">va</span>
        <span class="celdas">
          <b v-for="(p, n) in veredicto.pasos" :key="n" :class="['c', clase(p, 'va')]">{{ p.c ?? '·' }}</b>
        </span>
      </div>
    </div>

    <p class="porque">{{ ficha.porque }}</p>
    <p v-if="ficha.ojo" class="ojo">{{ ficha.ojo }}</p>
  </div>
</template>

<style scoped>
.correccion{margin-top:22px;padding:14px 16px;border:1px solid var(--line);border-radius:8px;
  background:var(--soft-bg)}
.correccion.bien{border-color:var(--va)}
.correccion.mal{border-color:var(--falla)}

.cab{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:10px}
.marca{font-size:16px;color:var(--va);line-height:1}
.palabra{font-family:Georgia,"Iowan Old Style",serif;font-size:19px;font-weight:600;
  letter-spacing:-.01em}
/* El nombre del error, a la derecha y en el color del fallo: se lee de una pasada, sin leer nada. */
.clase{margin-left:auto;font-size:12px;color:var(--falla)}

/* Monoespaciada y con celdas del mismo ancho: es lo único que hace que el hueco caiga JUSTO debajo
   de la letra que falta. Con tipografía proporcional las dos líneas se desalinean y la corrección
   deja de señalar nada. */
.diff{display:flex;flex-direction:column;gap:3px;margin-bottom:12px;overflow-x:auto}
.linea{display:flex;align-items:center;gap:10px}
.rot{font-size:11px;width:68px;flex:none;text-align:right}
.celdas{display:flex}
.c{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:19px;font-weight:500;
  width:1.05em;text-align:center;white-space:pre}
.c.ok{color:var(--page-soft)}
.c.malo{color:var(--falla);background:color-mix(in srgb,var(--falla) 14%,transparent);border-radius:3px}
.c.bueno{color:var(--va);background:color-mix(in srgb,var(--va) 14%,transparent);border-radius:3px}
.c.hueco{color:var(--line-fuerte)}

/* La regla en el color de la regla, y con una barra al costado: no es una nota al pie, es la
   respuesta de verdad — la palabra se olvida y esto se queda. */
.porque{margin:0;padding-left:11px;border-left:2px solid var(--regla);
  font-size:13.5px;line-height:1.6}
.ojo{margin:9px 0 0;padding-left:11px;border-left:2px solid var(--gemela);
  font-size:12.5px;line-height:1.55;color:var(--page-soft)}
</style>
