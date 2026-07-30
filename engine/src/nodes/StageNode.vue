<script setup>
import { computed, ref, nextTick } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import MoneyInput from '../MoneyInput.vue'
import PercentInput from '../PercentInput.vue'
import RateBlock from '../RateBlock.vue'
import FormulaBoard from '../FormulaBoard.vue'
import { desdeTexto, aTexto, en, reemplazar, envolver, envolverRaiz, primerHueco, huecos, hueco }
  from '../formulaTree.js'
import { fmtNum } from '../engine.js'
import { RATE_BASES, CON_EXPRESION, describir } from '../sheets.js'
import { inputs, fields, out, addField, removeField, setExpr, basesDisponibles,
         dependientesDe, termsOffered, setTermsOffered, porPlazo } from '../store.js'

// Una etapa AUTOCONTENIDA: sus propios inputs arriba, sus propias fórmulas abajo.
//
// El motor no sabe qué es una fianza: los dos puntos de inserción arrancan con los campos por
// defecto y todo lo demás se agrega acá. Cada campo dice qué hace, así que no hay un bloque con
// comportamiento cableado que haya que aprender aparte.
//
// La última fórmula va resaltada y se muestra SIEMPRE: es la salida de la etapa. `showRows: false`
// esconde los pasos intermedios, nunca el resultado.
//
// El v-model apunta al store, NO al prop `data`: `data` se recrea en cada recálculo y el input
// perdería el foco a cada tecla.
const props = defineProps({ data: Object })

const val = r => {
  if (!r || r.status === 'skipped') return 'sin calcular'
  if (r.status === 'error') return 'error'
  return fmtNum(r.value, /rate|Rate/.test(r.name) ? 6 : undefined)
}
// Si la etapa tiene RateBlock, el bloque es dueño de `statedRate` y `compound`: sacarlos de la
// lista o se dibujan dos veces.
const DEL_BLOQUE = new Set(['statedRate', 'compound'])
// `data.inputs` ya viene filtrado por el layout con `etapaDe`, que es lo que resuelve `inputsOf`:
// las perillas del punto `amount` llegan acá aunque su `appliesTo` diga `amount` y la etapa sea
// `rates`. Volver a filtrar por `appliesTo === key` las descartaba.
const propios = computed(() => props.data.inputs.filter(f =>
  !(props.data.rateBlock && DEL_BLOQUE.has(f.name))))
// `nFilas` lo calcula el layout desde `rows` de la hoja: todas, solo la salida, o ninguna. La
// etapa sigue siendo dueña de sus fórmulas aunque no dibuje ninguna.
const filas = computed(() => props.data.rows.slice(props.data.rows.length - props.data.nFilas))
// Cuando el nodo se llama por lo que produce (`valor a financiar`), la fila de salida repetiría el
// título. Se muestra solo el número: alineado y resaltado, se lee como el resultado del nodo.
const esSalidaDelNodo = r => r.label === props.data.title

// ── agregar un campo ──
// Los tres controles son las tres cosas que definen qué hace el campo, y se leen como una frase.
//
// `data.insertion` trae la CLAVE del punto de inserción, que no siempre es la de la etapa: cuando el
// punto está partido en dos —arriba las tarifas, abajo los pesos— las perillas viven en la de arriba
// pero el campo sigue teniendo el `at` del punto, así que sus términos caen donde corresponde.
const punto = computed(() => (props.data.insertion === true ? props.data.key : props.data.insertion))
const nuevo = ref(null)
const campo = ref(null)
// Las bases con nombre del punto (el monto neto, el bruto, lo financiado) más los campos ya
// creados en este nodo. Un campo solo puede apoyarse en los ANTERIORES, así que un ciclo no se
// puede ni escribir.
const basesFijas = computed(() => RATE_BASES[punto.value] || [])
const bases = computed(() => basesDisponibles(punto.value))
const frase = computed(() => (nuevo.value ? describir({ ...nuevo.value, at: punto.value }, fields) : ''))

