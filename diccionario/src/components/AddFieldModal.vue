<script setup lang="ts">
import { ref, computed } from 'vue'
import { X } from 'lucide-vue-next'
import { useDictionary, type FieldType, type FieldEntry } from '../dictionary'

const emit = defineEmits<{ (e: 'close'): void }>()
const dict = useDictionary()

const id = ref('')
const type = ref<FieldType>('text')
const label = ref('')
const optionsText = ref('')
const defaultValue = ref('')
const error = ref('')

const idOk = computed(() => /^[a-z][a-z0-9_]*$/.test(id.value.trim()))

const save = () => {
  error.value = ''
  const entry: FieldEntry = {
    id: id.value.trim(),
    type: type.value,
    label: label.value.trim(),
    status: 'active',
    createdAt: '',
  }
  if (type.value === 'checkbox') {
    entry.options = optionsText.value.split('\n').map((s) => s.trim()).filter(Boolean)
  }
  if (type.value !== 'table' && defaultValue.value.trim()) {
    entry.defaultValue = defaultValue.value.trim()
  }
  const res = dict.addField(entry)
  if (!res.ok) { error.value = res.error || 'No se pudo agregar'; return }
  emit('close')
}
</script>

<template>
  <div class="overlay" @click="emit('close')">
    <div class="modal" @click.stop>
      <div class="head">
        <h2>Nuevo campo</h2>
        <button class="btn btn-ghost" @click="emit('close')"><X :size="15" /></button>
      </div>
      <div class="body">
        <p class="hint">El diccionario es <strong>append-only</strong>: se agrega, no se edita ni se borra.</p>

        <label>ID <span class="mono muted">(snake_case, inglés)</span></label>
        <input v-model="id" placeholder="first_name" class="mono"
          :style="{ borderColor: id && !idOk ? 'var(--danger)' : '' }" />

        <label>Etiqueta</label>
        <input v-model="label" placeholder="Primer nombre" />

        <label>Tipo</label>
        <select v-model="type">
          <option value="text">text</option>
          <option value="checkbox">checkbox</option>
          <option value="table">table</option>
        </select>

        <template v-if="type === 'checkbox'">
          <label>Opciones <span class="muted">(una por línea)</span></label>
          <textarea v-model="optionsText" rows="3" class="mono" placeholder="document_copy&#10;income_certificate"></textarea>
          <p class="hint">Una sola opción = casilla de consentimiento; varias = selección única.</p>
        </template>

        <template v-if="type === 'table'">
          <p class="hint">Las celdas de una tabla (fila/columna + posición x, y, w) se mapean sobre la plantilla en el <strong>PDF Mapper</strong>, no acá.</p>
        </template>

        <template v-else>
          <label>Valor de ejemplo <span class="muted">(preview)</span></label>
          <input v-model="defaultValue" placeholder="JUAN" />
        </template>

        <p v-if="error" class="err">{{ error }}</p>
      </div>
      <div class="foot">
        <button class="btn btn-ghost" @click="emit('close')">Cancelar</button>
        <button class="btn btn-primary" :disabled="!idOk || !label.trim()" @click="save">Agregar al diccionario</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.overlay { position: fixed; inset: 0; background: rgba(0,0,0,.7); backdrop-filter: blur(3px); display: flex; align-items: center; justify-content: center; z-index: 100; }
.modal { width: 460px; max-height: 88vh; display: flex; flex-direction: column; background: var(--surface); border: 1px solid var(--border); border-radius: 12px; }
.head { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px; border-bottom: 1px solid var(--border); }
.head h2 { font-size: 14px; margin: 0; }
.body { padding: 16px; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; }
.body label { font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: var(--text3); margin-top: 8px; }
.body input, .body select, .body textarea { width: 100%; }
.hint { margin: 0 0 6px; font-size: 12px; color: var(--text2); }
.muted { color: var(--text3); text-transform: none; letter-spacing: 0; }
.err { color: var(--danger); font-size: 12px; margin: 8px 0 0; }
.foot { display: flex; justify-content: flex-end; gap: 8px; padding: 12px 16px; border-top: 1px solid var(--border); }
</style>
