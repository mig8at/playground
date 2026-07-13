<script setup>
import { computed } from 'vue'
import { ui, closeFieldInfo } from '../store'
import { FIELD_DOCS, FIELD_STATUS, LAYER_LABELS, NODE_STAGE } from '../fieldDocs'
import { X, Database, Layers3, FileCode2 } from 'lucide-vue-next'

// Sidebar derecho: detalle de un CAMPO o de un NODO (kind:'node' → vista más rica con role + bullets).
// Muestra: dónde se guarda (tablas), en qué capa vive la lógica, estado/etapa y el detalle.
// Contenido = fieldDocs.js (censo del código real). Reemplaza al tooltip como fuente de la verdad.
const doc = computed(() => ui.fieldInfo ? FIELD_DOCS[ui.fieldInfo] : null)
const isNode = computed(() => doc.value?.kind === 'node')
const st = computed(() => doc.value ? FIELD_STATUS[doc.value.status] : null)
const badgeLabel = computed(() => isNode.value ? ('Nodo · ' + (NODE_STAGE[doc.value.stage]?.label || doc.value.stage)) : st.value?.label)
const badgeClass = computed(() => isNode.value ? 'fi--node' : ('fi--' + doc.value.status))
const layerLabel = (l) => LAYER_LABELS[l] || l
</script>

<template>
  <transition name="fi">
    <aside v-if="doc" class="fieldinfo nodrag nowheel" @click.stop>
      <div class="fieldinfo__hd">
        <span class="fi-badge" :class="badgeClass">{{ badgeLabel }}</span>
        <button class="fieldinfo__x" @click="closeFieldInfo" title="cerrar"><X :size="15" /></button>
      </div>
      <h3 class="fieldinfo__title">{{ doc.label }}</h3>

      <!-- role (nodo) o hint del estado (campo) como intro -->
      <p class="fieldinfo__hint">{{ isNode ? doc.role : st.hint }}</p>
      <p v-if="!isNode" class="fieldinfo__sum">{{ doc.summary }}</p>
      <p v-if="doc.pisaPor && doc.pisaPor !== '—'" class="fieldinfo__pisa">Lo pisa → <b>{{ doc.pisaPor }}</b></p>

      <!-- bullets: los puntos clave / gotchas del nodo (la parte "rica") -->
      <ul v-if="doc.bullets && doc.bullets.length" class="fieldinfo__bullets">
        <li v-for="(b, i) in doc.bullets" :key="i">{{ b }}</li>
      </ul>

      <div class="fieldinfo__sec"><Database :size="12" /> Dónde se guarda</div>
      <ul class="fieldinfo__list">
        <li v-for="t in doc.tables" :key="t"><code>{{ t }}</code></li>
      </ul>

      <div class="fieldinfo__sec"><Layers3 :size="12" /> Dónde vive la lógica</div>
      <div class="fieldinfo__layers">
        <span v-for="l in doc.layers" :key="l" class="fi-layer" :class="'fi-layer--' + l">{{ layerLabel(l) }}</span>
      </div>

      <p v-if="doc.detail" class="fieldinfo__detail">{{ doc.detail }}</p>
      <div v-if="doc.evidencia" class="fieldinfo__ev"><FileCode2 :size="11" /> <code>{{ doc.evidencia }}</code></div>
      <div class="fieldinfo__foot">Censo del código real · docs/codigo/CENSO-CAMPOS-CONFIG.md</div>
    </aside>
  </transition>
</template>
