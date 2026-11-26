<script setup>
import { computed, reactive, watch } from 'vue'
import { customLenders, merchant, lenders, ui, selectOffer, editTick, RT_LABEL } from './store'
import { readPref, savePref } from './workbench.js'
import ClientForm from './ClientForm.vue'

// El sidebar de Flow (`sidebar` de la base, 2026-11-26): el ESCENARIO que se simula, y lo que se cambia para ver qué pasa.
// Tres secciones plegables (`<details>`, porque se pliegan dentro de un cuerpo que scrollea): las entidades del comercio
// —elegir una acá es lo mismo que en «Entidades disponibles» del grafo—, el cliente y la leyenda del grafo, que antes
// flotaba sobre el lienzo.
const open = reactive({ lenders: true, client: true, legend: false, ...readPref('flow.sidebar-sections', {}) })
watch(open, () => savePref('flow.sidebar-sections', { ...open }), { deep: true })
const onToggle = (key, e) => { open[key] = e.target.open }

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
  <div class="region-head">
    <span>Escenario</span>
  </div>
  <div class="region-body scenario">
    <div class="scenario-merchant" :title="'Comercio y sucursal de la simulación (los carga bin/flow import)'">
      <span class="ui-icon" data-icon="merchant" aria-hidden="true"></span>
      <span class="scenario-merchant__name">{{ merchant.nombre || 'Sin comercio' }}</span>
      <span class="scenario-merchant__branch">{{ merchant.sucursal }}</span>
    </div>

    <details class="accordion-item scenario-sec" :open="open.lenders" @toggle="onToggle('lenders', $event)">
      <summary class="accordion-trigger"><span>Entidades <span class="count">{{ okCount }} / {{ rows.length }}</span></span><span class="ui-icon accordion-chev" data-icon="down" aria-hidden="true"></span></summary>
      <div class="accordion-content">
        <p v-if="!rows.length" class="scenario-hint">No hay entidades. Se cargan por consola:
          <code>bin/flow import --branch … --lender …</code></p>
        <div v-else role="listbox" aria-label="Entidades del comercio">
          <button v-for="r in rows" :key="r.name" type="button" role="option" class="row lender-row"
            :class="{ on: ui.selected === r.name }" :aria-selected="ui.selected === r.name" :title="r.name + ' · ' + r.reason"
            @click="choose(r.name)">
            <b class="lg__chip" :class="'rt' + r.rt">rt{{ r.rt }}</b>
            <span class="lender-row__text">
              <span class="lender-row__name">{{ r.name }}</span>
              <span class="row-desc">{{ RT_LABEL[r.rt] }} · {{ r.product }}</span>
            </span>
            <i class="lender-row__dot" :class="r.ok ? 'is-ok' : 'is-bad'" role="img" :aria-label="r.ok ? 'sale' : 'no sale'"></i>
          </button>
        </div>
      </div>
    </details>

    <details class="accordion-item scenario-sec" :open="open.client" @toggle="onToggle('client', $event)">
      <summary class="accordion-trigger"><span>Cliente</span><span class="ui-icon accordion-chev" data-icon="down" aria-hidden="true"></span></summary>
      <div class="accordion-content"><ClientForm /></div>
    </details>

    <details class="accordion-item scenario-sec" :open="open.legend" @toggle="onToggle('legend', $event)">
      <summary class="accordion-trigger"><span>Leyenda</span><span class="ui-icon accordion-chev" data-icon="down" aria-hidden="true"></span></summary>
      <div class="accordion-content legend">
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
    </details>
  </div>
</template>

<style scoped>
.scenario { padding: 0 var(--gutter) var(--space-4); }
.scenario-merchant { display: flex; align-items: center; gap: var(--space-2); min-height: var(--row-h); padding: var(--space-2) 0;
  border-bottom: 1px solid var(--border); font-size: var(--text-base); color: var(--fg-2); }
.scenario-merchant .ui-icon { color: var(--fg-3); }
.scenario-merchant__name { font-weight: 600; color: var(--foreground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.scenario-merchant__branch { margin-left: auto; font-size: var(--text-xs); color: var(--fg-3); white-space: nowrap; }
.scenario-sec .accordion-trigger { align-items: center; font-size: var(--text-sm); font-weight: 600; color: var(--fg-2); }
.scenario-sec .accordion-trigger:hover { text-decoration: none; color: var(--foreground); }
.scenario-sec .accordion-trigger .count { margin-left: var(--space-1); }
.scenario-hint { margin: 0; font-size: var(--text-sm); line-height: 1.5; color: var(--fg-3); }
.scenario-hint code { font-family: var(--font-mono); font-size: var(--text-xs); }

/* La fila de una entidad: dos renglones (nombre y riel · producto), el chip del riel y un punto de si sale. Las filas
   de la base llevan 4 de margen afuera; acá el cuerpo ya da el margen, así que van a ras. */
.lender-row { width: 100%; margin: 0; padding: var(--space-1) var(--space-2); min-height: 40px; border: 0; background: none;
  font: inherit; text-align: left; white-space: normal; }
.lender-row .lg__chip { flex: none; font-weight: 400; }
/* El chip y el punto no son `span`: la base estira cada `span` de una fila para el nombre. */
.lender-row__text { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.lender-row__name { font-size: var(--text-base); color: var(--foreground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lender-row .row-desc { font-size: var(--text-xs); color: var(--fg-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lender-row.on .lender-row__name, .lender-row.on .row-desc { color: var(--accent-foreground); }
.lender-row__dot { flex: none; width: 8px; height: 8px; border-radius: 50%; }
.lender-row__dot.is-ok { background: var(--status-ok); }
.lender-row__dot.is-bad { background: var(--status-bad); }

.legend { display: flex; flex-direction: column; gap: var(--space-2); }
.legend .lg { font-size: var(--text-xs); color: var(--fg-2); flex-wrap: wrap; }
</style>
