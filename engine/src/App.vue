<script setup>
import { ref, reactive, computed, watch } from 'vue'
import { VueFlow, Panel } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@vue-flow/controls/dist/style.css'

import CalcNode from './nodes/CalcNode.vue'
import InputsNode from './nodes/InputsNode.vue'
import TableNode from './nodes/TableNode.vue'
import RuleNode from './nodes/RuleNode.vue'
import EndNode from './nodes/EndNode.vue'

import { evalSheet, evalPolicy, fmtNum } from './engine.js'
import { SHEETS, POLICIES, defaultInputs } from './sheets.js'
import { layoutSheet, layoutPolicy } from './layout.js'

const nodeTypes = {
  calcNode: CalcNode, inputsNode: InputsNode, tableNode: TableNode,
  ruleNode: RuleNode, endNode: EndNode,
}

/* ── estado ── */
const slug = ref('motai-rto')
const tab = ref('calc')
const dark = ref(true)
const inputs = reactive({})
const risk = reactive({ monthlyIncome: 3200000, creditScore: 520 })

const def = computed(() => SHEETS[slug.value])

// al cambiar de hoja, recargamos sus valores por defecto
watch(slug, () => {
  for (const k of Object.keys(inputs)) delete inputs[k]
  Object.assign(inputs, defaultInputs(def.value))
}, { immediate: true })

watch(dark, v => { document.documentElement.dataset.theme = v ? 'dark' : 'light' }, { immediate: true })

/* ── evaluación viva: todo cuelga de acá ── */
const out = computed(() => evalSheet(def.value, inputs))

const policy = computed(() =>
  Object.values(POLICIES).find(p => p.appliesTo.includes(slug.value)) || null)

const verdict = computed(() => {
  if (!policy.value) return null
  const rent = out.value.res[def.value.output]
  return evalPolicy(policy.value, {
    weeklyRent: rent?.status === 'ok' ? rent.value : '',
    ...risk,
  })
})

const graph = computed(() => layoutSheet(def.value, out.value, { inputValues: inputs }))

const pgraph = computed(() =>
  policy.value && verdict.value ? layoutPolicy(policy.value, verdict.value) : { nodes: [], edges: [] })

// remontar el canvas al cambiar de hoja/pestaña para que reencuadre solo
const canvasKey = computed(() => `${slug.value}|${tab.value}`)

const series = computed(() => out.value.series)
const outVal = computed(() => {
  const r = out.value.res[def.value.output]
  return r?.status === 'ok' ? r.value : null
})

const VERDICT = {
  aprobado: { t: 'Aprobado', c: 'ok' },
  rechazado: { t: 'Rechazado', c: 'no' },
  condicional: { t: 'Condicional — requiere codeudor', c: 'mid' },
  revision_manual: { t: 'A revisión manual', c: 'mid' },
  indeterminado: { t: 'Indeterminado', c: 'mid' },
}
</script>

