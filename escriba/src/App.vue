<script setup>
import { computed } from 'vue'
import { hayVoz, vozElegida } from './voz.js'
import Sidebar from './piezas/Sidebar.vue'
import Ejercicio from './piezas/Ejercicio.vue'

/* Las reglas se descubren solas. Agregar una es dejar caer un .json en data/reglas/ — no hay índice
   que actualizar, y por lo tanto no hay índice que quede viejo. El nombre del archivo ordena. */
const modulos = import.meta.glob('../data/reglas/*.json', { eager: true })
const reglas = Object.entries(modulos)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([, m]) => m.default ?? m)

const cuantos = computed(() => reglas.reduce((n, r) => n + (r.items?.length ?? 0), 0))
</script>

<template>
  <div class="app">
    <Sidebar :reglas="reglas" />

    <div class="col">
      <header class="head">
        <h1 class="marca">escriba</h1>
        <span class="lema tenue">ortografía por reglas, no por lista · {{ cuantos }} frases</span>
        <!-- Qué voz dicta NO es un detalle de configuración acá: decide si un bloque entero del
             ejercicio se puede resolver escuchando. Por eso está a la vista y no escondida. -->
        <span v-if="hayVoz()" class="voz tenue">lee {{ vozElegida() }}</span>
      </header>

      <div class="cuerpo">
        <Ejercicio :reglas="reglas" />
      </div>

      <footer class="leyenda">
        <span><i class="m va"></i>lo que va</span>
        <span><i class="m falla"></i>lo que escribiste</span>
        <span><i class="m regla"></i>la regla</span>
        <span><i class="m gemela"></i>la gemela</span>
        <span class="tenue der"><b>⏎</b> comprueba · <b>shift</b> repite la frase ·
          la que fallás vuelve a salir</span>
      </footer>
    </div>
  </div>
</template>

<style scoped>
/* `minmax(0,1fr)` en las FILAS, no sólo en las columnas. Una fila de grid es `auto` por defecto:
   crece con su contenido aunque el contenedor tenga `height:100%` y `overflow:hidden`, y entonces
   ningún `overflow-y:auto` de adentro tiene qué recortar. */
.app{display:grid;grid-template-columns:min(320px,32vw) 1fr;grid-template-rows:minmax(0,1fr);
  height:100%;overflow:hidden}
.col{display:flex;flex-direction:column;min-width:0;min-height:0;height:100%}

.head{display:flex;align-items:baseline;gap:12px;padding:10px 16px;
  border-bottom:1px solid var(--line);background:var(--panel)}
.marca{font-family:Georgia,"Iowan Old Style",serif;font-size:17px;font-weight:600;
  letter-spacing:-.02em}
.lema{font-size:12px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.voz{font-size:11px;flex:none}

/* `min-height:0` NO es adorno: sin él este bloque no scrollea. Un item flex arranca con
   `min-height:auto`, así que en vez de encogerse al alto disponible crece con su contenido y
   `overflow-y:auto` no tiene nada que recortar. El síntoma es que la rueda no hace nada. */
.cuerpo{flex:1;min-height:0;overflow-y:auto}

.leyenda{display:flex;align-items:center;gap:16px;flex-wrap:wrap;
  padding:8px 16px;border-top:1px solid var(--line);background:var(--panel);
  font-size:11.5px;color:var(--page-soft)}
.leyenda span{display:inline-flex;align-items:center;gap:6px}
.leyenda .der{margin-left:auto}
.m{width:14px;height:0;border-bottom-width:2px;border-bottom-style:solid;display:inline-block}
.m.va{border-bottom-color:var(--va)}
.m.falla{border-bottom-color:var(--falla)}
.m.regla{border-bottom-color:var(--regla)}
.m.gemela{border-bottom-color:var(--gemela)}

@media (max-width:900px){
  .app{grid-template-columns:1fr;grid-template-rows:auto minmax(0,1fr)}
  .side{max-height:38vh}
}
</style>
