<script setup>
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { AlertTriangle, Wifi, WifiOff, ClipboardList, Plus } from 'lucide-vue-next'
import { ui, findLenderDef, entidadCfg, bureau, nulls, perfil, providerDown, setNull, fieldNull, setEntidadAbaco, openFieldInfo, money } from '../store'
import MoneyInput from '../MoneyInput.vue'

// "Información complementaria" — vive DESPUÉS del listado y ANTES de la formalización: datos/validaciones
// que la ENTIDAD elegida le pide al cliente una vez seleccionada (config por entidad). Hoy el único ítem
// es Ábaco (ingreso EXTRA gig Rappi/DiDi/Uber, se SUMA al base); mañana pueden entrar codeudor, garantía,
// documentos, etc. Es INFORMATIVO: no cambia el cupo, la cuota ni la decisión — fiel al legacy (Ábaco no
// está cableado). Solo aparece si la entidad tiene el flag de Ábaco activo (Configurar entidad).
const lender = computed(() => findLenderDef(ui.selected))
const active = computed(() => !!entidadCfg(lender.value)?.abacoExtra)
const extra = computed(() => fieldNull('abacoIncome') ? null : bureau.abacoIncome)
const base = computed(() => perfil.value.salario || 0)
const total = computed(() => base.value + (extra.value || 0))
</script>

<template>
  <div class="node node--extra prov-node" :class="{ 'node--down': active && providerDown.abaco }">
    <Handle id="in" type="target" :position="Position.Left" />
    <div class="node__hd node__hd--green nhd-doc" title="clic: detalle del nodo" @click="openFieldInfo('node.ingresosextras')">
      <div class="node__title"><ClipboardList :size="13" /> Información complementaria</div>
      <button v-if="active" class="prov__api nodrag" :class="{ 'prov__api--down': providerDown.abaco }"
              @click.stop="providerDown.abaco = !providerDown.abaco"
              :title="providerDown.abaco ? 'API caída (timeout/5xx) — clic para revivir' : 'simular API caída (timeout/5xx)'">
        <WifiOff v-if="providerDown.abaco" :size="13" />
        <Wifi v-else :size="13" />
      </button>
    </div>
    <div class="node__body">
      <div class="ex-lead">Lo que la entidad le pide al cliente tras elegirla (se configura en Configurar entidad). Acá: <b>Ábaco</b> (ingreso extra); el <b>ingreso manual</b> se declara en Solicitud si no hay centrales.</div>
      <!-- Flag POR ENTIDAD: ¿pide el ingreso extra vía Ábaco? (mismo flag que Configurar entidad) -->
      <label class="ex-flag nodrag" :title="'Ábaco valida ingreso extra para ' + (lender ? lender.name : 'la entidad')">
        <input type="checkbox" class="ex-chk" :checked="active" @change="e => setEntidadAbaco(lender, e.target.checked)" />
        <span class="fld-doc" @click.stop="openFieldInfo('ent.abaco')">Ábaco activo</span>
        <span class="ex-src">config de entidad</span>
      </label>

      <div v-if="!active" class="ex-off">
        Esta entidad no pide información complementaria. Activá <b>Ábaco</b> (acá o en Configurar entidad) para validar un ingreso gig adicional.
      </div>
      <template v-else>
        <div v-if="providerDown.abaco" class="api-down"><AlertTriangle :size="13" /> API no responde</div>
        <template v-else>
          <div class="field pv pv--c2" title="Ingreso EXTRA validado por Ábaco (gig) — se suma al base; informativo">
            <input type="checkbox" class="null-tog nodrag" :checked="!!nulls['abacoIncome']" @change="e => setNull('abacoIncome', e.target.checked)" title="simular sin dato (null)" />
            <span class="fld-doc" title="clic: dónde vive y por qué" @click="openFieldInfo('buro.abacoIncome')">Ingreso extra</span>
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
      </template>
    </div>
    <Handle id="out" type="source" :position="Position.Right" />
  </div>
</template>
