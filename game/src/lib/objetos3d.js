/* El catálogo de objetos hechos a mano (FUGA, 2026-10-12): lo que no viene de un modelo (OBJ/GLB) se arma acá con
   cajas, una vez, y lo usan los edificios (town3d.js), el ascensor (buildCabins) y el taller (/objetos). Una mejora
   acá se ve en todo el juego.

   Cada objeto da sus piezas en su propio marco: el origen es el centro de su base, el frente mira a +z y x va a lo
   ancho. Una pieza: {x, y, z, sx, sy, sz, color} (y: dónde empieza abajo; la caja va de y a y+sy), y si hace falta
   rx/ry/rz (giros sobre el centro de su base) o luz: true (va con el material que brilla). piezas(o) recibe la medida
   que le da el plano (o.w a lo ancho, o.d de fondo) y se acomoda a ella; antes(o) es como era (para comparar).
   alto(o): dónde queda la cara de arriba (para lo que va encima: la comida del mostrador, el computador…).

   Estilo low poly: nada de un bloque macizo; zócalo, cuerpo, paneles, cubierta que sobresale, patas o listones, y
   tiradores; maderas, metales y pinturas de PALETA (las de los muebles de Casa2); unas 20–40 cajas por objeto.
   Una pieza con cyl: true es un cilindro de 10 lados (sx y sz, el diámetro): para lo redondo (papeleras, ruedas). */

import * as THREE from 'three';
import {mergeGeometries} from 'three/addons/utils/BufferGeometryUtils.js';

export const PALETA={madera:'#9a7352',maderaClara:'#c39a6b',maderaOscura:'#6e4b33',piedra:'#d8cbb5',acero:'#b9c0c6',aceroClaro:'#dde2e6',
 aceroOscuro:'#5d6266',negro:'#25282b',grafito:'#3a3e43',pantalla:'#26425a',crema:'#efe6d6',rojo:'#c0392b',ambar:'#f2b04a',cobre:'#b07a4a'};
import {piezasSinTitilar} from '../engine/titileo.js';
const C=PALETA,p=(x,y,z,sx,sy,sz,color,extra)=>({x,y,z,sx,sy,sz,color,...extra});
// (un color más oscuro o más claro: k < 1 oscurece)
const shadeHex=(h,k)=>'#'+[1,3,5].map(i=>Math.max(0,Math.min(255,Math.round(parseInt(h.slice(i,i+2),16)*k))).toString(16).padStart(2,'0')).join('');

// La ropa de la tienda (2026-10-17): colores de cada clase de prenda, en el orden en que se reparten.
const ROPA={camisas:['#f2f0eb','#8fb3d9','#d9a5a5','#2f3a4f','#e8d9b5','#9bbf9a','#c94f4f','#4a4a52'],abrigos:['#5a4636','#2e3440','#7c6a55','#4b5d4a','#8a2f2f','#3c3c44'],
 vestidos:['#b8324a','#2f4f7a','#e4b4c2','#1f1f24','#e9d27a','#5f8f6a'],doblada:['#3b5a86','#e9e6df','#8a8f96','#c45a5a','#2b2b2e','#d8c49a','#6e8f6a','#9a7aa8']};
// Una fila de n cosas iguales repartidas en [a, b] (los centros).
const row=(n,a,b)=>Array.from({length:n},(_,i)=>a+(b-a)*(n>1?i/(n-1):.5));

