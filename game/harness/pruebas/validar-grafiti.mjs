// Valida el grafiti sobre muros enteros (2026-11-21, engine/grafiti.js y engine/muros.js): los cuatro lados de cada
// edificio y las cuatro paredes de cada cuarto.
//  · la grilla entra entera en el muro y lo que sobra es menos de un píxel;
//  · cada hueco (ventana o puerta) cae dentro del muro, y ningún píxel pintable tiene su centro en un hueco;
//  · pintar respeta la máscara: sobre un hueco, fuera de la grilla o con un color que no existe, no cambia nada;
//  · guardar y volver a leer (aTexto / deTexto) da el mismo grafiti; valido rechaza lo pintado sobre un hueco;
//  · cada fachada es exactamente la suma de sus PAREDES (una por piso y por tramo entre tabiques): cubren todo, no se
//    pisan, ninguna es más angosta que el mínimo; lo pintado de corrido, repartido en paredes y vuelto a armar, es igual;
//    y los identificadores de todas las paredes de un edificio no se repiten;
//  · el identificador de un muro lleva de vuelta al mismo muro (muroDe), y sus dos puntas caen sobre el borde del
//    edificio (exterior) o del cuarto (interior), separadas por su ancho.
// Uso: node harness/pruebas/validar-grafiti.mjs [ciudades=2] [semilla0=1]
import {generateBlueprint} from '../../src/engine/blueprint.js';
import {muroExterior,murosDeCuarto,muroDe,puntoDe,otroLoteDe,paredesDeFachada,paredesDelEdificio,componerFachada,partirFachada,MIN_PARED} from '../../src/engine/muros.js';
import {GRAFITI,lienzoDe,vacio,pintar,pintados,valido,pixelEn,mascaraDe,pintable,centroDe,aTexto,deTexto} from '../../src/engine/grafiti.js';
const N=+(process.argv[2]||2),S0=+(process.argv[3]||1);const fallas=new Map();const falla=(k,ej)=>{const f=fallas.get(k)||fallas.set(k,{n:0,ej:[]}).get(k);f.n++;if(f.ej.length<3)f.ej.push(ej);};
let ext=0,int=0,pix=0,libres=0,mayor=0,sale={},pfach=0,fachs=0;
for(let s=S0;s<S0+N;s++){const bp=generateBlueprint({seed:s,team:3});
 for(const L of bp.lots){if(!L.levels?.length)continue;const otro=otroLoteDe(bp,L),muros=['N','S','E','W'].map(l=>muroExterior(L,l));
  L.levels.slice(0,L.floors).forEach((lv,nivel)=>{for(const q of lv.rooms)muros.push(...murosDeCuarto(L,nivel,q,otro));});
  // las paredes de cada fachada: la cubren entera, sin pisarse
  for(const lado of ['N','S','E','W']){const F=muroExterior(L,lado),Z=lienzoDe(F),P=paredesDeFachada(L,lado),d={ciudad:s,lote:L.id,lado},cubre=new Uint8Array(Z.cols*Z.rows);fachs++;pfach+=P.length;muros.push(...P);
   for(const w of P){if(w.ancho<MIN_PARED-1e-6&&w.ancho<F.ancho-1e-6)falla('una pared de fachada más angosta que el mínimo',{...d,id:w.id,ancho:w.ancho});const c0=Math.round(w.u0/Z.px),c1=Math.round(w.u1/Z.px),f0=Z.rows-Math.round((w.y0+w.alto)/Z.px),f1=Z.rows-Math.round(w.y0/Z.px),zw=lienzoDe(w);
    if(zw.cols!==c1-c0||zw.rows!==f1-f0)falla('la grilla de una pared no es su recorte de la fachada',{...d,id:w.id,pared:[zw.cols,zw.rows],recorte:[c1-c0,f1-f0]});
    for(let f=f0;f<f1;f++)for(let c=c0;c<c1;c++)cubre[f*Z.cols+c]++;}
   let huecos=0,dobles=0;for(const v of cubre){if(!v)huecos++;else if(v>1)dobles++;}if(huecos)falla('las paredes no cubren toda la fachada',{...d,pixeles:huecos});if(dobles)falla('dos paredes de una fachada se pisan',{...d,pixeles:dobles});
   // pintar de corrido, repartir y volver a armar
   const g=vacio(Z.cols,Z.rows),M=mascaraDe(F);for(let k=0;k<300;k++)pintar(g,(k*53+L.id)%Z.cols,(k*29+7)%Z.rows,1+k%15,M);const partes=partirFachada(L,lado,g),g2=componerFachada(L,lado,partes);
   if(pintados(g)&&(!g2||g2.d.some((v,i)=>v!==g.d[i])))falla('repartir en paredes y volver a armar no da lo mismo',d);
   for(const w of P){const v=partes[w.id];if(v){const gw=deTexto(v.t,v.cols,v.rows);if(!gw||!valido(gw,w).ok)falla('lo repartido a una pared no es válido en esa pared',{...d,id:w.id});}}}
  {const ids=paredesDelEdificio(bp,L).map(w=>w.id);if(new Set(ids).size!==ids.length)falla('identificadores de pared repetidos en un edificio',{ciudad:s,lote:L.id});}
  for(const m of muros){const Z=lienzoDe(m),d={ciudad:s,id:m.id};m.clase==='exterior'?ext++:int++;pix+=Z.cols*Z.rows;mayor=Math.max(mayor,Z.cols*Z.rows);if(m.clase==='interior')sale[m.sale]=(sale[m.sale]||0)+1;
   if(Z.cols<1||Z.rows<1){falla('un muro sin grilla',d);continue;}
   if(Z.cols*Z.px>m.ancho+1e-6||Z.rows*Z.px>m.alto+1e-6)falla('la grilla no entra en el muro',d);if(m.ancho-Z.cols*Z.px>=Z.px-1e-6||m.alto-Z.rows*Z.px>=Z.px-1e-6)falla('sobra un píxel entero o más',d);
   for(const h of m.huecos)if(h.u0<-.01||h.u1>m.ancho+.01||h.y0<-.01||h.y1>m.alto+.01||h.u1<=h.u0||h.y1<=h.y0)falla('un hueco se sale del muro',{...d,h});
   const M=mascaraDe(m);let li=0;for(let i=0;i<M.length;i++)li+=M[i];libres+=li;
   // la máscara, contra la pregunta píxel por píxel, en una muestra
   for(let k=0;k<60;k++){const c=(k*37+m.lote*11)%Z.cols,f=(k*61+m.lote*7)%Z.rows,{u,y}=centroDe(Z,c,f),enHueco=m.huecos.some(h=>u>h.u0&&u<h.u1&&y>h.y0&&y<h.y1);
    if(M[f*Z.cols+c]!==(pintable(m,c,f,Z)?1:0))falla('la máscara no coincide con pintable()',{...d,c,f});if(enHueco&&M[f*Z.cols+c])falla('un píxel pintable cae en un hueco',{...d,c,f});
    const q=pixelEn(m,u,y);if(!q||q.c!==c||q.f!==f)falla('el centro de un píxel no da ese píxel',{...d,c,f});}
   const g=vacio(Z.cols,Z.rows);let puestos=0;for(let k=0;k<40;k++){const c=(k*53+3)%Z.cols,f=(k*29+5)%Z.rows,antes=pintados(g),ok=pintar(g,c,f,1+k%15,M);if(ok)puestos++;if(ok&&!M[f*Z.cols+c])falla('pintó sobre un hueco',{...d,c,f});if(pintados(g)!==antes+(ok?1:0))falla('pintar cambió más de un píxel',d);}
   if(pintar(g,-1,0,3,M)||pintar(g,Z.cols,0,3,M)||pintar(g,0,Z.rows,3,M)||pintar(g,0,0,99,M))falla('pintó fuera de la grilla o con un color que no existe',d);
   const g2=deTexto(aTexto(g),Z.cols,Z.rows);if(!g2||g2.d.some((v,i)=>v!==g.d[i]))falla('guardar y leer no da el mismo grafiti',d);if(!valido(g,m).ok)falla('rechazó el grafiti de su muro',d);
   if(li<M.length){const i=M.indexOf(0),t=vacio(Z.cols,Z.rows);t.d[i]=3;if(valido(t,m).ok)falla('aceptó algo pintado sobre un hueco',d);}
   if(valido(vacio(Z.cols+1,Z.rows),m).ok)falla('aceptó un grafiti de otro tamaño',d);
   // el identificador vuelve al mismo muro, y sus puntas caen donde deben
   const v=muroDe(bp,m.id);if(!v||v.ancho!==m.ancho||v.alto!==m.alto||v.c.x!==m.c.x||v.c.z!==m.c.z||v.huecos.length!==m.huecos.length||v.sale!==m.sale)falla('el identificador no lleva al mismo muro',d);
   const a=puntoDe(m,0),b=puntoDe(m,m.ancho);if(Math.abs(Math.hypot(b.x-a.x,b.z-a.z)-m.ancho)>.01)falla('las puntas no están a su ancho',d);
   const R=m.clase==='exterior'?{x:L.rect.x,y:L.rect.y,w:L.rect.w,h:L.rect.h}:L.levels[m.nivel].rooms.find(q=>q.id===m.cuarto),enBorde=p=>Math.abs(p.x-R.x)<.01||Math.abs(p.x-R.x-R.w)<.01||Math.abs(p.z-R.y)<.01||Math.abs(p.z-R.y-R.h)<.01;
   if(!enBorde(a)||!enBorde(b))falla('las puntas del muro no caen sobre su borde',{...d,a,b});}}}
console.log(`grafiti · ${N} ciudades · ${fachs} fachadas partidas en ${pfach} paredes · ${int} caras de cuarto · ${(pix/1e6).toFixed(1)} millones de píxeles de ${GRAFITI.px*100} cm, ${Math.round(libres/pix*100)} % pintable · el muro más grande, ${mayor.toLocaleString('es-CO')} píxeles`);
console.log('  paredes de cuarto según lo que hay detrás: '+Object.entries(sale).map(([k,n])=>`${k==='0.075'?'tabique':k==='0.145'?'medianera':'fachada'} ${n}`).join(' · '));
for(const [k,f] of fallas)console.log(`  ${f.n}\t${k}\n        ${f.ej.map(e=>JSON.stringify(e)).join('\n        ')}`);
console.log(`fallas: ${[...fallas.values()].reduce((a,f)=>a+f.n,0)}`);process.exit(fallas.size?1:0);
