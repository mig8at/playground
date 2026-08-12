import { createApp } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import App from './App.vue'
import Home from './vistas/Home.vue'
import Epica from './vistas/Epica.vue'
import Gente from './vistas/Gente.vue'
import Revision from './vistas/Revision.vue'
import Mcp from './vistas/Mcp.vue'
import './estilo.css'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'home', component: Home },
    // La épica tiene URL propia a propósito: se puede pegar en Slack y cae en la épica correcta.
    { path: '/epica/:id', name: 'epica', component: Epica, props: true },
    { path: '/gente', name: 'gente', component: Gente },
    { path: '/revision', name: 'revision', component: Revision },
    { path: '/mcp', name: 'mcp', component: Mcp },
    { path: '/:resto(.*)', redirect: '/' },
  ],
  scrollBehavior: () => ({ top: 0 }),
})

createApp(App).use(router).mount('#app')
