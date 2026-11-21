// Valida el grafiti (2026-11-21, engine/grafiti.js) sobre todos los paños pintables de la ciudad:
//  · la grilla de cada paño entra entera en él y lo que sobra es menos de un píxel, repartido a los dos lados;
//  · pintar un píxel cambia ése y ninguno más, y no toca el grafiti de antes; fuera de la grilla o con un color que no
//    existe, no cambia nada;
//  · pixelEn devuelve, para el centro de cada píxel, ese mismo píxel (ida y vuelta);
//  · valido acepta el grafiti de su paño y rechaza el de otro tamaño o con un color de afuera de la paleta.
// Uso: node harness/pruebas/validar-grafiti.mjs [ciudades=2] [semilla0=1]
import {generateBlueprint} from '../../src/engine/blueprint.js';
import {paniosPintables} from '../../src/engine/fachada-medida.js';
import {GRAFITI,lienzoDe,vacio,pintar,colorEn,pintados,valido,pixelEn} from '../../src/engine/grafiti.js';
const N=+(process.argv[2]||2),S0=+(process.argv[3]||1);const fallas=new Map();const falla=(k,ej)=>{const f=fallas.get(k)||fallas.set(k,{n:0,ej:[]}).get(k);f.n++;if(f.ej.length<3)f.ej.push(ej);};
let panios=0,pixeles=0,mayor=0;
for(let s=S0;s<S0+N;s++){const bp=generateBlueprint({seed:s,team:3});
 for(const p of paniosPintables(bp)){panios++;const L=lienzoDe(p),d={ciudad:s,id:p.id};pixeles+=L.cols*L.rows;mayor=Math.max(mayor,L.cols);
  if(L.cols<1||L.rows<1)falla('un paño sin grilla',d);if(L.cols*L.px>p.ancho+1e-6||L.rows*L.px>p.alto+1e-6)falla('la grilla no entra en el paño',d);
  if(p.ancho-L.cols*L.px>=L.px-1e-6||p.alto-L.rows*L.px>=L.px-1e-6)falla('sobra un píxel entero o más',d);if(L.du<-1e-6||L.dy<-1e-6)falla('el margen es negativo',d);
  const g0=vacio(L.cols,L.rows),c=(p.lote*7+3)%L.cols,f=(p.lote*5+1)%L.rows,g1=pintar(g0,c,f,3);
  if(pintados(g0)!==0)falla('pintar cambió el grafiti de antes',d);if(pintados(g1)!==1||colorEn(g1,c,f)!==GRAFITI.paleta[3])falla('pintar no dejó ese píxel de ese color',d);
  if(pintar(g1,-1,0,3)!==g1||pintar(g1,L.cols,0,3)!==g1||pintar(g1,0,L.rows,3)!==g1||pintar(g1,0,0,99)!==g1)falla('pintó fuera de la grilla o con un color que no existe',d);
  if(pintados(pintar(g1,c,f,0))!==0)falla('borrar no borró',d);
  for(const [ci,fi] of [[0,0],[L.cols-1,L.rows-1],[c,f]]){const q=pixelEn(p,L.du+(ci+.5)*L.px,L.dy+(L.rows-1-fi+.5)*L.px);if(!q||q.c!==ci||q.f!==fi)falla('el punto del centro de un píxel no da ese píxel',{...d,ci,fi,q});}
  if(!valido(g1,p).ok)falla('rechazó el grafiti de su paño',d);if(valido(vacio(L.cols+1,L.rows),p).ok)falla('aceptó un grafiti de otro tamaño',d);if(valido({...g1,celdas:'z'+g1.celdas.slice(1)},p).ok)falla('aceptó un color de afuera de la paleta',d);}}
console.log(`grafiti · ${N} ciudades · ${panios} paños pintables · ${pixeles.toLocaleString('es-CO')} píxeles de 10 cm · el más ancho, ${mayor} píxeles · ${GRAFITI.paleta.length-1} colores`);
for(const [k,f] of fallas)console.log(`  ${f.n}\t${k}\n        ${f.ej.map(e=>JSON.stringify(e)).join('\n        ')}`);
console.log(`fallas: ${[...fallas.values()].reduce((a,f)=>a+f.n,0)}`);process.exit(fallas.size?1:0);