export const OBJETOS={
 // ---------- Locales ----------
 mostrador:{nombre:'Mostrador',grupo:'Locales',medida:[2.2,.7],alto:()=>1.0,
  antes:o=>[p(0,0,0,o.w,1.05,o.d,'#8d7360')],
  piezas:o=>{const W=o.w,D=o.d,n=Math.max(2,Math.round(W/.75)),pw=(W-.2)/n;
   return [p(0,0,-.03,W-.1,.1,D-.12,C.grafito),// el zócalo, metido
    p(0,.1,0,W-.04,.85,D-.06,C.madera),// el cuerpo
    ...row(n,-(W-.2)/2+pw/2,(W-.2)/2-pw/2).flatMap(x=>[p(x,.22,D/2-.03,pw-.08,.6,.02,C.maderaClara),p(x,.2,D/2-.035,pw-.04,.64,.012,C.maderaOscura)]),// los paneles del frente, con su marco
    p(0,.95,.01,W,.05,D+.02,C.piedra),// la cubierta, que sobresale
    p(W/2-.32,1.0,-.05,.34,.1,.28,C.negro),p(W/2-.32,1.1,-.11,.26,.16,.03,C.grafito,{rx:-.35}),p(W/2-.32,1.1,-.1,.22,.12,.005,C.pantalla,{rx:-.35})];}},// la caja registradora
 tv:{nombre:'Televisor',grupo:'Casa',medida:[1.4,.45],alto:()=>.45,
  antes:o=>[p(0,.45,0,o.w,.55,o.d,'#2f3437')],
  piezas:o=>{const W=o.w,D=o.d;
   return [// el mueble: patas, cuerpo, dos puertas con tirador y la cubierta
    ...[-1,1].flatMap(s=>[p(s*(W/2-.08),0,D/2-.08,.05,.08,.05,C.maderaOscura),p(s*(W/2-.08),0,-D/2+.08,.05,.08,.05,C.maderaOscura)]),
    p(0,.08,0,W-.04,.34,D-.04,C.madera),...[-1,1].flatMap(s=>[p(s*(W-.12)/4,.11,D/2-.015,(W-.16)/2-.02,.28,.012,C.maderaClara),p(s*.05,.24,D/2,.02,.08,.02,C.aceroOscuro)]),
    p(0,.42,0,W,.03,D,C.maderaOscura),
    // la pantalla en su pie
    p(0,.45,-.04,.3,.02,.2,C.negro),p(0,.47,-.06,.06,.12,.04,C.negro),p(0,.55,-.05,Math.min(1.15,W-.2),.66,.05,C.negro),p(0,.58,-.022,Math.min(1.15,W-.2)-.06,.6,.005,C.pantalla)];}},
 caja:{nombre:'Caja de madera',grupo:'Bodega',medida:[.8,.8],alto:()=>.8,
  antes:o=>[p(0,0,0,o.w,.8,o.d,'#b98a4f')],
  piezas:o=>{const W=Math.min(o.w,.8),D=Math.min(o.d,.8),H=.78,out=[],cm='#8a6440',sl='#c49a63';
   for(const sx of [-1,1])for(const sz of [-1,1])out.push(p(sx*(W/2-.04),0,sz*(D/2-.04),.08,H,.08,cm));// las cuatro esquinas
   for(const y of [.06,.32,.58]){// tres listones por lado, con luz entre ellos
    for(const s of [-1,1]){out.push(p(0,y,s*(D/2-.015),W-.14,.16,.03,sl),p(s*(W/2-.015),y,0,.03,.16,D-.14,sl));}}
   for(const x of row(4,-(W-.2)/2,(W-.2)/2))out.push(p(x,H,0,(W-.12)/4-.02,.03,D-.02,sl));// la tapa
   out.push(p(0,H+.03,0,.06,.012,D-.06,cm));// el listón que cruza la tapa
   return out;}},
 buzones:{nombre:'Buzones',grupo:'Edificio',medida:[1.2,.3],alto:()=>1.6,
  antes:o=>[p(0,.3,0,o.w,1.3,o.d,'#9aa3a8')],
  piezas:o=>{const W=o.w,D=Math.min(o.d,.3),cols=Math.max(2,Math.round(W/.3)),rows=4,cw=(W-.08)/cols,rh=.24,out=[];
   out.push(p(0,.3,-.01,W,1.3,D-.02,C.aceroOscuro),p(0,1.6,0,W+.04,.04,D+.02,C.grafito),p(0,.26,0,W+.04,.04,D+.02,C.grafito));// el mueble, la cornisa y la base
   for(let j=0;j<rows;j++)for(let i=0;i<cols;i++){const x=-(W-.08)/2+cw*(i+.5),y=.38+j*(rh+.06);
    out.push(p(x,y,D/2-.01,cw-.04,rh,.015,C.acero),p(x,y+rh-.07,D/2+.006,cw-.12,.012,.006,C.negro),p(x+cw/2-.06,y+.05,D/2+.006,.02,.04,.012,C.ambar),p(x-cw/2+.07,y+.06,D/2+.006,.06,.025,.004,C.crema));}// puertita, ranura, cerradura y etiqueta
   return out;}},
 caja_fuerte:{nombre:'Caja fuerte',grupo:'Banco',medida:[.8,.8],alto:()=>1.1,
  antes:o=>[p(0,0,0,o.w,1.1,o.d,'#5d6266')],
  piezas:o=>{const W=Math.min(o.w,.8),D=Math.min(o.d,.8);
   return [...[-1,1].flatMap(s=>[p(s*(W/2-.08),0,D/2-.08,.08,.06,.08,C.negro),p(s*(W/2-.08),0,-D/2+.08,.08,.06,.08,C.negro)]),// las patas
    p(0,.06,0,W,1.0,D,C.grafito),p(0,1.06,0,W+.02,.04,D+.02,C.aceroOscuro),// el cuerpo y su tapa
    p(.02,.14,D/2,W-.16,.84,.04,C.aceroOscuro),p(.02,.18,D/2+.04,W-.26,.76,.01,C.grafito),// la puerta y su contramarco
    ...[.3,.75].map(y=>p(-W/2+.06,.06+y,D/2+.01,.04,.14,.05,C.negro)),// las bisagras
    p(.05,.6,D/2+.05,.16,.16,.03,C.aceroClaro),p(.05,.66,D/2+.08,.03,.04,.01,C.negro),// la perilla con su marca
    p(.25,.42,D/2+.05,.03,.18,.05,C.aceroClaro),p(.25,.42,D/2+.09,.14,.03,.03,C.aceroClaro)];}},// la manija
 // ---------- Oficina ----------
 computador:{nombre:'Computador',grupo:'Oficina',medida:[.6,.35],alto:()=>.4,
  // (va sobre el escritorio: y es la cara de arriba del escritorio)
  antes:()=>[p(0,0,0,.24,.02,.16,'#2a2d30'),p(-0,.01,-.02,.05,.14,.04,'#2a2d30'),p(0,.14,0,.58,.36,.04,'#1c1f22'),p(0,.165,.022,.53,.31,.005,'#3d78a8')],
  piezas:()=>[p(0,0,-.08,.22,.015,.16,C.grafito),p(0,.015,-.1,.05,.16,.035,C.grafito),// el pie
   p(0,.14,-.08,.56,.34,.035,C.negro),p(0,.155,-.06,.52,.3,.004,C.pantalla),p(0,.145,-.059,.08,.012,.004,C.aceroClaro),// el monitor y su marca
   p(0,0,.14,.42,.018,.14,C.grafito),...row(4,.11,.18).map(z=>p(0,.018,z,.38,.006,.022,C.aceroOscuro)),// el teclado
   p(.3,0,.16,.06,.022,.1,C.grafito),p(.3,0,.16,.2,.002,.2,C.negro)]},// el mouse en su pad
 // ---------- Colegio (2026-10-17, Miguel: «en las escuelas creo que falta buenas mesas») ----------
 // El pupitre y su silla de tubo pintado (el azul de los colegios), el pizarrón verde con su bandeja de tizas y los
 // casilleros de lámina: cada uno a la medida que le reserva el aula (blueprint.js, ITEMS y el reparto de «pupitres»).
 pupitre:{nombre:'Pupitre',grupo:'Colegio',medida:[.7,.5],alto:()=>.72,
  antes:o=>[p(0,0,0,o.w,.72,o.d,'#a7825f')],
  piezas:o=>{const W=Math.min(o.w||.7,.75),D=Math.min(o.d||.5,.55),tb='#3f6e9a',top='#dccaa4',ed='#7b5a3c';
   return [...[-1,1].flatMap(sx=>[-1,1].flatMap(sz=>[p(sx*(W/2-.04),0,sz*(D/2-.04),.03,.69,.03,tb),p(sx*(W/2-.04),0,sz*(D/2-.04),.04,.015,.04,C.negro)])),// las cuatro patas de tubo, con su regatón
    ...[-1,1].map(sx=>p(sx*(W/2-.04),.12,0,.025,.025,D-.08,tb)),p(0,.12,-(D/2-.04),W-.08,.025,.025,tb),// los travesaños de abajo (los pies del niño van por delante)
    ...[-1,1].map(sx=>p(sx*(W/2-.04),.66,0,.025,.03,D-.08,tb)),// los largueros que cargan la cubierta
    p(0,.53,-.04,W-.1,.012,D-.2,C.aceroOscuro),...[-1,1].map(sx=>p(sx*(W/2-.06),.53,-.04,.012,.08,D-.2,C.aceroOscuro)),p(0,.53,-(D/2-.1),W-.1,.08,.012,C.aceroOscuro),// la parrilla para los cuadernos
    p(0,.69,0,W,.03,D,ed),p(0,.695,0,W-.02,.028,D-.02,top),// la cubierta laminada con su canto
    p(0,.72,-(D/2-.05),W-.12,.006,.02,'#bfae8a')];}},// la ranura del lápiz
 silla_escolar:{nombre:'Silla escolar',grupo:'Colegio',medida:[.45,.45],alto:()=>.44,
  antes:o=>[p(0,0,0,o.w,.9,o.d,'#5d6670')],
  piezas:()=>{const tb='#3f6e9a',wd='#b5834f',S=.4;
   return [...[-1,1].flatMap(sx=>[-1,1].flatMap(sz=>[p(sx*(S/2-.02),0,sz*(S/2-.02),.025,.42,.025,tb),p(sx*(S/2-.02),0,sz*(S/2-.02),.035,.012,.035,C.negro)])),// las patas
    ...[-1,1].map(sx=>p(sx*(S/2-.02),.15,0,.02,.02,S-.04,tb)),// los travesaños de los costados
    p(0,.42,0,S,.022,S,wd),p(0,.43,.005,S-.04,.014,S-.05,shadeHex(wd,1.08)),// el asiento de triplex
    ...[-1,1].map(sx=>p(sx*(S/2-.02),.42,-(S/2-.02),.025,.42,.025,tb,{rx:-.06})),// los dos parales del respaldo, un poco echados
    p(0,.6,-(S/2-.005),S-.02,.2,.02,wd,{rx:-.08}),p(0,.79,-(S/2+.01),S-.06,.03,.02,shadeHex(wd,.85),{rx:-.08})];}},// el respaldo y su borde
 tablero:{nombre:'Pizarrón',grupo:'Colegio',medida:[2.4,.12],alto:()=>2.1,variantes:['verde','blanco'],
  antes:o=>[p(0,.9,0,o.w,1.1,o.d,'#3f5a46')],
  piezas:o=>{const W=o.w||2.4,b=o.variante==='blanco'?'#f1f3f2':'#2f5a46',al=C.aceroClaro,z0=-(o.d||.12)/2;
   return [p(0,.9,z0+.015,W,1.2,.03,al),p(0,.93,z0+.031,W-.06,1.14,.004,b),// el marco de aluminio y la superficie
    ...(o.variante==='blanco'?[]:[p(-W*.25,1.45,z0+.034,W*.22,.004,.002,'#dfe6e1'),p(-W*.22,1.3,z0+.034,W*.3,.004,.002,'#dfe6e1'),p(W*.18,1.55,z0+.034,W*.18,.004,.002,'#dfe6e1')]),// lo que quedó escrito
    p(0,.86,z0+.07,W-.1,.02,.08,al),p(0,.88,z0+.105,W-.1,.02,.01,al),// la bandeja de las tizas
    ...[-.4,-.36,.2].map((x,i)=>p(x*W/2.4,.88,z0+.07,.07,.012,.012,i===2?'#e8c95a':'#f4f2ea')),p(W*.32,.892,z0+.06,.13,.03,.05,C.maderaOscura),p(W*.32,.88,z0+.06,.12,.012,.045,'#6d6d6d'),// tizas y borrador
    ...[-1,1].map(sx=>p(sx*(W/2-.15),2.08,z0+.02,.06,.04,.04,al))];}},// los soportes de arriba
 casillero:{nombre:'Casilleros',grupo:'Colegio',medida:[1.2,.45],alto:()=>1.8,variantes:['azul','gris','rojo'],
  antes:o=>[p(0,0,0,o.w,1.8,o.d,'#5f8fb3')],
  piezas:o=>{const W=o.w||1.2,D=Math.min(o.d||.45,.5),c=o.variante==='gris'?'#8d969d':o.variante==='rojo'?'#b4473b':'#4f7fa8',dk=shadeHex(c,.8),n=Math.max(1,Math.round(W/.3)),cw=W/n,H=1.8,h=(H-.12)/2;
   const out=[p(0,0,0,W-.04,.1,D-.04,C.grafito),p(0,.1,0,W,H-.1,D,dk),p(0,H,0,W+.01,.015,D+.01,dk)];// el zócalo, el cuerpo y la tapa
   for(let i=0;i<n;i++){const x=-W/2+cw*(i+.5);for(let j=0;j<2;j++){const y=.12+j*h;
    out.push(p(x,y,D/2,cw-.02,h-.02,.012,c),// la puerta
     ...[0,1,2].map(k=>p(x,y+h-.14-k*.035,D/2+.012,cw*.5,.012,.004,dk)),// las rejillas
     p(x+cw/2-.06,y+h*.45,D/2+.012,.02,.1,.02,C.aceroClaro),p(x,y+h-.07,D/2+.012,.06,.025,.003,C.crema));}}// la manija y el número
   return out;}},
 // ---------- Gimnasio (2026-10-17, Miguel: «por ejemplo hay gimnasio y tiendas de ropa») ----------
 // El local con giro «gimnasio» (blueprint.js local_gimnasio): las máquinas miran a la pared (el que corre o pedalea
 // queda de espaldas al cuarto) y su frente, +z, es por donde uno se sube.
 caminadora:{nombre:'Caminadora',grupo:'Gimnasio',medida:[.85,1.9],alto:()=>.22,
  antes:o=>[p(0,0,0,o.w,1.35,o.d,'#3a3e43')],
  piezas:o=>{const W=Math.min(o.w||.85,.9),D=Math.min(o.d||1.9,2),zc=-(D/2-.3),k=C.grafito;
   return [...[-1,1].flatMap(sx=>[-1,1].map(sz=>p(sx*(W/2-.08),0,sz*(D/2-.15),.08,.05,.08,C.negro))),// las patas
    p(0,.05,.04,W,.15,D-.12,k),p(0,.2,.1,W-.24,.02,D-.5,'#26282b'),// la plataforma y la banda
    ...[-1,1].map(sx=>p(sx*(W/2-.06),.2,.1,.1,.02,D-.5,C.aceroClaro)),// los apoyapiés de los lados
    p(0,.05,-(D/2-.2),W,.26,.4,'#4a4f55'),p(0,.31,-(D/2-.2),W-.1,.01,.36,C.rojo),// la tapa del motor, con su franja
    ...[-1,1].flatMap(sx=>[p(sx*(W/2-.05),.31,zc,.05,.95,.05,C.aceroOscuro),p(sx*(W/2-.05),1.05,zc+.3,.04,.04,.55,C.aceroClaro)]),// los parales y las barandas
    p(0,1.26,zc,W-.04,.09,.24,k),p(0,1.35,zc+.02,.38,.006,.15,C.pantalla),p(.26,1.35,zc+.02,.1,.006,.08,C.ambar,{luz:true})];}},// la consola con su pantalla y el botón
 bicicleta:{nombre:'Bicicleta estática',grupo:'Gimnasio',medida:[.6,1.2],alto:()=>.89,
  antes:o=>[p(0,0,0,o.w,1.1,o.d,'#3a3e43')],
  piezas:()=>{const k=C.grafito,m=C.aceroOscuro;
   return [p(0,0,-.5,.52,.05,.08,k),p(0,0,.5,.52,.05,.08,k),p(0,.05,0,.08,.07,1.08,k),// las dos patas y la viga
    p(0,.12,-.3,.06,.38,.38,'#c9ced2'),p(0,.24,-.3,.08,.14,.14,m),// el volante y su eje
    p(0,.12,.24,.06,.7,.06,m),p(0,.82,.27,.18,.07,.28,C.negro),// el tubo y el sillín
    p(0,.12,-.42,.06,.92,.06,m),p(0,1.04,-.42,.5,.04,.07,C.negro),...[-1,1].map(sx=>p(sx*.23,1.04,-.32,.04,.04,.18,C.negro)),// el manubrio
    p(0,1.08,-.45,.16,.09,.04,C.pantalla),// la consola
    p(0,.36,-.04,.2,.03,.04,C.aceroClaro),...[-1,1].map(sx=>p(sx*.13,.33,-.04,.06,.025,.11,C.negro))];}},// la biela y los pedales
 banco:{nombre:'Banco de pesas',grupo:'Gimnasio',medida:[1.2,1.5],alto:()=>.48,
  antes:o=>[p(0,0,0,o.w,1.45,o.d,'#3a3e43')],
  piezas:o=>{const W=Math.min(o.w||1.2,1.25),D=Math.min(o.d||1.5,1.6),zr=-(D/2-.15),m=C.aceroOscuro,u=W/2-.1;
   return [...[-1,1].flatMap(sx=>[p(sx*u,0,zr,.12,.04,.34,C.grafito),p(sx*u,.04,zr,.06,1.4,.06,m),p(sx*u,1.08,zr+.05,.06,.05,.06,C.negro)]),// el rack: patas, parales y ganchos
    p(0,1.13,zr+.05,W-.04,.03,.03,C.aceroClaro),...[-1,1].map(sx=>p(sx*(W/2-.05),1.0,zr+.05,.05,.3,.3,C.negro)),// la barra con sus discos
    p(0,0,zr+.45,.36,.4,.06,m),p(0,0,D/2-.15,.36,.4,.06,m),p(0,.4,(zr+.3+D/2-.02)/2,.3,.08,D/2-.02-(zr+.3),'#24262a')];}},// el banco: dos apoyos y el cojín
 mancuernas:{nombre:'Mancuernas',grupo:'Gimnasio',medida:[1.5,.5],alto:()=>.85,
  antes:o=>[p(0,0,0,o.w,.85,o.d,'#3a3e43')],
  piezas:o=>{const W=o.w||1.5,D=Math.min(o.d||.5,.55),n=Math.max(2,Math.floor((W-.2)/.22)),out=[...[-1,1].map(sx=>p(sx*(W/2-.03),0,0,.05,.85,D-.04,C.grafito))];
   [[.3,.12],[.65,.09]].forEach(([y,h],t)=>{out.push(p(0,y,0,W-.1,.03,D-.1,C.aceroOscuro));
    for(const x of row(n,-(W-.3)/2,(W-.3)/2))out.push(...[-1,1].map(sz=>p(x,y+.03,sz*.12,h,h,.06,t?C.negro:'#7d2a24')),p(x,y+.03+h/2-.015,0,.03,.03,.18,C.aceroClaro));});
   return out;}},// dos repisas de mancuernas, las pesadas abajo
 colchoneta:{nombre:'Colchonetas',grupo:'Gimnasio',medida:[1.8,.9],alto:()=>.04,
  antes:o=>[p(0,0,0,o.w,.04,o.d,'#2f6f8f')],
  piezas:o=>{const W=o.w||1.8,D=o.d||.9,n=Math.max(1,Math.round(W/.9)),w=W/n;
   return row(n,-W/2+w/2,W/2-w/2).flatMap((x,i)=>[p(x,0,0,w-.04,.04,D-.04,i%2?'#2f6f8f':'#3d8a6a')]);}},
 espejo_pared:{nombre:'Espejo de pared',grupo:'Gimnasio',medida:[2.4,.06],alto:()=>2.1,
  antes:o=>[p(0,.3,0,o.w,1.8,o.d,'#cfe3ea')],
  piezas:o=>{const W=o.w||2.4,z0=-(o.d||.06)/2;
   return [p(0,.3,z0+.01,W,1.8,.02,C.aceroOscuro),p(0,.33,z0+.024,W-.06,1.74,.004,'#cfe3ea'),p(0,.33,z0+.029,W-.06,.004,.002,'#e9f3f6')];}},// el marco, el vidrio y un brillo
 // ---------- Tienda de ropa (2026-10-17, Miguel: «tiendas de ropa») ----------
 // El local con giro «ropa» (blueprint.js local_ropa). La ropa sale de una paleta fija y cada prenda toma su color por
 // su lugar en la fila (sin azar: el mismo perchero se ve igual cada vez).
 perchero:{nombre:'Perchero',grupo:'Tienda de ropa',medida:[1.2,.5],alto:()=>1.5,variantes:['camisas','abrigos','vestidos'],
  antes:o=>[p(0,0,0,o.w,1.5,o.d,'#8d969d')],
  piezas:o=>{const W=Math.min(o.w||1.2,1.6),D=Math.min(o.d||.5,.55),v=o.variante||'camisas',R=ROPA[v],n=Math.max(4,Math.floor((W-.2)/.075)),largo=v==='camisas'?.62:v==='abrigos'?.9:1.05;
   return [...[-1,1].flatMap(sx=>[p(sx*(W/2-.03),0,0,.05,.03,D-.04,C.grafito),...[-1,1].map(sz=>p(sx*(W/2-.03),.03,sz*(D/2-.06),.035,.035,.035,C.negro)),// las patas con sus ruedas
     p(sx*(W/2-.03),.03,0,.03,1.42,.03,C.aceroClaro)]),p(0,1.45,0,W-.02,.025,.025,C.aceroClaro),// los parales y la barra
    ...row(n,-(W-.2)/2,(W-.2)/2).flatMap((x,i)=>[p(x,1.38,0,.012,.07,.012,C.aceroOscuro),p(x,1.38-largo,0,.035,largo,Math.min(.42,D-.08),R[(i*7+3)%R.length])])];}},// la percha y la prenda
 maniqui:{nombre:'Maniquí',grupo:'Tienda de ropa',medida:[.5,.5],alto:()=>1.72,variantes:['azul','rojo','verde','negro'],
  antes:o=>[p(0,0,0,o.w,1.72,o.d,'#e9e4dc')],
  piezas:o=>{const k='#ece7df',v=o.variante||'azul',ca={azul:'#3b5a86',rojo:'#a53a3a',verde:'#4d7a4f',negro:'#2b2b2e'}[v],pa=v==='negro'?'#c9b89a':'#2f3540';
   return [p(0,0,0,.4,.025,.4,C.grafito,{cyl:true}),// la base
    ...[-1,1].map(sx=>p(sx*.075,.025,0,.11,.8,.13,pa)),p(0,.825,0,.32,.14,.2,pa),// las piernas y la cadera (el pantalón)
    p(0,.965,0,.36,.44,.22,ca),...[-1,1].map(sx=>p(sx*.225,.98,0,.085,.42,.11,ca)),// el torso y los brazos (la camisa)
    ...[-1,1].map(sx=>p(sx*.225,.86,0,.07,.12,.08,k)),p(0,1.405,0,.08,.07,.08,k),p(0,1.475,0,.17,.22,.19,k)];}},// las manos, el cuello y la cabeza
 estanteria_ropa:{nombre:'Estantería de ropa',grupo:'Tienda de ropa',medida:[1.6,.45],alto:()=>2,
  antes:o=>[p(0,0,0,o.w,2,o.d,'#c39a6b')],
  piezas:o=>{const W=o.w||1.6,D=Math.min(o.d||.45,.5),wd='#ece5d8',n=Math.max(1,Math.floor((W-.1)/.38)),R=ROPA.doblada,out=[p(0,0,-D/2+.01,W,2,.02,shadeHex(wd,.92))];// el fondo
   out.push(...[-1,1].map(sx=>p(sx*(W/2-.015),0,.01,.03,2,D-.02,wd)),p(0,0,.01,W-.06,.08,D-.02,shadeHex(wd,.8)));// los costados y el zócalo
   [.4,.85,1.3,1.75].forEach((y,j)=>{out.push(p(0,y-.025,.01,W-.06,.025,D-.02,wd));
    if(j<3)for(const [i,x] of row(n,-(W-.12)/2+.17,(W-.12)/2-.17).entries())for(let k=0;k<3;k++)out.push(p(x,y+k*.045,.03,.3,.045,.3,R[(i*5+j*3+k)%R.length]));});// tres pilas dobladas por repisa
   return out;}},
 probador:{nombre:'Probador',grupo:'Tienda de ropa',medida:[1,1],alto:()=>2.1,
  antes:o=>[p(0,0,0,o.w,2.1,o.d,'#8a3b4a')],
  piezas:o=>{const W=Math.min(o.w||1,1.2),D=Math.min(o.d||1,1.2),pa='#e6dfd3',z0=-D/2;
   return [p(0,0,z0+.02,W,2.1,.04,pa),...[-1,1].map(sx=>p(sx*(W/2-.02),0,z0+.04+(D-.04)/2,.04,2.1,D-.04,pa)),// el fondo y los costados
    p(0,2.06,D/2-.04,W-.08,.04,.04,C.aceroOscuro),p(-(W-.08)*.18,.12,D/2-.04,(W-.08)*.64,1.9,.03,'#8a3b4a'),// la barra y la cortina, corrida a un lado
    p(0,.45,z0+.045,.42,1.25,.006,'#cfe3ea'),p(0,0,z0+.25,W-.2,.42,.3,C.maderaClara),// el espejo y la banquita
    ...[-1,1].map(sx=>p(sx*.15,1.7,z0+.045,.03,.03,.06,C.aceroOscuro))];}},// los ganchos
 // ---------- La guarida (2026-10-17, REGLAS.md): la caja donde los ladrones guardan lo robado ----------
 baul:{nombre:'Caja de la guarida',grupo:'Juego',medida:[.9,.5],alto:()=>.56,
  antes:o=>[p(0,0,0,o.w,.56,o.d,'#6e4b33')],
  piezas:o=>{const W=Math.min(o.w||.9,.95),D=Math.min(o.d||.5,.55),wd=C.maderaOscura,fe=C.aceroOscuro;
   return [p(0,0,0,W-.04,.04,D-.04,C.negro),p(0,.04,0,W,.38,D,wd),p(0,.42,0,W+.02,.12,D+.02,shadeHex(wd,1.12)),// el zócalo, el cuerpo y la tapa
    ...[-1,1].flatMap(sx=>[p(sx*(W/2-.12),.04,D/2+.003,.05,.38,.006,fe),p(sx*(W/2-.12),.42,D/2+.013,.05,.12,.006,fe)]),// los zunchos de hierro
    p(0,.36,D/2+.003,.12,.1,.012,C.cobre),p(0,.3,D/2+.015,.06,.07,.025,C.ambar)];}},// la chapa y el candado
 // ---------- Ascensor ----------
 // La cabina (1,7 × 1,7 m, 2,6 de alto; la puerta, de 1 m, en el frente). Las hojas corredizas van aparte (buildCabins).
 ascensor:{nombre:'Cabina de ascensor',grupo:'Edificio',medida:[1.7,1.7],alto:()=>2.6,
  antes:()=>{const E=.85,T=.07,D=.5,g='#9aa3a8',m='#7d878d';return [p(0,0,-(E-T/2),2*E,2.6,T,g),p(-(E-T/2),0,0,T,2.6,2*E,g),p(E-T/2,0,0,T,2.6,2*E,g),
   ...[-1,1].map(s=>p(s*(D+(E-D)/2),0,E-T/2,E-D,2.6,T,m)),p(0,2.2,E-T/2,2*D,.4,T,m),p(0,2.58,0,2*E,.06,2*E,'#c9cdd0'),p(0,2.55,0,1.1,.03,1.1,null,{luz:true}),p(D+.12,1.1,E-T-.02,.12,.32,.03,'#222')];},
  piezas:()=>{const E=.85,T=.07,D=.5,I=E-T,st=C.acero,fr='#8d959b';
   return [// paredes de acero, con zócalo oscuro y el marco del frente
    // (los costados entre el fondo y el marco, sin pisarlos: en las esquinas las caras titilaban)
    p(0,0,-(E-T/2),2*E,2.6,T,st),p(-(E-T/2),0,0,T,2.6,2*E-2*T,st),p(E-T/2,0,0,T,2.6,2*E-2*T,st),
    ...[-1,1].map(s=>p(s*(D+(E-D)/2),0,E-T/2,E-D,2.6,T,fr)),p(0,2.2,E-T/2,2*D,.4,T,fr),
    p(0,0,-I-.004,2*I,.12,.008,C.grafito),...[-1,1].map(s=>p(s*(I+.004),0,0,.008,.12,2*I,C.grafito)),
    p(0,0,0,2*I,.025,2*I,C.grafito),// el piso
    p(0,2.58,0,2*E,.06,2*E,'#d9dde0'),p(0,2.55,0,1.1,.03,1.1,null,{luz:true}),p(0,2.54,0,1.2,.01,1.2,C.aceroClaro),// el techo y la luz con su marco
    p(0,.95,-I+.01,1.2,1.35,.012,'#dfe9ef'),p(0,.92,-I+.004,1.28,1.41,.008,C.aceroOscuro),// el espejo del fondo (sobre la pared, no metido en ella)
    // pasamanos al fondo y a los costados, en sus soportes
    p(0,.88,-I+.06,1.4,.04,.04,C.aceroClaro),...[-.62,.62].map(x=>p(x,.86,-I+.03,.03,.06,.05,C.aceroClaro)),
    ...[-1,1].flatMap(s=>[p(s*(I-.06),.88,-.15,.04,.04,1.0,C.aceroClaro),...[-.55,.25].map(z=>p(s*(I-.03),.86,z,.05,.06,.03,C.aceroClaro))]),
    // la botonera de adentro, junto a la puerta, con dos columnas de botones
    p(I-.012,.85,I-.24,.024,.6,.16,C.negro),...[0,1,2,3,4].flatMap(r=>[-1,1].map(s=>p(I-.026,.95+r*.09,I-.24+s*.04,.008,.05,.05,'#e8eaec'))),
    // afuera: el contramarco de la puerta, el indicador del piso y el botón de llamada
    ...[-1,1].map(s=>p(s*(D+.05),0,E+.01,.1,2.3,.02,C.aceroClaro)),p(0,2.22,E+.01,2*D+.2,.08,.02,C.aceroClaro),
    p(0,2.36,E+.012,.36,.14,.02,C.negro),p(0,2.39,E+.024,.12,.08,.004,'#e05a3a'),
    p(D+.28,.95,E+.012,.1,.24,.02,C.aceroClaro),p(D+.28,1.04,E+.024,.045,.045,.01,C.ambar)];}},

 // ---------- Calle ----------
 // (o.color: el color propio de cada uno, si el mapa se lo da: la papelera, el techo del kiosco)
 banca:{nombre:'Banca',grupo:'Calle',medida:[1.7,.55],alto:()=>.42,
  antes:()=>[p(0,0,0,1.7,.45,.55,'#8a6a4a')],
  piezas:()=>{const fe='#2f3437',wd='#a87a4f';
   return [// dos costados de fundición: pata de adelante, de atrás, apoyabrazos y el travesaño
    ...[-1,1].flatMap(s=>[p(s*.74,0,.17,.06,.42,.06,fe),p(s*.74,0,-.2,.06,.86,.06,fe,{rx:-.12}),p(s*.74,.6,.02,.06,.04,.42,fe),p(s*.74,.38,-.01,.05,.04,.4,fe)]),
    ...[.15,0,-.15].map(z=>p(0,.42,z+.02,1.6,.04,.12,wd)),// el asiento: tres tablones
    ...[.62,.78].map(y=>p(0,y,-.24+(y-.62)*-.15,1.6,.1,.03,wd,{rx:-.12})),// el respaldo: dos tablones, echados para atrás
    p(0,.25,-.01,1.4,.03,.03,fe)];}},// el travesaño de abajo
 papelera:{nombre:'Papelera',grupo:'Calle',medida:[.6,.6],alto:()=>.95,
  antes:o=>[p(0,0,0,.56,.92,.56,o.color||'#3d6f8f',{cyl:true}),p(0,.92,0,.6,.06,.6,'#2b2f31',{cyl:true})],
  piezas:o=>{const c=o.color||'#3d6f8f';
   return [p(0,0,0,.42,.06,.42,C.grafito,{cyl:true}),// el pie
    p(0,.06,0,.5,.8,.5,c,{cyl:true}),p(0,.3,0,.52,.08,.52,C.aceroOscuro,{cyl:true}),p(0,.62,0,.52,.08,.52,C.aceroOscuro,{cyl:true}),// el tacho con dos zunchos
    p(0,.86,0,.56,.05,.56,C.grafito,{cyl:true}),p(0,.91,0,.46,.05,.46,C.negro,{cyl:true}),// el borde y la boca
    p(0,.4,.255,.18,.12,.01,C.crema)];}},// la calcomanía del frente
 kiosco:{nombre:'Kiosco',grupo:'Calle',medida:[1.6,1.6],alto:()=>2.55,
  antes:o=>[p(0,0,0,1.6,2.3,1.6,'#e9e2d3'),p(0,2.35,0,2.3,.18,2.3,o.color||'#c2412d')],
  piezas:o=>{const c=o.color||'#c2412d',w='#e9e2d3';
   return [p(0,0,0,1.7,.12,1.7,C.grafito),// la base
    p(0,.12,-.1,1.6,2.2,1.4,w),// el cuerpo (el frente queda para la ventanilla)
    p(0,.12,.68,1.6,.95,.14,w),p(-.7,1.07,.68,.2,1.25,.14,w),p(.7,1.07,.68,.2,1.25,.14,w),// abajo del mostrador y los costados de la ventanilla
    p(0,1.02,.75,1.5,.05,.3,C.madera),// el mostrador de la ventanilla
    p(0,1.07,.62,1.2,.9,.02,'#9fb4c2'),// el vidrio de adentro
    p(0,2.0,.68,1.6,.32,.14,c),p(0,2.06,.76,1.3,.18,.01,C.crema),// la franja del letrero
    p(0,1.95,.95,1.6,.05,.5,c,{rx:.35}),// el toldito de la ventanilla
    p(0,2.32,0,2.1,.12,2.1,c),p(0,2.44,0,1.7,.1,1.7,w),p(0,2.54,0,.5,.1,.5,c),// el techo, escalonado
    ...[-1,1].flatMap(s=>[p(s*.82,.12,.82,.08,2.2,.08,C.grafito),p(s*.82,.12,-.82,.08,2.2,.08,C.grafito)])];}},// esquineros
 contenedor:{nombre:'Contenedor',grupo:'Calle',medida:[1.8,1.05],alto:()=>1.3,
  antes:()=>[p(0,0,0,1.8,1.25,1.05,'#2f5a3f')],
  piezas:()=>{const g='#2f5a3f',d='#244634';
   return [...[-1,1].flatMap(s=>[p(s*.68,.08,.36,.16,.08,.16,C.negro,{cyl:true,rz:Math.PI/2}),p(s*.68,.08,-.36,.16,.08,.16,C.negro,{cyl:true,rz:Math.PI/2})]),// las ruedas
    p(0,.12,0,1.7,1.0,.95,g),// el cuerpo
    ...[-.55,0,.55].map(x=>p(x,.18,.48,.08,.9,.02,d)),// los refuerzos del frente
    p(0,1.12,0,1.8,.06,1.05,d),// el borde
    ...[-1,1].map(s=>p(s*.44,1.18,-.02,.86,.06,1.0,C.grafito,{rx:s<0?-.05:0})),// las dos tapas
    p(0,.75,.5,1.2,.05,.06,C.aceroOscuro),...[-1,1].map(s=>p(s*.92,.55,0,.06,.08,.6,C.aceroOscuro)),// la manija y los ganchos de los costados
    p(-.45,.5,.49,.42,.24,.01,C.crema)];}},// la etiqueta

 // ---------- Calle: luces, agua ----------
 // El farol de la calle: el brazo sale hacia +z (1,15 m) y la luz cuelga a 4,35 m. Lo que brilla (luz: true) va con
 // el material de las luces de la calle, que de noche se prende (world3d headMat).
 farol:{nombre:'Farol de calle',grupo:'Calle',medida:[.5,1.5],alto:()=>4.6,
  antes:()=>[p(0,0,0,.2,4.6,.2,'#3a3f43',{cyl:true}),p(0,4.41,.6,.08,.08,1.25,'#3a3f43'),p(0,4.29,1.15,.28,.12,.55,null,{luz:true})],
  piezas:()=>{const m='#3a3f43';
   return [p(0,0,0,.34,.32,.34,C.grafito,{cyl:true}),p(0,.32,0,.24,.08,.24,m,{cyl:true}),// la base
    p(0,.4,0,.13,4.1,.13,m,{cyl:true}),p(0,1.6,0,.17,.06,.17,m,{cyl:true}),p(0,3.4,0,.16,.05,.16,m,{cyl:true}),// el poste con sus anillos
    p(0,4.5,0,.18,.08,.18,m,{cyl:true}),// el remate
    p(0,4.43,.58,.07,.07,1.18,m),p(0,4.05,.06,.04,.5,.04,m,{rx:.75}),// el brazo y su riostra
    p(0,4.38,1.15,.34,.1,.62,C.grafito),p(0,4.48,1.15,.2,.04,.4,C.grafito),// la luminaria
    p(0,4.34,1.15,.28,.04,.52,null,{luz:true})];}},// el difusor
 farol_parque:{nombre:'Farol de parque',grupo:'Calle',medida:[.4,.4],alto:()=>3.6,
  antes:()=>[p(0,0,0,.18,3.15,.18,'#2f3a33',{cyl:true}),p(0,3.06,0,.48,.48,.48,null,{luz:true,cyl:true})],
  piezas:()=>{const m='#2f3a33';
   return [p(0,0,0,.3,.22,.3,m,{cyl:true}),p(0,.22,0,.2,.1,.2,m,{cyl:true}),p(0,.32,0,.1,2.68,.1,m,{cyl:true}),p(0,1.2,0,.15,.08,.15,m,{cyl:true}),// base, poste y su anillo
    p(0,3.0,0,.3,.05,.3,m),// la bandeja del farol
    ...[-1,1].flatMap(sx=>[-1,1].map(sz=>p(sx*.12,3.05,sz*.12,.025,.36,.025,m))),// los cuatro parantes
    p(0,3.05,0,.22,.34,.22,null,{luz:true}),// el vidrio que brilla
    p(0,3.41,0,.34,.05,.34,m),p(0,3.46,0,.22,.06,.22,m),p(0,3.52,0,.08,.08,.08,m)];}},// el techito escalonado y su remate
 hidrante:{nombre:'Hidrante',grupo:'Calle',medida:[.4,.4],alto:()=>.78,
  antes:o=>[p(0,0,0,.3,.7,.3,o.color||'#c2412d',{cyl:true})],
  piezas:o=>{const c=o.color||'#c2412d',d='#3a3f43';
   return [p(0,0,0,.32,.06,.32,d,{cyl:true}),// la brida del piso
    p(0,.06,0,.24,.5,.24,c,{cyl:true}),p(0,.5,0,.28,.05,.28,c,{cyl:true}),// el cuerpo y su anillo
    p(0,.55,0,.2,.12,.2,c,{cyl:true}),p(0,.67,0,.12,.06,.12,c,{cyl:true}),p(0,.73,0,.06,.05,.06,d,{cyl:true}),// la cabeza y la tuerca de arriba
    ...[-1,1].map(s=>p(s*.08,.33,0,.1,.1,.1,c,{cyl:true,rz:-s*Math.PI/2})),// las bocas de los costados
    p(0,.28,.08,.13,.13,.13,c,{cyl:true,rx:Math.PI/2}),p(0,.3,.2,.08,.03,.08,d,{cyl:true,rx:Math.PI/2})];}},// la boca grande con su tapa
 // ---------- El botín del mundo (botin.js, 2026-10-16) ----------
 // La vitrina de las joyas: mueble bajo con tapa de vidrio y las joyas adentro (puntos de oro y de piedras).
 vitrina:{nombre:'Vitrina de joyas',grupo:'Botín',medida:[1.2,.5],alto:()=>1.0,
  piezas:o=>{const W=o.w||1.2,D=o.d||.5,out=[p(0,0,0,W,.06,D,C.negro),p(0,.06,0,W,.74,D,C.maderaOscura),p(0,.8,0,W+.02,.03,D+.02,C.aceroClaro),// zócalo, cuerpo y borde
    p(0,.83,0,W-.04,.17,D-.04,null,{vidrio:true}),p(0,.83,0,W-.04,.01,D-.04,'#5a1f2e')];// la urna de vidrio y el terciopelo
   for(let i=0;i<6;i++)out.push(p(-W/2+.12+i*(W-.24)/5,.84,(i%2?.06:-.06),.06,.03,.06,i%3?'#e8c45a':'#5fb7d6'));return out;}},// las joyas
 // La escultura: un plinto y una figura abstracta de bronce (tres volúmenes girados).
 escultura:{nombre:'Escultura',grupo:'Botín',medida:[.8,.8],alto:()=>2.1,
  piezas:o=>{const W=o.w||.8,D=o.d||.8,B2='#a0703c';
   return [p(0,0,0,W,.9,D,C.piedra),p(0,.9,0,W+.04,.04,D+.04,'#c9bca5'),// el plinto
    p(0,.94,0,.22,.5,.22,B2,{ry:.4}),p(.05,1.4,0,.3,.38,.18,B2,{ry:-.5,rz:.25}),p(-.04,1.74,.02,.16,.36,.16,B2,{ry:.9,rz:-.2}),p(0,2.06,0,.1,.04,.1,'#c08a4a')];}},
 // ---------- Del equipamiento del plano (equipamiento.js, 2026-10-16): lo que no tenía objeto ----------
 // El semáforo: poste en la esquina y la caja de luces en lo alto, mirando a +z (al carril que regula).
 semaforo:{nombre:'Semáforo',grupo:'Calle',medida:[.4,.4],alto:()=>3.6,
  piezas:()=>{const m='#33383c';
   return [p(0,0,0,.3,.12,.3,C.grafito,{cyl:true}),p(0,.12,0,.12,3.0,.12,m,{cyl:true}),// la base y el poste
    p(0,2.45,.12,.34,1.0,.24,C.negro),p(0,2.42,.11,.4,1.06,.2,'#d9b43a'),// la caja de luces con su marco amarillo
    p(0,3.15,.25,.18,.18,.04,'#c0392b',{luz:true}),p(0,2.9,.25,.18,.18,.04,'#f2b04a'),p(0,2.65,.25,.18,.18,.04,'#3f9e5a'),// rojo, ámbar, verde
    p(0,3.12,0,.16,.08,.16,m,{cyl:true})];}},
 // La parada de bus: techo, vidrio de atrás, dos postes, la banca y el letrero. Mira a +z (a la calle).
 parada:{nombre:'Parada de bus',grupo:'Calle',medida:[3,1.5],alto:()=>2.6,
  piezas:o=>{const w=o.w||3,d=o.d||1.5,m='#4a5258';
   return [...[-1,1].flatMap(s=>[p(s*(w/2-.08),0,-d/2+.12,.08,2.5,.08,m),p(s*(w/2-.08),0,d/2-.12,.08,2.5,.08,m)]),// los cuatro postes
    p(0,2.5,0,w+.2,.08,d+.2,'#3d6f8f'),p(0,2.42,d/2+.05,w+.2,.12,.06,C.crema),// el techo y su borde
    p(0,.15,-d/2+.08,w-.2,2.2,.03,null,{vidrio:true}),// el vidrio de atrás
    p(0,.45,-d/2+.35,w*.7,.05,.4,C.maderaClara),...[-1,1].map(s=>p(s*w*.3,0,-d/2+.35,.06,.45,.3,m)),// la banca
    p(w/2-.05,1.4,0,.04,.9,.6,'#3d6f8f'),p(w/2-.02,1.55,0,.02,.5,.45,C.crema)];}},// el letrero del costado
 // La torre de salvavidas: cuatro patas, plataforma, cabina con techo y la escalera hacia el mar (+z).
 salvavidas:{nombre:'Torre de salvavidas',grupo:'Playa',medida:[2,2],alto:()=>3.6,
  piezas:o=>{const w=o.w||2,d=o.d||2,h=o.h||2,wd='#e9e2d3',r='#c0392b';
   return [...[-1,1].flatMap(sx=>[-1,1].map(sz=>p(sx*(w/2-.1),0,sz*(d/2-.1),.12,h,.12,wd))),// las patas
    p(0,h,0,w,.1,d,C.madera),// la plataforma
    p(0,h+.1,-d/2+.06,w,1.0,.06,r),...[-1,1].map(s=>p(s*(w/2-.03),h+.1,0,.06,1.0,d,r)),// la cabina (abierta hacia el mar)
    p(0,h+1.1,0,w+.3,.08,d+.3,wd),p(0,h+1.18,0,w*.6,.06,d*.6,r),// el techo
    ...[0,1,2,3].map(i=>p(0,h-(i+1)*h/4.5,d/2+.25+i*.25,.8,.05,.2,C.madera)),...[-1,1].map(s=>p(s*.42,0,d/2+.6,.06,h,.06,wd,{rx:-.45}))];}},// la escalera
 // La sombrilla de playa: el mástil y la tela (un cono bajo de cajas escalonadas), con dos asoleadoras.
 sombrilla:{nombre:'Sombrilla de playa',grupo:'Playa',medida:[2.2,2.2],alto:()=>2.4,
  piezas:o=>{const c=o.color||'#e46a4a',b='#f4efe2';
   return [p(0,0,0,.05,2.3,.05,'#cfc6b4',{cyl:true}),// el mástil
    p(0,2.0,0,2.1,.06,2.1,c,{cyl:true}),p(0,2.06,0,1.5,.08,1.5,b,{cyl:true}),p(0,2.14,0,.9,.08,.9,c,{cyl:true}),p(0,2.22,0,.3,.06,.3,b,{cyl:true}),
    ...[-1,1].map(s=>p(s*.55,0,.75,.55,.18,1.6,'#f3f0e6',{rx:0}))];}},// las asoleadoras
 // El paso de cebra: franjas blancas de 50 cm cada metro a lo ancho (x: de cordón a cordón), de fondo o.d (por donde
 // se camina). Pintura: casi sin alto.
 cebra:{nombre:'Paso de cebra',grupo:'Calle',medida:[6,3],alto:()=>.01,
  piezas:o=>{const w=o.w||6,d=o.d||3,n=Math.max(1,Math.floor(w/1));
   return Array.from({length:n},(_,i)=>p(-w/2+(i+.5)*w/n,0,0,.5,.012,d,'#f2f2ec'));}},
 fuente:{nombre:'Fuente',grupo:'Calle',medida:[2.5,2.5],alto:()=>1.6,
  antes:()=>[p(0,0,0,2.4,.5,2.4,'#cfc8b8',{cyl:true}),p(0,.42,0,2.04,.04,2.04,'#5f9fc2',{cyl:true}),p(0,0,0,.34,1.3,.34,'#cfc8b8',{cyl:true}),p(0,1.25,0,1,.22,1,'#cfc8b8',{cyl:true})],
  piezas:()=>{const st='#cfc8b8',dk='#b8b09f',wa='#5f9fc2';
   return [p(0,0,0,2.56,.1,2.56,dk,{cyl:true}),// el escalón de la base
    p(0,.1,0,2.4,.42,2.4,st,{cyl:true}),p(0,.52,0,2.5,.06,2.5,dk,{cyl:true}),// la pileta y su borde
    p(0,.58,0,2.2,.015,2.2,wa,{cyl:true}),// el agua de abajo, al ras del borde
    p(0,.1,0,.5,.3,.5,dk,{cyl:true}),p(0,.4,0,.3,.9,.3,st,{cyl:true}),p(0,.85,0,.4,.06,.4,dk,{cyl:true}),// el pie de la columna
    p(0,1.24,0,.4,.1,.4,st,{cyl:true}),p(0,1.3,0,1.1,.14,1.1,st,{cyl:true}),p(0,1.42,0,.92,.02,.92,wa,{cyl:true}),// la taza y su agua
    p(0,1.44,0,.14,.18,.14,st,{cyl:true}),p(0,1.62,0,.2,.05,.2,dk,{cyl:true}),p(0,1.67,0,.08,.1,.08,wa,{cyl:true})];}},// el surtidor

 // ---------- Decoración: alfombras y cuadros ----------
 // Alfombra (o.w × o.d, o.variante, o.paleta): en capas finas, cada una apenas más alta (si dos caras de arriba quedan
 // al mismo alto, titilan): la base, el borde, el campo, el dibujo y los flecos de las puntas.
 alfombra:{nombre:'Alfombra',grupo:'Decoración',medida:[2.4,1.6],alto:()=>.02,variantes:['persa','rayas','moderna','redonda'],
  antes:()=>[],
  piezas:o=>{const W=o.w,D=o.d,P=RUGS[(o.paleta??0)%RUGS.length],v=o.variante||'persa',out=[];
   if(v==='redonda'){const R=Math.min(W,D);return [p(0,0,0,R,.012,R,P.base,{cyl:true}),p(0,.012,0,R-.16,.004,R-.16,P.borde,{cyl:true}),p(0,.016,0,R-.32,.003,R-.32,P.campo,{cyl:true}),p(0,.019,0,R*.32,.002,R*.32,P.acento,{cyl:true})];}
   out.push(p(0,0,0,W,.012,D,P.base));
   for(const s of [-1,1])for(let i=0;i<Math.max(4,Math.round(D/.12));i++)out.push(p(s*(W/2+.03),0,-D/2+.06+i*(D-.12)/Math.max(3,Math.round(D/.12)-1),.06,.006,.025,P.fleco));// los flecos
   if(v==='persa'){const b=Math.min(.16,D*.1);
    out.push(p(0,.012,-D/2+b/2+.06,W-.12,.004,b,P.borde),p(0,.012,D/2-b/2-.06,W-.12,.004,b,P.borde),p(-W/2+b/2+.06,.012,0,b,.004,D-.12-2*b,P.borde),p(W/2-b/2-.06,.012,0,b,.004,D-.12-2*b,P.borde));
    out.push(p(0,.016,0,W-.5,.003,D-.5,P.campo));// el campo
    for(const [k,sc] of [[0,1],[1,.66],[2,.33]])out.push(p(0,.019+k*.002,0,(W-.5)*.42*sc,.002,(D-.5)*.62*sc,k%2?P.borde:P.acento));// el medallón
    for(const sx of [-1,1])for(const sz of [-1,1])out.push(p(sx*(W/2-.4),.019,sz*(D/2-.4),.16,.002,.16,P.acento));}// las esquinas
   else if(v==='rayas'){const n=Math.max(5,Math.round(W/.3));for(let i=0;i<n;i++)if(i%2)out.push(p(-W/2+(i+.5)*W/n,.012,0,W/n,.003,D-.08,i%4===1?P.borde:P.acento));}
   else{// moderna: dos rectángulos corridos sobre un campo liso
    out.push(p(0,.012,0,W-.14,.003,D-.14,P.campo),p(-W*.12,.015,-D*.08,W*.42,.003,D*.5,P.borde),p(W*.14,.018,D*.1,W*.3,.003,D*.36,P.acento));}
   return out;}},
 // Cuadro (o.w × o.h, o.variante, o.marco): cuelga de la pared, con el frente hacia +z y la espalda en z=0; y=0 es el
 // borde de abajo del marco. La escena, en bloques planos delante de la tela (cada capa un poco más adelante).
 cuadro:{nombre:'Cuadro',grupo:'Decoración',medida:[1,.7],alto:o=>o.h||.7,variantes:['paisaje','mar','abstracto','flores'],
  antes:()=>[],
  // (marcos: madera, dorado, negro o plateado; el crema se perdía contra la pared)
  piezas:o=>{const W=o.w||1,H=o.h||.7,F=.05,M=['#6e4b33','#b8923f','#25282b','#a9b0b6'][(o.marco??0)%4],v=o.variante||'paisaje',iw=W-2*F,ih=H-2*F,out=[];
   out.push(p(0,0,.02,W,F,.04,M),p(0,H-F,.02,W,F,.04,M),p(-W/2+F/2,F,.02,F,ih,.04,M),p(W/2-F/2,F,.02,F,ih,.04,M));// el marco
   // una mancha de la escena: (u, v) en la tela de 0 a 1 desde abajo a la izquierda, (su, sv) su tamaño, capa k
   const at=(u,v,su,sv,color,k=0)=>out.push(p(-iw/2+(u+su/2)*iw,F+v*ih,.016+.004*k,su*iw,sv*ih,.004,color));
   if(v==='paisaje'){at(0,0,1,1,'#bfe0f0');at(0,0,1,.32,'#7fae5a',1);
    for(const [u,w,h,c] of [[.05,.4,.55,'#7f93a8'],[.35,.45,.68,'#93a6b8'],[.62,.36,.48,'#7f93a8']])for(let t=0;t<4;t++)at(u+w*t/8,.3+h*t/4*.9,w*(1-t/4),h/4,t===3&&h>.6?'#f3f6f8':c,2);// montañas en escalones (con nieve)
    at(.78,.72,.1,.14,'#f2c14e',3);at(.18,.12,.03,.14,'#6e4b33',3);at(.13,.24,.13,.16,'#4f7d3a',4);}// el sol y un árbol
   else if(v==='mar'){at(0,0,1,1,'#cfe6f2');at(0,0,1,.45,'#3f7fa8',1);at(0,0,1,.12,'#e8d8a8',2);at(0,.44,1,.015,'#8fc2dc',2);
    at(.4,.42,.22,.05,'#7a4a2e',3);at(.49,.47,.02,.3,'#4a3a2e',3);at(.43,.5,.06,.22,'#f4f1ea',4);at(.52,.52,.08,.16,'#f4f1ea',4);at(.15,.75,.12,.05,'#ffffff',3);at(.62,.82,.16,.05,'#ffffff',3);}// el velero y unas nubes
   else if(v==='abstracto'){at(0,0,1,1,'#f4f1ea');at(0,.62,.42,.38,'#c0392b',1);at(.7,0,.3,.28,'#2f5fa8',1);at(.88,.62,.12,.38,'#e8c23a',1);
    for(const u of [.42,.7,.88])at(u-.012,0,.024,1,'#1c1f22',2);for(const vv of [.28,.62])at(0,vv-.015,1,.03,'#1c1f22',2);}
   else{at(0,0,1,1,'#2f3a36');at(.38,.04,.24,.3,'#b07a4a',1);at(.42,.34,.16,.04,'#8a5a3a',1);// el fondo y el florero
    for(const [u,h,c] of [[.36,.3,'#c0392b'],[.47,.42,'#e8c23a'],[.58,.34,'#e8a0b4'],[.42,.22,'#f4f1ea'],[.54,.24,'#9a6ad0']]){at(u+.03,.34,.012,h-.06,'#4f7d3a',2);at(u,.34+h-.08,.08,.11,c,3);}}
   return out;}},

 // ---------- Los que reemplazan modelos pesados (2026-10-12) ----------
 // Del paquete de Oficina: el escritorio (2.640 triángulos), la silla de oficina (2.116), el archivador (4.040), la mesa
 // de noche (2.016) y la cama de hospital (3.684); del de la casa, la lámpara de techo (820). kitModel los arma como
 // modelos con el mismo nombre: quien los usa no cambia. Frente +z (el que se sienta mira a +z; la cabecera, a −z).
 escritorio:{nombre:'Escritorio',grupo:'Oficina',medida:[1.5,.72],alto:()=>.76,modelo:'Desk',
  antes:()=>[],
  piezas:o=>{const W=o.w||1.5,D=o.d||.72,wd='#b08a62',fe=C.grafito;
   return [p(0,.73,0,W,.035,D,wd),// la cubierta
    ...[-1].map(s=>p(s*(W/2-.04),0,0,.04,.73,D-.06,fe)),p(-W/2+.04,.0,0,.06,.02,D-.02,fe),// el costado de metal (izquierda)
    p(-.12,.3,-D/2+.04,W-.5,.4,.02,wd),// el faldón del fondo
    p(W/2-.24,0,0,.44,.72,D-.04,wd),...[0,1,2].map(i=>p(W/2-.24,.06+i*.22,D/2-.015,.4,.19,.012,C.maderaClara)),...[0,1,2].map(i=>p(W/2-.24,.17+i*.22,D/2,.12,.02,.02,C.aceroOscuro))];}},// la cajonera con tres cajones y tiradores
 silla_oficina:{nombre:'Silla de oficina',grupo:'Oficina',medida:[.6,.6],alto:()=>.47,modelo:'OfficeChair',
  antes:()=>[],
  piezas:()=>{const k=C.negro,c='#3a4a5c';
   return [...[0,1,2,3,4].flatMap(i=>{const a=i*Math.PI*2/5;return [p(Math.sin(a)*.14,.05,Math.cos(a)*.14,.04,.035,.28,k,{ry:a}),p(Math.sin(a)*.27,0,Math.cos(a)*.27,.05,.05,.05,k)];}),// la estrella con sus ruedas
    p(0,.05,0,.08,.36,.08,C.aceroOscuro,{cyl:true}),p(0,.4,0,.28,.04,.24,k),// el pistón y su base
    p(0,.43,.02,.5,.07,.48,c),// el asiento
    p(0,.47,-.24,.06,.18,.03,k),p(0,.6,-.25,.44,.48,.06,c,{rx:-.1}),// el respaldo en su soporte
    ...[-1,1].flatMap(s=>[p(s*.25,.47,0,.03,.18,.03,k),p(s*.25,.65,.03,.05,.03,.26,k)])];}},// los apoyabrazos
 archivador:{nombre:'Archivador',grupo:'Oficina',medida:[.5,.62],alto:()=>1.32,modelo:'ShortCloset',
  antes:()=>[],
  piezas:o=>{const W=Math.min(o.w||.5,.6),D=Math.min(o.d||.62,.65),g='#8d969d';
   return [p(0,0,0,W-.04,.06,D-.04,C.grafito),p(0,.06,0,W,1.24,D,g),p(0,1.3,0,W+.01,.02,D+.01,C.aceroOscuro),
    ...[0,1,2,3].flatMap(i=>[p(0,.1+i*.3,D/2,W-.06,.27,.012,'#a3acb3'),p(0,.3+i*.3,D/2+.012,.16,.025,.02,C.aceroClaro),p(0,.24+i*.3,D/2+.008,.1,.04,.004,C.crema)])];}},// cuatro cajones: frente, manija y etiqueta
 mesa_noche:{nombre:'Mesa de noche',grupo:'Casa',medida:[.5,.45],alto:()=>.56,modelo:'NightStand',
  antes:()=>[],
  piezas:o=>{const W=Math.min(o.w||.5,.55),D=Math.min(o.d||.45,.5),w=C.madera;
   return [...[-1,1].flatMap(sx=>[-1,1].map(sz=>p(sx*(W/2-.04),0,sz*(D/2-.04),.04,.08,.04,C.maderaOscura))),
    p(0,.08,0,W,.44,D,w),...[0,1].flatMap(i=>[p(0,.11+i*.21,D/2,W-.06,.18,.012,C.maderaClara),p(0,.2+i*.21,D/2+.012,.04,.04,.02,C.cobre)]),p(0,.52,0,W+.03,.03,D+.03,C.maderaOscura)];}},
 cama_hospital:{nombre:'Cama de hospital',grupo:'Hospital',medida:[1.05,2.15],alto:()=>.62,modelo:'HospitalBed',
  antes:()=>[],
  piezas:()=>{const m='#c9cfd4',b='#e9eef1',k=C.grafito;
   return [...[-1,1].flatMap(sx=>[-1,1].map(sz=>p(sx*.4,0,sz*.92,.08,.08,.08,k,{cyl:true}))),// las ruedas
    p(0,.08,0,.9,.06,1.95,m),...[-1,1].map(sz=>p(0,.14,sz*.6,.06,.3,.06,m)),// el chasis
    p(0,.44,.25,.86,.06,1.4,m),p(0,.5,.25,.82,.12,1.38,b),// el colchón de los pies
    p(0,.5,-.68,.82,.12,.6,b,{rx:.45}),p(0,.62,-.82,.5,.1,.24,'#ffffff',{rx:.45}),// la cabecera levantada con su almohada
    p(0,.3,-1.0,.98,.75,.05,m),p(0,.3,1.0,.98,.5,.05,m),p(0,.4,-1.0,.8,.5,.06,b),// cabecera y piecera
    ...[-1,1].flatMap(s=>[p(s*.47,.62,.2,.03,.03,1.0,C.aceroClaro),p(s*.47,.48,-.25,.03,.14,.03,C.aceroClaro),p(s*.47,.48,.65,.03,.14,.03,C.aceroClaro)])];}},// las barandas
 plafon:{nombre:'Lámpara de techo',grupo:'Casa',medida:[.42,.42],alto:()=>.14,modelo:'Light_Ceiling3',
  antes:()=>[],
  // (cuelga hacia abajo desde su origen, como las lámparas del paquete: se pone a la altura del cielo raso)
  piezas:()=>[p(0,-.04,0,.42,.04,.42,C.aceroClaro,{cyl:true}),p(0,-.12,0,.36,.08,.36,'#fff6e0',{cyl:true}),p(0,-.14,0,.2,.02,.2,'#fffaf0',{cyl:true})]},

 // ---------- Decoración 2 (2026-10-12): lo de encima de las mesas, de las paredes y de las ventanas ----------
 // (vidrio: true es una pieza transparente: la mampara)
 florero:{nombre:'Florero',grupo:'Decoración',medida:[.2,.2],alto:()=>.42,variantes:['rojas','amarillas','lilas'],
  antes:()=>[],
  piezas:o=>{const F={rojas:['#c0392b','#e05a4a'],amarillas:['#e8c23a','#f2d36b'],lilas:['#9a6ad0','#c49ae8']}[o.variante||'rojas'],v=['#3d6f8f','#e9e2d3','#b07a4a'][(o.paleta??0)%3];
   return [p(0,0,0,.12,.03,.12,v,{cyl:true}),p(0,.03,0,.15,.12,.15,v,{cyl:true}),p(0,.15,0,.1,.06,.1,v,{cyl:true}),p(0,.21,0,.07,.04,.07,v,{cyl:true}),// el florero
    ...[[-.04,0,.16],[.03,.03,.2],[0,-.04,.13],[.05,-.02,.17],[-.03,.04,.15]].flatMap(([x,z,h],i)=>[p(x*.6,.2,z*.6,.008,h,.008,'#4f7d3a'),p(x,.2+h-.01,z,.05,.05,.05,F[i%2])]),
    p(.03,.27,.02,.06,.015,.03,'#5f9147',{rz:.6}),p(-.03,.29,-.01,.06,.015,.03,'#5f9147',{rz:-.6})];}},// tallos, flores y dos hojas
 reloj:{nombre:'Reloj de pared',grupo:'Decoración',medida:[.36,.05],alto:()=>.36,
  antes:()=>[],
  // (colgado: la espalda en z=0 y el frente a +z; y=0 es su borde de abajo)
  piezas:o=>{const R=.36,c=R/2,m=['#25282b','#6e4b33','#b8923f'][(o.paleta??0)%3];
   return [p(0,c,0,R,.04,R,m,{cyl:true,rx:Math.PI/2}),p(0,c,.04,R-.05,.006,R-.05,'#f4f1ea',{cyl:true,rx:Math.PI/2}),// el marco y la esfera
    ...[0,1,2,3].map(k=>{const a=k*Math.PI/2;return p(Math.sin(a)*.13,c+Math.cos(a)*.13-.012,.046,.012,.025,.004,'#25282b');}),// las marcas de 12, 3, 6 y 9
    p(0,c,.05,.012,.1,.004,'#25282b',{rz:-.5}),p(0,c,.052,.008,.13,.004,'#25282b',{rz:2.1}),p(0,c-.01,.054,.02,.02,.006,'#c0392b')];}},// las agujas y el centro
 telefono:{nombre:'Teléfono',grupo:'Oficina',medida:[.2,.2],alto:()=>.08,
  antes:()=>[],
  piezas:()=>[p(0,0,0,.18,.05,.2,C.grafito),p(0,.05,-.03,.16,.012,.12,C.negro,{rx:.15}),// la base y su tapa
   p(0,.062,.02,.2,.035,.06,C.negro),p(-.085,.055,.02,.04,.03,.07,C.negro),p(.085,.055,.02,.04,.03,.07,C.negro),// el auricular
   ...[0,1,2].flatMap(r=>[-1,0,1].map(cc=>p(cc*.03,.05,.065+r*.0,.022,.006,.018,'#d0d3d6')))]},// el teclado
 espejo:{nombre:'Espejo de baño',grupo:'Baño',medida:[.6,.15],alto:()=>.9,
  antes:()=>[],
  // (colgado sobre el lavamanos: la espalda en z=0; y=0 es la repisa)
  piezas:o=>{const W=Math.min(o.w||.6,.7);
   return [p(0,0,.06,W,.025,.12,'#efe9df'),...[-1,1].map(s=>p(s*(W/2-.04),0,.06,.025,.06,.1,C.aceroClaro)),// la repisa y sus ménsulas
    p(-.1,.025,.06,.05,.12,.05,'#5f9fc2',{cyl:true}),p(.06,.025,.06,.06,.08,.06,'#e8a0b4',{cyl:true}),p(.16,.025,.07,.03,.1,.03,'#f4f1ea'),// frascos y cepillo
    p(0,.12,.012,W-.04,.72,.024,C.aceroOscuro),p(0,.14,.026,W-.1,.68,.006,'#dfe9ef'),p(0,.78,.03,W-.3,.04,.03,'#fff6e0')];}},// el marco, la luna y la luz
 mampara:{nombre:'Mampara de ducha',grupo:'Baño',medida:[1,1],alto:()=>2.0,
  antes:()=>[],
  // (sobre la ducha de 1 × 1: el vidrio del frente, con marco; al fondo, el caño y la regadera)
  piezas:o=>{const W=Math.min(o.w||1,1.1),D=Math.min(o.d||1,1.1),al=C.aceroClaro;
   return [p(0,.1,D/2-.03,W-.04,1.9,.01,null,{vidrio:true}),// el vidrio
    p(0,1.98,D/2-.03,W-.02,.03,.03,al),...[-1,1].map(s=>p(s*(W/2-.02),.1,D/2-.03,.025,1.9,.03,al)),p(W/2-.12,1.0,D/2,.02,.25,.03,al),// el marco y la manija
    p(-W/4,.9,-D/2+.04,.025,1.15,.025,al),p(-W/4,1.98,-D/2+.12,.025,.025,.18,al),p(-W/4,1.92,-D/2+.21,.14,.03,.14,al,{cyl:true}),// el caño y la regadera
    p(-W/4,1.05,-D/2+.04,.1,.1,.05,al)];}},// la llave
 cortina:{nombre:'Cortinas',grupo:'Decoración',medida:[1.3,.12],alto:o=>o.h||2.5,variantes:['crema','azul','verde','terracota'],
  antes:()=>[],
  // (frente a una ventana de ancho o.w: el barral a o.h de alto y los dos paños, plegados, a los costados; la espalda en
  // z=0, contra la pared; o.bajo: hasta dónde llegan)
  // (o.cerrada: un color —engine/cortinas.js— y la tela corrida de lado a lado, 15 cm más ancha que la ventana por lado,
  // con dos pliegues; tapa el cuarto desde la calle)
  piezas:o=>{const W=o.w||1.3,H=o.h||2.5,B=o.bajo??.1,c={crema:['#efe6d6','#e2d6c0'],azul:['#7b98b8','#6a87a6'],verde:['#9fb89a','#8aa685'],terracota:['#c98a6a','#b77a5c']}[o.variante||'crema'];
   const pl=o.pliegues||3,rb=.06+.09*(pl-1)+.08;// (el barral, hasta pasar el último pliegue)
   const out=[p(0,H,.07,W+2*rb,.03,.03,C.maderaOscura),...[-1,1].map(s=>p(s*(W/2+rb-.03),H-.02,.07,.07,.07,.07,C.maderaOscura))];// (el barral, una caja: las casas no giran piezas)
   if(o.cerrada){const t=o.cerrada,d='#'+[1,3,5].map(i=>Math.round(parseInt(t.slice(i,i+2),16)*.82).toString(16).padStart(2,'0')).join('');
    out.push(p(0,B,.04,W+.3,H-B-.02,.03,t));for(const s of [-1,1])out.push(p(s*(W+.3)/6,B,.065,.12,H-B-.06,.02,d));return out;}
   const np=o.pliegues||3;for(const s of [-1,1])for(let k=0;k<np;k++)out.push(p(s*(W/2+.06+k*.09),B,.04+(k%2)*.025,.1,H-B-.02,.02,c[k%2]));// tres pliegues por paño (o.pliegues: menos, si la pared no da)
   return out;}},

 // La biblioteca (2026-10-12): reemplaza a las del paquete, con libros (C2_BookCaseBooks 1.456 triángulos,
 // C2_BookCaseLargeBooks 3.500, Bookcase_Books de Oficina 10.948) y vacías. Cuatro tablas; en cada una, una fila de
 // libros de alturas y colores distintos (cada libro, una caja), a veces uno acostado o un hueco. o.libros=false: vacía.
 biblioteca:{nombre:'Biblioteca',grupo:'Casa',medida:[1.0,.38],alto:()=>1.95,variantes:['con libros','vacía','ancha'],
  modelo:{C2_BookCaseBooks:{},C2_BookCaseLargeBooks:{w:1.6},Bookcase_Books:{},C2_BookCase:{libros:false},C2_BookCaseLarge:{w:1.6,libros:false},Bookcase:{libros:false}},
  antes:()=>[],
  piezas:o=>{const v=o.variante,W=v==='ancha'?1.6:(o.w||1),D=Math.min(o.d||.38,.42),H=1.95,wd=C.madera,libros=o.libros??v!=='vacía',out=[];
   out.push(p(-W/2+.02,0,0,.04,H,D,wd),p(W/2-.02,0,0,.04,H,D,wd),p(0,H-.04,0,W,.04,D,C.maderaOscura),p(0,0,-D/2+.01,W-.08,H-.04,.02,C.maderaOscura),p(0,0,.0,W-.08,.08,D,wd));// costados, techo, fondo y zócalo
   const shelves=[.08,.5,.94,1.38];for(const y of shelves.slice(1))out.push(p(0,y-.03,0,W-.08,.03,D-.02,wd));
   if(!libros)return out;
   let s=(o.semilla??7)*9301+49297;const r=()=>(s=(s*9301+49297)%233280)/233280,BOOK=['#8a3b2e','#2f4a6b','#3e6b4f','#c9a24a','#6b4e7a','#d8cbb5','#7a5a3a','#b8432f'];
   for(const y of shelves){let x=-W/2+.06;const end=W/2-.06;
    while(x<end-.04){const w=.06+r()*.06,h=.2+r()*.13;if(r()<.08){x+=.06;continue;}// un hueco
     if(r()<.07&&x+.24<end){out.push(p(x+.12,y,.02,.24,.035,.18,BOOK[Math.floor(r()*8)]));x+=.26;continue;}// uno acostado
     if(x+w>end)break;out.push(p(x+w/2,y,.02,w,Math.min(h,.38),.2+r()*.04,BOOK[Math.floor(r()*8)]));x+=w+.004;}}
   return out;}},

 // La lámpara colgante (reemplaza a Light_Ceiling1, 269 triángulos, de la que hay miles): florón, cable, pantalla en dos
 // escalones y el foco. Cuelga hacia abajo desde su origen (unos 43 cm), como la del paquete.
 colgante:{nombre:'Lámpara colgante',grupo:'Casa',medida:[.36,.36],alto:()=>.43,modelo:'Light_Ceiling1',
  antes:()=>[],
  piezas:()=>[p(0,-.03,0,.12,.03,.12,C.crema,{cyl:true}),p(0,-.28,0,.012,.25,.012,C.negro),// el florón y el cable
   p(0,-.33,0,.16,.07,.16,'#2f5f5a',{cyl:true}),p(0,-.4,0,.34,.07,.34,'#2f5f5a',{cyl:true}),// la pantalla
   p(0,-.43,0,.12,.04,.12,'#fff6e0',{cyl:true})]},// el foco

 // El baño (reemplazan a Bathroom_Toilet, 402 triángulos, y Bathroom_Sink, 350, de los que hay más de mil de cada uno).
 // Frente +z: el inodoro con el tanque contra la pared de atrás; el lavamanos, un mueble con su poceta encima.
 inodoro:{nombre:'Inodoro',grupo:'Baño',medida:[.5,.7],alto:()=>.42,modelo:'Bathroom_Toilet',
  antes:()=>[],
  piezas:()=>{const w='#f4f6f6',g='#e3e8ea';
   return [p(0,0,.04,.24,.3,.32,w),// el pie
    p(0,.28,.08,.4,.1,.5,w,{cyl:true}),p(0,.38,.08,.42,.03,.52,g,{cyl:true}),p(0,.41,.08,.26,.006,.34,'#bfcbd0',{cyl:true}),// la taza, el asiento y el hueco
    p(0,.41,-.2,.42,.38,.04,g,{rx:-.08}),// la tapa levantada
    p(0,.36,-.27,.44,.4,.17,w),p(0,.76,-.27,.47,.04,.2,g),p(.12,.8,-.27,.06,.015,.06,C.aceroClaro,{cyl:true})];}},// el tanque, su tapa y el botón
 lavamanos:{nombre:'Lavamanos',grupo:'Baño',medida:[.72,.42],alto:()=>.86,modelo:'Bathroom_Sink',
  antes:()=>[],
  piezas:o=>{const W=Math.min(o.w||.72,.8),D=Math.min(o.d||.42,.5),wd='#e9e2d3';
   return [p(0,0,-.02,W-.06,.06,D-.06,C.grafito),p(0,.06,0,W,.72,D,wd),// el zócalo y el mueble
    ...[-1,1].flatMap(s=>[p(s*(W/4),.1,D/2,W/2-.04,.62,.012,'#f4efe4'),p(s*.04,.62,D/2+.012,.02,.1,.02,C.aceroOscuro)]),// las dos puertas con tirador
    p(0,.78,0,W+.02,.04,D+.02,'#f4f6f6'),p(0,.815,.03,W-.22,.012,D-.16,'#dfe7ea'),// la cubierta y la poceta
    p(0,.82,-D/2+.07,.05,.12,.05,C.aceroClaro,{cyl:true}),p(0,.92,-D/2+.07,.04,.03,.14,C.aceroClaro),p(.09,.82,-D/2+.07,.04,.04,.04,C.aceroClaro,{cyl:true})];}},// la llave, el pico y la manija

 // ---------- Lo que más pesaba después (2026-10-12), a la medida de cada modelo del paquete ----------
 nevera:{nombre:'Nevera',grupo:'Cocina',medida:[.67,.68],alto:()=>1.72,modelo:'Kitchen_Fridge',
  antes:()=>[],
  // (a la medida, 2026-10-12: el ancho y el fondo que le da el plano; las puertas y las manijas se corren con el ancho)
  piezas:o=>{const w='#dfe3e2',W=o.w||.67,D=o.d||.68,X=W/.67,Z=D/.68;
   return [p(0,0,-.02*Z,W-.05,.06,D-.08,C.negro),p(0,.06,-.03*Z,W,1.64,D-.06,w),// el zócalo y el cuerpo
    p(0,.08,D/2-.05,W-.03,1.08,.03,'#e8ecea'),p(0,1.19,D/2-.05,W-.03,.5,.03,'#e8ecea'),p(0,1.16,D/2-.04,W-.03,.025,.02,C.grafito),// las dos puertas y la junta
    p(W/2-.075,.62,D/2-.02,.03,.4,.03,C.aceroClaro),p(W/2-.075,1.3,D/2-.02,.03,.22,.03,C.aceroClaro),p(-.18*X,1.5,D/2-.03,.12,.08,.005,'#c0392b')];}},// las manijas y un imán
 fregadero:{nombre:'Lavaplatos',grupo:'Cocina',medida:[.53,.58],alto:()=>.84,modelo:'Kitchen_Sink',
  antes:()=>[],
  piezas:()=>{const k='#5b675f',t='#81807e';
   return [p(0,0,-.02,.49,.08,.52,C.negro),p(0,.08,0,.53,.72,.56,k),p(0,.12,.28,.47,.6,.012,'#6b786f'),p(.18,.62,.29,.03,.12,.02,C.aceroClaro),// mueble y puerta
    p(0,.8,0,.53,.04,.58,t),p(0,.835,.04,.38,.01,.36,'#5a5c5e'),// la cubierta y la poza
    p(0,.84,-.22,.04,.22,.04,C.aceroClaro,{cyl:true}),p(0,1.02,-.16,.03,.03,.14,C.aceroClaro)];}},// la llave y el pico
 ducha:{nombre:'Ducha',grupo:'Baño',medida:[.99,.98],alto:()=>.1,modelo:'Bathroom_Shower1',
  antes:()=>[],
  // (el plato, con su desagüe y las baldosas de la pared de atrás; el vidrio y la regadera son de la mampara)
  // (a la medida, 2026-10-12: de 0,8 × 0,8 en los baños chicos a 1 × 1)
  piezas:o=>{const W=o.w||.99,D=o.d||.98;return [p(0,0,0,W,.08,D,'#f4f6f6'),p(0,.08,0,W-.14,.005,D-.14,'#dfe7ea'),p(0,.085,0,.08,.003,.08,C.aceroClaro,{cyl:true}),
   p(0,.08,-D/2+.02,W-.02,1.8,.02,'#dcebef')];}},
 maceta:{nombre:'Planta en maceta',grupo:'Decoración',medida:[.3,.3],alto:()=>.81,modelo:'Houseplant_8',
  antes:()=>[],
  piezas:()=>{const g='#4f7d3a',g2='#5f9147';
   return [p(0,0,0,.26,.26,.26,'#b5654a',{cyl:true}),p(0,.24,0,.28,.04,.28,'#a0573f',{cyl:true}),p(0,.28,0,.22,.006,.22,'#4a3a2e',{cyl:true}),// la maceta y la tierra
    p(0,.27,0,.03,.3,.03,'#6b4e36'),// el tallo
    p(0,.48,0,.32,.16,.32,g,{ry:.4}),p(.03,.6,-.02,.26,.14,.26,g2,{ry:1.1}),p(-.02,.71,.02,.18,.1,.18,g,{ry:.2})];}},// el follaje en tres capas giradas
 // ---------- Azoteas (2026-10-18, engine/azoteas.js: lo reparte el 2D) ----------
 // El tanque de agua de 1.000 l de las azoteas colombianas: negro, de polietileno, sobre su base de concreto.
 tanque_agua:{nombre:'Tanque de agua',grupo:'Azoteas',medida:[1.2,1.2],alto:()=>1.5,
  antes:()=>[],
  piezas:()=>[p(0,0,0,1.2,.16,1.2,C.piedra),// la base
   p(0,.16,0,1.08,1.08,1.08,'#2a2c2f',{cyl:true}),p(0,1.24,0,.96,.14,.96,'#323539',{cyl:true}),// el cuerpo y el hombro
   p(0,1.38,0,.46,.12,.46,'#3b3f44',{cyl:true}),// la tapa
   p(.42,.5,.42,.06,.92,.06,C.aceroOscuro),p(.56,.5,0,.1,.06,.06,C.aceroOscuro)]},// el tubo que baja y la llave
 // La antena: el mástil con sus brazos (la de televisión) y la parabólica chica.
 antena:{nombre:'Antena',grupo:'Azoteas',medida:[.3,.3],alto:()=>2.6,
  antes:()=>[],
  piezas:()=>[p(0,0,0,.3,.06,.3,C.aceroOscuro),p(0,.06,0,.05,2.5,.05,C.acero),// la base y el mástil
   ...[1.9,2.15,2.4].map((y,i)=>p(0,y,0,.9-i*.2,.03,.03,C.acero)),// los brazos
   p(.02,1.3,.12,.42,.42,.06,C.aceroClaro,{rx:-.5}),p(.02,1.3,.2,.05,.05,.16,C.aceroOscuro)]},// la parabólica y su brazo
 // El tendedero: dos postes con cuerdas y ropa colgada (de colores al azar de la ropa de la tienda).
 tendedero:{nombre:'Tendedero',grupo:'Azoteas',medida:[3,.3],alto:()=>1.7,
  antes:()=>[],
  piezas:o=>{const W=o.w||3,cs=ROPA.doblada,k=o.paleta||0;
   return [...[-1,1].flatMap(sx=>[p(sx*(W/2-.04),0,0,.06,1.7,.06,C.aceroOscuro),p(sx*(W/2-.04),1.62,0,.06,.04,.34,C.aceroOscuro)]),// los postes con su travesaño
    ...[-.13,.13].map(z=>p(0,1.64,z,W-.1,.012,.012,'#d8d4cc')),// las cuerdas
    ...[-.95,-.35,.25,.85].map((x,i)=>p(x*W/3,1.08+(i%2)*.1,i%2?.13:-.13,.42,.5-(i%2)*.1,.02,cs[(k+i*3)%cs.length]))];}},// la ropa
 // La matera de azotea: una jardinera de barro con una mata.
 matera_azotea:{nombre:'Matera de azotea',grupo:'Azoteas',medida:[.5,.5],alto:()=>.45,
  antes:()=>[],
  piezas:o=>[p(0,0,0,.5,.32,.5,'#b5654a'),p(0,.32,0,.54,.04,.54,'#a0573f'),p(0,.36,0,.44,.008,.44,'#4a3a2e'),// la jardinera, su borde y la tierra
   p(0,.37,0,.42,.2,.42,(o.paleta||0)%2?'#4f7d3a':'#5f9147',{ry:.5}),p(.05,.5,-.03,.26,.14,.26,'#6a9a4f',{ry:1.2})]},// la mata
 mesa_reunion:{nombre:'Mesa de reunión',grupo:'Oficina',medida:[1.21,2.36],alto:()=>.74,modelo:'Table',
  antes:()=>[],
  piezas:o=>{const W=o.w||1.21,D=o.d||2.36,wd='#a07d5a';
   return [p(0,.7,0,W,.04,D,wd),p(0,.66,0,W-.16,.04,D-.16,C.maderaOscura),// la cubierta y su faldón
    ...[-1,1].flatMap(s=>[p(0,0,s*(D/2-.35),.5,.03,.08,C.grafito),p(0,.03,s*(D/2-.35),.08,.63,.08,C.grafito)]),p(0,.3,0,.04,.04,D-.7,C.grafito)];}},// dos pies en T y el travesaño
 // La ventana de un cuarto (2026-10-12), a la medida del vano (o.w × o.h; el origen, el medio de abajo del vano; el frente,
 // afuera, a +z; 12 cm de fondo, el de la pared): el marco, los travesaños según el cuarto y el alféizar de adentro y el
 // de afuera. El vidrio va sin color (lo pone quien la usa, con su material transparente). Variantes: dos hojas
 // (dormitorios), tres paños (sala), baño (un paño, vidrio esmerilado: color), cocina (travesaño arriba), simple.
 ventana:{nombre:'Ventana de cuarto',grupo:'Casa',medida:[1.2,.12],alto:o=>o.h||1.2,variantes:['dos_hojas','tres_panos','bano','cocina','simple'],
  antes:()=>[],
  piezas:o=>{const W=o.w||1.2,H=o.h||1.2,D=.12,f=.06,v=o.variante||'dos_hojas',col=o.color||'#f4f1ea',out=[];
   out.push(p(0,0,0,W,f,D,col),p(0,H-f,0,W,f,D,col),p(-W/2+f/2,f,0,f,H-2*f,D,col),p(W/2-f/2,f,0,f,H-2*f,D,col));// el marco
   const vert=x=>out.push(p(x,f,0,.045,H-2*f,D*.7,col)),hor=y=>out.push(p(0,y,0,W-2*f,.045,D*.7,col));
   if(v==='dos_hojas')vert(0);else if(v==='tres_panos'){vert(-W/6);vert(W/6);}else if(v==='cocina')hor(H*.68);
   out.push(p(0,-.04,-D/2-.05,W+.1,.04,.14,shadeHex(col,.95)),p(0,-.06,D/2+.03,W+.14,.05,.1,shadeHex(col,.9)));// alféizar de adentro y de afuera
   out.push(p(0,f,0,W-2*f,H-2*f,.012,v==='bano'?'#e6eef0':null));// el vidrio (el del baño, esmerilado y opaco)
   return out;}},
 // La hoja de la puerta de un cuarto (2026-10-12), a la medida del vano (o.w × o.h; 4 cm de grueso; el frente a +z,
 // centrada): de tablero (cuatro paneles, en los dormitorios), lisa, con vidrio arriba (la cocina) o con rejilla abajo (el
 // baño). La manija, de los dos lados, a 1 m y a 7 cm del canto que no lleva bisagra (el de −x).
 puerta:{nombre:'Puerta de cuarto',grupo:'Casa',medida:[.85,.04],alto:o=>o.h||2.05,variantes:['tablero','lisa','vidrio','rejilla'],
  antes:()=>[],
  piezas:o=>{const W=o.w||.85,H=o.h||2.05,T=.04,v=o.variante||'tablero',wd=o.color||(v==='lisa'||v==='rejilla'?'#ece7dc':C.maderaClara),dk=shadeHex(wd,.86),out=[p(0,0,0,W,H,T,wd)];
   const panel=(x,y,w,h,c=dk)=>{for(const s of [-1,1])out.push(p(x,y,s*(T/2+.004),w,h,.008,c));};
   if(v==='tablero'){const pw=(W-.3)/2;for(const sx of [-1,1]){panel(sx*(pw/2+.05),.18,pw,.78);panel(sx*(pw/2+.05),1.12,pw,H-1.32);}}
   else if(v==='lisa')panel(0,.08,W-.12,H-.16,shadeHex(wd,.94));
   // (la de vidrio, 2026-10-16: la hoja era maciza y el vidrio iba adentro, al ras de su cara —titilaba—; ahora es un
   // marco —abajo macizo, arriba el travesaño y los dos largueros— con el vidrio en el hueco y el parante del medio)
   else if(v==='vidrio'){out.length=0;const g=H-1.3;out.push(p(0,0,0,W,1.1,T,wd),p(0,H-.2,0,W,.2,T,wd));for(const sx of [-1,1])out.push(p(sx*(W/2-.06),1.1,0,.12,g,T,wd));
    panel(0,.12,W-.24,.8);out.push(p(0,1.1,0,W-.24,g,.012,'#bcd6e2'),p(0,1.1+g/2-.015,0,W-.24,.03,T*.8,dk));}
   else{panel(0,1.0,W-.24,H-1.2);for(let i=0;i<6;i++)for(const s of [-1,1])out.push(p(0,.16+i*.11,s*(T/2+.006),W-.24,.035,.012,dk));}// las tablillas de la rejilla
   for(const s of [-1,1])out.push(p(-W/2+.07,.98,s*(T/2+.03),.03,.12,.03,C.aceroClaro),p(-W/2+.11,1.02,s*(T/2+.05),.1,.025,.025,C.aceroClaro));// la manija
   return out;}},
 // La mesa de centro de la sala (2026-10-12), a la medida: la cubierta a 42 cm, un entrepaño abajo y cuatro patas.
 mesa_centro:{nombre:'Mesa de centro',grupo:'Casa',medida:[.9,.6],alto:()=>.42,
  antes:()=>[],
  piezas:o=>{const W=o.w||.9,D=o.d||.6,lx=W/2-.06,lz=D/2-.06;
   return [p(0,.38,0,W,.04,D,C.maderaClara),p(0,.1,0,W-.12,.025,D-.12,C.madera),...[-1,1].flatMap(sx=>[-1,1].map(sz=>p(sx*lx,0,sz*lz,.05,.38,.05,C.maderaOscura)))];}},
 // La mesa del comedor de la casa (2026-10-12): a la medida del cuarto (de 0,8 × 0,8 para dos a 1,6 × 0,9 para seis).
 mesa_comedor:{nombre:'Mesa de comedor',grupo:'Casa',medida:[1.2,.8],alto:()=>.76,
  antes:()=>[],
  piezas:o=>{const W=o.w||1.2,D=o.d||.8,wd=C.madera,lx=W/2-.08,lz=D/2-.08;
   return [p(0,.72,0,W,.04,D,wd),p(0,.64,0,W-.1,.08,D-.1,C.maderaOscura),// la cubierta y su faldón
    ...[-1,1].flatMap(sx=>[-1,1].map(sz=>p(sx*lx,0,sz*lz,.06,.64,.06,C.maderaOscura)))];}},// las cuatro patas
 cama:{nombre:'Cama doble',grupo:'Casa',medida:[1.31,2.1],alto:()=>.5,modelo:'C2_Bed',
  antes:()=>[],
  // (la cabecera a −z; el frente, los pies, a +z)
  // (a la medida, 2026-10-12: de 1,2 a 1,6 m de ancho según el cuarto; con menos de 1,25 m, una sola almohada)
  piezas:q=>{const wd=C.madera,o=C.maderaOscura,W=q.w||1.31,D=q.d||2.1,h=D/2,pw=Math.min(.52,(W-.27)/2);
   return [...[-1,1].flatMap(sx=>[-1,1].map(sz=>p(sx*(W/2-.055),0,sz*(h-.07),.07,.14,.07,o))),p(0,.14,0,W,.16,D,wd),// patas y marco
    p(0,.3,.02,W-.07,.16,D-.1,'#efe9de'),p(0,.46,.32*D/2.1,W-.03,.06,D*.676,'#7d8ea6'),p(0,.4,h-.05,W-.01,.08,.14,'#6c7c93'),// colchón, cobija y su doblez a los pies
    ...(W<1.25?[p(0,.46,-h+.27,Math.min(.7,W-.2),.12,.3,'#f4f2ec')]:[-1,1].map(s=>p(s*(W/4-.0275),.46,-h+.27,pw,.12,.3,'#f4f2ec'))),// las almohadas
    // (la cabecera llega a 84 cm: por debajo del alféizar, así la cama puede ir bajo una ventana)
    p(0,.14,-h+.01,W,.7,.06,wd),...[-1,0,1].map(k=>p(k*W*.32,.4,-h+.05,.3*W/1.31,.34,.02,o)),
    p(0,.14,h-.01,W,.32,.05,wd)];}},// la piecera
 // (a la medida, 2026-10-12: el ancho y el fondo del plano; desde 1,2 m, dos columnas de cajones)
 comoda2:{nombre:'Cómoda',grupo:'Casa',medida:[.9,.62],alto:()=>1.29,modelo:'C2_Closet2',
  antes:()=>[],
  piezas:o=>{const wd=C.madera,W=o.w||.9,D=o.d||.62,cols=W>=1.2?2:1,cw=(W-.06)/cols,f=D/2;
   return [...[-1,1].flatMap(sx=>[-1,1].map(sz=>p(sx*(W/2-.05),0,sz*(f-.05),.06,.08,.06,C.maderaOscura))),p(0,.08,0,W,1.16,D-.02,wd),p(0,1.24,0,W+.04,.05,D+.02,C.maderaOscura),// patas, cuerpo y tapa
    ...[0,1,2,3].flatMap(i=>Array.from({length:cols},(_,c)=>{const x=-W/2+.03+cw*(c+.5);return [p(x,.12+i*.28,f-.01,cw-.04,.24,.015,C.maderaClara),p(x-cw*.22,.23+i*.28,f,.08,.025,.02,C.cobre),p(x+cw*.22,.23+i*.28,f,.08,.025,.02,C.cobre)];}).flat())];}},// los cajones con dos tiradores
 // El sofá y el armario a la medida (2026-10-12): del plano sale el largo, y de ahí cuántos cojines y cuántas puertas.
 sofa:{nombre:'Sofá',grupo:'Casa',medida:[2.1,.9],alto:()=>.45,
  antes:()=>[],
  piezas:o=>{const W=o.w||2.1,D=o.d||.9,f=D/2,tela='#7d8b99',cojin='#8e9caa',arm=.16,n=Math.max(1,Math.round((W-2*arm)/.62)),cw=(W-2*arm)/n;
   return [...[-1,1].flatMap(sx=>[-1,1].map(sz=>p(sx*(W/2-.08),0,sz*(f-.08),.06,.1,.06,C.maderaOscura))),// las patas
    p(0,.1,0,W,.2,D,tela),...[-1,1].map(s=>p(s*(W/2-arm/2),.1,0,arm,.52,D,tela)),p(0,.3,-f+.1,W-2*arm,.55,.2,tela),// la base, los brazos y el respaldo
    ...Array.from({length:n},(_,k)=>{const x=-W/2+arm+cw*(k+.5);return [p(x,.3,.08,cw-.03,.15,D-.26,cojin),p(x,.45,-f+.24,cw-.05,.38,.14,cojin,{rx:-.18})];}).flat()];}},// cojines del asiento y del respaldo
 armario:{nombre:'Armario',grupo:'Casa',medida:[1.2,.6],alto:()=>2.0,
  antes:()=>[],
  piezas:o=>{const W=o.w||1.2,D=o.d||.6,f=D/2,n=Math.max(2,Math.round(W/.5)),dw=(W-.06)/n,wd=C.maderaClara;
   return [p(0,0,0,W-.04,.08,D-.06,C.maderaOscura),p(0,.08,0,W,1.86,D,wd),p(0,1.94,0,W+.04,.06,D+.03,C.maderaOscura),// zócalo, cuerpo y cornisa
    ...Array.from({length:n},(_,k)=>{const x=-W/2+.03+dw*(k+.5),side=k%2?-1:1;return [p(x,.14,f,dw-.03,1.74,.015,C.madera),p(x+side*(dw/2-.07),.9,f+.012,.025,.3,.02,C.cobre)];}).flat()];}},// las puertas con su tirador (de a pares)
};
// (2026-10-16: ninguna pieza con una cara en el mismo plano que otra de otro color —titilan al mover la cámara—:
// engine/titileo.js las corrige al armarlas; lo comprueba validar-titileo)
for(const o of Object.values(OBJETOS))if(o.piezas){const f=o.piezas;o.piezas=x=>piezasSinTitilar(f(x));}

