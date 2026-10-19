import {createRouter,createWebHistory} from 'vue-router';

// FUGA, sólo el juego (2026-10-18, Miguel: «oculta en una carpeta before lo que ya no usamos y deja solamente lo que ya
// aterrizamos del juego»). Los talleres y el calibrador web viejos están en before/ (fuera del juego); el método de
// trabajo —las pruebas del 2D, el probador y el calibrador por consola— sigue en scripts/.
//  · / : la entrada (título, entrar, perfil, salas —con las salas de prueba precargadas—, crear mundo, sala de espera);
//  · /juego : la partida (?ciudad=1&jugadores=3&papel=policia); /demo es el mismo (lo usan las pruebas de pantalla).
const router=createRouter({
 history:createWebHistory(),
 routes:[
  {path:'/',name:'inicio',component:()=>import('./views/InicioView.vue'),meta:{title:'FUGA'}},
  {path:'/inicio',redirect:to=>({path:'/',query:to.query})},
  {path:'/juego',name:'juego',component:()=>import('./views/DemoView.vue'),meta:{title:'En partida'}},
  {path:'/demo',name:'demo',component:()=>import('./views/DemoView.vue'),meta:{title:'En partida'}},
  // (prototipos para iterar rápido antes de llevarlos al juego)
  {path:'/prototipo/menu',name:'prototipo-menu',component:()=>import('./views/PrototipoMenuView.vue'),meta:{title:'Menú (prototipo)'}},
  {path:'/:resto(.*)*',redirect:'/'},
 ],
});
router.afterEach(to=>{document.title=to.meta.title&&to.meta.title!=='FUGA'?`${to.meta.title} · FUGA`:'FUGA';});
export default router;
