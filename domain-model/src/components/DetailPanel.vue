<script setup lang="ts">
import { computed } from 'vue'
import { contextColor, contextLabel } from '../lib/transform'
import type { Entidad, Modelo } from '../lib/types'

const props = defineProps<{ entidad: Entidad | null; modelo: Modelo }>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'goto', key: string): void }>()

const color = computed(() => (props.entidad ? contextColor(props.entidad.contexto) : '#64748b'))
const colsConNota = computed(
  () => props.entidad?.atributos.filter((a) => a.note && a.note.trim()).length ?? 0,
)
const nameByKey = computed(() => new Map(props.modelo.entidades.map((e) => [e.key, e.name])))
const ctxByKey = computed(() => new Map(props.modelo.entidades.map((e) => [e.key, e.contexto])))
const linkColor = (key: string) => contextColor(ctxByKey.value.get(key) ?? '')

// relaciones entrantes (quién apunta a esta entidad)
const incoming = computed(() => {
  if (!props.entidad) return []
  const me = props.entidad.key
  const res: { from: string; card: string; rol?: string; tipo: string }[] = []
  for (const e of props.modelo.entidades) {
    for (const r of e.relaciones ?? []) {
      if (r.a === me) res.push({ from: e.key, card: r.card, rol: r.rol, tipo: r.tipo })
    }
  }
  return res
})
</script>

<template>
  <aside v-if="entidad" class="detail" :style="{ '--ctx': color }">
    <div class="d-head">
      <div>
        <div class="d-name">{{ entidad.name }}</div>
        <code class="d-tabla">{{ entidad.legacy?.tabla ?? entidad.legacy?.ref ?? '—' }}</code>
      </div>
      <button class="d-close" @click="emit('close')">✕</button>
    </div>

    <div class="d-tags">
      <span class="d-tag" :style="{ background: color }">{{ contextLabel(entidad.contexto) }}</span>
      <span class="d-tag ghost">{{ entidad.tipo }}</span>
      <span v-if="entidad.identidad" class="d-tag ghost">id: {{ entidad.identidad }}</span>
    </div>

    <p v-if="entidad.descripcion" class="d-desc">{{ entidad.descripcion }}</p>

    <section v-if="entidad.relaciones?.length">
      <h4>Relaciones salientes ({{ entidad.relaciones.length }})</h4>
      <ul class="d-rels">
        <li v-for="r in entidad.relaciones" :key="r.a + (r.rol || '')">
          <span class="d-card">{{ r.card }}</span>
          <span class="d-cdot" :style="{ background: linkColor(r.a) }" />
          <button class="d-link" :style="{ color: linkColor(r.a) }" @click="emit('goto', r.a)">{{ nameByKey.get(r.a) || r.a }}</button>
          <code v-if="r.rol" class="d-rol">{{ r.rol }}</code>
          <span class="d-dot" :class="r.tipo">{{ r.tipo }}</span>
        </li>
      </ul>
    </section>

    <section v-if="incoming.length">
      <h4>Referenciada por ({{ incoming.length }})</h4>
      <ul class="d-rels">
        <li v-for="r in incoming" :key="r.from + (r.rol || '')">
          <span class="d-card">{{ r.card }}</span>
          <span class="d-cdot" :style="{ background: linkColor(r.from) }" />
          <button class="d-link" :style="{ color: linkColor(r.from) }" @click="emit('goto', r.from)">{{ nameByKey.get(r.from) || r.from }}</button>
          <code v-if="r.rol" class="d-rol">{{ r.rol }}</code>
        </li>
      </ul>
    </section>

    <section>
      <h4>Columnas ({{ entidad.atributos.length }}) · {{ colsConNota }} con descripción</h4>
      <ul class="d-collist">
        <li v-for="a in entidad.atributos" :key="a.n" class="d-colitem">
          <div class="d-colhead">
            <span class="c-n">{{ a.n }}</span>
            <span class="c-t">{{ a.t }}</span>
            <span v-if="a.nuevo" class="c-nuevo" title="Columna nueva del deber-ser: no existe en la tabla legacy">nuevo</span>
          </div>
          <p v-if="a.note" class="c-desc">{{ a.note }}</p>
          <p v-else class="c-desc c-missing">— sin descripción de negocio —</p>
          <div v-if="a.legacy" class="c-legacy">legacy: <code>{{ a.legacy }}</code></div>
        </li>
      </ul>
    </section>

    <section v-if="entidad.legacy?.reducidas?.length">
      <h4>Columnas reducidas ({{ entidad.legacy.reducidas.length }})</h4>
      <p class="d-redhint">Columnas legacy colapsadas/derivadas bajo el modelo config-driven. Se preservan para la migración.</p>
      <ul class="d-redlist">
        <li v-for="r in entidad.legacy.reducidas" :key="r.n">
          <code>{{ r.legacy }}</code> <span class="d-arrow">→</span> {{ r.via }}
        </li>
      </ul>
    </section>

    <section v-if="entidad.legacy?.absorbe?.length">
      <h4>Tablas unificadas ({{ entidad.legacy.absorbe.length + (entidad.legacy.tabla ? 1 : 0) }})</h4>
      <p class="d-redhint">{{ entidad.legacy.unificacion || 'Tablas del sistema anterior que quedaron consolidadas en esta sola tabla.' }}</p>
      <ul class="d-unilist">
        <li v-if="entidad.legacy.tabla">
          <code>{{ entidad.legacy.tabla }}</code> <span class="d-base">base</span>
        </li>
        <li v-for="t in entidad.legacy.absorbe" :key="t"><code>{{ t }}</code></li>
      </ul>
    </section>
  </aside>