<template>
  <div class="app">
    <!-- ───────── barra superior ───────── -->
    <div class="top">
      <span class="brand">motor<small>cálculo y política · CreditOp</small></span>
      <select v-model="slug" style="min-width:210px">
        <option v-for="(s, k) in SHEETS" :key="k" :value="k">{{ s.label }}</option>
      </select>
      <span class="mono" style="font-size:11px;color:var(--dim)">
        base {{ def.periodBase }} · cobro {{ def.periodCharged }}
        <template v-if="def.periodBase !== def.periodCharged"> · ⚠ necesita puente</template>
      </span>
      <div class="spacer"></div>
      <button @click="dark = !dark">{{ dark ? 'claro' : 'oscuro' }}</button>
    </div>

    <div class="tabs">
      <button class="tab" :class="{ on: tab === 'calc' }" @click="tab = 'calc'">Cálculo</button>
      <button class="tab" :class="{ on: tab === 'policy' }" @click="tab = 'policy'">
        Política<template v-if="!policy"> · n/a</template>
      </button>
    </div>

    <div class="body">
      <!-- ───────── panel lateral ───────── -->
      <aside class="side">
        <div class="grp">
          <h4>Inputs · los manda el llamador</h4>
          <div v-for="f in def.inputs" :key="f.name" class="fld">
            <span>{{ f.label }} <em>{{ f.name }}</em></span>
            <select v-if="f.type === 'bool'" v-model="inputs[f.name]">
              <option :value="true">sí</option>
              <option :value="false">no</option>
            </select>
            <select v-else-if="f.enum" v-model.number="inputs[f.name]">
              <option v-for="o in f.enum" :key="o" :value="o">{{ o }}</option>
            </select>
            <input v-else class="num" v-model="inputs[f.name]" :placeholder="'(vacío = ausente)'">
          </div>
          <div class="hint">
            Vaciá un input y mirá el grafo: solo se apagan <b>sus descendientes</b>.
            El resto sigue dando su número — eso es la evaluación parcial.
          </div>
        </div>

        <div v-if="tab === 'policy' && policy" class="grp">
          <h4>Datos de la persona</h4>
          <div class="fld">
            <span>Ingreso mensual <em>monthlyIncome</em></span>
            <input class="num" v-model.number="risk.monthlyIncome">
          </div>
          <div class="fld">
            <span>Score Datacrédito <em>creditScore</em></span>
            <input class="num" v-model.number="risk.creditScore">
          </div>
          <div class="hint">
            La hoja de cálculo <b>nunca ve estos datos</b>. Solo produjo
            <span class="mono">{{ def.output }}</span>; juzgarlo es de la política.
          </div>
        </div>

        <div class="grp">
          <h4>Nota</h4>
          <div class="hint">{{ def.note }}</div>
        </div>
      </aside>

      <!-- ───────── canvas ───────── -->
      <main class="main">
        <!-- verdicto -->
        <div v-if="tab === 'policy' && verdict" class="verdict" :class="(VERDICT[verdict.outcome] || {}).c">
          <h3>{{ (VERDICT[verdict.outcome] || {}).t || verdict.outcome }}</h3>
          <p>
            <template v-if="verdict.firedRule"><b>{{ verdict.firedRule }}</b> · </template>
            {{ verdict.explanation || 'Pasó todas las reglas del gate.' }}
          </p>
        </div>

        <div class="canvas">
          <VueFlow v-if="tab === 'calc'" :key="canvasKey" :nodes="graph.nodes" :edges="graph.edges"
            :node-types="nodeTypes" :class="{ dark }" fit-view-on-init :min-zoom="0.15" :max-zoom="1.6"
            :nodes-draggable="true" :edges-updatable="false" :nodes-connectable="false">
            <Background :gap="22" :size="1" :pattern-color="dark ? '#26251e' : '#d3cfc4'" />
            <Controls :show-interactive="false" />
            <Panel position="top-left">
              <div class="legend">
                <span><i style="background:var(--amber)"></i>entrada</span>
                <span><i style="background:var(--blue)"></i>fórmula</span>
                <span><i style="background:var(--purple)"></i>output</span>
                <span style="color:var(--dim)">·  {{ graph.nodes.length }} nodos, izquierda → derecha en orden de cálculo</span>
              </div>
            </Panel>
          </VueFlow>

          <template v-else>
            <VueFlow v-if="policy" :key="canvasKey" :nodes="pgraph.nodes" :edges="pgraph.edges"
              :node-types="nodeTypes" :class="{ dark }" fit-view-on-init :min-zoom="0.2" :max-zoom="1.6"
              :nodes-draggable="true" :nodes-connectable="false">
              <Background :gap="22" :size="1" :pattern-color="dark ? '#26251e' : '#d3cfc4'" />
              <Controls :show-interactive="false" />
              <Panel position="top-left">
                <div class="legend">
                  <span>{{ policy.label }}</span>
                  <span style="color:var(--dim)">· el gate corre en cadena y corta en la primera que falla</span>
                </div>
              </Panel>
            </VueFlow>
            <div v-else style="padding:40px;max-width:520px">
              <div class="hint">
                <b>Esta hoja todavía no tiene política.</b><br><br>
                Y eso es el punto: <span class="mono">motai-renting</span> y
                <span class="mono">motai-rto</span> son dos hojas distintas que comparten
                <b>una sola</b> política — el documento de Manuela lo dice explícito
                ("mismas reglas de validación"). Con <span class="mono">creditopx-salud</span> pasa al revés:
                una hoja para tres comercios. Por eso cálculo y decisión son recursos separados.
              </div>
            </div>
          </template>
        </div>

        <!-- serie -->
        <div v-if="tab === 'calc' && series" class="drawer">
          <header>
            <b>{{ series.name }}</b>
            <span v-if="series.error" style="color:var(--red)">{{ series.error }}</span>
            <span v-else>{{ series.rows.length }} filas{{ series.capped ? ' (cortado por el tope del motor)' : '' }}</span>
            <div class="spacer"></div>
            <span v-if="outVal !== null">{{ def.output }} = <b style="color:var(--purple)">{{ fmtNum(outVal) }}</b></span>
          </header>
          <div v-if="series.rows && series.rows.length" class="scroll">
            <table class="ser">
              <thead>
                <tr><th>#</th><th v-for="c in series.cols" :key="c">{{ c }}</th></tr>
              </thead>
              <tbody>
                <tr v-for="(r, i) in series.rows" :key="i">
                  <td>{{ i + 1 }}</td>
                  <td v-for="c in series.cols" :key="c">{{ fmtNum(r[c], 0) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  </div>
</template>
