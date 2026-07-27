<script setup>
import { ref, computed } from 'vue'
import { X, Copy, Check, ArrowRight } from 'lucide-vue-next'
import { parse, tokenize, fmtNum } from './engine.js'
import { toLatex } from './latex.js'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import { ui, effDef, out, usedBy, inputs, consts, selectFormula } from './store.js'

// Panel derecho: la fórmula abierta, renderizada como matemática de verdad.
// Sale del MISMO AST que evalúa el motor, así que no puede desincronizarse del cálculo.
const withValues = ref(false)
const copied = ref(false)

const name = computed(() => ui.selected)
const expr = computed(() => effDef.value.formulas?.[name.value] ?? null)
const res = computed(() => out.value.res[name.value])

const ast = computed(() => {
  try { return parse(tokenize(expr.value || '')) } catch { return null }
})

/** Todo lo que tiene valor ahora mismo, para la vista "con valores". */
const env = computed(() => {
  const e = { ...consts, ...inputs }
  for (const [k, v] of Object.entries(out.value.res)) if (v.status === 'ok') e[k] = v.value
  return e
})

const latex = computed(() =>
  ast.value ? toLatex(ast.value, withValues.value ? env.value : null) : '')

// `trust` acotado a \htmlClass: es el único comando HTML que generamos (para pintar los
// valores sustituidos). No abrimos \href ni el resto. `strict:false` calla los avisos de
// modo estricto sobre ese mismo comando y sobre las tildes dentro de \text{}.
const mathHtml = computed(() => {
  try {
    return katex.renderToString(latex.value, {
      displayMode: true, throwOnError: false, strict: false,
      trust: ctx => ctx.command === '\\htmlClass',
    })
  } catch (e) { return `<span class="fp-err">${e.message}</span>` }
})

const deps = computed(() => [...new Set(out.value.deps[name.value] || [])].map(d => ({
  name: d,
  isFormula: d in (effDef.value.formulas || {}),
  value: env.value[d],
})))
const users = computed(() => usedBy.value[name.value] || [])

const isRate = n => /rate|factor|ratio|share/i.test(n)

async function copy() {
  try {
    await navigator.clipboard.writeText(latex.value)
    copied.value = true
    setTimeout(() => (copied.value = false), 1400)
  } catch { /* sin portapapeles: el texto igual se puede seleccionar */ }
}
</script>

<template>
  <aside v-if="name" class="fpanel">
    <header>
      <b class="mono">{{ name }}</b>
      <span v-if="name === effDef.output" class="badge b-out">output</span>
      <div class="spacer"></div>
      <button class="icon" @click="ui.selected = null" title="Cerrar"><X :size="15" /></button>
    </header>

    <div class="fp-val" :class="{ off: res?.status !== 'ok' }">
      <template v-if="res?.status === 'ok'">{{ fmtNum(res.value, isRate(name) ? 6 : undefined) }}</template>
      <template v-else-if="res?.status === 'skipped'">sin calcular</template>
      <template v-else>error</template>
    </div>
    <div v-if="res && res.status !== 'ok'" class="fp-why">
      {{ res.reason === 'missing_input' ? `falta ${res.missing.join(', ')}`
        : res.reason === 'upstream' ? `espera a ${res.dependsOn.join(', ')}` : res.reason }}
    </div>

    <div class="segs fp-segs">
      <button :class="{ on: !withValues }" @click="withValues = false">símbolos</button>
      <button :class="{ on: withValues }" @click="withValues = true">con valores</button>
    </div>

    <div class="fp-math" v-html="mathHtml"></div>

    <div class="fp-sec">
      LaTeX
      <button class="icon" @click="copy" :title="copied ? 'Copiado' : 'Copiar'">
        <Check v-if="copied" :size="13" /><Copy v-else :size="13" />
      </button>
    </div>
    <pre class="fp-tex">{{ latex }}</pre>

    <div class="fp-sec">Expresión</div>
    <pre class="fp-tex src">{{ expr }}</pre>

    <template v-if="deps.length">
      <div class="fp-sec">Depende de</div>
      <div v-for="d in deps" :key="d.name" class="fp-dep"
           :class="{ nav: d.isFormula }" @click="d.isFormula && selectFormula(d.name)">
        <span class="mono">{{ d.name }}</span>
        <b class="mono">{{ d.value === undefined ? '—' : fmtNum(d.value, isRate(d.name) ? 6 : undefined) }}</b>
        <ArrowRight v-if="d.isFormula" :size="12" class="go" />
      </div>
    </template>

    <div class="fp-sec">Lo usan</div>
    <div v-if="!users.length" class="fp-none">Nadie — es el final de la cadena.</div>
    <div v-for="u in users" :key="u" class="fp-dep nav" @click="selectFormula(u)">
      <span class="mono">{{ u }}</span>
      <ArrowRight :size="12" class="go" />
    </div>
  </aside>
</template>