// ── los campos FÓRMULA ──
// No tienen perilla: su valor es la expresión, así que se dibujan aparte de `propios` (que son los
// inputs). Se muestran con la expresión editable y el resultado al lado — la celda de una hoja de
// cálculo. Si la expresión está mal, el motor devuelve la razón y se muestra ahí mismo.
// Se dibujan donde vive la perilla del punto, igual que los demás inputs.
const formulaFields = computed(() =>
  fields.filter(f => CON_EXPRESION.has(f.kind) && f.at === punto.value))
const resultado = f => out.value.res[f.name + 'Value']
// Por qué no dio. El `reason` de un `skipped` es un CÓDIGO del motor, no prosa: `upstream` con un
// `dependsOn`, o `missing_input` con un `missing`. Un ciclo, además, lo reporta en la fórmula que
// lo CIERRA y no en la que lo escribió, así que hay que perseguir la cadena hasta la causa real —
// sin esto la celda decía "—" o "upstream", que es justo cuando más hace falta saber por qué.
const razon = f => {
  let r = resultado(f)
  const visto = new Set()
  while (r?.status === 'skipped' && r.reason === 'upstream' && r.dependsOn?.[0]) {
    const sig = r.dependsOn[0]
    if (visto.has(sig)) break
    visto.add(sig)
    r = out.value.res[sig]
  }
  if (!r || r.status === 'ok') return ''
  if (r.status === 'error') return r.reason
  if (r.reason === 'missing_input') return `falta ${r.missing?.[0] ?? 'un dato'}`
  return 'sin calcular'
}

// ── borrar solo si nadie cuelga ──
// No hay flechas para reordenar, y es a propósito: un campo solo puede apoyarse en los ANTERIORES
// —lo imponen el selector de base y los chips de nombres— así que el orden es correcto POR
// CONSTRUCCIÓN. Reordenar solo podía romperlo, y obligaba a validar y revertir.
//
// Lo único que sí podía romper el grafo de referencias era borrar algo del medio. Así que el × se
// apaga cuando alguien depende, y dice quién.
const cuelgan = f => dependientesDe(f).map(d => d.label)
const razonBorrar = f => {
  const d = cuelgan(f)
  return d.length
    ? `No se puede quitar: ${d.join(' · ')} ${d.length > 1 ? 'dependen' : 'depende'} de este campo. `
      + 'Quitá primero esos.'
    : 'quitar este campo'
}

// ── B4 · los nombres que se pueden escribir en una expresión ──
// Escribir `netAmount + setupFee` obligaba a ADIVINAR los names en inglés. Acá salen listados y
// clickeables: las bases con nombre del punto, `installments` (para repartir), y los campos
// anteriores en sus pesos. Solo los ANTERIORES, que es la misma regla que la de las bases.
const nombresUsables = computed(() => {
  // EXCLUYENTE: hasta el campo que se está editando, sin incluirlo. Ofrecerse a sí mismo es un ciclo
  // —el motor lo caza, pero sugerirlo está mal. Sin `id` (campo nuevo) valen todos los anteriores.
  const id = tab.value?.id
  const i = id ? fields.findIndex(f => f.id === id) : fields.length
  const previos = fields.slice(0, i < 0 ? fields.length : i)
  const delPunto = previos.filter(f => f.at === punto.value)
  // La tecla MUESTRA el español y ESCRIBE el identificador: es la misma regla del resto —la UI nunca
  // muestra un `name`— y evita tener que conocerlos de memoria.
  return [
    ...basesFijas.value.map(b => ({ name: b.value, label: b.label })),
    { name: 'installments', label: 'cuotas' },
    ...delPunto.map(f => ({ name: f.kind === 'money' ? f.name : f.name + 'Value', label: f.label })),
  ]
})

// ══════════ EL TABLERO ══════════
// La fórmula se arma por CAJAS, no escribiendo texto: se elige un cuadrito y se le pone un campo, un
// número o una operación. El texto sigue siendo lo que se guarda —lo come el motor— pero deja de ser
// lo que se edita.
//
// El árbol va y vuelve con `formulaTree.js`, que usa el parser DEL MOTOR: así el tablero y el cálculo
// no pueden interpretar distinto la misma fórmula. Si la expresión tiene algo que el tablero no
// dibuja (un `pmt`, un `if`, una comparación), `desdeTexto` devuelve null y ese campo se sigue
// editando como texto — mejor eso que dibujar mal algo que el motor entiende bien.
const tab = ref(null)   // { id, arbol, sel }

