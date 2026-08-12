<script setup>
/* El avance. Reemplaza al anillo: una barra plana se lee más rápido y no compite con el texto.
   El relleno es del color del TEXTO, no de un color de marca — el color acá queda reservado para
   estado, y «voy por el 40%» no es un estado. Solo el 100% se pinta. */
defineProps({
  pct:    { type: Number, required: true },
  numero: { type: Boolean, default: true },
})
</script>

<template>
  <div class="med" :class="{ soloBarra: !numero }">
    <div class="pista"><span class="lleno" :class="{ full: pct >= 100 }" :style="{ width: pct + '%' }"></span></div>
    <span v-if="numero" class="pct" :class="{ full: pct >= 100, cero: pct === 0 }">{{ pct }}<i>%</i></span>
  </div>
</template>

<style scoped>
.med{display:flex;align-items:center;gap:10px;min-width:0}
.pista{flex:1 1 auto;height:4px;border-radius:2px;background:var(--soft-bg2);overflow:hidden;
  min-width:40px}
.lleno{display:block;height:100%;background:var(--page-ink);border-radius:2px;
  transition:width .45s cubic-bezier(.4,0,.2,1)}
.lleno.full{background:var(--ok)}
.pct{flex:0 0 auto;font-size:12.5px;font-weight:500;color:var(--page-ink);min-width:36px;
  text-align:right;letter-spacing:-.01em}
.pct.cero{color:var(--page-tenue);font-weight:400}
.pct.full{color:var(--ok)}
.pct i{font-style:normal;font-size:10.5px;color:var(--page-tenue);margin-left:1px}
.pct.full i{color:var(--ok);opacity:.7}
.soloBarra{gap:0}
</style>
