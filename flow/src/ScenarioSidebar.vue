<script setup>
import { computed, reactive, watch } from 'vue'
import { customLenders, merchant, lenders, ui, selectOffer, editTick, RT_LABEL } from './store'
import { settings } from './settings'
import { readPref, savePref } from './workbench.js'
import ClientForm from './ClientForm.vue'

// El sidebar de Flow (`sidebar` de la base): el ESCENARIO que se simula y lo que se cambia para ver qué pasa. En la banda,
// el comercio y la sucursal; abajo, grupos que se pliegan con el encabezado de grupo de la base (`region-head group`, que
// se pega arriba al scrollear): las entidades —elegir una acá es lo mismo que en la cabecera de la tabla o en el grafo—,
// el cliente y, sólo con el grafo a la vista, su leyenda. (Rediseñado el 2026-11-26.)
const open = reactive({ lenders: true, client: true, legend: true, ...readPref('flow.sidebar-sections', {}) })
watch(open, () => savePref('flow.sidebar-sections', { ...open }), { deep: true })

const rows = computed(() => {
  editTick.n // dependencia: recalcula al editar el cliente
  const byName = Object.fromEntries(lenders.value.map(r => [r.name, r]))
  return customLenders.filter(l => merchant.enabled[l.name]).map(l => {
    const r = byName[l.name]
    return { name: l.name, rt: l.rt, product: l.producto, ok: !!r?.ok, reason: r ? (r.ok ? 'sale en el listado' : r.reason) : 'el país de la entidad no es el del comercio' }
  })
})
const okCount = computed(() => rows.value.filter(r => r.ok).length)
function choose(name) { if (ui.selected === name) ui.selected = null; else selectOffer(name) }
</script>

<template>
  <div class="region-head sc-head" :title="'Comercio y sucursal de la simulación: los carga bin/flow import'">
    <span class="sc-head__name"><span class="ui-icon" data-icon="merchant" aria-hidden="true"></span><span>{{ merchant.nombre || 'Sin comercio' }}</span></span>
    <span class="sc-head__branch">{{ merchant.sucursal }}</span>
  </div>
  <div class="region-body sc">
    <!-- Entidades -->
    <button type="button" class="region-head group sc-group" :aria-expanded="open.lenders" @click="open.lenders = !open.lenders">
      <span>Entidades</span>
      <span class="count" :title="okCount + ' de ' + rows.length + ' salen en el listado'">{{ okCount }} / {{ rows.length }}</span>
      <span class="ui-icon sc-chev" data-icon="down" aria-hidden="true"></span>
    </button>
    <div v-show="open.lenders" class="sc-body sc-body--list">
      <p v-if="!rows.length" class="sc-hint">No hay entidades. Se cargan por consola con
        <code>bin/flow import --branch … --lender …</code></p>
      <div v-else role="listbox" aria-label="Entidades del comercio">
        <button v-for="r in rows" :key="r.name" type="button" role="option" class="row sc-lender"
          :class="{ on: ui.selected === r.name }" :aria-selected="ui.selected === r.name" :title="r.name + ': ' + r.reason"
          @click="choose(r.name)">
          <b class="lg__chip" :class="'rt' + r.rt">rt{{ r.rt }}</b>
          <span class="sc-lender__text">
            <span class="sc-lender__name">{{ r.name }}</span>
            <span class="sc-lender__desc">{{ RT_LABEL[r.rt] }} · {{ r.product }}</span>
          </span>
          <i class="sc-lender__state" :class="r.ok ? 'is-ok' : 'is-bad'">{{ r.ok ? 'sale' : 'no sale' }}</i>
        </button>
      </div>
    </div>

    <!-- Cliente -->
    <button type="button" class="region-head group sc-group" :aria-expanded="open.client" @click="open.client = !open.client">
      <span>Cliente</span>
      <span class="ui-icon sc-chev" data-icon="down" aria-hidden="true"></span>
    </button>
    <div v-show="open.client" class="sc-body"><ClientForm /></div>

    <!-- Leyenda: sólo explica el grafo -->
    <template v-if="settings.view === 'graph'">
      <button type="button" class="region-head group sc-group" :aria-expanded="open.legend" @click="open.legend = !open.legend">
        <span>Leyenda del grafo</span>
        <span class="ui-icon sc-chev" data-icon="down" aria-hidden="true"></span>
      </button>
      <div v-show="open.legend" class="sc-body legend">
        <div class="lg"><span class="lg__chip rt2">rt2</span> CreditopX · decide CreditOp</div>
        <div class="lg"><span class="lg__chip rt4">rt4</span> delegada · su política, cierra acá</div>
        <div class="lg"><span class="lg__chip rt1">rt1</span> agregador · decide su API</div>
        <div class="lg"><span class="lg__chip rt0">rt0</span> redirect · decide su sitio</div>
        <div class="lg lg--dash"><span class="lg__dash"></span> config / herencia</div>
        <div class="lg"><span class="lg__ext"></span> con halo: contesta un tercero</div>
        <div class="lg"><span class="lg__dim"></span> con entidad elegida: su config a media luz y apagado lo que no usa</div>
        <div class="lg"><span class="lg__chip mprod--credito">C</span><span class="lg__chip mprod--renting">R</span><span class="lg__chip mprod--rto">RB</span> productos</div>
        <div class="lg"><i class="kv-dot inh-heredada"></i> heredada <i class="kv-dot inh-editada"></i> editada</div>
        <div class="lg"><i class="lg-sw lg-sw--won"></i> categoría gana <i class="lg-sw lg-sw--off"></i> no aplica <i class="lg-sw lg-sw--fail"></i> no cumple</div>
      </div>
    </template>
  </div>
