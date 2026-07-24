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
const pdfDefault = ref('')
const formRequired = ref(false)
const formValidation = ref('')
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
    consumers: {},
  }
  if (type.value === 'checkbox') {
    entry.options = optionsText.value.split('\n').map((s) => s.trim()).filter(Boolean)
  }
  if (pdfDefault.value.trim()) entry.consumers.pdfMapper = { defaultValue: pdfDefault.value.trim() }
  if (formRequired.value || formValidation.value.trim()) {
    entry.consumers.dynamicForm = {
      required: formRequired.value || undefined,
      validation: formValidation.value.trim() || undefined,
    }
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
          <option value="number">number</option>
          <option value="date">date</option>
          <option value="checkbox">checkbox</option>
          <option value="table">table</option>
        </select>

        <template v-if="type === 'checkbox'">
          <label>Opciones <span class="muted">(una por línea)</span></label>
          <textarea v-model="optionsText" rows="3" class="mono" placeholder="accepted"></textarea>
        </template>

        <div class="ext" :style="{ '--c': 'var(--pdf)' }">
          <span class="ext-title">PDF Mapper</span>
          <label>Valor de ejemplo (preview)</label>
          <input v-model="pdfDefault" placeholder="JUAN" />
        </div>

        <div class="ext" :style="{ '--c': 'var(--form)' }">
          <span class="ext-title">Form dinámico</span>
          <label class="row"><input type="checkbox" v-model="formRequired" /> Requerido</label>
          <label>Validación</label>
          <input v-model="formValidation" placeholder="email · min:0 · …" />
        </div>

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
.ext { border: 1px solid var(--border); border-left: 3px solid var(--c); border-radius: 8px; padding: 8px 10px 12px; margin-top: 12px; display: flex; flex-direction: column; gap: 6px; }
.ext-title { font-size: 11px; font-weight: 700; color: var(--c); }
.row { display: flex; flex-direction: row !important; align-items: center; gap: 6px; text-transform: none !important; letter-spacing: 0 !important; color: var(--text2) !important; font-size: 13px !important; }
.row input { width: auto; }
.err { color: var(--danger); font-size: 12px; margin: 8px 0 0; }
.foot { display: flex; justify-content: flex-end; gap: 8px; padding: 12px 16px; border-top: 1px solid var(--border); }
</style>
