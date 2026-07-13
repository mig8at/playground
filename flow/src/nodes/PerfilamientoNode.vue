<script setup>
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { ui, perfil, findLenderDef, perfilDiagSel, isBlacklisted, setBlacklist, preApprovalOf, setPreApproval, money, openFieldInfo } from '../store'
import { Check, X, Layers } from 'lucide-vue-next'

// HUB del perfilamiento: los DATOS del usuario que perfilan + el VEREDICTO (qué categoría gana).
// Las 3 categorías y los tramos son nodos propios ARRIBA (CategoryNode / TramoNode), conectados a
// este hub. Solo rt=2 categoriza; rt=1 pregunta a su API; rt=0 redirige.
const lender = computed(() => ui.selected ? findLenderDef(ui.selected) : null)
const isCx = computed(() => lender.value?.rt === 2)
const isRt1 = computed(() => lender.value?.rt === 1)
const diag = perfilDiagSel // computed compartido del store (null si no es rt=2)
const blacklisted = computed(() => !!diag.value?.blacklisted)
const PA = ['aprueba', 'rechaza', 'timeout']
const verified = computed(() => !['declarado', '—'].includes(perfil.value.salarioFuente))
</script>

<template>
  <div class="node node--perfil prov-node">
    <Handle id="in" type="target" :position="Position.Right" />
    <Handle id="fromcats" type="target" :position="Position.Top" />
    <div class="node__hd node__hd--teal nhd-doc" title="clic: detalle del nodo" @click="openFieldInfo('node.perfil')">
      <div class="node__title"><Layers :size="13" /> Perfilamiento</div>
      <span class="pl-cat">config de entidad</span>
    </div>
    <div class="node__body">
      <!-- SIEMPRE: los datos del usuario que perfilan (de la persona, no de la entidad) -->
      <div class="pl-sec">Datos que perfilan <span class="pl-hint">· del usuario</span></div>
      <div class="perfil-in">
        <span class="pin"><em>ocupación</em>{{ perfil.employment || '—' }}</span>
        <span class="pin"><em>edad</em>{{ perfil.edad ?? '—' }}</span>
        <span class="pin"><em>ingreso</em>{{ money(perfil.salario) }} <i>{{ verified ? '✓ verif.' : 'declarado' }}</i></span>
        <span class="pin"><em>continuidad</em>{{ perfil.continuity || '—' }}</span>
        <span class="pin"><em>género</em>{{ perfil.gender || '—' }}</span>
      </div>

      <!-- CreditopX (rt=2): veredicto (las categorías + tramos viven en los nodos de arriba ↑) -->
      <template v-if="isCx">
        <div class="rn-status" :class="diag.winner ? 'ok' : 'no'">
          <Check v-if="diag.winner" :size="13" /><X v-else :size="13" />
          <span>{{ diag.winner ? lender.name + ' → categoría ' + diag.winner : (blacklisted ? lender.name + ' → documento en lista negra' : lender.name + ' → sin categoría (no ofrecido)') }}</span>
        </div>
        <label class="chk--sim perfil-bl"><input type="checkbox" :checked="isBlacklisted(ui.selected)" @change="e => setBlacklist(ui.selected, e.target.checked)" /> documento en lista negra (rechazo directo)</label>
        <div class="pl-updo">↑ Las categorías y los tramos están arriba. La que <b>gana</b> define enganche / cupo / plazo.</div>
      </template>

      <!-- Agregador (rt=1): pre-aprobación EXTERNA — la API de la entidad decide -->
      <template v-else-if="isRt1">
        <div class="pl-sec">Pre-aprobación externa <span class="pl-hint">· su API</span></div>
        <div class="dn-hint">CreditOp no perfila acá: le pregunta a la API de {{ lender.name }} y respeta su respuesta. Simulá el resultado:</div>
        <div class="cat__chips">
          <button v-for="p in PA" :key="p" class="chip-toggle nodrag" :class="{ on: preApprovalOf(ui.selected) === p }" @click="setPreApproval(ui.selected, p)">{{ p }}</button>
        </div>
        <div class="dn-hint">rechaza/timeout → sale del listado (removeNonPreapprovedLenders).</div>
      </template>

      <div v-else-if="lender" class="dn-hint">{{ lender.name }} es rt{{ lender.rt }} (redirect): sin pre-aprobación, se redirige al sitio de la entidad y decide allá.</div>
      <div v-else class="dn-hint">Elegí una entidad <b>CreditopX</b> en “Entidades disponibles” para ver su categorización.</div>
    </div>
  </div>
</template>