/** Las OPERACIONES del tablero. Solo las que el motor soporta y significan algo con dinero: las 14
 *  fórmulas reales —6 presets + las 3 calculadoras de `lenders.calculator`— usan `+ − × ÷` y
 *  paréntesis, ni una raíz ni un valor absoluto. El `^` está porque el motor lo soporta y es lo que
 *  haría falta para capitalizar una tasa dentro de un campo. */
const OPS = [
  { o: '+', ver: '+', ayuda: 'sumar' },
  { o: '-', ver: '−', ayuda: 'restar — un descuento' },
  { o: '*', ver: '×', ayuda: 'multiplicar — un porcentaje sobre algo' },
  { o: '/', ver: '÷', ayuda: 'dividir — repartir entre las cuotas' },
  { o: '^', ver: '^', ayuda: 'elevar. El motor lo soporta; ninguna fórmula real lo usa todavía.' },
]

/** name → label, para que las cajas muestren el español. */
const etiquetas = computed(() => {
  const m = {}
  for (const b of RATE_BASES[punto.value] || []) m[b.value] = b.label
  m.installments = 'cuotas'
  m.amount = 'el monto'
  for (const f of fields) m[f.kind === 'money' ? f.name : f.name + 'Value'] = f.label
  return m
})

/** El tablero para el campo que se está creando: arranca en un hueco. */
function abrirNuevo() {
  const arbol = desdeTexto(nuevo.value.expr) || hueco()
  tab.value = { id: null, arbol, sel: primerHueco(arbol) ?? [] }
}

function abrirTablero(f) {
  const arbol = desdeTexto(f.expr)
  if (!arbol) { tab.value = null; return false }   // no dibujable: se edita como texto
  tab.value = { id: f.id, arbol, sel: primerHueco(arbol) ?? [] }
  return true
}
function cerrarTablero() { tab.value = null }

/** Cada cambio del árbol se serializa y se guarda: el texto sigue siendo la fuente para el motor. */
function aplicar(arbol) {
  tab.value.arbol = arbol
  const t = tab.value.id
  if (t) setExpr(t, aTexto(arbol))
  else if (nuevo.value) nuevo.value.expr = aTexto(arbol)
}
const poner = n => {
  const a = reemplazar(tab.value.arbol, tab.value.sel, n)
  aplicar(a)
  tab.value.sel = primerHueco(a, [], tab.value.sel) ?? tab.value.sel
}
const operar = o => {
  const a = envolver(tab.value.arbol, tab.value.sel, o)
  aplicar(a)
  tab.value.sel = primerHueco(a, [], []) ?? tab.value.sel
}
// la raíz ENVUELVE lo elegido, igual que las operaciones: si estás sobre algo armado y apretás
// raíz, querés la raíz DE eso. Reemplazar te hacía perder lo que tenías.
const operarRaiz = () => {
  const a = envolverRaiz(tab.value.arbol, tab.value.sel)
  aplicar(a)
  tab.value.sel = primerHueco(a, [], []) ?? tab.value.sel
}
const ponerNum = (ruta, v) => aplicar(reemplazar(tab.value.arbol, ruta, { k: 'num', v }))
const faltan = computed(() => (tab.value ? huecos(tab.value.arbol) : 0))

// ── los plazos ofrecidos ──
// La lista se edita como TEXTO porque así se guarda: `credit_line_by_lenders.fee_numbers` es una
// cadena separada por comas. El store la parsea, ordena y deduplica.
const listaPlazos = computed(() => termsOffered.join(', '))

async function abrir() {
  nuevo.value = { label: '', kind: 'money', base: basesFijas.value[0]?.value || '',
                  spread: false, expr: '' }
  await nextTick()
  campo.value?.focus()
}
function crear() {
  if (!nuevo.value?.label.trim()) return
  addField({ ...nuevo.value, at: punto.value })
  nuevo.value = null
}
</script>

