<script setup>
import { computed, ref, watch } from 'vue'
import { Search, X, Download, LoaderCircle, Check } from 'lucide-vue-next'
import { api, getSnapshot, saveSnapshot } from '../prodCatalog'
import { applyProductionImport } from '../store'
const emit = defineEmits(['close'])
const q = ref(''), items = ref([]), page = ref(0), commerce = ref(null), branches = ref([]), branch = ref(null), lenders = ref([]), selectedIds = ref([]), busy = ref(false), error = ref(''), progress = ref('')
const selectedLenders = computed(() => lenders.value.filter(x => selectedIds.value.includes(String(x.id))))
let timer
watch(q, (v) => { clearTimeout(timer); items.value = []; page.value = 0; if (v.trim().length < 2) return; timer = setTimeout(() => search(), 350) })
async function search(next = 0) { busy.value = true; error.value = ''; try { const r = await api(`comercios?q=${encodeURIComponent(q.value)}&page=${next}&limit=5`); items.value = next ? [...items.value, ...r.items] : r.items; page.value = next } catch (e) { error.value = e.message } finally { busy.value = false } }
async function pickCommerce(c) { busy.value = true; error.value = ''; commerce.value = c; branch.value = null; lenders.value = []; selectedIds.value = []; try { branches.value = (await api(`sucursales?allied=${c.id}`)).items } catch (e) { error.value = e.message } finally { busy.value = false } }
async function pickBranch(b) { busy.value = true; error.value = ''; branch.value = b; selectedIds.value = []; try { lenders.value = (await api(`entidades?sucursal=${b.id}`)).items } catch (e) { error.value = e.message } finally { busy.value = false } }
function toggleLender(l) { const id = String(l.id), at = selectedIds.value.indexOf(id); if (at < 0) selectedIds.value.push(id); else selectedIds.value.splice(at, 1) }
async function importSelected() { busy.value = true; error.value = ''; try { for (const [i, l] of selectedLenders.value.entries()) { progress.value = `${i + 1}/${selectedLenders.value.length}`; const key = `prod:v4:${commerce.value.id}:${branch.value.id}:${l.id}`; let config = await getSnapshot(key); if (!config) { config = await api(`configuracion?sucursal=${branch.value.id}&entidad=${l.id}`); await saveSnapshot(key, config) }; applyProductionImport({ comercio: commerce.value, sucursal: branch.value, ...config }) }; emit('close') } catch (e) { error.value = e.message } finally { busy.value = false; progress.value = '' } }
</script>
<template>
  <div class="prod-import nowheel" @wheel.stop>
    <div class="prod-import__hd"><span><Download :size="13" /> Importar foto de producción</span><button @click="emit('close')"><X :size="14" /></button></div>
    <p>Lee una configuración puntual por Redash. Nunca modifica producción.</p>
    <label v-if="!commerce" class="prod-search"><Search :size="13" /><input v-model="q" autofocus placeholder="Buscar comercio…" /></label>
    <div v-if="busy" class="prod-busy"><LoaderCircle :size="13" /> {{ progress ? `importando ${progress}` : 'consultando…' }}</div><div v-if="error" class="prod-error">{{ error }}</div>
    <template v-if="!commerce"><button v-for="x in items" :key="x.id" class="prod-choice" @click="pickCommerce(x)"><b>{{ x.name }}</b><small>#{{ x.id }}</small></button><button v-if="items.length === 5" class="prod-more" @click="search(page + 1)">Ver 5 más</button></template>
    <template v-else-if="!branch"><button class="prod-back" @click="commerce = null">‹ {{ commerce.name }}</button><button v-for="x in branches" :key="x.id" class="prod-choice" @click="pickBranch(x)"><b>{{ x.name }}</b><small>{{ x.status ? 'activa' : 'inactiva' }}</small></button></template>
    <template v-else><button class="prod-back" @click="branch = null">‹ {{ branch.name }}</button><button v-for="x in lenders" :key="x.id" class="prod-choice prod-choice--multi" :class="{ on: selectedIds.includes(String(x.id)) }" @click="toggleLender(x)"><span class="prod-check"><Check v-if="selectedIds.includes(String(x.id))" :size="12" /></span><span><b>{{ x.name }}</b><small>rt{{ x.response_type }} · {{ x.branch_status ? 'activa' : 'inactiva' }}</small></span></button><button class="prod-import__accept" :disabled="!selectedLenders.length || busy" @click="importSelected"><Download :size="13" /> Importar {{ selectedLenders.length || '' }} entidad{{ selectedLenders.length === 1 ? '' : 'es' }}</button></template>
  </div>
</template>
