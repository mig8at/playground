import { createApp } from 'vue'
import App from './App.vue'
import './styles.css'
import { startRoutes } from './route'
import { bindThemeToggle } from './workbench.js'

/* Con el estilo «Paneles» de la base (`workbench.css`), como el resto de las herramientas. */
document.documentElement.setAttribute('data-style', 'panels')
/* El tema no se elige en Flow: lo hereda de Cockpit (o del sistema, fuera de él). `bindThemeToggle` es lo que escucha
   a Cockpit y aplica su claro/oscuro y su paleta; se le pasa un botón que no se monta, así no hay control propio. */
bindThemeToggle(document.createElement('button'))

createApp(App).mount('#app')
startRoutes()