<template>
  <div class="n n--stage"
       :class="['st--' + data.key, data.group && 'g--' + data.group, { 'has-tec': !!tab }]"
       style="min-width:296px;max-width:296px">
    <!-- el de la izquierda solo si algo la apunta desde afuera del grupo -->
    <Handle v-if="data.hIn" id="in" type="target" :position="Position.Left" />
    <!-- solo las etapas con una dependencia DENTRO de su grupo: la flecha baja en vez de dar
         la vuelta por la izquierda -->
    <Handle v-if="data.hUp" id="up" type="target" :position="Position.Top" />
    <Handle v-if="data.hDown" id="down" type="source" :position="Position.Bottom" />
    <!-- El tooltip lleva la consecuencia (paga intereses o no). Estuvo como insignia visible
         mientras los dos puntos de inserción caían en columnas distintas y era lo único que los
         hacía leer como par; comparten columna y color, así que ya sobraba en pantalla. -->
    <div class="n__hd" :title="data.insertionHelp">
      <b>{{ data.title }}</b>
    </div>

    <div class="ent">
      <!-- inputs propios de la etapa -->
      <div v-for="f in propios" :key="f.name" class="ent__row">
        <span class="ent__k" :title="f.help">
          <span class="ent__kt">{{ f.label }}</span>
          <!-- solo lo AMBIGUO: sobre qué se aplica el %, o que es un total repartido -->
          <i v-if="f.note" class="ent__note">{{ f.note }}</i>
        </span>
        <button v-if="f.field" class="nodrag del" :class="{ 'is-locked': cuelgan(f.field).length }"
          :disabled="!!cuelgan(f.field).length" :title="razonBorrar(f.field)"
          @click="removeField(f.field)">×</button>
        <select v-if="f.type === 'bool'" class="nodrag nf" v-model="inputs[f.name]">
          <option :value="true">sí</option><option :value="false">no</option>
        </select>
        <!-- las opciones son la lista de plazos ofrecidos, no un número libre -->
        <select v-else-if="f.choices === 'terms'" class="nodrag nf nf--term"
          :value="Number(inputs[f.name])"
          @change="inputs[f.name] = Number($event.target.value)">
          <option v-for="n in termsOffered" :key="n" :value="n">{{ n }} cuotas</option>
        </select>
        <MoneyInput v-else-if="f.type === 'money'" v-model="inputs[f.name]" />
        <PercentInput v-else-if="f.type === 'rate'" v-model="inputs[f.name]" />
        <input v-else class="nodrag nf" type="text" inputmode="numeric" v-model="inputs[f.name]">
      </div>

      <RateBlock v-if="data.rateBlock" />

      <!-- campos fórmula: la expresión ES el valor, así que se ve y se edita -->
      <div v-for="f in formulaFields" :key="f.id" class="ent__f">
        <div class="ent__row">
          <span class="ent__k" :title="f.help">
            <span class="ent__kt">{{ f.label }}</span>
            <!-- un auxiliar es un escalón, no un costo: hay que verlo o se lee como si sumara -->
            <i v-if="f.kind === 'aux'" class="ent__note">no suma</i>
          </span>
          <button class="nodrag del" :class="{ 'is-locked': cuelgan(f.id).length }"
            :disabled="!!cuelgan(f.id).length" :title="razonBorrar(f.id)"
            @click="removeField(f.id)">×</button>
          <!-- La expresión se MUESTRA acá y se EDITA en el tablero. Si el tablero no la puede
               dibujar (un `pmt`, un `if`), cae al input de texto: mejor eso que dibujar mal algo que
               el motor entiende bien. -->
          <button v-if="desdeTexto(f.expr)" class="nodrag nf nf--expr nf--abre" :title="f.expr"
            @click="tab && tab.id === f.id ? cerrarTablero() : abrirTablero(f)">{{ f.expr || '▢' }}</button>
          <input v-else class="nodrag nf nf--expr" :value="f.expr" :title="f.expr"
            @input="setExpr(f.id, $event.target.value)" @keydown.stop spellcheck="false"
            placeholder="p. ej. pmt(...)">
        </div>
        <div class="ent__row ent__fres">
          <span class="ent__k"></span>
          <b class="ent__fv" :class="{ 'is-bad': resultado(f)?.status !== 'ok' }">
            {{ resultado(f)?.status === 'ok' ? fmtNum(resultado(f).value) : '—' }}</b>
        </div>
        <div v-if="razon(f)" class="ent__err">{{ razon(f) }}</div>
      </div>

      <!-- los nombres usables, mientras se escribe una expresión. `mousedown.prevent` para no
           perder el foco ni el cursor. -->
      <!-- ══════════ EL TABLERO ══════════
           Overlay y no dentro del nodo: si el nodo creciera al abrirlo se solaparía con el de abajo
           —Vue Flow posiciona por alto medido y el layout no sabe que hay un tablero abierto—. -->
      <div v-if="tab" class="tab nodrag">
        <div class="tab__hd">
          <b>armá la fórmula</b>
          <span v-if="faltan" class="tab__f">{{ faltan }} sin llenar</span>
          <button class="tab__x" @click="cerrarTablero()">listo</button>
        </div>

        <!-- la fórmula, por cajas. Click en una caja la elige; la operación entera también se
             puede elegir, para envolverla o reemplazarla. -->
        <div class="tab__ex">
          <FormulaBoard :node="tab.arbol" :sel="tab.sel" :labels="etiquetas"
            @sel="r => (tab.sel = r)" @num="ponerNum" />
        </div>

        <div class="tab__hd2">campos</div>
        <div class="tab__g tab__g--nom">
          <button v-for="nb in nombresUsables" :key="nb.name" class="tab__k" :title="nb.name"
            @click="poner({ k: 'ref', name: nb.name })">{{ nb.label }}</button>
        </div>

        <div class="tab__hd2">operaciones</div>
        <div class="tab__g">
          <button v-for="op in OPS" :key="op.o" class="tab__k tab__k--op" :title="op.ayuda"
            @click="operar(op.o)">▢ {{ op.ver }} ▢</button>
          <!-- una raíz es `x ^ (1/n)` y el índice es una caja editable, así que UNA tecla da todas
               las raíces. Y sirve de verdad: con 12 es la conversión de una tasa anual a mensual. -->
          <button class="tab__k tab__k--op"
            title="raíz. Es x ^ (1/n) con el índice editable — con 12 da la conversión de una tasa anual a mensual."
            @click="operarRaiz()">ⁿ√▢</button>
          <button class="tab__k tab__k--op" title="un número, se escribe en la caja"
            @click="poner({ k: 'num', v: '' })">123</button>
          <button class="tab__k tab__k--op" title="vaciar esta caja"
            @click="poner(hueco())">▢</button>
        </div>
      </div>

      <!-- la lista de plazos que el lender OFRECE.      <!-- la lista de plazos que el lender OFRECE. No es un input: `cuotas` elige uno de acá -->
      <div v-if="data.termsEditor" class="ent__row ent__plazos">
        <span class="ent__k" title="Los plazos que el lender ofrece. En producción es
