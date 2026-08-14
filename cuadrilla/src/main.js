import { createApp } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import App from './App.vue'
import Home from './vistas/Home.vue'
import Epica from './vistas/Epica.vue'
import Gente from './vistas/Gente.vue'
import Revision from './vistas/Revision.vue'
import Tarea from './vistas/Tarea.vue'
import Api from './vistas/Api.vue'
import Impostor from './vistas/Impostor.vue'
import './estilo.css'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'home', component: Home },
    // La épica tiene URL propia a propósito: se puede pegar en Slack y cae en la épica correcta.
    { path: '/epica/:id', name: 'epica', component: Epica, props: true },
    /* La TAREA: lo que una persona hace dentro de una épica. `:quien` acepta el id del tablero
       (`miguel`) o el login de GitHub (`mig-creditop`) — quien comparte el enlace suele tener a
       mano el login. */
    { path: '/epica/:id/:quien', name: 'tarea', component: Tarea, props: true },
    { path: '/gente', name: 'gente', component: Gente },
    { path: '/revision', name: 'revision', component: Revision },
    { path: '/api', name: 'api', component: Api },
    { path: '/games/impostor', name: 'impostor', component: Impostor },
    // La sección se llamaba /mcp; el enlace viejo sigue llevando a algún lado.
    { path: '/mcp', redirect: '/api' },
    { path: '/:resto(.*)', redirect: '/' },
  ],
  scrollBehavior: () => ({ top: 0 }),
})

createApp(App).use(router).mount('#app')
