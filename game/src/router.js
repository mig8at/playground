import {createRouter,createWebHistory} from 'vue-router';

// MYCITY (2026-11-22, Miguel: «quitemos todo lo de policías y ladrones para trabajar solamente en mycity»). El juego de
// policías y ladrones y su entrada (salas, bandos, perfil) quedaron en before/; el método de trabajo —las pruebas del 2D,
// el probador y el calibrador por consola— sigue en harness/pruebas/.
//  · / : la entrada: el país y la ciudad (engine/lugares.js);
//  · /ciudad : la ciudad para caminar (?lugar=bogota; ?ciudad= y ?jugadores= cambian la semilla y el tamaño). /juego y
//    /demo, las rutas de antes, llevan a /ciudad con lo que traigan.
const router=createRouter({
 history:createWebHistory(),
 routes:[
  {path:'/',name:'inicio',component:()=>import('./views/InicioView.vue'),meta:{title:'mycity'}},
  {path:'/inicio',redirect:to=>({path:'/',query:to.query})},
  {path:'/ciudad',name:'ciudad',component:()=>import('./views/DemoView.vue'),meta:{title:'La ciudad'}},
  {path:'/juego',redirect:to=>({path:'/ciudad',query:to.query})},
  {path:'/demo',redirect:to=>({path:'/ciudad',query:to.query})},
  // (el plano 2D entero, sin cargar el 3D: /plano?ciudad=1&jugadores=3)
  {path:'/plano',name:'plano',component:()=>import('./views/PlanoView.vue'),meta:{title:'El plano'}},
  // (el catálogo: los muebles, las fachadas y las texturas, de a uno, sin el mapa)
  {path:'/fachadas',name:'fachadas',component:()=>import('./views/FachadasView.vue'),meta:{title:'Fachadas'}},
  {path:'/catalogo',name:'catalogo',component:()=>import('./views/CatalogoView.vue'),meta:{title:'El catálogo'}},
  // (el prototipo de personajes humanos —2026-11-22—: el maniquí de la Universal Animation Library, sus animaciones y sus
  // niveles de detalle, para medir antes de decidir)
  {path:'/prototipo-personajes',name:'prototipo-personajes',component:()=>import('./views/PrototipoPersonajesView.vue'),meta:{title:'Prototipo de personajes'}},
  // (la página para calzar los peinados de los personajes nuevos en una sola cabeza, con cuatro vistas)
  {path:'/prototipo-pelo',name:'prototipo-pelo',component:()=>import('./views/PrototipoPeloView.vue'),meta:{title:'Calzar peinados'}},
  // (las contexturas posibles de los personajes nuevos: delgado, normal, robusto, grueso, musculoso, bajo y alto)
  {path:'/prototipo-contexturas',name:'prototipo-contexturas',component:()=>import('./views/PrototipoContexturasView.vue'),meta:{title:'Contexturas'}},
  // (la vitrina de la ropa: un maniquí por prenda, con los cortes del sombreador)
  {path:'/prototipo-ropa',name:'prototipo-ropa',component:()=>import('./views/PrototipoRopaView.vue'),meta:{title:'Vitrina de ropa'}},
  {path:'/:resto(.*)*',redirect:'/'},
 ],
});
// (el nombre que se ve: mycity, 2026-11-22, Miguel: «se me ocurre que se va a llamar mycity por el momento»)
router.afterEach(to=>{document.title=to.meta.title&&to.meta.title!=='mycity'?`${to.meta.title} · mycity`:'mycity';});
export default router;
