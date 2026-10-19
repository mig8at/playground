/* Los barrios residenciales de la montaña (FUGA, 2026-10-11): los edificios de las manzanas de la grilla, con varios
   pisos como en la ciudad pero residenciales, y un parque chico alrededor (pasto, senderos, árboles, bancas, faroles).
   Se arman con el mismo código de la ciudad (buildWorld de world3d.js: fachadas del paquete downtown, pisos, cuartos,
   muebles, escaleras y ascensores). Ese código trabaja en una grilla desde (0, 0) con el piso en y = 0, así que cada
   barrio (los edificios de un mismo nivel, plan.isla.barrios) se arma en su marco local y su grupo se corre a su lugar:
   (ox·6, nivel, oy·6). Lo demás del marco (calles, otros escalones) va como `vacio`: no se dibuja nada ahí.
   Las consultas (piso, choques, adentro) pasan del mundo al marco local del barrio que toque. */
import {City} from '../engine/index.js';
import {buildWorld,CELL} from './world3d.js';
import * as THREE from 'three';

const K=City.K;
// Sobre el pasto del lote (que va a nivel + 0,05): el piso del barrio un poco más arriba, para que no se pisen.
const ALZA=.06;

// ocultar(cx, cy): casillas (del mundo) que el barrio deja para otro (las rampas de la isla, que se dibujan solas).
export function createBarrios(plan,{downtown=null,nature=null,furniture=null,ocultar=null,mobiliario=true}={}){
 const group=new THREE.Group(),lista=[];
 for(const b of plan?.isla?.barrios||[]){
  const {W,H}=b,kind=new Uint8Array(W*H).fill(K.courtyard),vacio=new Uint8Array(W*H).fill(1);
  const celdas=b.celdas.filter(([x,y])=>!ocultar?.(x+b.ox,y+b.oy));
  for(const [x,y] of celdas){kind[y*W+x]=K.plaza;vacio[y*W+x]=0;}
  // Un parque por mitad de manzana (su rectángulo), como jardín (buildWorld con barrio): pasto entero con árboles,
  // arbustos, alguna banca y un farol cada tres casillas; las casillas del edificio quedan como edificio. Sin publicidad.
  const map={W,H,seed:Math.round(b.nivel*100)+b.ox*7+b.oy*13,kind,blocks:[],sites:[],houses:[],hideouts:[],thiefSpawns:[],station:null,parks:b.parques,names:null};
  const world=buildWorld(map,{plan:{lots:b.lotes,courts:[],isla:null},downtown,nature,furniture,vacio,barrio:true,mobiliario});
  const ox=b.ox*CELL,oz=b.oy*CELL,y=b.nivel+ALZA;world.group.position.set(ox,y,oz);group.add(world.group);
  lista.push({world,ox,oz,y,x1:ox+W*CELL,z1:oz+H*CELL,celdas:new Set(celdas.map(([x,y])=>x+','+y))});}
 // El barrio de un punto: el que tiene esa casilla como suya (de sus lotes o su parque).
 const de=(x,z)=>{for(const B of lista){if(x<B.ox||z<B.oz||x>=B.x1||z>=B.z1)continue;const cx=Math.floor((x-B.ox)/CELL),cy=Math.floor((z-B.oz)/CELL);if(B.celdas.has(cx+','+cy))return B;}return null;};
 return {group,count:lista.length,
  // El piso en (x, z) para quien viene a la altura feet, o null si el punto no es de un barrio.
  floorAt(x,z,feet=0){const B=de(x,z);return B?B.world.floorAt(x-B.ox,z-B.oz,feet-B.y)+B.y:null;},
  collide(x,z,r,hard,feet=0){const B=de(x,z);return B?B.world.collide(x-B.ox,z-B.oz,r,hard,feet-B.y):false;},
  dentro(x,z,y){const B=de(x,z);return B?B.world.dentro(x-B.ox,z-B.oz,y-B.y):false;},
  updateDoors(dt,people){for(const B of lista)B.world.updateDoors(dt,people.map(p=>({...p,x:p.x-B.ox,z:p.z-B.oz})));},
  updateInteriors(x,z,dt,y){for(const B of lista)B.world.updateInteriors(x-B.ox,z-B.oz,dt,y-B.y);},
  setNight(on){for(const B of lista)B.world.setNight(on);},
  // Las luces de los faroles de los parques, en coordenadas del mundo (para las luces de noche del demo).
  get lights(){return lista.flatMap(B=>(B.world.lights||[]).map(l=>({x:l.x+B.ox,y:l.y+B.y,z:l.z+B.oz})));},
  dispose(){for(const B of lista)B.world.dispose();}};
}
