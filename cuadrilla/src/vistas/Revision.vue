<script setup>
import { computed } from 'vue'
import { persona, colaDeRevision, dias } from '../datos.js'
import Avatar from '../piezas/Avatar.vue'

/* La cola: todo lo que tiene PR abierto y nadie aprobó, cruzando épicas, lo más viejo arriba.
   Es la única vista donde el orden NO lo decide la épica sino el tiempo — acá el criterio es
   «qué está frenando al equipo», y eso no respeta fronteras de épica. */
const cola = computed(() => colaDeRevision())

// 4 días es el corte que ya usa la fila de rama. Un solo umbral en toda la app, no dos.
const viejas = computed(() => cola.value.filter(r => r.dias >= 4).length)
</script>

<template>
  <div>
    <h1>Revisión</h1>
    <p class="sub">
      Todo lo que tiene PR abierto y nadie aprobó. Lo más viejo arriba, sin importar de qué épica sea.
    </p>

    <p v-if="!cola.length" class="limpio">✓ No hay nada esperando aprobación.</p>

    <template v-else>
      <p class="corte">
        <b>{{ cola.length }}</b> {{ cola.length === 1 ? 'PR espera' : 'PRs esperan' }}
        <template v-if="viejas">
          · <span class="ojo"><b>{{ viejas }}</b> hace 4 días o más</span>
        </template>
      </p>

      <ol class="cola">
        <li v-for="r in cola" :key="r.epica.id + r.repo + r.rama" :class="{ vieja: r.dias >= 4 }">
          <span class="dias">{{ r.dias }}<i>d</i></span>
          <div class="qué">
            <div class="l1">
              <span class="rama mono">{{ r.rama }}</span>
              <span class="repo mono">{{ r.repo }}</span>
              <span v-if="r.pr" class="pr mono">#{{ r.pr }}</span>
            </div>
            <div class="l2">
              <Avatar :quien="r.autor" :tam="17" />
              <span class="autor">{{ persona(r.autor).nombre }}</span>
              <RouterLink class="ep" :to="{ name: 'epica', params: { id: r.epica.id } }">
                {{ r.epica.nombre }}
              </RouterLink>
              <span v-if="r.nota" class="nota">{{ r.nota }}</span>
            </div>
          </div>
          <span class="diff mono"><i class="mas">+{{ r.mas }}</i> <i class="men">−{{ r.men }}</i></span>
        </li>
      </ol>
    </template>
  </div>
</template>

<style scoped>
.sub{color:var(--page-soft);font-size:13px;margin:6px 0 0;max-width:70ch}
.limpio{margin-top:18px;color:var(--ok);font-size:13.5px}
.corte{margin:18px 0 0;font-size:12.5px;color:var(--page-soft)}
.corte b{color:var(--page-ink);font-weight:500}
.ojo{color:var(--warn)} .ojo b{color:var(--warn)}

/* Una tabla, no un montón de cards: borde por fuera y filas separadas por una línea de 1px. */
ol.cola{list-style:none;margin:12px 0 0;padding:0;display:flex;flex-direction:column;gap:1px;
  border:1px solid var(--line);border-radius:10px;overflow:hidden;background:var(--line)}
ol.cola li{display:flex;align-items:center;gap:14px;background:var(--panel);padding:11px 15px;
  transition:background .15s}
ol.cola li:hover{background:var(--panel-2)}
ol.cola li.vieja{box-shadow:inset 2px 0 0 var(--warn)}

/* El número de días es lo primero que se lee: es el criterio de orden de toda la lista. */
.dias{flex:0 0 auto;font-family:ui-monospace,Menlo,monospace;font-size:16px;font-weight:500;
  color:var(--page-tenue);min-width:32px;text-align:right;line-height:1;letter-spacing:-.03em}
.dias i{font-style:normal;font-size:10.5px;opacity:.65;margin-left:1px}
li.vieja .dias{color:var(--warn)}

.qué{flex:1;min-width:0}
.l1{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
.l2{display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin-top:4px}
.rama{font-size:12.5px;font-weight:500}
.repo,.pr{font-size:11.5px;color:var(--page-tenue)}
.autor{font-size:12px;color:var(--page-soft)}
.ep{font-size:11.5px;color:var(--page-soft);text-decoration:none;border:1px solid var(--line);
  border-radius:5px;padding:1px 7px;transition:border-color .15s,color .15s}
.ep:hover{border-color:var(--line-fuerte);color:var(--page-ink)}
.nota{font-size:12px;color:var(--page-tenue)}
.nota::before{content:"↳ ";opacity:.55}
.diff{font-size:11px;white-space:nowrap;flex:0 0 auto;color:var(--page-tenue)}
.diff .mas{color:var(--ok)} .diff .men{color:var(--bad)}

@media (max-width:600px){ .diff{display:none} }
</style>
