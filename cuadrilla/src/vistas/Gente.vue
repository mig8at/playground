<script setup>
import { computed } from 'vue'
import { laGente, dias, fraccion } from '../datos.js'
import Avatar from '../piezas/Avatar.vue'
import Barra from '../piezas/Barra.vue'

/* La misma persona vista de lado: no «cómo va esta épica» sino «en qué anda fulano», cruzando
   todas. Ordenada por lo que tiene trabado — quien espera hace más, arriba. */
const gente = computed(() => laGente())
</script>

<template>
  <div>
    <h1>Gente</h1>
    <p class="sub">En qué anda cada quien, cruzando todas las épicas. Primero el que lleva más esperando.</p>

    <div class="lista">
      <article v-for="p in gente" :key="p.quien" class="ficha">
        <header>
          <Avatar :quien="p.quien" :tam="34" />
          <div class="nom">
            <b>{{ p.nombre }}</b>
            <span class="sec">
              {{ p.epicas.length === 1 ? 'en 1 épica' : `en ${p.epicas.length} épicas` }}
              <template v-if="p.total"> · {{ fraccion(p.mergeadas, p.total) }}</template>
            </span>
          </div>
        </header>

        <Barra :pct="p.pct" />

        <div class="cifras">
          <span v-if="p.esperando" class="badge aprobacion">
            {{ p.esperando }} por aprobación · {{ dias(p.masDias) }}
          </span>
          <span v-if="p.desarrollo" class="badge desarrollo">{{ p.desarrollo }} en desarrollo</span>
          <span v-if="p.mergeadas" class="badge mergeada">
            {{ p.mergeadas }} {{ p.mergeadas === 1 ? 'mergeada' : 'mergeadas' }}
          </span>
          <span v-if="!p.total" class="badge desarrollo">sin ramas todavía</span>
        </div>

        <div class="epicas">
          <RouterLink v-for="e in p.epicas" :key="e.id" class="ep"
                      :to="{ name: 'epica', params: { id: e.id } }">
            {{ e.nombre }}
            <i class="cuenta">{{ p.ramas.filter(r => r.epica.id === e.id).length }}</i>
          </RouterLink>
        </div>
      </article>
    </div>
  </div>
</template>

<style scoped>
.sub{color:var(--page-soft);font-size:13px;margin:6px 0 0;max-width:70ch}

.lista{margin-top:18px;display:grid;gap:12px;grid-template-columns:repeat(auto-fill,minmax(320px,1fr))}
.ficha{background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:15px 16px;
  display:flex;flex-direction:column;gap:12px;transition:border-color .15s}
.ficha:hover{border-color:var(--line-fuerte)}
.ficha header{display:flex;align-items:center;gap:11px}
.nom{flex:1;min-width:0}
.nom b{font-size:14px;font-weight:500;display:block;line-height:1.35}
.sec{font-size:12px;color:var(--page-tenue)}

.cifras{display:flex;gap:14px;flex-wrap:wrap}

.epicas{display:flex;gap:6px;flex-wrap:wrap;border-top:1px solid var(--line);padding-top:11px;
  margin-top:auto}
.ep{font-size:12px;color:var(--page-soft);text-decoration:none;border:1px solid var(--line);
  border-radius:6px;padding:2px 8px;display:inline-flex;align-items:center;gap:6px;
  transition:border-color .15s,color .15s}
.ep:hover{border-color:var(--line-fuerte);color:var(--page-ink)}
.cuenta{font-style:normal;font-size:10.5px;color:var(--page-tenue)}
</style>