// Las paletas de las alfombras (las de costumbre: persas rojas y azules, de lana cruda, verdes y grises).
const RUGS=[{base:'#7a2b2b',borde:'#e3c79a',campo:'#9c3a35',acento:'#2f4a6b',fleco:'#efe6d6'},{base:'#2f4a6b',borde:'#e3c79a',campo:'#3c5d84',acento:'#9c3a35',fleco:'#efe6d6'},
 {base:'#e7dcc8',borde:'#8d6a4e',campo:'#efe6d6',acento:'#5f7f6a',fleco:'#f4efe4'},{base:'#4f6b5a',borde:'#d8c79e',campo:'#5f7f6a',acento:'#c9a24a',fleco:'#efe6d6'},
 {base:'#6b6e72',borde:'#d0d3d6',campo:'#7b7f84',acento:'#c0392b',fleco:'#e4e6e8'}];
export const RUG_COUNT=RUGS.length;

// Las piezas de un objeto puestas en el mundo: en (x, y, z), girado ry (su frente, +z, hacia ry). Devuelve las cajas
// como las dibuja world3d (instanced: base en y, giro YXZ) con los campos de más que se pasen en extra (f, el piso…).
// Las piezas en el mundo dibujadas (para lo que no pasa por las cajas de los edificios: la calle, el taller): una
// InstancedMesh para las cajas, otra para los cilindros y otra para lo que brilla. Devuelve un grupo (userData.tris).
const BOX_G=new THREE.BoxGeometry(1,1,1).translate(0,.5,0),CYL_G=new THREE.CylinderGeometry(.5,.5,1,10).translate(0,.5,0);
const GLASS=new THREE.MeshStandardMaterial({color:'#cfe4ee',transparent:true,opacity:.28,roughness:.05,metalness:.1,depthWrite:false}),MAT=new THREE.MeshStandardMaterial({roughness:.7,flatShading:true}),LIGHT=new THREE.MeshStandardMaterial({color:'#fff8e8',emissive:'#fff1d6',emissiveIntensity:1.1});
// (light: el material de lo que brilla)
export function partsMesh(list,{cast=true,light=LIGHT}={}){const g=new THREE.Group(),o=new THREE.Object3D(),c=new THREE.Color();let tris=0;
 for(const [geo,mat,L] of [[BOX_G,GLASS,list.filter(b=>b.vidrio)],[BOX_G,MAT,list.filter(b=>!b.luz&&!b.cyl&&!b.vidrio)],[CYL_G,MAT,list.filter(b=>!b.luz&&b.cyl)],[BOX_G,light,list.filter(b=>b.luz&&!b.cyl)],[CYL_G,light,list.filter(b=>b.luz&&b.cyl)]]){if(!L.length)continue;
  const m=new THREE.InstancedMesh(geo,mat,L.length);
  L.forEach((b,i)=>{o.position.set(b.x,b.y,b.z);o.rotation.set(b.rx||0,b.ry||0,b.rz||0,'YXZ');o.scale.set(b.sx,b.sy,b.sz);o.updateMatrix();m.setMatrixAt(i,o.matrix);if(mat===MAT)m.setColorAt(i,c.set(b.color||'#999'));});
  m.castShadow=cast;m.receiveShadow=true;g.add(m);tris+=L.length*(geo===CYL_G?40:12);}
 g.userData.tris=tris;return g;}