</template>

<style scoped>
.detail {
  position: absolute;
  top: 0;
  right: 0;
  width: 340px;
  height: 100%;
  background: #fff;
  border-left: 1px solid #e2e8f0;
  box-shadow: -4px 0 16px rgba(15, 23, 42, 0.08);
  overflow-y: auto;
  z-index: 10;
  font-family: ui-sans-serif, system-ui, sans-serif;
  padding: 14px 16px 40px;
}
.d-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  border-bottom: 2px solid var(--ctx);
  padding-bottom: 8px;
}
.d-name {
  font-size: 17px;
  font-weight: 700;
  color: #0f172a;
}
.d-tabla {
  font-size: 11px;
  color: #64748b;
}
.d-absorbe {
  font-size: 10px;
  color: #94a3b8;
  margin-top: 3px;
}
.d-absorbe code {
  background: #f1f5f9;
  border-radius: 3px;
  padding: 0 4px;
  margin-right: 3px;
}
.d-close {
  border: none;
  background: #f1f5f9;
  border-radius: 6px;
  width: 26px;
  height: 26px;
  cursor: pointer;
  color: #475569;
}
.d-tags {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin: 10px 0;
}
.d-tag {
  font-size: 10px;
  color: #fff;
  padding: 2px 8px;
  border-radius: 999px;
  font-weight: 600;
}
.d-tag.ghost {
  background: #f1f5f9;
  color: #475569;
}
.d-desc {
  font-size: 12px;
  color: #475569;
  line-height: 1.5;
  margin: 4px 0 12px;
}
h4 {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #94a3b8;
  margin: 16px 0 6px;
}
.d-rels {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.d-rels li {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
}
.d-card {
  font-family: ui-monospace, monospace;
  font-size: 10px;
  background: #f1f5f9;
  border-radius: 4px;
  padding: 1px 5px;
  color: #475569;
}
.d-cdot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex: 0 0 auto;
}
.d-link {
  border: none;
  background: none;
  color: #2563eb;
  cursor: pointer;
  font-size: 12px;
  padding: 0;
  font-weight: 600;
}
.d-link:hover {
  text-decoration: underline;
}
.d-rol {
  font-size: 10px;
  color: #94a3b8;
}
.d-dot {
  margin-left: auto;
  font-size: 9px;
  padding: 1px 5px;
  border-radius: 999px;
}
.d-dot.interna {
  background: #dcfce7;
  color: #166534;
}
.d-dot.referencia {
  background: #fef3c7;
  color: #92400e;
}
.d-collist {
  list-style: none;
  margin: 0;
  padding: 0;
}
.d-colitem {
  padding: 6px 0;
  border-bottom: 1px solid #f1f5f9;
}
.d-colhead {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 8px;
}
.c-n {
  font-family: ui-monospace, monospace;
  font-size: 12px;
  color: #1e293b;
  font-weight: 600;
}
.c-t {
  color: #94a3b8;
  font-size: 10px;
  white-space: nowrap;
}
.c-desc {
  margin: 2px 0 0;
  font-size: 11px;
  line-height: 1.4;
  color: #475569;
}
.c-missing {
  color: #cbd5e1;
  font-style: italic;
}
.c-nuevo {
  margin-left: auto;
  font-size: 8.5px;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #052e16;
  background: #4ade80;
  border-radius: 3px;
  padding: 1px 5px;
}
.c-legacy {
  margin-top: 2px;
  font-size: 9.5px;
  color: #94a3b8;
}
.c-legacy code {
  color: #94a3b8;
}
.d-redhint {
  font-size: 11px;
  color: #94a3b8;
  margin: 0 0 6px;
}
.d-redlist {
  list-style: none;
  margin: 0;
  padding: 0;
  font-size: 11.5px;
}
.d-redlist li {
  padding: 3px 0;
  border-bottom: 1px solid #f1f5f9;
  color: #475569;
}
.d-redlist code {
  background: #fef3c7;
  color: #92400e;
  border-radius: 3px;
  padding: 0 4px;
}
.d-arrow {
  color: #cbd5e1;
}
.d-unilist {
  list-style: none;
  margin: 0;
  padding: 0;
  font-size: 11.5px;
}
.d-unilist li {
  padding: 3px 0;
  border-bottom: 1px solid #f1f5f9;
  display: flex;
  align-items: center;
  gap: 6px;
}
.d-unilist code {
  background: #eef2ff;
  color: #3730a3;
  border-radius: 3px;
  padding: 1px 5px;
}
.d-base {
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #64748b;
  background: #f1f5f9;
  border-radius: 999px;
  padding: 1px 6px;
}
</style>
