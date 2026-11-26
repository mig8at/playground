import { createApp } from 'vue'
import App from './App.vue'
import './styles.css'
import { startBridge } from './bridge'

/* Con el estilo «Paneles» de la base (`workbench.css`), como el resto de las herramientas. */
document.documentElement.setAttribute('data-style', 'panels')
/* El tema no se elige en Flow: lo hereda de Cockpit (o del sistema, fuera de él). Lo escucha `bindThemeToggle`, que
   App.vue engancha a un botón oculto del pie (así Cockpit también pone ahí su botón del panel «Claude»). */

createApp(App).mount('#app')
startBridge()   // los comandos de bin/flow