`credit_line_by_lenders.fee_numbers`, también una lista separada por comas. La calculadora corre una
vez por cada uno: la vitrina está en el nodo de la cuota.">plazos</span>
        <input class="nodrag nf" :value="listaPlazos" spellcheck="false" @keydown.stop
          @change="setTermsOffered($event.target.value)"
          @keydown.enter="setTermsOffered($event.target.value)">
      </div>

      <!-- agregar un campo. Solo en los puntos de inserción: entra al cálculo por acá -->
      <template v-if="data.insertion">
        <div v-if="!nuevo" class="ent__add">
          <button class="nodrag addbtn" @click="abrir"
            :title="`Agrega un costo que entra ${data.title}.`">+ campo</button>
        </div>
        <div v-else class="ent__new">
          <div class="ent__row">
            <input ref="campo" class="nodrag nf nf--name" v-model="nuevo.label"
              placeholder="nombre del costo" @keydown.enter="crear"
              @keydown.esc="nuevo = null" @keydown.stop>
            <select class="nodrag nf nf--kind" v-model="nuevo.kind">
              <option value="money">monto</option>
              <option value="rate">%</option>
              <option value="formula">fórmula</option>
              <option value="aux">auxiliar</option>
            </select>
          </div>
          <!-- una fórmula se escribe entera: no necesita base ni ÷ cuotas, eso se escribe ahí -->
          <div v-if="CON_EXPRESION.has(nuevo.kind)" class="ent__row">
            <button class="nodrag nf nf--expr nf--abre" @click="abrirNuevo()">
              {{ nuevo.expr || '▢ armar' }}</button>
          </div>
          <!-- sobre qué se aplica: la base del punto, u otro campo de este mismo nodo -->
          <div v-if="nuevo.kind === 'rate'" class="ent__row">
            <span class="ent__k">sobre</span>
            <select class="nodrag nf nf--base" v-model="nuevo.base">
              <option v-for="b in basesFijas" :key="b.value" :value="b.value" :title="b.help">
                {{ b.label }}</option>
              <option v-for="b in bases" :key="b.id" :value="b.name">{{ b.label }}</option>
            </select>
          </div>
          <!-- en la cuota: ¿ya viene por cuota, o es un total que se reparte? -->
          <div v-if="data.key === 'charges' && nuevo.kind === 'money'" class="ent__row">
            <span class="ent__k">cada</span>
            <select class="nodrag nf nf--base" v-model="nuevo.spread">
              <option :value="false">cuota</option>
              <option :value="true">total ÷ cuotas</option>
            </select>
          </div>
          <div class="ent__row ent__frase">
            <span class="ent__k">{{ frase }}</span>
            <button class="nodrag ok" @click="crear" :disabled="!nuevo.label.trim()">✓</button>
          </div>
        </div>
      </template>
    </div>

    <!-- resultados de la etapa -->
    <div v-if="filas.length" class="grp-rows st-out">
      <div v-for="(r, i) in filas" :key="r.name"
           :class="['grp-row', { 'is-out': i === filas.length - 1, 'is-off': r.status !== 'ok',
                                 'has-expr': r.verExpr, 'is-ajena': r.ajena,
                                 'is-total': data.sumRows && i === filas.length - 1 }]"
           :title="r.expr">
        <!-- el `+` hace que el nodo se lea como la SUMA que es, no como una lista. La primera fila
             no lo lleva (es la base) y la última tampoco (es el total). -->
        <em v-if="data.sumRows" class="grp-op">{{ i === 0 || i === filas.length - 1 ? '' : '+' }}</em>
        <span class="grp-k" :class="{ 'is-hidden': esSalidaDelNodo(r) }">
          {{ esSalidaDelNodo(r) ? '' : r.label }}
          <!-- La expresión, cuando la perilla vive en otra etapa: sin esto el nodo mostraba los
               pesos y no de dónde salían. Es lo que hace entendible el 10% sin meterlo DENTRO de la
               fórmula, que ataría la hoja a un solo lender. -->
          <!-- traducida: los `name` a su label y `*` como `×`. El crudo queda en el tooltip de la
               fila, que es donde sirve para copiarlo a otra fórmula. -->
          <i v-if="r.verExpr" class="grp-expr">{{ r.exprEs }}</i>
        </span>
        <b class="grp-v">{{ val(r) }}</b>
      </div>
    </div>

    <!-- LA VITRINA: la cuota de cada plazo ofrecido, de correr la misma hoja una vez por plazo.
         Es la pantalla que el cliente ve de verdad, y clickear una fila elige ese plazo. -->
    <div v-if="data.termsCompare && porPlazo.length" class="vit">
      <div class="vit__hd">cuota por plazo</div>
      <button v-for="p in porPlazo" :key="p.n" class="nodrag vit__row"
        :class="{ on: Number(inputs.installments) === p.n, bad: !p.ok }"
        @click="inputs.installments = p.n"
        :title="p.ok ? `${p.n} cuotas de ${fmtNum(p.value)}` : 'no se pudo calcular'">
        <span class="vit__n">{{ p.n }}</span>
        <b class="vit__v">{{ p.ok ? fmtNum(p.value) : '—' }}</b>
      </button>
    </div>

    <Handle id="out" type="source" :position="Position.Right" />
  </div>
</template>