</template>

<style scoped>
/* La banda: el comercio (lo que se está simulando) y la sucursal apagada al borde. */
.sc-head__name { display: inline-flex; align-items: center; gap: var(--space-2); color: var(--foreground); }
.sc-head__name .ui-icon { color: var(--fg-3); }
.sc-head__name > span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sc-head__branch { flex: none; max-width: 45%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 400; font-size: var(--text-xs); color: var(--fg-3); }

.sc { padding-bottom: var(--space-4); }
/* El encabezado de grupo de la base, como botón que pliega: el chevron al final gira cuando se cierra. */
.sc-group { gap: var(--space-2); padding: 0 var(--gutter); }
.sc-body + .sc-group { margin-top: var(--space-2); }
.sc-chev { flex: none; color: var(--fg-3); transition: transform .15s; }
.sc-group[aria-expanded="false"] .sc-chev { transform: rotate(-90deg); }
.sc-group .count { margin-left: auto; }
.sc-body { padding: var(--space-1) var(--gutter) var(--space-2); }
.sc-body--list { padding: 0 0 var(--space-1); }
.sc-hint { margin: 0; padding: var(--space-1) var(--gutter); font-size: var(--text-sm); line-height: 1.5; color: var(--fg-3); }
.sc-hint code { font-family: var(--font-mono); font-size: var(--text-xs); }

/* Una entidad: el chip del riel, nombre y riel · producto en dos renglones, y si sale, en texto y color. La fila es la
   de la base (con su margen de 4 y la elegida con fondo y barra); el chip y el estado no son `span`, porque la base
   estira cada `span` de una fila para el nombre. */
.sc-lender { width: calc(100% - 2 * var(--space-1)); min-height: 40px; padding: var(--space-1) var(--space-2); border: 0; background: none;
  font: inherit; text-align: left; white-space: normal; }
.sc-lender .lg__chip { flex: none; width: 30px; text-align: center; font-weight: 400; }
.sc-lender__text { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.sc-lender__name { font-size: var(--text-base); color: var(--foreground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sc-lender__desc { font-size: var(--text-xs); color: var(--fg-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sc-lender.on .sc-lender__name, .sc-lender.on .sc-lender__desc { color: var(--accent-foreground); }
.sc-lender__state { flex: none; font-style: normal; font-size: var(--text-xs); display: inline-flex; align-items: center; gap: 5px; }
.sc-lender__state::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.sc-lender__state.is-ok { color: var(--status-ok); }
.sc-lender__state.is-bad { color: var(--status-bad); }

.legend { display: flex; flex-direction: column; gap: var(--space-2); }
.legend .lg { flex-wrap: wrap; }
</style>
