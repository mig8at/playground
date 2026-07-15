<script setup>
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { AlertTriangle, Wifi, WifiOff, ClipboardList, Plus } from 'lucide-vue-next'
import { bureau, nulls, perfil, providerDown, setNull, fieldNull, openFieldInfo, money } from '../store'
import MoneyInput from '../MoneyInput.vue'

// "Información complementaria" — solo se muestra si la ENTIDAD elegida activó Ábaco (Configurar entidad);
// el gating vive en App.vue, así que acá se asume activo. Muestra el ingreso EXTRA gig (Rappi/DiDi/Uber)
// que se SUMA al ingreso base. Informativo: no cambia el cupo, la cuota ni la decisión (fiel al legacy).
const extra = computed(() => fieldNull('abacoIncome') ? null : bureau.abacoIncome)
const base = computed(() => perfil.value.salario || 0)
const total = computed(() => base.value + (extra.value || 0))
</script>

<template>
  <div class="node node--extra prov-node" :class="{ 'node--down': providerDown.abaco }">
    <Handle id="in" type="target" :position="Position.Left" />
    <div class="node__hd node__hd--green nhd-doc" title="clic: detalle del nodo" @click="openFieldInfo('node.ingresosextras')">
      <div class="node__title"><ClipboardList :size="13" /> Información complementaria</div>
      <button class="prov__api nodrag" :class="{ 'prov__api--down': providerDown.abaco }"
              @click.stop="providerDown.abaco = !providerDown.abaco"
              :title="providerDown.abaco ? 'API caída (timeout/5xx) — clic para revivir' : 'simular API caída (timeout/5xx)'">
        <WifiOff v-if="providerDown.abaco" :size="13" />
        <Wifi v-else :size="13" />
      </button>
    </div>
    <div class="node__body">
      <div v-if="providerDown.abaco" class="api-down"><AlertTriangle :size="13" /> API no responde</div>
      <template v-else>
        <div class="field pv pv--c2" title="Ingreso EXTRA validado por Ábaco (gig) — se suma al base; informativo">
          <input type="checkbox" class="null-tog nodrag" :checked="!!nulls['abacoIncome']" @change="e => setNull('abacoIncome', e.target.checked)" title="simular sin dato (null)" />
          <span class="fld-doc" title="clic: dónde vive y por qué" @click="openFieldInfo('buro.abacoIncome')">Ingreso extra (Ábaco)</span>
          <b v-if="fieldNull('abacoIncome')" class="pv-null">— null</b>
          <MoneyInput v-else v-model="bureau.abacoIncome" />
        </div>
        <div class="ex-sum">
          <div class="ex-row"><span>Ingreso base ({{ perfil.salarioFuente }})</span><b>{{ money(base) }}</b></div>
          <div class="ex-row ex-row--extra"><span><Plus :size="10" /> extra Ábaco</span><b>{{ extra == null ? '—' : money(extra) }}</b></div>
          <div class="ex-row ex-row--tot"><span>Ingreso total</span><b>{{ money(total) }}</b></div>
        </div>
        <div class="ex-note">Informativo — no cambia el cupo ni la cuota de la oferta.</div>
      </template>
    </div>
    <Handle id="out" type="source" :position="Position.Right" />
  </div>
</template>