// Las piezas como cajas {x0,x1,y0,y1,z0,z1,color} (las casas armadas, vivienda.js): el objeto girado de a 90° y sin
// piezas inclinadas.
// Lo que estas cajas no saben girar se aproxima: un cilindro de canto (rx = ±90°: el reloj) es un octógono de dos cajas,
// y una pieza girada sobre z (las agujas) queda derecha o acostada, según hacia dónde apunte más.
const flat=b=>{if(b.cyl&&Math.abs(Math.abs(b.rx||0)-Math.PI/2)<.1){const d=b.sy,z0=b.rx>0?b.z:b.z-d;
  return [{...b,cyl:false,rx:0,y:b.y-b.sz*.36,sy:b.sz*.72,z:z0+d/2,sz:d},{...b,cyl:false,rx:0,sx:b.sx*.72,y:b.y-b.sz/2,sy:b.sz,z:z0+d/2,sz:d}];}
 if(b.rz){const up=Math.abs(Math.cos(b.rz))>.7;return [{...b,rz:0,...(up?{}:{sx:b.sy,sy:b.sx,x:b.x-Math.sin(b.rz)*b.sy/2,y:b.y-b.sx/2})}];}
 return [b];};
export function partsBoxes(parts,{x=0,y=0,z=0,ry=0}={}){const q=Math.round(ry/(Math.PI/2))&3,c=[1,0,-1,0][q],s=[0,1,0,-1][q];
 return parts.flatMap(flat).map(b=>{const cx=x+b.x*c+b.z*s,cz=z-b.x*s+b.z*c,sw=q%2?b.sz:b.sx,sd=q%2?b.sx:b.sz;return {x0:cx-sw/2,x1:cx+sw/2,y0:y+b.y,y1:y+b.y+b.sy,z0:cz-sd/2,z1:cz+sd/2,color:b.color};});}

