import { createRouter, createWebHashHistory } from 'vue-router'
import SimuladorView from '../views/SimuladorView.vue'

// Solo el simulador de filtros (comercio/lender). El modelo de datos/ERD vive en `domain-model/`.
export default createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'simulador', component: SimuladorView },
  ],
  scrollBehavior() {
    return { top: 0 }
  },
})
