<script setup>
import { computed } from 'vue'
import { Globe2 } from 'lucide-vue-next'
import { merchant, countryById, openFieldInfo } from '../store'

// País no es una regla adicional: es contexto compartido. Este resumen concentra el
// catálogo y formato que heredan la sucursal y la solicitud, sin repetir controles.
const props = defineProps({
  compact: Boolean,
  source: { type: String, default: 'comercio' },
})
const country = computed(() => countryById(merchant.paisId))
const documents = computed(() => country.value?.docTypes?.join(' · ') || 'sin catálogo')
const phone = computed(() => {
  const p = country.value
  if (!p?.dial && !p?.phoneLen) return 'sin formato'
  return `${p.dial ? '+' + p.dial : '—'} · ${p.phoneLen ? p.phoneLen + ' díg.' : '—'}`
})
const regional = computed(() => {
  const p = country.value
  return [p?.currency, p?.locale].filter(Boolean).join(' · ') || 'sin formato'
})
const capabilities = computed(() => country.value?.capabilities || {})
const stage = computed(() => capabilities.value.stage || 'pendiente')
const risk = computed(() => capabilities.value.risk || 'sin resolver')
</script>

<template>
  <section class="country-profile" :class="{ 'country-profile--compact': compact }">
    <div class="country-profile__head">
      <span class="country-profile__title fld-doc" title="clic: país heredado y catálogo compatible" @click="openFieldInfo('pais.sucursal')">
        <Globe2 :size="12" /> Perfil de país · {{ country?.name || 'Sin país' }}
      </span>
      <span class="country-profile__stage" :class="'country-profile__stage--' + stage" title="clic: capacidad del escenario" @click="openFieldInfo('pais.capabilities')">{{ stage }}</span>
      <span class="country-profile__source">hereda de {{ source }}</span>
    </div>
    <div class="country-profile__facts">
      <span class="country-profile__fact fld-doc" title="clic: documentos compatibles con el país" @click="openFieldInfo('pais.docTypes')"><small>docs</small><b>{{ documents }}</b></span>
      <span class="country-profile__fact fld-doc" title="clic: código y longitud de celular" @click="openFieldInfo('pais.dial')"><small>celular</small><b>{{ phone }}</b></span>
      <span class="country-profile__fact fld-doc" title="clic: moneda y localización" @click="openFieldInfo('pais.currency')"><small>formato</small><b>{{ regional }}</b></span>
      <span class="country-profile__fact fld-doc" title="clic: capacidad de riesgo del escenario" @click="openFieldInfo('pais.capabilities')"><small>riesgo</small><b>{{ risk }}</b></span>
    </div>
  </section>
</template>