// Un objeto del catálogo como un modelo de los paquetes ({parts:[{geometry, materials}], box, scale}): todas sus piezas
// en una geometría con colores por vértice (una llamada de dibujo). Así reemplaza a un modelo con el mismo nombre.
const KIT_MAT=new THREE.MeshStandardMaterial({vertexColors:true,roughness:.7,flatShading:true});
export function kitModel(id,o={}){const O=OBJETOS[id],ps=O.piezas({w:O.medida[0],d:O.medida[1],...o}),geos=[],m=new THREE.Matrix4(),q=new THREE.Quaternion(),e=new THREE.Euler(),c=new THREE.Color();
 // (lo redondo y chico —menos de 20 cm— con 6 lados: de lejos no se nota y pesa menos)
 for(const b of ps){const g=(b.cyl?new THREE.CylinderGeometry(.5,.5,1,Math.max(b.sx,b.sz)<.2?6:10):new THREE.BoxGeometry(1,1,1)).translate(0,.5,0).toNonIndexed();g.deleteAttribute('uv');
  m.compose(new THREE.Vector3(b.x,b.y,b.z),q.setFromEuler(e.set(b.rx||0,b.ry||0,b.rz||0,'YXZ')),new THREE.Vector3(b.sx,b.sy,b.sz));g.applyMatrix4(m);
  c.set(b.color||'#fff8e8');const n=g.attributes.position.count,col=new Float32Array(n*3);for(let i=0;i<n;i++){col[i*3]=c.r;col[i*3+1]=c.g;col[i*3+2]=c.b;}g.setAttribute('color',new THREE.BufferAttribute(col,3));geos.push(g);}
 const geometry=mergeGeometries(geos);geometry.computeBoundingBox();
 return {parts:[{geometry,materials:KIT_MAT}],box:geometry.boundingBox.clone(),scale:1,catalogo:id};}
// Los modelos del paquete que reemplaza el catálogo: modelo → id.
// (modelo: un nombre, o {nombre: opciones} cuando el mismo objeto reemplaza a varios: la biblioteca con y sin libros)
export const REEMPLAZOS=Object.fromEntries(Object.entries(OBJETOS).filter(([,O])=>O.modelo).flatMap(([id,O])=>typeof O.modelo==='string'?[[O.modelo,[id,{}]]]:Object.entries(O.modelo).map(([n,o])=>[n,[id,o]])));

export function placeParts(parts,{x=0,y=0,z=0,ry=0}={},extra={}){const c=Math.cos(ry),s=Math.sin(ry);
 return parts.map(q=>({...q,...extra,x:x+q.x*c+q.z*s,y:y+q.y,z:z-q.x*s+q.z*c,ry:ry+(q.ry||0)}));}
