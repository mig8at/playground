import { createRouter, createWebHashHistory } from 'vue-router'
import ErdView from '../views/ErdView.vue'

export default createRouter({
  history: createWebHashHistory(),
  routes: [{ path: '/', name: 'erd', component: ErdView }],
  scrollBehavior() {
    return { top: 0 }
  },
})
