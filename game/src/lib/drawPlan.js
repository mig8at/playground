// Dibujo del plano por etapas (engine/blueprint.js): la ciudad entera hasta la etapa elegida y el plano de un piso.
import {nivelDe,bordesDe} from '../engine/duplex.js';
import {CELL,TYPES} from '../engine/blueprint.js';
import {City} from '../engine/index.js';
import {planHouse,FURN_SIZE,FLOOR0,FH} from '../engine/vivienda.js';
import {AWNINGS,RAISE} from '../engine/fachada.js';
import {ALTURA,CALLE} from '../engine/medidas.js';
import {COLOR} from '../engine/colores.js';
import {PAQUETES,textura} from './texturas2d.js';
import {DE_OBRA,modeloDeObra} from '../engine/entrega.js';
import {fachadaMedida,texturaDeMuro,PINTABLE,VANO,ejeDe} from '../engine/fachada-medida.js';
import {GRAFITI,lienzoDe} from '../engine/grafiti.js';
// (cada textura del 3D, con la que la dibuja en el 2D)
const TEX_2D={ladrillo:'ladrillo',ladrillo_pintado:'ladrillo',sillar:'sillar',estuco:'estuco',panel:'panel',hormigon:'hormigon',tablilla:'tabla'};
const K=City.K;
const css=name=>getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export const ROOM_LABEL={entrepiso:'Entrepiso',sala:'Sala',dormitorio:'Dormitorio',cocina:'Cocina',bano:'Baño',oficina:'Oficina',abierta:'Oficina abierta',reuniones:'Reuniones',
 cocineta:'Cocineta',habitacion:'Habitación',habitacion_h:'Habitación',enfermeria:'Enfermería',aula:'Aula',sala_prof:'Profesores',lectura:'Lectura',
 archivo:'Archivo',celda:'Celda',boveda:'Bóveda',local:'Local',recepcion:'Recepción',urgencias:'Urgencias',consultorio:'Consultorio',vestibulo:'Vestíbulo',
 garaje:'Garaje',deposito:'Depósito',sala_cocina:'Sala y cocineta',estudio:'Estudio',dormitorio_b:'Dormitorio',hall:'Hall',ropas:'Zona de ropas',
 entrada:'Entrada',secretaria:'Secretaría',comedor:'Comedor',sanitario:'Sanitario',interrogatorio:'Interrogatorio',prestamo:'Préstamo',estanteria:'Estantería',infantil:'Sala infantil'};
// Colores del plano (claros también en modo oscuro: es un plano impreso, como el del juego).
// EL PLANO TÉCNICO (2026-11-22, Miguel: «enfocarnos en la generación exacta de espacios, tanto a nivel cenital, que es el
// mapa, como a nivel frontal con las fachadas, antes de pensar en cargar el inmobiliario y aplicar texturas»): los muros
// en negro, la ventana como muro abierto con una raya fina y, en cada cuarto, su medida de eje a eje; lo que no cae en
// metro entero va en rojo (TECNICO.fuera). Los cuartos conservan su color por tipo (ROOM_COLOR): «en el plano 2D sí
// podés usar colores para identificar áreas —comercial, habitación, baño, sala, cocina—; donde no los quiero es en el 3D».
export const TECNICO={cuarto:'#ffffff',paso:'#f1f1ef',nucleo:'#dcdcd8',muro:'#1f2224',fuera:'#d0412f',cota:'#4a4f55'};
const entero=v=>Math.abs(v-Math.round(v))<1e-6,mm=v=>(Math.round(v*100)/100).toLocaleString('es-CO');
const ROOM_COLOR={entrepiso:'#ece4f1',hall:'#efe9df',ropas:'#e2eef0',sala:'#f3e6cf',dormitorio:'#e8e0f0',cocina:'#f6eccd',bano:'#d9ecf2',oficina:'#dfe9f2',abierta:'#e3edf5',reuniones:'#e9e4f2',cocineta:'#f6eccd',
 habitacion:'#ede3ef',habitacion_h:'#f7e4e4',enfermeria:'#f7e9e9',aula:'#f1edcf',sala_prof:'#ece7d2',lectura:'#ece4d4',archivo:'#e4ddcf',celda:'#d6dde6',
 boveda:'#f2e3a6',local:'#f6ddd0',recepcion:'#e2ecf3',urgencias:'#f8dcdc',consultorio:'#f5e6e6',vestibulo:'#efede6',garaje:'#e2e2e2',deposito:'#e6dfd2',sala_cocina:'#f3e6cf',estudio:'#efe2d6',dormitorio_b:'#e8e0f0',
 entrada:'#efe9df',secretaria:'#e2ecf3',comedor:'#f4e7cc',sanitario:'#d9ecf2',interrogatorio:'#d9dbe2',prestamo:'#ece4d4',estanteria:'#e6dcc6',infantil:'#f6e6ee'};
// Las calles y los patios, también claros en modo oscuro (los del tema cambian).
// (2026-11-22, Miguel: «color coherente desde el motor 2D hasta el 3D»: el suelo, con los colores del motor —engine/colores.js—,
// los mismos del 3D)
const PAPER={asfalto:COLOR.suelo.asfalto,cordon:'rgba(60,58,52,.6)',street:COLOR.suelo.anden,avenue:COLOR.suelo.anden,alley:COLOR.suelo.concreto,courtyard:COLOR.suelo.patio,border:'#7f877f',kiosk:COLOR.suelo.pasto};
const USE_COLOR={edificios:'#d3d8cf',parque:'#cfe2c8',plaza:'#e2eedd',patio:'#ece6d3',comisaria:'#b9cfe6'};
const ITEM_COLOR={sofa:'#b88b6a',cama:'#9c86b8',cama_s:'#9c86b8',litera:'#7a5a3a',cama_h:'#ffffff',catre:'#8a8f96',camilla:'#ffffff',armario:'#8b6a4e',estante:'#8b6a4e',archivador:'#7d8790',casillero:'#4f7fa8',caminadora:'#3a3e43',bicicleta:'#3a3e43',banco:'#24262a',mancuernas:'#5d6266',colchoneta:'#2f6f8f',espejo_pared:'#cfe3ea',perchero:'#8d969d',maniqui:'#e9e4dc',estanteria_ropa:'#c39a6b',probador:'#8a3b4a',
 escritorio:'#a7825f',pupitre:'#a7825f',mesa:'#b0906c',mesa_centro:'#b0906c',mesa_reunion:'#9a7b5b',mesa_lectura:'#a7825f',mostrador:'#8d7360',meson:'#c9c3b8',
 nevera:'#e8eef2',estufa:'#4b4f53',inodoro:'#ffffff',lavamanos:'#ffffff',ducha:'#bfe0ec',tv:'#2f3437',planta:'#7fae74',silla:'#5d6670',mesa_noche:'#8b6a4e',
 tablero:'#3f5a46',vehiculo:'#c0392b',
 // (2026-11-19: diez muebles del plano no tenían color y salían todos del mismo gris)
 sillon:'#c29a7a',lampara:'#e8c860',cajon:'#a98a62',tina:'#cfe6ee',comoda:'#8b6a4e',horno:'#5a5f63',lavadora:'#eef1f3',plancha:'#6b7076',repisa:'#9a7b5b',vitrina:'#bfd6dc',
 probador:'#b7a9c9',estanteria_ropa:'#a48d74',perchero:'#7c6a58',maniqui:'#d9c8b4',caja:'#b98a4f',buzones:'#9aa3a8',caja_fuerte:'#5d6266'};

// El contorno de un edificio de una o más partes (rectángulos en metros): cada borde menos lo que comparte con otra
// parte (la unión de las dos alas de una L no es pared de afuera).
function outline(g,parts,X,Y){g.beginPath();
 for(const [i,P] of parts.entries()){const edges=[[P.x,P.y,P.x+P.w,P.y,'h'],[P.x,P.y+P.h,P.x+P.w,P.y+P.h,'h'],[P.x,P.y,P.x,P.y+P.h,'v'],[P.x+P.w,P.y,P.x+P.w,P.y+P.h,'v']];
  for(const [x0,y0,x1,y1,o] of edges){let segs=[[o==='h'?x0:y0,o==='h'?x1:y1]];
   for(const [j,Q] of parts.entries()){if(i===j)continue;const qs=o==='h'?[[Q.y,Q.x,Q.x+Q.w],[Q.y+Q.h,Q.x,Q.x+Q.w]]:[[Q.x,Q.y,Q.y+Q.h],[Q.x+Q.w,Q.y,Q.y+Q.h]];
    for(const [at,a,b] of qs){if(Math.abs(at-(o==='h'?y0:x0))>1e-6)continue;segs=segs.flatMap(([s0,s1])=>{const c0=Math.max(s0,a),c1=Math.min(s1,b);if(c1<=c0)return [[s0,s1]];return [[s0,c0],[c1,s1]].filter(([p,q])=>q-p>1e-6);});}}
   for(const [s0,s1] of segs){if(o==='h'){g.moveTo(X(s0),Y(y0));g.lineTo(X(s1),Y(y0));}else{g.moveTo(X(x0),Y(s0));g.lineTo(X(x0),Y(s1));}}}}
 g.stroke();}

// ---------- La ciudad hasta la etapa elegida ----------
// fronts: la raya en el frente de cada lote (el minimapa del demo la apaga: a esa escala ensucia).
// (sobre: {g, x, y} dibuja la ciudad en un contexto ajeno, corrida a ese punto en píxeles del dispositivo, en vez de en su
// propio lienzo: lo usa la región del visor —abajo, drawIslaStage—, donde un lienzo de la ciudad entera no cabría)
export function drawCityStage(canvas,bp,{cell,stage,level=0,selected=-1,fronts=true,sobre=null,paquete='liso'}){
 const PQ=PAQUETES[paquete]||PAQUETES.liso;
 const {map}=bp,{W,H,kind}=map,dpr=window.devicePixelRatio||1,m=cell/CELL;// px por metro
 if(!sobre){canvas.width=Math.round(W*cell*dpr);canvas.height=Math.round(H*cell*dpr);}
 const g=sobre?sobre.g:canvas.getContext('2d');g.setTransform(dpr,0,0,dpr,sobre?.x||0,sobre?.y||0);
 // Etapa 1: el terreno con su rejilla de casillas.
 g.fillStyle=PAPER.courtyard;g.fillRect(0,0,W*cell,H*cell);
 if(stage===1){g.strokeStyle='rgba(0,0,0,.08)';g.lineWidth=1;g.beginPath();for(let x=0;x<=W;x++){g.moveTo(x*cell,0);g.lineTo(x*cell,H*cell);}for(let y=0;y<=H;y++){g.moveTo(0,y*cell);g.lineTo(W*cell,y*cell);}g.stroke();
  g.strokeStyle=PAPER.border;g.lineWidth=2;g.strokeRect(1,1,W*cell-2,H*cell-2);return;}
 // Etapa 2: calles y manzanas con su uso.
 const street={[K.street]:PAPER.street,[K.avenue]:PAPER.avenue,[K.alley]:PAPER.alley,[K.border]:PAPER.border};
 for(let y=0;y<H;y++)for(let x=0;x<W;x++){const k=kind[y*W+x];g.fillStyle=street[k]||(k===K.kiosk?PAPER.avenue:'#d3d8cf');g.fillRect(x*cell,y*cell,cell+.5,cell+.5);}
 for(const b of bp.blocks){g.fillStyle=USE_COLOR[b.use];g.fillRect(b.x0*cell,b.y0*cell,b.w*cell,b.h*cell);
  // (el piso de cada espacio abierto: matas de pasto en el parque —siempre en el mismo lugar: salen de la casilla— y las
  // juntas de las losas de 2 m en la plaza)
  if(m>=2&&b.use==='parque'){g.fillStyle='rgba(70,120,60,.22)';for(let y=b.y0;y<=b.y1;y++)for(let x=b.x0;x<=b.x1;x++)for(let k=0;k<5;k++){const h1=Math.sin((x*73+y*151+k*37)*12.9898)*43758.5453,h2=Math.sin((x*29+y*83+k*61)*78.233)*12543.31,u=h1-Math.floor(h1),v=h2-Math.floor(h2);
     g.beginPath();g.ellipse((x+u)*cell,(y+v)*cell,Math.max(1,m*.45),Math.max(.8,m*.28),u*3,0,7);g.fill();}}
  if(m>=3&&b.use==='plaza'){g.strokeStyle='rgba(120,100,70,.16)';g.lineWidth=1;g.beginPath();for(let u=0;u<=b.w*CELL;u+=2){g.moveTo(b.x0*cell+u*m,b.y0*cell);g.lineTo(b.x0*cell+u*m,(b.y0+b.h)*cell);}for(let v=0;v<=b.h*CELL;v+=2){g.moveTo(b.x0*cell,b.y0*cell+v*m);g.lineTo((b.x0+b.w)*cell,b.y0*cell+v*m);}g.stroke();}
  if(b.use==='plaza'||b.use==='parque'){for(let y=b.y0;y<=b.y1;y++)for(let x=b.x0;x<=b.x1;x++)if(kind[y*W+x]===K.kiosk){g.fillStyle=PAPER.kiosk;g.beginPath();g.arc((x+.5)*cell,(y+.5)*cell,cell*.32,0,7);g.fill();}}
  if(stage>=3)for(let y=b.y0;y<=b.y1;y++)for(let x=b.x0;x<=b.x1;x++)if(kind[y*W+x]===K.alley){g.fillStyle=PAPER.alley;g.fillRect(x*cell,y*cell,cell+.5,cell+.5);}}
 // LA CALZADA Y LA VEREDA (2026-11-21): la calle era una sola franja clara. Con las medidas de CALLE —vereda de 3 m a cada
 // lado, carriles de 3— se pinta el asfalto en gris y, contra cada manzana, la vereda con su cordón; en las esquinas, el
 // cuadro de vereda que las une. Así la pintura de vías (cebras, líneas de carril) cae sobre asfalto, como en la calle.
 if(stage>=3&&m>=1.2){const via=(x,y)=>x>=0&&y>=0&&x<W&&y<H&&(kind[y*W+x]===K.street||kind[y*W+x]===K.avenue),v=CALLE.vereda*m,cordon=Math.max(.6,Math.min(1.6,m*.12));
  g.fillStyle=PAPER.asfalto;for(let y=0;y<H;y++)for(let x=0;x<W;x++)if(via(x,y))g.fillRect(x*cell,y*cell,cell+.5,cell+.5);
  const esquinas=[];
  g.fillStyle=PAPER.street;g.strokeStyle=PAPER.cordon;g.lineWidth=cordon;g.beginPath();
  for(let y=0;y<H;y++)for(let x=0;x<W;x++){if(!via(x,y))continue;const X0=x*cell,Y0=y*cell,n=!via(x,y-1),s2=!via(x,y+1),w=!via(x-1,y),e=!via(x+1,y);
   if(n){g.fillRect(X0,Y0,cell+.5,v);g.moveTo(X0+(w?v:0),Y0+v);g.lineTo(X0+cell-(e?v:0),Y0+v);}
   if(s2){g.fillRect(X0,Y0+cell-v,cell+.5,v+.5);g.moveTo(X0+(w?v:0),Y0+cell-v);g.lineTo(X0+cell-(e?v:0),Y0+cell-v);}
   if(w){g.fillRect(X0,Y0,v,cell+.5);g.moveTo(X0+v,Y0+(n?v:0));g.lineTo(X0+v,Y0+cell-(s2?v:0));}
   if(e){g.fillRect(X0+cell-v,Y0,v+.5,cell+.5);g.moveTo(X0+cell-v,Y0+(n?v:0));g.lineTo(X0+cell-v,Y0+cell-(s2?v:0));}
   // (la esquina de una manzana que toca esta casilla sólo en diagonal: su cuadro de vereda, con el cordón en L)
   // (2026-11-21: redondeada, como el cordón de una esquina de verdad —un cuarto de círculo del radio de la vereda con el
   // centro en la esquina de la manzana—; antes era un cuadro, y todas las esquinas se veían en ángulo recto)
   for(const [dx,dy] of [[-1,-1],[1,-1],[-1,1],[1,1]]){if(via(x+dx,y+dy)||!via(x+dx,y)||!via(x,y+dy))continue;esquinas.push([dx<0?X0:X0+cell,dy<0?Y0:Y0+cell,dx,dy]);}}
  g.stroke();
  for(const [cx,cy,dx,dy] of esquinas){const a0=dx<0?(dy<0?0:-Math.PI/2):(dy<0?Math.PI/2:Math.PI);g.beginPath();g.moveTo(cx,cy);g.arc(cx,cy,v,a0,a0+Math.PI/2);g.closePath();g.fill();g.beginPath();g.arc(cx,cy,v,a0,a0+Math.PI/2);g.stroke();}}
 if(stage===2){g.strokeStyle='rgba(0,0,0,.25)';g.lineWidth=1;for(const b of bp.blocks)g.strokeRect(b.x0*cell+.5,b.y0*cell+.5,b.w*cell-1,b.h*cell-1);return;}
 // Etapa 3: lotes por tipo; patios de manzana.
 for(const c of bp.courts){g.fillStyle=PAPER.courtyard;g.fillRect(c.x0*cell,c.y0*cell,(c.x1-c.x0+1)*cell,(c.y1-c.y0+1)*cell);}
 // (la sombra de cada edificio, corrida hacia abajo a la derecha según sus pisos —hasta 5 m—: da el relieve de la ciudad sin
 // el 3D; en el piso que se mira, sólo los que llegan hasta ahí)
 if(m>=1.2){g.fillStyle='rgba(38,42,54,.17)';for(const L of bp.lots){const d=Math.min(5,(level>=L.floors?L.floors:L.floors-level)*ALTURA.piso*.3)*m;// (visto desde arriba de su techo, la sombra entera)
  for(const P of L.parts)g.fillRect(P.x*m+d,P.y*m+d,P.w*m,P.h*m);}}
 for(const L of bp.lots){g.fillStyle=TYPES[L.type].color;for(const P of L.parts)g.fillRect(P.x*m,P.y*m,P.w*m,P.h*m);}
 // Etapas 5–8: el piso elegido de cada edificio, en chico.
 if(stage>=5)for(const L of bp.lots){const lv=L.levels[Math.min(level,L.levels.length-1)];if(level>=L.floors)continue;drawLevel(g,lv,{m,stage,small:m<10,labels:m>=16});}
 for(const L of bp.lots){g.strokeStyle=L.id===selected?'#c0392b':'rgba(40,46,50,.55)';g.lineWidth=L.id===selected?2.5:1;outline(g,L.parts,v=>v*m,v=>v*m);
  // EL TECHO (2026-11-21): por encima de su último piso un edificio era un velo blanco. Ahora es su techo: la losa del
  // color que decide el plano, el pretil alrededor y, si es mansarda, sus faldones de pizarra con la cumbrera; lo de la
  // azotea (tanques, antenas, materas) lo pone encima drawExterior.
  if(level>=L.floors&&stage>=5){const C=L.colores||{},manz=L.fachada?.techo==='mansarda',base=manz?(C.techo||'#4b5560'):'#cfcbc2',pret=Math.max(1,.35*m);
   for(const P of L.parts){const x=P.x*m,y=P.y*m,w=P.w*m,h=P.h*m;g.fillStyle=C.moldura||'#e9e6de';g.fillRect(x,y,w,h);g.fillStyle=base;g.fillRect(x+pret,y+pret,w-2*pret,h-2*pret);
    // (la textura del techo, según el paquete: la losa en los planos y la pizarra, la teja o el zinc en las mansardas)
    {const tx=manz?PQ.mansarda:PQ.losa;if(tx){g.beginPath();g.rect(x+pret,y+pret,w-2*pret,h-2*pret);textura(g,tx,m,x,y);}}
    if(manz&&m>=1.5){const f=Math.min(w,h)*.22;g.fillStyle='rgba(255,255,255,.14)';g.fillRect(x+pret+f,y+pret+f,w-2*(pret+f),h-2*(pret+f));g.strokeStyle='rgba(0,0,0,.28)';g.lineWidth=Math.max(.6,m*.06);g.beginPath();
     for(const [cx,cy] of [[x+pret,y+pret],[x+w-pret,y+pret],[x+pret,y+h-pret],[x+w-pret,y+h-pret]]){g.moveTo(cx,cy);g.lineTo(cx<x+w/2?cx+f:cx-f,cy<y+h/2?cy+f:cy-f);}g.strokeRect(x+pret+f,y+pret+f,w-2*(pret+f),h-2*(pret+f));g.stroke();}
    else if(m>=3){g.strokeStyle='rgba(0,0,0,.07)';g.lineWidth=1;g.beginPath();for(let u=2;u<P.w;u+=2){g.moveTo(x+u*m,y+pret);g.lineTo(x+u*m,y+h-pret);}g.stroke();}}}
  // (el nombre de cada edificio, a media distancia —de cerca ya se leen sus cuartos—, con un halo para que se lea)
  if(stage>=5&&m>=2.2&&m<11){const t=L.shopName||L.name,r=L.rect,fs=Math.max(9,Math.min(13,m*2.2));if(t&&r.w*m>fs*t.length*.42){g.font=`600 ${fs}px system-ui,sans-serif`;g.textAlign='center';g.textBaseline='middle';
    const cx=(r.x+r.w/2)*m,cy=(r.y+r.h/2)*m;g.lineWidth=3;g.strokeStyle='rgba(255,255,255,.85)';g.strokeText(t,cx,cy);g.fillStyle='rgba(30,34,40,.9)';g.fillText(t,cx,cy);}}
  // Etapa 4: los pisos de cada uno.
  if(stage>=4&&cell>=14){g.fillStyle='rgba(30,34,36,.75)';g.font=`600 ${Math.max(9,Math.min(12,cell*.42))}px ui-monospace,monospace`;g.textAlign='center';g.textBaseline='middle';
   if(stage===4)g.fillText(L.floors,(L.rect.x+L.rect.w/2)*m,(L.rect.y+L.rect.h/2)*m);}
  // El frente: una raya en el lado que da a la calle.
  if(fronts&&stage>=3&&stage<5){const r=L.rect,f=L.front;g.strokeStyle='rgba(30,34,36,.6)';g.lineWidth=2.5;g.beginPath();
   if(f==='N'){g.moveTo(r.x*m+3,r.y*m+2);g.lineTo((r.x+r.w)*m-3,r.y*m+2);}if(f==='S'){g.moveTo(r.x*m+3,(r.y+r.h)*m-2);g.lineTo((r.x+r.w)*m-3,(r.y+r.h)*m-2);}
   if(f==='W'){g.moveTo(r.x*m+2,r.y*m+3);g.lineTo(r.x*m+2,(r.y+r.h)*m-3);}if(f==='E'){g.moveTo((r.x+r.w)*m-2,r.y*m+3);g.lineTo((r.x+r.w)*m-2,(r.y+r.h)*m-3);}g.stroke();}}
}

// ---------- Un piso ----------
function drawLevel(g,lv,{m,stage,small=false,ox=0,oy=0,labels=false}){
 const X=v=>(v-ox)*m,Y=v=>(v-oy)*m,R=(q,f)=>f(X(q.x),Y(q.y),q.w*m,q.h*m);
 // Núcleo (5) y pasillo.
 // (el ensanche: el tramo ciego CORTO de un piso de departamentos —el largo lleva ropas y trasteros desde el 2026-11-20—, que por decisión de diseño es más pasillo y no cuartos —el 3D
 // lo decora con cuadros y floreros—; va en otro tono y con su nombre, para que no se lea como un pasillo que sobra)
 for(const c of lv.corridor){g.fillStyle=c.ensanche?'#ebe4d3':TECNICO.paso;R(c,(a,b,w,h)=>g.fillRect(a,b,w,h));
  if(c.ensanche&&!small){g.save();g.strokeStyle='rgba(120,100,70,.35)';g.lineWidth=1;g.setLineDash([5,4]);R(c,(a,b,w,h)=>g.strokeRect(a+3,b+3,w-6,h-6));g.restore();
   if(labels&&c.w*m>=70){g.font='600 11px system-ui,sans-serif';g.textAlign='center';g.textBaseline='middle';g.fillStyle='rgba(90,76,52,.85)';g.fillText('Ensanche del pasillo',X(c.x+c.w/2),Y(c.y+c.h/2));}}}
 // (un piso puede no tener núcleo —un local de una planta sin escalera—: se dibuja sin él; antes el plano entero se caía)
 const core=lv.core;if(core){g.fillStyle=TECNICO.nucleo;R(core,(a,b,w,h)=>g.fillRect(a,b,w,h));}
 if(!small){g.strokeStyle='#8b877f';g.lineWidth=1;// escalera en U: dos carriles con sus peldaños, el descanso al fondo y la pared al medio; ascensor: una X
  const st=lv.stair;if(st){const Pt=(a,b)=>[X(st.x+st.ux*a+st.vx*b),Y(st.z+st.uz*a+st.vz*b)],FR=st.fr,BK=st.bk,run=st.d-FR-BK,W=st.w||2,HW=W/2;g.beginPath();
   const N=st.steps||Math.max(8,Math.round(run/.25));for(let k=0;k<=N;k++){const b=FR+run*k/N;for(const [a0,a1] of [[0,HW],[HW,W]]){const [x0,y0]=Pt(a0,b),[x1,y1]=Pt(a1,b);g.moveTo(x0,y0);g.lineTo(x1,y1);}}
   const [cx0,cy0]=Pt(HW,FR),[cx1,cy1]=Pt(HW,FR+run);g.moveTo(cx0,cy0);g.lineTo(cx1,cy1);g.stroke();
   // flechas: sube por el carril A hacia el fondo y vuelve por el B
   g.strokeStyle='#5d5a54';g.beginPath();const [a0x,a0y]=Pt(HW/2,FR+.2),[a1x,a1y]=Pt(HW/2,FR+run+BK/2),[b1x,b1y]=Pt(W-HW/2,FR+run+BK/2),[b0x,b0y]=Pt(W-HW/2,FR+.2);g.moveTo(a0x,a0y);g.lineTo(a1x,a1y);g.lineTo(b1x,b1y);g.lineTo(b0x,b0y);g.stroke();}
  const L=lv.liftRect;if(L){g.strokeStyle='#8b877f';g.strokeRect(X(L.x+.2),Y(L.y+.2),(L.w-.4)*m,(L.h-.4)*m);g.beginPath();g.moveTo(X(L.x+.2),Y(L.y+.2));g.lineTo(X(L.x+L.w-.2),Y(L.y+L.h-.2));g.moveTo(X(L.x+L.w-.2),Y(L.y+.2));g.lineTo(X(L.x+.2),Y(L.y+L.h-.2));g.stroke();}}
 if(stage<6){if(core){g.strokeStyle='#5d5a54';g.lineWidth=small?.8:1.5;R(core,(a,b,w,h)=>g.strokeRect(a,b,w,h));}return;}
 // Cuartos (6).
 for(const q of lv.rooms){g.fillStyle=ROOM_COLOR[q.type]||TECNICO.cuarto;R(q,(a,b,w,h)=>g.fillRect(a,b,w,h));}
 g.strokeStyle=TECNICO.muro;g.lineWidth=small?.7:2;for(const q of core?[...lv.rooms,core]:lv.rooms)R(q,(a,b,w,h)=>g.strokeRect(a,b,w,h));
 // Cada departamento, con su contorno más grueso (la pared que lo separa del vecino y del pasillo).
 // (un penthouse en L —engine/duplex.js, u.partes—: su contorno es el de la L, no el del rectángulo que la encierra)
 if(lv.units?.length){g.strokeStyle='#1f2224';g.lineWidth=small?1.3:4;for(const u of lv.units){if(u.partes){g.beginPath();for(const b of bordesDe(u.partes)){if(b.h){g.moveTo(X(b.a0),Y(b.fija));g.lineTo(X(b.a1),Y(b.fija));}else{g.moveTo(X(b.fija),Y(b.a0));g.lineTo(X(b.fija),Y(b.a1));}}g.stroke();}else R(u,(a,b,w,h)=>g.strokeRect(a,b,w,h));}}
 // LA ESCALERA DEL DÚPLEX (2026-11-22, engine/duplex.js): abajo, en la sala, la recta con sus peldaños y una flecha que
 // sube; arriba, el hueco por donde llega, rayado, con su baranda (una raya doble, oscura).
 for(const e of [...(lv.escalerasInternas||[]),...(lv.huecos||[])]){const arriba=!!lv.mansarda;g.save();g.fillStyle=arriba?'rgba(60,64,70,.18)':'#f1ede4';R(e,(a,b,w,h)=>g.fillRect(a,b,w,h));g.strokeStyle='#3a3d40';g.lineWidth=small?.6:1.2;R(e,(a,b,w,h)=>g.strokeRect(a,b,w,h));
  {const n=e.peldanos||15,h=e.eje==='x';g.beginPath();for(let k=1;k<n;k++){const t=k/n;if(h){g.moveTo(X(e.x+e.w*t),Y(e.y));g.lineTo(X(e.x+e.w*t),Y(e.y+e.h));}else{g.moveTo(X(e.x),Y(e.y+e.h*t));g.lineTo(X(e.x+e.w),Y(e.y+e.h*t));}}g.stroke();
   if(!small&&e.pie&&e.llegada){g.strokeStyle=arriba?'#5d5a54':'#c0392b';g.lineWidth=1.6;g.beginPath();g.moveTo(X(e.pie[0]),Y(e.pie[1]));g.lineTo(X(e.llegada[0]),Y(e.llegada[1]));g.stroke();
    const ang=Math.atan2(Y(e.llegada[1])-Y(e.pie[1]),X(e.llegada[0])-X(e.pie[0])),hx=X(e.llegada[0]),hy=Y(e.llegada[1]);g.beginPath();g.moveTo(hx,hy);g.lineTo(hx-8*Math.cos(ang-.5),hy-8*Math.sin(ang-.5));g.moveTo(hx,hy);g.lineTo(hx-8*Math.cos(ang+.5),hy-8*Math.sin(ang+.5));g.stroke();}}
  if(arriba){g.save();g.beginPath();R(e,(a,b,w,h)=>g.rect(a,b,w,h));g.clip();g.strokeStyle='rgba(60,64,70,.35)';g.lineWidth=1;g.beginPath();for(let d=-e.h*m;d<e.w*m;d+=6){g.moveTo(X(e.x)+d,Y(e.y));g.lineTo(X(e.x)+d+e.h*m,Y(e.y+e.h));}g.stroke();g.restore();}
  g.restore();}
 // (la sala a doble altura, arriba: su vacío, rayado más suave, con su nombre)
 for(const v of lv.vacios||[]){g.save();g.fillStyle='rgba(120,150,180,.16)';R(v,(a,b,w,h)=>g.fillRect(a,b,w,h));g.beginPath();R(v,(a,b,w,h)=>g.rect(a,b,w,h));g.clip();g.strokeStyle='rgba(90,120,150,.3)';g.lineWidth=1;g.beginPath();for(let d=-v.h*m;d<v.w*m;d+=10){g.moveTo(X(v.x)+d+v.h*m,Y(v.y));g.lineTo(X(v.x)+d,Y(v.y+v.h));}g.stroke();g.restore();
  if(!small){g.fillStyle='#4a5a6a';g.font='600 11px system-ui,sans-serif';g.textAlign='center';g.fillText('Doble altura',X(v.x+v.w/2),Y(v.y+v.h/2));}}
 for(const b of lv.barandas||[]){g.strokeStyle='#2a2d30';g.lineWidth=small?1:3;g.beginPath();g.moveTo(X(b.x0),Y(b.y0));g.lineTo(X(b.x1),Y(b.y1));g.stroke();g.strokeStyle='#f4f2ec';g.lineWidth=small?.3:1;g.stroke();}
 // Puertas y ventanas (7): la puerta corta la pared; la ventana es una doble raya celeste.
 if(stage>=7){for(const d of lv.doors){g.strokeStyle=d.street?'#f4f2ec':'#f4f2ec';g.lineWidth=small?1.4:4;g.beginPath();g.moveTo(X(d.x0),Y(d.y0));g.lineTo(X(d.x1),Y(d.y1));g.stroke();
    // La hoja: gira desde una jamba hacia adentro del cuarto (un cuarto de círculo).
   if(!small&&!d.core&&!d.wide){const room=lv.rooms.find(q=>q.id===d.a)||lv.rooms.find(q=>q.id===d.b);if(room){
    const len=Math.hypot(d.x1-d.x0,d.y1-d.y0),ux=(d.x1-d.x0)/len,uy=(d.y1-d.y0)/len,cx=room.x+room.w/2,cy=room.y+room.h/2;
    let nx=-uy,ny=ux;if((cx-d.x0)*nx+(cy-d.y0)*ny<0){nx=-nx;ny=-ny;}
    g.strokeStyle=d.street?'#c0392b':'#7d7972';g.lineWidth=1.2;g.beginPath();g.moveTo(X(d.x0),Y(d.y0));g.lineTo(X(d.x0+nx*len),Y(d.y0+ny*len));
    const a0=Math.atan2(ny,nx),a1=Math.atan2(uy,ux);let da=a1-a0;da=Math.atan2(Math.sin(da),Math.cos(da));g.arc(X(d.x0),Y(d.y0),len*m,a0,a0+da,da<0);g.stroke();}}}
  // (la ventana, como en un plano de arquitectura: el muro abierto y una raya fina al medio)
  for(const w of lv.windows){g.strokeStyle=TECNICO.cuarto;g.lineWidth=small?1.2:3.5;g.beginPath();g.moveTo(X(w.x0),Y(w.y0));g.lineTo(X(w.x1),Y(w.y1));g.stroke();
   g.strokeStyle=TECNICO.muro;g.lineWidth=small?.6:1;g.beginPath();g.moveTo(X(w.x0),Y(w.y0));g.lineTo(X(w.x1),Y(w.y1));g.stroke();}}
 // Muebles (8): cada uno con su forma y mirando hacia donde mira (drawItem); muy de lejos, su caja de color.
 if(stage>=8)for(const f of lv.furniture){if(m>=4)drawItem(g,f,X,Y,m);else{g.fillStyle=ITEM_COLOR[f.kind]||'#999';R(f,(a,b,w,h)=>g.fillRect(a,b,w,h));}}
 if(labels&&stage>=6){g.font='600 11px system-ui,sans-serif';g.textAlign='center';g.textBaseline='middle';
  // (el nombre y, debajo, la medida de eje a eje: ancho × fondo; en rojo si no cae en metro entero)
  for(const q of lv.rooms){if(q.w*m<34)continue;const t=ROOM_LABEL[q.type]||q.type,cx=X(q.x+q.w/2),cy=Y(q.y+q.h/2)-(stage>=8&&lv.furniture.length?q.h*m/2-9:0);g.font='600 11px system-ui,sans-serif';g.fillStyle='rgba(40,44,48,.85)';g.fillText(t,cx,cy-(q.h*m>=34?6:0));
   if(q.h*m>=34){const mal=!entero(q.w)||!entero(q.h);g.font='500 10px ui-monospace,monospace';g.fillStyle=mal?TECNICO.fuera:'rgba(40,44,48,.6)';g.fillText(`${mm(q.w)} × ${mm(q.h)}`,cx,cy+7);}}
  // El número de cada departamento, sobre su sala (o su estudio).
  g.font='700 11px ui-monospace,monospace';for(const u of lv.units||[]){const s=lv.rooms.find(q=>q.unit===u.n&&(q.type==='sala'||q.type==='sala_cocina'||q.type==='estudio'));if(!s)continue;
   const t='Apto '+u.n,tw=g.measureText(t).width+10,cx=X(s.x+s.w/2),cy=Y(s.y+s.h/2)+(stage>=8?s.h*m/2-12:14);g.fillStyle='rgba(31,34,36,.82)';g.fillRect(cx-tw/2,cy-8,tw,16);g.fillStyle='#fff';g.fillText(t,cx,cy);}}
}

// El plano grande de un piso del edificio L (centrado en el canvas, con escala en metros).
// El marco del plano de un piso: cuántos píxeles mide un metro y dónde cae el origen. Lo usan drawFloorPlan y quien
// necesite pasar de un clic a metros (colocar objetos: PlanoView).
export const PAD_PISO=48;// (px alrededor del plano de un piso: el nombre de cada lado y sus cotas)
export const marcoPiso=(L,width)=>{const pad=PAD_PISO,r=L.rect,m=Math.min(42,(width-2*pad)/r.w);return {m,ox:r.x-(width/m-r.w)/2,oy:r.y-pad/m};};
// Lo colocado a mano sobre el plano de un piso (engine/colocar.js), encima de lo que dibujó drawFloorPlan, y el
// «fantasma» —dónde quedaría lo que se está por poner: verde si se puede, rojo si no—.
export function drawColocados(canvas,L,lista,fantasma,OBJETOS,{width}){const {m,ox,oy}=marcoPiso(L,width),g=canvas.getContext('2d'),X=v=>(v-ox)*m,Y=v=>(v-oy)*m;
 const uno=(o,fant)=>{const O=OBJETOS[o.tipo];if(!O||!o.rect)return;g.save();if(fant)g.globalAlpha=.75;
  if(o.modo==='pared'){const R=o.rect,grueso=Math.max(4,.09*m),horiz=R.w>R.h,adentro=o.lado==='N'||o.lado==='W'?1:-1;
   // (colgado: una barra del color del objeto pegada a la pared, del lado de adentro, con su marco)
   g.fillStyle=O.color||'#8b6a4e';const x=horiz?X(R.x):(adentro>0?X(R.x):X(R.x+R.w)-grueso),y=horiz?(adentro>0?Y(R.y):Y(R.y+R.h)-grueso):Y(R.y),w=horiz?R.w*m:grueso,h=horiz?grueso:R.h*m;
   g.fillRect(x,y,w,h);g.strokeStyle=fant?(o.ok?'#1f9d55':'#d0412f'):'rgba(0,0,0,.55)';g.lineWidth=fant?2.5:1;g.strokeRect(x,y,w,h);}
  else{g.translate(X(o.x),Y(o.z));g.rotate(o.giro||0);const girado=Math.abs(Math.sin(o.giro||0))>.5,w=(girado?o.d:o.w)*m,d=(girado?o.w:o.d)*m;glyph(g,O.mueble||'caja',w,d,m);
   if(fant){g.strokeStyle=o.ok?'#1f9d55':'#d0412f';g.lineWidth=2.5;g.strokeRect(-w/2-2,-d/2-2,w+4,d+4);}}
  g.restore();};
 for(const o of lista)uno(o,false);if(fantasma)uno(fantasma,true);}
export function drawFloorPlan(canvas,L,{level,stage,width}){
 const dpr=window.devicePixelRatio||1,pad=PAD_PISO,r=L.rect,m=Math.min(42,(width-2*pad)/r.w),hgt=r.h*m+2*pad;
 canvas.width=Math.round(width*dpr);canvas.height=Math.round(hgt*dpr);canvas.style.height=hgt+'px';
 const g=canvas.getContext('2d');g.setTransform(dpr,0,0,dpr,0,0);g.clearRect(0,0,width,hgt);
 const ox=r.x-(width/m-r.w)/2,oy=r.y-pad/m;
 g.fillStyle=TYPES[L.type].color;for(const P of L.parts)g.fillRect((P.x-ox)*m,(P.y-oy)*m,P.w*m,P.h*m);
 // Rejilla de 1 m, y la del módulo de 2 m más marcada.
 g.save();g.beginPath();for(const P of L.parts)g.rect((P.x-ox)*m,(P.y-oy)*m,P.w*m,P.h*m);g.clip();
 for(const [paso,a] of [[1,.05],[2,.09]]){g.strokeStyle=`rgba(0,0,0,${a})`;g.lineWidth=1;g.beginPath();for(let x=0;x<=r.w;x+=paso){g.moveTo((r.x+x-ox)*m,(r.y-oy)*m);g.lineTo((r.x+x-ox)*m,(r.y+r.h-oy)*m);}for(let y=0;y<=r.h;y+=paso){g.moveTo((r.x-ox)*m,(r.y+y-oy)*m);g.lineTo((r.x+r.w-ox)*m,(r.y+y-oy)*m);}g.stroke();}g.restore();
 // El contorno antes que el piso: así puertas y ventanas de la fachada quedan encima.
 g.strokeStyle='#1f2224';g.lineWidth=5;g.lineCap='square';outline(g,L.parts,v=>(v-ox)*m,v=>(v-oy)*m);g.lineCap='butt';
 const LV=nivelDe(L,level);
 if(stage>=5)drawLevel(g,LV,{m,stage,ox,oy,labels:true});
 // LAS COTAS de cada lado: dónde llega cada tabique a la fachada, con la medida de cada tramo; en rojo lo que no cae en
 // metro entero. (cada lado del rectángulo del lote; los puntos, los bordes de los cuartos y del núcleo que tocan ese lado)
 if(stage>=6){const lv=LV,qs=[...lv.rooms,...(lv.core?[lv.core]:[]),...lv.corridor],e=1e-6;g.font='500 10px ui-monospace,monospace';
  for(const [lado,horiz,fija,a0,a1,sal] of [['N',true,r.y,r.x,r.x+r.w,-1],['S',true,r.y+r.h,r.x,r.x+r.w,1],['W',false,r.x,r.y,r.y+r.h,-1],['E',false,r.x+r.w,r.y,r.y+r.h,1]]){
   const ps=new Set([a0,a1]);for(const q of qs){const toca=horiz?Math.abs(q.y-fija)<e||Math.abs(q.y+q.h-fija)<e:Math.abs(q.x-fija)<e||Math.abs(q.x+q.w-fija)<e;if(!toca)continue;for(const v of horiz?[q.x,q.x+q.w]:[q.y,q.y+q.h])if(v>a0-e&&v<a1+e)ps.add(+v.toFixed(3));}
   const L2=[...ps].sort((a,b)=>a-b);if(L2.length<3)continue;
   const d=(horiz?(fija-oy)*m:(fija-ox)*m)+sal*28,P=(u,o=0)=>horiz?[(u-ox)*m,d+o]:[d+o,(u-oy)*m];
   g.strokeStyle=TECNICO.cota;g.lineWidth=1;g.beginPath();{const [x0,y0]=P(L2[0]),[x1,y1]=P(L2[L2.length-1]);g.moveTo(x0,y0);g.lineTo(x1,y1);}
   for(const u of L2){const [x,y]=P(u,-4),[x2,y2]=P(u,4);g.moveTo(x,y);g.lineTo(x2,y2);}g.stroke();
   for(let i=0;i+1<L2.length;i++){const a=L2[i],b=L2[i+1],len=b-a;if(len*m<18)continue;const [x,y]=P((a+b)/2,sal*7);g.fillStyle=entero(len)&&entero(a-a0)?TECNICO.cota:TECNICO.fuera;
    g.save();g.translate(x,y);if(!horiz)g.rotate(-Math.PI/2);g.textAlign='center';g.textBaseline='middle';g.fillText(mm(len),0,0);g.restore();}}}
 // Qué hay de cada lado (calle, avenida, patio, medianera).
 g.fillStyle=css('--muted')||'#777';g.font='11px ui-monospace,monospace';g.textAlign='center';g.textBaseline='middle';
 const mid=[(r.x+r.w/2-ox)*m,(r.y+r.h/2-oy)*m];
 g.fillText(L.sides.N,mid[0],(r.y-oy)*m-11);g.fillText(L.sides.S,mid[0],(r.y+r.h-oy)*m+12);
 g.save();g.translate((r.x-ox)*m-11,mid[1]);g.rotate(-Math.PI/2);g.fillText(L.sides.W,0,0);g.restore();
 g.save();g.translate((r.x+r.w-ox)*m+11,mid[1]);g.rotate(Math.PI/2);g.fillText(L.sides.E,0,0);g.restore();
 return m;
}

// ---------- La isla (etapa 9) ----------
// La ciudad (hasta la etapa 8) corrida al lugar que le toca, y alrededor la isla: cada casilla con su suelo (la montaña
// más clara cuanto más alta), los senderos, las salidas del muro, las casas con su plano (desde la etapa 5) y el globo y
// el parapente. Devuelve el corrimiento (en casillas) para pasar de un clic a metros del plano.
const ISLA_COL={pradera:COLOR.suelo.pradera,playa:COLOR.suelo.arena,agua:COLOR.agua.baja,agua_honda:COLOR.agua.honda};
const ISLA_BORDE={playa:'#b0703f',finca:'#7a6a4a',cabana:'#6b4a2e',refugio:'#4f3520',puesto:'#2f5f9a',tienda:'#c0672f'};
const ISLA_LOT={playa:'#f2c7a5',finca:'#efe5cf',cabana:'#c9a07a',refugio:'#a8825f',puesto:'#9fbcdc',tienda:'#f0b98f'};
// ---------- El mundo entero por etapas (2026-10-12) ----------
// La isla alrededor de la ciudad desde la etapa 1, y cada etapa suma lo suyo afuera y adentro: 1 el terreno (playa,
// pradera, agua y la montaña por altura); 2 las calles y las carreteras del monte con sus manzanas en terraza; 3 los
// lotes (los de la ciudad, los de la isla, los barrios y las casas del monte); 4 los pisos; 5–8 adentro de todo: núcleo,
// cuartos, puertas y ventanas, y muebles (también los de las casas armadas, con su plano de vivienda.js).
// Devuelve el corrimiento (en casillas) para pasar de un clic a metros del plano.
export function drawWorldStage(canvas,bp,opts){return drawIslaStage(canvas,bp,opts);}
// El plano de una casa armada del monte, en su lugar: la huella (3–4) y, desde la 6, los cuartos y las paredes del piso
// pedido; 7, puertas y ventanas; 8, los muebles.
const houseCache=new WeakMap();
// (los modelos de las casas, llevados al mueble del plano que les corresponde, para dibujarlos con su símbolo)
const MODELO={Bed_King:'cama',Bed_Single:'cama_s',C2_Bed:'cama_s',Couch_Medium2:'sofa',C2_SofaDouble:'sofa',Couch_Small2:'sillon',C2_Sofa:'sillon',Kitchen_Fridge:'nevera',Kitchen_Oven:'estufa',
 Kitchen_Sink:'lavamanos',Kitchen_2Drawers:'comoda',Kitchen_Cabinet1:'comoda',Table_RoundSmall:'mesa',C2_CoffeeTable:'mesa_centro',Shelf_1:'estante',Bookshelf:'estante',C2_BookCaseBooks:'estante',
 NightStand_1:'mesa_noche',Drawer_1:'comoda',Bathroom_Toilet:'inodoro',Bathroom_Sink:'lavamanos',Bathroom_Shower1:'ducha',C2_Lamp:'lampara',C2_Closet:'armario',C2_Closet2:'armario',C2_ChairCushioned:'silla'};
// px: los píxeles por metro a los que se está dibujando (el contexto viene en metros): desde 4 los muebles van con su
// símbolo y desde 16 cada cuarto lleva su nombre.
export function drawHouse(g,c,{stage,level,px=1,vacia=false}){/* (vacia: la casa entregada sin amueblar —engine/entrega.js—: sólo el baño y la cocina) */let P=houseCache.get(c);if(!P){P=planHouse(c.spec);houseCache.set(c,P);}
 if(px>=1.2){g.fillStyle='rgba(38,42,54,.17)';g.save();g.translate(c.x+1.2,c.z+1.2);g.rotate(-(c.ry||0));g.fillRect(-P.w/2,-P.d/2,P.w,P.d);g.restore();}
 g.save();g.translate(c.x,c.z);g.rotate(-(c.ry||0));
 g.fillStyle='#efe2c4';g.fillRect(-P.w/2,-P.d/2,P.w,P.d);
 if(stage>=6){const two=P.rooms.length>1&&P.rooms.some(r=>r.y0>1),lv=two&&level>=1?1:0,y0=lv?FLOOR0+FH:FLOOR0;
  for(const r of P.rooms)if(Math.abs(r.y0-y0)<.3){g.fillStyle=r.garage?'#e2e2e2':'#f3e6cf';g.fillRect(r.x0,r.z0,r.x1-r.x0,r.z1-r.z0);}
  // (las casas desde la familia: cada cuarto con su color y, desde la 8, cada mueble; del plano de hogar.js, en las
  // coordenadas de la casa: x = u, z = D − v, corridas al centro de la huella)
  const HG=P.spec.hogar,HL=HG&&HG.levels[Math.min(lv,HG.levels.length-1)],ox=-P.body.x0,oz=-P.body.z0,hx=u=>u-ox,hz=v=>P.D-v-oz;
  if(HL)for(const q of HL.rooms){g.fillStyle=q.type==='hall'?'#efe9df':q.type==='escalera'?'#e4ddd0':ROOM_COLOR[q.type]||'#f3e6cf';g.fillRect(hx(q.u0),hz(q.v1),q.u1-q.u0,q.v1-q.v0);}
  g.fillStyle='#3a3d40';for(const b of P.boxes)if(b.solid&&b.y1-b.y0>1.5&&b.y0<y0+1&&b.y1>y0+1&&(b.cat==='interior'||b.cat==='tablas'||b.cat==='liso'))g.fillRect(b.x0,b.z0,b.x1-b.x0,b.z1-b.z0);
  if(stage>=7)for(const o of P.openings){if(Math.abs(o.y0-(y0+(o.kind==='window'?.85:0)))>1.3)continue;g.strokeStyle=o.kind==='window'?'#5aa9d6':'#f4f2ec';g.lineWidth=o.kind==='window'?.35:.5;g.beginPath();
   if(o.axis==='x'){g.moveTo(o.c-o.w/2,o.at);g.lineTo(o.c+o.w/2,o.at);}else{g.moveTo(o.at,o.c-o.w/2);g.lineTo(o.at,o.c+o.w/2);}g.stroke();}
  if(stage>=8)for(const f of P.furniture){const sz=FURN_SIZE[f.m];if(!sz||Math.abs(f.y-y0)>.5||vacia&&!modeloDeObra(f.m))continue;g.save();g.translate(f.x,f.z);g.rotate(-(f.rot||0));
   if(px>=4){g.scale(1/px,1/px);glyph(g,MODELO[f.m]||'caja',sz[0]*px,sz[1]*px,px);}
   else{g.fillStyle=/Bed/.test(f.m)?'#9c86b8':/Sofa|Couch/.test(f.m)?'#b88b6a':/Kitchen/.test(f.m)?'#c9c3b8':/Bathroom/.test(f.m)?'#ffffff':'#a7825f';g.fillRect(-sz[0]/2,-sz[1]/2,sz[0],sz[1]);}g.restore();}
  // (los del plano de hogar traen hacia dónde miran en `dir` —en u,v—; en la casa la v va al revés)
  if(stage>=8&&HL)for(const f of HL.furniture){if(vacia&&!DE_OBRA.has(f.kind))continue;if(px<4){g.fillStyle=ITEM_COLOR[f.kind]||'#a7825f';g.fillRect(hx(f.u0),hz(f.v1),f.u1-f.u0,f.v1-f.v0);continue;}
   const ry=f.dir?Math.atan2(f.dir[0],-f.dir[1]):0,alX=Math.abs(Math.sin(ry))>.5,w=f.u1-f.u0,d=f.v1-f.v0;
   g.save();g.translate(hx((f.u0+f.u1)/2),hz((f.v0+f.v1)/2));g.rotate(-ry);g.scale(1/px,1/px);glyph(g,f.kind,(alX?d:w)*px,(alX?w:d)*px,px,f.pc);g.restore();}
  if(HL&&px>=16){g.textAlign='center';g.textBaseline='middle';g.fillStyle='rgba(40,44,48,.8)';
   for(const q of HL.rooms){if(q.type==='hall'||(q.u1-q.u0)*px<46)continue;g.save();g.translate(hx((q.u0+q.u1)/2),hz(q.v1)+.42);if(Math.cos(c.ry||0)<0)g.rotate(Math.PI);// (una casa que mira al otro lado: el nombre no queda de cabeza)
    g.scale(1/px,1/px);g.font='600 11px system-ui,sans-serif';g.fillText(ROOM_LABEL[q.type]||q.label||q.type,0,0);g.restore();}}}
 g.strokeStyle='#6b4e36';g.lineWidth=.35;g.strokeRect(-P.w/2,-P.d/2,P.w,P.d);g.restore();}
// LA REGIÓN (2026-11-19): con region={x,y,w,h} —en píxeles del dispositivo de la imagen entera a esta escala— se dibuja
// sólo ese recorte, en un lienzo de ese tamaño. Es lo que deja acercar el plano y verlo nítido: a 40 px por metro la
// imagen entera mediría decenas de miles de píxeles de lado. Todo el dibujo fija su transformación en absoluto, así que
// alcanza con correr cada setTransform del contexto lo que mide el recorte.
export function drawIslaStage(canvas,bp,{cell,stage=9,level=0,selected=-1,fronts=true,dim=true,capas=CAPAS,region=null,paquete='liso'}){
 const I=bp.isla,B=I.bounds,dpr=window.devicePixelRatio||1,m=cell/CELL;
 canvas.width=region?Math.round(region.w):Math.round((B.x1-B.x0)*cell*dpr);canvas.height=region?Math.round(region.h):Math.round((B.y1-B.y0)*cell*dpr);const g=canvas.getContext('2d');
 const rx=region?.x||0,ry=region?.y||0;if(region){const fija=g.setTransform.bind(g);g.setTransform=(a,b,c,d,e,f)=>fija(a,b,c,d,e-rx,f-ry);}
 g.setTransform(1,0,0,1,0,0);g.fillStyle='#2b3a44';g.fillRect(rx,ry,canvas.width,canvas.height);
 if(region){g.save();drawCityStage(null,bp,{cell,stage:Math.min(stage,8),level,selected,fronts,paquete,sobre:{g,x:-B.x0*cell*dpr,y:-B.y0*cell*dpr}});g.restore();}
 else{const city=document.createElement('canvas');drawCityStage(city,bp,{cell,stage:Math.min(stage,8),level,selected,fronts,paquete});g.drawImage(city,-B.x0*cell*dpr,-B.y0*cell*dpr);}
 g.setTransform(dpr*m,0,0,dpr*m,-B.x0*cell*dpr,-B.y0*cell*dpr);g.globalAlpha=dim&&level>0?.5:1;
 // 1: el terreno; desde la 2, las terrazas del monte (el suelo aplanado de cada manzana) con el borde de cada manzana
 // EL TERRENO SUAVE (2026-11-21): cada casilla de 6 m se pintaba como un cuadrado y la costa y el monte salían en
 // escalera. Lo natural —agua, playa, pradera, montaña— se pinta primero en una imagen de un píxel por casilla y se estira
 // con suavizado: los colores se funden de una casilla a la otra, como una acuarela. Lo construido (plazas, terrazas) va
 // encima, nítido. Al acercar mucho el fundido mide una casilla: no inventa detalle, sólo quita la escalera.
 {const bw=B.x1-B.x0,bh=B.y1-B.y0,low=document.createElement('canvas');low.width=bw;low.height=bh;const lg=low.getContext('2d');
  for(const q of I.cells){lg.fillStyle=q.zona==='montaña'?`hsl(${80-Math.min(40,q.h/3)},${Math.max(8,28-q.h/4)}%,${Math.min(78,52+q.h/4)}%)`:ISLA_COL[q.zona]||'#b9cf8e';lg.fillRect(q.x-B.x0,q.y-B.y0,1,1);}
  // (sin pisar la ciudad, que ya está dibujada: el fundido se recorta en su borde)
  g.save();g.beginPath();g.rect(B.x0*CELL,B.y0*CELL,bw*CELL,bh*CELL);g.rect(0,0,bp.map.W*CELL,bp.map.H*CELL);g.clip('evenodd');
  g.imageSmoothingEnabled=true;g.imageSmoothingQuality='high';g.drawImage(low,B.x0*CELL,B.y0*CELL,bw*CELL,bh*CELL);g.restore();}
 for(const q of I.cells){if(q.plaza==null&&!(stage>=2&&q.terraza!=null))continue;g.fillStyle=q.plaza!=null?'#e6dfcd':'#dccfae';g.fillRect(q.x*CELL,q.y*CELL,CELL+.05,CELL+.05);
  if(q.plaza!=null){g.strokeStyle='rgba(120,100,70,.35)';g.lineWidth=.2;g.strokeRect(q.x*CELL+.5,q.y*CELL+.5,CELL-1,CELL-1);}}
 if(stage>=2){const mz=new Map();for(const q of I.cells)if(q.manzana)mz.set(q.x+','+q.y,q.manzana);g.strokeStyle='rgba(90,70,40,.7)';g.lineWidth=.45;g.beginPath();
  for(const [k,id] of mz){const [x,y]=k.split(',').map(Number);for(const [dx,dy,x0,y0,x1,y1] of [[1,0,1,0,1,1],[-1,0,0,0,0,1],[0,1,0,1,1,1],[0,-1,0,0,1,0]])if(mz.get((x+dx)+','+(y+dy))!==id){g.moveTo((x+x0)*CELL,(y+y0)*CELL);g.lineTo((x+x1)*CELL,(y+y1)*CELL);}}g.stroke();}
 if(stage<2){g.globalAlpha=1;g.setTransform(1,0,0,1,0,0);return {x0:B.x0,y0:B.y0};}
 const sk=new Set(I.cells.filter(q=>q.sendero).map(q=>q.x+','+q.y));g.strokeStyle='#b08a5e';g.lineWidth=1.6;g.lineCap='round';g.beginPath();
 for(const q of I.cells){if(!q.sendero)continue;g.moveTo((q.x+.5)*CELL,(q.y+.5)*CELL);g.lineTo((q.x+.5)*CELL+.01,(q.y+.5)*CELL);for(const [dx,dy] of [[1,0],[0,1]])if(sk.has((q.x+dx)+','+(q.y+dy))){g.moveTo((q.x+.5)*CELL,(q.y+.5)*CELL);g.lineTo((q.x+dx+.5)*CELL,(q.y+dy+.5)*CELL);}}g.stroke();
 for(const gt of I.gates){g.fillStyle=PAPER.street;g.fillRect(gt.x*CELL,gt.y*CELL,CELL,CELL);}
 // Las carreteras de montaña, como continuación de las calles: arrancan en la calle de adentro, cruzan la salida del muro
 // y siguen afuera con el mismo dibujo que las calles de la ciudad (claras, con un borde suave). A cada costado, la franja
 // aplanada (para las casas) en el tono de los patios.
 const entrada=r=>{const g0=r.desde&&I.gates.find(q=>q.x===r.desde[0]&&q.y===r.desde[1]);return g0?[[(g0.in[0]+.5)*CELL,(g0.in[1]+.5)*CELL],[(g0.x+.5)*CELL,(g0.y+.5)*CELL]]:[];};
 const traza=r=>[...entrada(r),...(r.puntos?r.puntos.map(p=>[p.x,p.z]):r.map(([x,y])=>[(x+.5)*CELL,(y+.5)*CELL]))];
 // La franja de cada lado: una banda continua (trazo grueso) por el borde de la carretera, cortada donde ese lado no tiene.
 for(const r of I.carreteras||[]){const P=r.puntos;if(!P)continue;g.lineJoin='round';g.lineCap='round';g.strokeStyle=PAPER.courtyard;
  for(const sgn of [1,-1]){const key=sgn>0?'izq':'der';let open=false;
   for(let i=0;i<P.length;i++){const a=P[Math.max(0,i-1)],b=P[Math.min(P.length-1,i+1)],L=Math.hypot(b.x-a.x,b.z-a.z)||1,nx=-(b.z-a.z)/L*sgn,nz=(b.x-a.x)/L*sgn,w=P[i][key];
    if(!w){if(open){g.stroke();open=false;}continue;}const o=3+w/2,x=P[i].x+nx*o,y=P[i].z+nz*o;
    if(!open){g.lineWidth=w+1;g.beginPath();g.moveTo(x,y);open=true;}else g.lineTo(x,y);}
   if(open)g.stroke();}}
 // La grilla de la montaña: los tramos que no se construyen (muy empinados, o con mucho corte), punteados en rojo.
 if(I.grilla){g.save();g.setLineDash([3,3]);g.lineWidth=1.4;for(const t of I.grilla.rechazos){g.strokeStyle=t.porque==='pendiente'?'rgba(200,40,40,.75)':'rgba(220,130,30,.75)';g.beginPath();g.moveTo(...t.a);g.lineTo(...t.b);g.stroke();}g.restore();}
 for(const r of I.carreteras||[]){const P=traza(r);g.lineJoin=r.tipo==='grilla'?'miter':'round';g.lineCap=r.tipo==='grilla'?'square':'round';
  for(const [w,c] of [[6.6,'rgba(40,46,50,.28)'],[6,PAPER.street]]){g.strokeStyle=c;g.lineWidth=w;g.beginPath();P.forEach(([x,y],i)=>i?g.lineTo(x,y):g.moveTo(x,y));g.stroke();}
  // La mini rotonda del final: el círculo de calle con la isla del medio en pasto.
  const o=r.rotonda;if(o){g.fillStyle='rgba(40,46,50,.28)';g.beginPath();g.arc(o.x,o.z,o.R+.3,0,Math.PI*2);g.fill();g.fillStyle=PAPER.street;g.beginPath();g.arc(o.x,o.z,o.R,0,Math.PI*2);g.fill();
   g.fillStyle=PAPER.courtyard;g.beginPath();g.arc(o.x,o.z,o.isla,0,Math.PI*2);g.fill();}}
 // Los puentes: las dos barandas a los lados del tablero.
 for(const r of I.carreteras||[]){const P=r.puntos;if(!P)continue;g.strokeStyle='#6b5d4c';g.lineWidth=.6;g.lineCap='butt';
  for(const sgn of [1,-1]){let open=false;for(let i=0;i<P.length;i++){if(!P[i].puente){if(open){g.stroke();open=false;}continue;}const a=P[Math.max(0,i-1)],b=P[Math.min(P.length-1,i+1)],L=Math.hypot(b.x-a.x,b.z-a.z)||1,x=P[i].x-(b.z-a.z)/L*sgn*3.8,y=P[i].z+(b.x-a.x)/L*sgn*3.8;
   if(!open){g.beginPath();g.moveTo(x,y);open=true;}else g.lineTo(x,y);}if(open)g.stroke();}}
 g.globalAlpha=1;g.setTransform(dpr,0,0,dpr,-B.x0*cell*dpr,-B.y0*cell*dpr);
 if(stage>=3)for(const L of I.lots){if(level>=L.floors)continue;g.fillStyle=ISLA_LOT[L.kind];for(const P of L.parts)g.fillRect(P.x*m,P.y*m,P.w*m,P.h*m);
  if(stage>=5)drawLevel(g,L.levels[level],{m,stage,small:m<10,labels:m>=16});
  g.strokeStyle=L.id===selected?'#c0392b':ISLA_BORDE[L.kind]||'rgba(40,46,50,.7)';g.lineWidth=L.id===selected?2.5:L.kind==='puesto'||L.kind==='tienda'?2.2:1.2;outline(g,L.parts,v=>v*m,v=>v*m);
  if((L.kind==='puesto'||L.kind==='tienda')&&level===0){const q=L.rect,t=L.kind==='puesto'?'POLICÍA':'TIENDA';const fs=Math.max(6,m*1.1);g.font=`bold ${fs}px sans-serif`;g.textAlign='center';const w=g.measureText(t).width+3,cx=(q.x+q.w/2)*m,y=q.y*m-2;
   g.fillStyle=L.kind==='puesto'?'#2f5f9a':'#c0672f';g.fillRect(cx-w/2,y-fs,w,fs+2);g.fillStyle='#fff';g.fillText(t,cx,y);}}
 g.setTransform(dpr*m,0,0,dpr*m,-B.x0*cell*dpr,-B.y0*cell*dpr);
 // Las casas armadas del monte, con su plano (etapa 3 en adelante).
 if(stage>=3)for(const c of I.casas||[])if(c.spec)drawHouse(g,c,{stage,level,px:m,vacia:!!bp.entrega});
 if(stage>=9)drawExterior(g,bp,{level,px:m,capas});
 if(level===0){g.font='bold 5px sans-serif';g.textAlign='center';g.fillStyle='#3b4446';
  // El nombre de cada pueblo, sobre su plaza (con un fondo para que se lea).
  for(const P of I.pueblos||[]){const x=(P.x+.5)*CELL,y=(P.y+.5)*CELL,w=g.measureText(P.name).width+3;g.fillStyle='rgba(255,252,244,.85)';g.fillRect(x-w/2,y-4.2,w,6);g.fillStyle=P.kind==='costa'?'#2f5f7a':'#4b5a2e';g.fillText(P.name,x,y);}
  g.fillStyle='#3b4446';
  if(I.globo){const {x,y}=I.globo;g.fillStyle='#e0503a';g.beginPath();g.arc(x,y-2.2,2.4,0,7);g.fill();g.strokeStyle='#5a4632';g.lineWidth=.3;g.beginPath();g.moveTo(x-1.5,y-.8);g.lineTo(x-.7,y+.6);g.moveTo(x+1.5,y-.8);g.lineTo(x+.7,y+.6);g.stroke();g.fillStyle='#8a6a4c';g.fillRect(x-.8,y+.6,1.6,1.2);g.fillStyle='#3b4446';g.fillText('globo',x,y+7);}
  if(I.parapente){const {x,y}=I.parapente;g.fillStyle='#4f7fa8';g.beginPath();g.ellipse(x,y-1.6,3.2,1.3,0,Math.PI,0);g.fill();g.strokeStyle='#3b4446';g.lineWidth=.2;g.beginPath();g.moveTo(x-3,y-1.6);g.lineTo(x,y+.8);g.lineTo(x+3,y-1.6);g.stroke();g.fillStyle='#3b4446';g.fillText('parapente',x,y+6);}}
 g.setTransform(1,0,0,1,0,0);return {x0:B.x0,y0:B.y0};}

// ---------- Un mueble, con su forma y su frente (2026-11-19) ----------
// Antes cada mueble era una caja de color: no se distinguía una cama de un armario ni de qué lado se usa una silla. El
// plano guarda hacia dónde mira cada uno (`ry`: el frente del modelo, +z, girado alrededor de la vertical), así que se
// dibuja en su propio marco —el frente hacia +y, el respaldo o la pared hacia −y— y se gira. Son símbolos de plano de
// arquitectura, no retratos: la cama con sus almohadas contra la cabecera, el sofá con respaldo y brazos, el inodoro con su
// tanque, la estufa con sus hornillas. W es el ancho (de lado a lado) y D el fondo (de la pared al frente), en píxeles.
const CAMAS=new Set(['cama','cama_s','cama_h','catre','camilla','litera']),GUARDA=new Set(['armario','comoda','archivador','estante','casillero','repisa','estanteria_ropa','vitrina','buzones','cajon','perchero']),
 MESAS=new Set(['mesa','mesa_centro','mesa_reunion','mesa_lectura']),BARRAS=new Set(['meson','mostrador','plancha','horno','lavadora']);
function drawItem(g,f,X,Y,m){
 const ry=f.ry||0,alX=Math.abs(Math.sin(ry))>.5;
 g.save();g.translate(X(f.x+f.w/2),Y(f.y+f.h/2));g.rotate(-ry);glyph(g,f.kind,(alX?f.h:f.w)*m,(alX?f.w:f.h)*m,m,f.pc);g.restore();}
// El símbolo, ya en el marco del mueble (el centro en el origen, el frente hacia +y) y en píxeles: m son los píxeles
// por metro. Lo usan los edificios (drawItem) y las casas (drawHouse y drawHogar).
function glyph(g,k,W,D,m,pc=false){
 const col=ITEM_COLOR[k]||'#999',lw=Math.max(.6,Math.min(1.4,m*.035)),f={pc};
 const box=(x,y,w,h,r=0)=>{g.beginPath();if(r>0&&g.roundRect)g.roundRect(x,y,w,h,Math.min(r,w/2,h/2));else g.rect(x,y,w,h);},pinta=(c=col)=>{g.fillStyle=c;g.fill();g.stroke();},
  circ=(x,y,r)=>{g.beginPath();g.arc(x,y,Math.max(.5,r),0,7);},oscuro='rgba(0,0,0,.42)',claro='rgba(255,255,255,.55)';
 g.strokeStyle=oscuro;g.lineWidth=lw;g.lineJoin='round';g.lineCap='butt';
 const x0=-W/2,y0=-D/2,r=Math.min(W,D)*.12;
 if(CAMAS.has(k)){box(x0,y0,W,D,r);pinta('#f4f1ea');// (el colchón claro, la cobija del color de la cama y las almohadas contra la cabecera)
  box(x0,y0+D*.3,W,D*.7,r);pinta();const n=W>D*.62?2:1,aw=W/n*.7,ah=D*.16;for(let i=0;i<n;i++){box(x0+W/n*(i+.5)-aw/2,y0+D*.07,aw,ah,ah*.4);pinta('#ffffff');}
  if(k==='litera'){g.beginPath();g.moveTo(x0,y0+D*.3);g.lineTo(x0+W,y0+D);g.stroke();}}
 else if(k==='sofa'||k==='sillon'){box(x0,y0,W,D,r);pinta();const b=D*.28,a=Math.min(W*.14,D*.3);// respaldo atrás y un brazo a cada lado
  g.fillStyle='rgba(0,0,0,.16)';g.fillRect(x0,y0,W,b);g.fillRect(x0,y0,a,D);g.fillRect(x0+W-a,y0,a,D);
  const n=k==='sofa'?Math.max(2,Math.round((W-2*a)/(D*.9))):1;g.beginPath();for(let i=1;i<n;i++){const x=x0+a+(W-2*a)*i/n;g.moveTo(x,y0+b);g.lineTo(x,y0+D);}g.stroke();}
 else if(k==='silla'){box(x0,y0+D*.12,W,D*.88,r*2);pinta();g.lineWidth=Math.max(1.2,D*.16);g.lineCap='round';g.beginPath();g.moveTo(x0+W*.12,y0+D*.1);g.lineTo(x0+W*.88,y0+D*.1);g.stroke();}
 else if(k==='inodoro'){box(x0,y0,W,D*.3,r);pinta('#ffffff');g.beginPath();g.ellipse(0,y0+D*.64,W*.42,D*.36,0,0,7);pinta('#ffffff');g.beginPath();g.ellipse(0,y0+D*.66,W*.24,D*.2,0,0,7);g.stroke();}
 else if(k==='lavamanos'){box(x0,y0,W,D,r);pinta('#ffffff');g.beginPath();g.ellipse(0,D*.06,W*.32,D*.3,0,0,7);g.stroke();circ(0,y0+D*.16,Math.min(W,D)*.06);g.fillStyle=oscuro;g.fill();}
 else if(k==='ducha'){box(x0,y0,W,D);pinta();g.beginPath();g.moveTo(x0,y0);g.lineTo(x0+W,y0+D);g.moveTo(x0+W,y0);g.lineTo(x0,y0+D);g.stroke();circ(0,0,Math.min(W,D)*.07);g.fillStyle='#ffffff';g.fill();g.stroke();}
 else if(k==='tina'){box(x0,y0,W,D,r);pinta('#ffffff');box(x0+W*.12,y0+D*.08,W*.76,D*.84,W*.3);pinta();circ(0,y0+D*.16,W*.07);g.fillStyle=oscuro;g.fill();}
 else if(k==='estufa'){box(x0,y0,W,D,r*.5);pinta();g.strokeStyle=claro;for(const [a,b] of [[-.22,-.2],[.22,-.2],[-.22,.22],[.22,.22]]){circ(W*a,D*b,Math.min(W,D)*.14);g.stroke();}}
 else if(k==='nevera'){box(x0,y0,W,D,r*.5);pinta();g.beginPath();g.moveTo(x0,y0+D*.82);g.lineTo(x0+W,y0+D*.82);g.moveTo(x0+W*.8,y0+D*.82);g.lineTo(x0+W*.8,y0+D);g.stroke();}
 else if(k==='tv'){box(x0,y0+D*.25,W,D*.5,1);pinta();box(-W*.14,y0,W*.28,D*.3);pinta('#565b60');}
 else if(k==='planta'){circ(0,0,Math.min(W,D)*.5);pinta();g.strokeStyle='rgba(30,70,30,.6)';g.beginPath();for(let i=0;i<5;i++){const a=i*1.2566;g.moveTo(0,0);g.lineTo(Math.cos(a)*W*.42,Math.sin(a)*D*.42);}g.stroke();}
 else if(k==='lampara'||k==='maniqui'){circ(0,0,Math.min(W,D)*.5);pinta();circ(0,0,Math.min(W,D)*.2);g.stroke();}
 else if(k==='caja'||k==='caja_fuerte'){box(x0,y0,W,D);pinta();if(k==='caja'){g.beginPath();g.moveTo(x0,y0);g.lineTo(x0+W,y0+D);g.moveTo(x0+W,y0);g.lineTo(x0,y0+D);g.stroke();}else{circ(0,0,Math.min(W,D)*.24);g.strokeStyle=claro;g.stroke();}}
 else if(MESAS.has(k)){box(x0,y0,W,D,Math.min(W,D)*(k==='mesa'&&Math.abs(W-D)<m*.15?.5:.14));pinta();}
 else if(k==='escritorio'||k==='pupitre'){box(x0,y0,W,D,r*.5);pinta();// (el computador, del lado de la pared: quien lo usa se sienta al frente)
  if(f.pc){box(-W*.2,y0+D*.12,W*.4,D*.14);pinta('#2f7fc0');box(-W*.16,y0+D*.5,W*.32,D*.2,1);pinta('#e9ecef');}}
 else if(GUARDA.has(k)){box(x0,y0,W,D);pinta();// las puertas o cajones, del lado del frente
  g.beginPath();g.moveTo(x0,y0+D*.78);g.lineTo(x0+W,y0+D*.78);const n=Math.max(1,Math.round(W/Math.max(D,m*.5)));for(let i=1;i<n;i++){const x=x0+W*i/n;g.moveTo(x,y0+D*.78);g.lineTo(x,y0+D);}g.stroke();}
 else if(BARRAS.has(k)){box(x0,y0,W,D,r*.4);pinta();g.strokeStyle=claro;g.beginPath();g.moveTo(x0+W*.06,y0+D*.2);g.lineTo(x0+W*.94,y0+D*.2);g.stroke();
  if(k==='horno'){circ(0,D*.1,Math.min(W,D)*.26);g.stroke();}if(k==='lavadora'){circ(0,0,Math.min(W,D)*.3);g.stroke();}}
 else if(k==='caminadora'||k==='bicicleta'||k==='banco'){box(x0,y0,W,D,r*2);pinta();g.strokeStyle=claro;g.beginPath();g.moveTo(x0+W*.15,y0+D*.2);g.lineTo(x0+W*.85,y0+D*.2);g.stroke();}
 else{box(x0,y0,W,D,k==='colchoneta'||k==='probador'?r:0);pinta();}
}

// Un mueble suelto, para el catálogo: su símbolo de frente (el frente hacia abajo), con su medida en metros, centrado en
// el canvas. `px`: píxeles por metro.
export function drawMueble(canvas,kind,w,d,{px=70,lado=150,pc=false}={}){
 const dpr=window.devicePixelRatio||1;canvas.width=canvas.height=Math.round(lado*dpr);canvas.style.width=canvas.style.height=lado+'px';
 const g=canvas.getContext('2d'),m=Math.min(px,(lado-24)/Math.max(w,d));g.setTransform(dpr,0,0,dpr,0,0);g.clearRect(0,0,lado,lado);
 // (el piso: una rejilla de medio metro, para leer el tamaño de un vistazo)
 g.strokeStyle='rgba(0,0,0,.06)';g.lineWidth=1;g.beginPath();for(let x=lado/2%(m/2);x<lado;x+=m/2){g.moveTo(x,0);g.lineTo(x,lado);g.moveTo(0,x);g.lineTo(lado,x);}g.stroke();
 g.save();g.translate(lado/2,lado/2);glyph(g,kind,w*m,d*m,m,pc);g.restore();return m;}

// ---------- LO DE AFUERA Y LAS AZOTEAS (2026-11-19) ----------
// El plano ya traía todo esto medido —1.838 árboles, 482 piezas de mobiliario, 1.259 marcas de pintura, los nombres de
// 21 vías, los botines y lo que hay en cada azotea, en la ciudad 1— pero el dibujo no lo mostraba: sólo se veía en el 3D.
// Va en metros (el contexto ya viene escalado) y cada capa se puede apagar: capas={pintura,equipo,arboles,nombres}.
// `px` es cuántos píxeles mide un metro: lo chico (un hidrante, el nombre de una calle) no se dibuja si no se va a leer.
const EQUIPO={farol:'#3a3f45',banca:'#8a6a4c',papelera:'#4f7d5a',hidrante:'#d0412f',semaforo:'#23272b',parada:'#2f6fb0',salvavidas:'#e8762c'};
const AZOTEA={tanque:'#7f97a8',antena:'#4a4f55',matera:'#6f9f5e',tendedero:'#c9c2b4',aire:'#9aa0a6'};
export const CAPAS={pintura:true,equipo:true,arboles:true,nombres:true};
function drawExterior(g,bp,{level=0,px=1,capas=CAPAS}){
 const girado=(x,z,ang,f)=>{g.save();g.translate(x,z);g.rotate(ang||0);f();g.restore();};
 if(capas.pintura&&px>=1.5)for(const p of bp.pintura||[]){g.fillStyle=p.tipo==='amarilla'?'#e8b93c':'#ffffff';// (blanca sobre el asfalto gris)
  // (el largo va a lo largo del ángulo: una raya de cebra, un tramo de la línea de carril)
  girado(p.x,p.z,-p.ang,()=>g.fillRect(-p.largo/2,-p.ancho/2,p.largo,p.ancho));}
 if(capas.equipo&&px>=2.5)for(const e of bp.equipamiento||[]){const c=EQUIPO[e.tipo];if(!c)continue;g.fillStyle=c;
  if(e.tipo==='banca')girado(e.x,e.z,e.ang||0,()=>{const l=e.largo||1.8,f=e.fondo||.6;g.fillRect(-l/2,-f/2,l,f);g.fillStyle='rgba(0,0,0,.25)';g.fillRect(-l/2,-f/2,l,f*.28);});// (ang: a lo largo de la banca, como la guarda el plano)
  else if(e.tipo==='parada')girado(e.x,e.z,-(e.hacia||0),()=>{g.fillRect(-1.6,-.6,3.2,1.2);g.fillStyle='#dfeaf5';g.fillRect(-1.4,-.4,2.8,.8);});
  else if(e.tipo==='farol'){g.beginPath();g.arc(e.x,e.z,.28,0,7);g.fill();g.strokeStyle='rgba(240,190,90,.55)';g.lineWidth=.12;g.beginPath();g.arc(e.x,e.z,1.1,0,7);g.stroke();}
  else if(e.tipo==='semaforo'){g.fillRect(e.x-.3,e.z-.3,.6,.6);g.fillStyle='#e23b2e';g.beginPath();g.arc(e.x,e.z,.16,0,7);g.fill();}
  else{g.beginPath();g.arc(e.x,e.z,e.tipo==='salvavidas'?.6:.32,0,7);g.fill();}}
 // (los contenedores de basura: 1,8 × 1,05 m, sobre el andén y paralelos a la fachada —engine/contenedores.js—)
 if(capas.equipo&&px>=2)for(const c of bp.contenedores||[]){girado(c.x,c.z,c.ang||0,()=>{g.fillStyle=c.sinAnden?'#c0392b':'#2f6b4f';g.fillRect(-.9,-.525,1.8,1.05);g.fillStyle='rgba(255,255,255,.28)';g.fillRect(-.9,-.525,1.8,.22);g.strokeStyle='rgba(0,0,0,.4)';g.lineWidth=.06;g.strokeRect(-.9,-.525,1.8,1.05);});}
 // (las azoteas: en el piso que ya es techo de cada edificio)
 for(const L of bp.lots){if(level<L.floors||!L.azotea?.objetos)continue;for(const o of L.azotea.objetos){g.fillStyle=AZOTEA[o.tipo]||'#999';
  if(o.tipo==='tanque'){g.beginPath();g.arc(o.x,o.z,Math.max(o.w,o.d)/2,0,7);g.fill();}else girado(o.x,o.z,-(o.giro||0),()=>g.fillRect(-o.w/2,-o.d/2,o.w,o.d));}}
 if(capas.arboles){const V=bp.vegetacion||{};
  for(const s of V.sombrillas||[]){if(px<2)break;g.fillStyle=s.tela;g.globalAlpha=.85;g.beginPath();g.arc(s.x,s.z,s.r,0,7);g.fill();}
  // (la copa translúcida —lo de abajo se sigue viendo— con su borde, y el tronco: es donde está plantado)
  // (un árbol de calle junto a una fachada va PODADO en óvalo —vegetacion.js, V.poda—: `ra` hacia el edificio y `r` a lo largo
  // de la calle, con el eje en `eje`. Dibujado como círculo de radio r parecía metido en el edificio, y no lo está.)
  if(px>=2){g.globalAlpha=.1;g.fillStyle='#1e2430';for(const a of [...(V.arboles||[]),...(V.palmeras||[])]){g.beginPath();if(a.ra!=null)g.ellipse(a.x+.9,a.z+.9,a.r,a.ra,a.eje||0,0,7);else g.arc(a.x+.9,a.z+.9,a.r,0,7);g.fill();}}
  for(const a of [...(V.arboles||[]),...(V.palmeras||[])]){g.globalAlpha=.26;g.fillStyle=a.follaje||'#5c8f40';g.beginPath();if(a.ra!=null)g.ellipse(a.x,a.z,a.r,a.ra,a.eje||0,0,7);else g.arc(a.x,a.z,a.r,0,7);g.fill();
   g.globalAlpha=.6;g.strokeStyle=a.color&&a.color!==a.follaje?a.color:'#3f6a2c';g.lineWidth=Math.min(.22,a.r*.08);g.stroke();
   if(px>=3){g.fillStyle='#5a4028';g.beginPath();g.arc(a.x,a.z,.22,0,7);g.fill();}}
  g.globalAlpha=1;}
 // Los nombres de las vías, a lo largo de cada una y repetidos cada tanto. La letra se dibuja en PÍXELES (se deshace la
 // escala del plano alrededor de cada texto): pedida en metros salía de 2 px y el navegador la subía a su mínimo (~10 px),
 // que con la escala encima daba nombres de 9 m de alto.
 if(capas.nombres&&px>=1.2){const alto=Math.max(9,Math.min(14,px*2.2)),paso=Math.max(96,420/px);
  const texto=(t,x,z,ang)=>{g.save();g.translate(x,z);g.rotate(ang);g.scale(1/px,1/px);g.fillText(t,0,0);g.restore();};
  g.font=`600 ${alto}px system-ui,sans-serif`;g.textAlign='center';g.textBaseline='middle';g.fillStyle='rgba(60,66,72,.6)';
  for(const v of [...(bp.vias?.h||[]),...(bp.vias?.v||[])]){const t=px>=4?v.largo:v.corto,a=v.desde??0,b=v.hasta??(v.eje==='h'?bp.map.W:bp.map.H)*CELL;if(!t||b-a<alto/px*4)continue;
   for(let d=a+paso/2;d<b;d+=paso){if(v.eje==='h')texto(t,d,v.coord,0);else texto(t,v.coord,d,-Math.PI/2);}}}
}

// ---------- EL ALZADO: la fachada de un edificio, de frente (2026-11-19) ----------
// El plano ya decide todo lo que se ve desde la calle —en qué piso y a cuántos metros va cada ventana y cada puerta, los
// tres colores de la regla 60-30-10 (muro, moldura y acento), el zócalo, la banda entre pisos, la cornisa, los toldos, los
// balcones y el techo—, pero sólo se podía mirar armando el 3D. Esto lo dibuja de frente, a escala, para revisar la
// composición: que las ventanas caigan una sobre otra, cuánto del frente es vidrio y cómo quedan los colores juntos.
// `lado`: N, S, E u O del lote (por defecto, su frente). Devuelve lo medido: {ancho, alto, ventanas, corridas, sobreMuro, vano}.
// Una ventana está CORRIDA si pisa a una de abajo sin compartir su eje: eso desordena la fachada y se marca en naranja.
// Una que cae SOBRE MURO (abajo no hay vano en ese tramo) es normal —el piso que ya pasa al vecino abre ventanas donde
// abajo hay medianera— y sólo se cuenta. Medido en la ciudad 1: 3.334 ventanas de pisos altos, 0 corridas, 244 sobre muro.
export function drawElevation(canvas,L,{width=560,lado=null,paquete='liso',pintables=false,grafiti=null,mapa=null}={}){
 const PQ=PAQUETES[paquete]||PAQUETES.liso,relleno=(nombre,x,y,w,h,ox=x,oy=y)=>{if(!nombre)return;g.beginPath();g.rect(x,y,w,h);textura(g,nombre,m,ox,oy);};
 // (2026-11-21: por TRAMO del contorno —engine/fachada-medida.js ejeDe—, no por el lado del rectángulo que envuelve al
 // edificio: en uno en L cada recta es su fachada. `lado`: un código de tramo (N0, S1…) o sólo la letra, el más largo)
 const EJ=ejeDe(L,lado||L.front),f=EJ.lado,H=ALTURA.piso,horiz=EJ.horiz,ancho=EJ.ancho,sube=L.fachada?.escalinata?RAISE:0,manz=L.fachada?.techo==='mansarda';
 const alto=L.floors*H+sube,techo=manz?H*.9:.9,dpr=window.devicePixelRatio||1,pad=34,m=Math.min(30,(width-2*pad)/ancho),hgt=(alto+techo)*m+2*pad+10;
 canvas.width=Math.round(width*dpr);canvas.height=Math.round(hgt*dpr);canvas.style.width=width+'px';canvas.style.height=hgt+'px';
 const g=canvas.getContext('2d');g.setTransform(dpr,0,0,dpr,0,0);g.clearRect(0,0,width,hgt);
 const C=L.colores||{},F=L.fachada||{},muro=C.fachada||TYPES[L.type]?.color||'#d9cdb8',mold=C.moldura||'#f2efe6',acento=C.acento||'#3a3d40',marco=C.marco||mold,zoc=C.zocalo||muro;
 const x0=(width-ancho*m)/2,suelo=hgt-pad,X=u=>x0+u*m,Y=y=>suelo-y*m;
 // (de frente: lo que en el plano va de oeste a este se ve de izquierda a derecha mirando al norte; del otro lado, al revés)
 const linea=EJ.linea,enLado=w=>{const c=horiz?(w.x0+w.x1)/2:(w.y0+w.y1)/2;return c>EJ.o-.01&&c<EJ.o+ancho+.01&&(horiz?Math.abs(w.y0-linea)<.3&&Math.abs(w.y1-linea)<.3:Math.abs(w.x0-linea)<.3&&Math.abs(w.x1-linea)<.3);};
 const tramo=w=>{const a=(horiz?w.x0:w.y0)-EJ.o,b=(horiz?w.x1:w.y1)-EJ.o,inv=EJ.inv;const u0=Math.max(0,Math.min(a,b)),u1=Math.min(ancho,Math.max(a,b));return inv?[ancho-u1,ancho-u0]:[u0,u1];};
 // el cielo de papel, el suelo y la sombra del edificio
 g.fillStyle='#eef3f6';g.fillRect(0,0,width,suelo);g.fillStyle='#d9d5c8';g.fillRect(0,suelo,width,hgt-suelo);
 g.fillStyle=muro;g.fillRect(X(0),Y(alto),ancho*m,alto*m);
 // (la textura del muro, según la familia del edificio y el paquete: encima del color, anclada abajo a la izquierda)
 relleno(PQ.comoEl3D?TEX_2D[texturaDeMuro(F.familia,C.fachada)]:PQ.muro[F.familia],X(0),Y(alto),ancho*m,alto*m,X(0),suelo);
 // el zócalo (y, si el edificio va subido, la base de la escalinata)
 g.fillStyle=zoc;g.fillRect(X(0),Y(sube+.55),ancho*m,(sube+.55)*m);relleno(PQ.zocalo,X(0),Y(sube+.55),ancho*m,(sube+.55)*m,X(0),suelo);
 // las esquinas de piedra
 if(F.esquinas&&F.esquinas!=='no'){g.fillStyle=mold;let k=0;for(let y=sube+.55;y<alto-.45;y+=.6,k++){const w=k%2?.36:.26;g.fillRect(X(0),Y(y+.48),w*m,.42*m);g.fillRect(X(ancho-w),Y(y+.48),w*m,.42*m);}}
 const medido={ancho,alto:+alto.toFixed(1),ventanas:0,corridas:0,sobreMuro:0,vano:[]};let abajo=null;
 for(let i=0;i<L.floors;i++){const lv=L.levels[i],base=sube+i*H,vs=lv.windows.filter(enLado).map(w=>({...w,t:tramo(w)})),ps=i===0?lv.doors.filter(d=>d.street&&enLado(d)).map(d=>({...d,t:tramo(d)})):[];
  // la banda entre pisos
  if(i>0&&F.banda){g.fillStyle=mold;g.fillRect(X(0),Y(base+.12),ancho*m,.2*m);}
  let vidrio=0;
  for(const w of vs){const [a,b]=w.t,[p,q]=VANO[w.shop?'vidriera':w.pieza==='ventanal'?'ventanal':'comun'],mk=Math.max(1.5,m*.09);
   g.fillStyle=marco;g.fillRect(X(a)-mk,Y(base+q)-mk,(b-a)*m+2*mk,(q-p)*m+2*mk);
   g.fillStyle='#a9cfe2';g.fillRect(X(a),Y(base+q),(b-a)*m,(q-p)*m);g.fillStyle='rgba(255,255,255,.35)';g.fillRect(X(a),Y(base+q),(b-a)*m*.45,(q-p)*m);
   // la carpintería: un parteluz al medio y, en las comunes, un travesaño
   g.strokeStyle=marco;g.lineWidth=Math.max(1,m*.05);g.beginPath();g.moveTo(X((a+b)/2),Y(base+q));g.lineTo(X((a+b)/2),Y(base+p));if(!w.shop){g.moveTo(X(a),Y(base+p+(q-p)*.55));g.lineTo(X(b),Y(base+p+(q-p)*.55));}g.stroke();
   // el alféizar, el balcón y el toldo
   if(!w.shop){g.fillStyle=mold;g.fillRect(X(a)-mk*2,Y(base+p)+mk,(b-a)*m+mk*4,Math.max(2,m*.1));}
   if(F.balcones&&i>0&&!w.shop){g.strokeStyle=acento;g.lineWidth=Math.max(1,m*.04);const yb=Y(base+.05),yt=Y(base+1);g.strokeRect(X(a)-m*.2,yt,(b-a)*m+m*.4,yb-yt);g.beginPath();for(let u=a-.1;u<=b+.11;u+=.2){g.moveTo(X(u),yt);g.lineTo(X(u),yb);}g.stroke();}
   if(w.shop&&AWNINGS[F.toldos]){g.fillStyle=AWNINGS[F.toldos];g.beginPath();g.moveTo(X(a)-m*.1,Y(base+q+.25));g.lineTo(X(b)+m*.1,Y(base+q+.25));g.lineTo(X(b)+m*.25,Y(base+q-.35));g.lineTo(X(a)-m*.25,Y(base+q-.35));g.closePath();g.fill();}
   vidrio+=(b-a)*(q-p);
   if(i>0){medido.ventanas++;const pisa=abajo.filter(v=>Math.min(b,v.t[1])-Math.max(a,v.t[0])>.05),c=(a+b)/2;
    if(!pisa.length)medido.sobreMuro++;
    // (sobre la planta baja alcanza con caer dentro de una vidriera o de la puerta: son más anchas que una ventana)
    else if(!pisa.some(v=>Math.abs((v.t[0]+v.t[1])/2-c)<.16||(i===1&&c>v.t[0]&&c<v.t[1]))){medido.corridas++;g.strokeStyle='#e0672f';g.lineWidth=2;g.setLineDash([4,3]);g.strokeRect(X(a)-4,Y(base+q)-4,(b-a)*m+8,(q-p)*m+8);g.setLineDash([]);}}}
  for(const d of ps){const [a,b]=d.t,q=VANO.puerta[1],mk=Math.max(2,m*.1);g.fillStyle=mold;g.fillRect(X(a)-mk,Y(sube+q)-mk,(b-a)*m+2*mk,q*m+mk);g.fillStyle=acento;g.fillRect(X(a),Y(sube+q),(b-a)*m,q*m);
   g.fillStyle='rgba(255,255,255,.28)';g.fillRect(X(a)+(b-a)*m*.18,Y(sube+q-.25),(b-a)*m*.64,q*m*.4);
   if(sube){g.fillStyle='#bdb7aa';for(let k=0;k<3;k++)g.fillRect(X(a)-m*(.15+k*.18),Y(sube-k*sube/3),(b-a)*m+m*(.3+k*.36),sube/3*m+1);}}
  medido.vano.push(+(vidrio/(ancho*H)*100).toFixed(0));abajo=[...vs,...ps];}
 // el remate: la cornisa y el techo
 g.fillStyle=mold;g.fillRect(X(0)-m*.15,Y(alto+.05),ancho*m+m*.3,.32*m);
 if(manz){g.fillStyle=C.techo||'#4b5560';g.beginPath();g.moveTo(X(0),Y(alto+.3));g.lineTo(X(ancho),Y(alto+.3));g.lineTo(X(ancho)-m*.7,Y(alto+techo));g.lineTo(X(0)+m*.7,Y(alto+techo));g.closePath();g.fill();if(PQ.mansarda)textura(g,PQ.mansarda,m,X(0),Y(alto+.3));
  g.fillStyle=marco;for(const w of (L.levels[L.floors-1].windows.filter(enLado).map(tramo))){const c=(w[0]+w[1])/2;g.fillRect(X(c-.45),Y(alto+techo*.78),.9*m,techo*.5*m);g.fillStyle='#a9cfe2';g.fillRect(X(c-.33),Y(alto+techo*.72),.66*m,techo*.38*m);g.fillStyle=marco;}}
 else{g.fillStyle=muro;g.fillRect(X(0),Y(alto+techo),ancho*m,(techo-.3)*m);g.fillStyle=mold;g.fillRect(X(0),Y(alto+techo),ancho*m,.12*m);}
 g.strokeStyle='rgba(30,34,38,.55)';g.lineWidth=1;g.strokeRect(X(0)+.5,Y(alto)+.5,ancho*m-1,alto*m-1);
 // (el grafiti de esta fachada —engine/grafiti.js—: el muro entero es el lienzo; cada píxel pintado, en su lugar)
 {const FM=fachadaMedida(L,EJ.codigo);medido.codigo=EJ.codigo;medido.textura=FM.textura;medido.hiladas=FM.hiladasPorPiso;medido.modulos=FM.modulos;
  if(grafiti){const Lz=lienzoDe({ancho,alto}),d=grafiti.d;if(grafiti.cols===Lz.cols&&grafiti.rows===Lz.rows)for(let fi=0;fi<Lz.rows;fi++)for(let ci=0;ci<Lz.cols;ci++){const v=d[fi*Lz.cols+ci];if(!v)continue;g.fillStyle=GRAFITI.paleta[v];g.fillRect(X(Lz.du+ci*Lz.px),Y(alto-Lz.dy-fi*Lz.px),Lz.px*m+.4,Lz.px*m+.4);}}
  // (el mapa de lo pintable —engine/muros.js fachadaPintable—: gris lo que no se pinta, blanco lo que sí, y el número de
  // cada pared pintable: sus tres últimas cifras, las de la pared dentro del piso)
  if(mapa){g.fillStyle='rgba(96,104,116,.88)';g.fillRect(X(0),Y(alto),ancho*m,alto*m);g.fillStyle='#ffffff';
   for(const w of mapa.paredes){const y0=Math.max(w.y0,...(w.huecos||[]).filter(h=>h.clase==='zocalo').map(h=>w.y0+h.y1)),y1=w.y0+w.alto;g.fillRect(X(w.u0),Y(y1),(w.u1-w.u0)*m,(y1-y0)*m);g.strokeStyle='#18a06a';g.lineWidth=1.5;g.strokeRect(X(w.u0)+.75,Y(y1)+.75,(w.u1-w.u0)*m-1.5,(y1-y0)*m-1.5);
    if((w.u1-w.u0)*m>26){g.fillStyle='#1d2530';g.font=`600 ${Math.max(9,Math.min(13,m*.5))}px system-ui,sans-serif`;g.textAlign='center';g.textBaseline='middle';g.fillText(w.numero.slice(7),X((w.u0+w.u1)/2),(Y(y1)+Y(y0))/2);g.fillStyle='#ffffff';}}
   medido.pintablesN=mapa.paredes.length;}
  if(pintables){g.setLineDash([5,3]);g.lineWidth=1.5;g.strokeStyle='#18a06a';g.strokeRect(X(0)+1,Y(alto)+1,ancho*m-2,alto*m-2);g.setLineDash([]);}}
 // las cotas: el ancho abajo y el alto y cada piso a la izquierda
 g.fillStyle='#5d6670';g.font='11px system-ui,sans-serif';g.textAlign='center';g.textBaseline='middle';g.fillText(`${ancho} m · fachada ${({N:'norte',S:'sur',E:'este',W:'oeste'})[f]}`,width/2,suelo+16);
 g.textAlign='right';for(let i=0;i<L.floors;i++)g.fillText(i===0?'PB':String(i),X(0)-8,Y(sube+i*H+H/2));
 return medido;}

// ---------- Las casas desde la familia (engine/hogar.js, 2026-10-12) ----------
// El plano de un piso: cuartos (con su nombre y medida), paredes, puertas (con su giro), ventanas y muebles. u a lo
// ancho, v hacia el fondo; el frente (la calle) abajo del dibujo.
export function drawHogar(canvas,P,{level=0,width=560,vacia=false}={}){
 const dpr=window.devicePixelRatio||1,pad=30,m=Math.min(56,(width-2*pad)/P.W),hgt=P.D*m+2*pad+18;
 canvas.width=Math.round(width*dpr);canvas.height=Math.round(hgt*dpr);canvas.style.width=width+'px';canvas.style.height=hgt+'px';
 const g=canvas.getContext('2d');g.setTransform(dpr,0,0,dpr,0,0);g.clearRect(0,0,width,hgt);
 const ox=(width-P.W*m)/2,X=u=>ox+u*m,Y=v=>pad+(P.D-v)*m;// (el frente abajo)
 const L=P.levels[Math.min(level,P.levels.length-1)],COL={...ROOM_COLOR,escalera:'#e4ddd0',hall:'#efe9df',deposito:'#e4ddcf',oficina:'#e9e4d6'};
 for(const q of L.rooms){g.fillStyle=COL[q.type]||'#eee';g.fillRect(X(q.u0),Y(q.v1),(q.u1-q.u0)*m,(q.v1-q.v0)*m);}
 // la escalera: sus peldaños
 for(const q of L.rooms.filter(q=>q.type==='escalera')){g.strokeStyle='#b9ad98';g.lineWidth=1;for(let v=q.v0+.25;v<q.v1;v+=.27){g.beginPath();g.moveTo(X(q.u0),Y(v));g.lineTo(X(q.u1),Y(v));g.stroke();}}
 for(const f of L.furniture){if(vacia&&!DE_OBRA.has(f.kind))continue;const ry=f.dir?Math.atan2(f.dir[0],-f.dir[1]):0,alX=Math.abs(Math.sin(ry))>.5,w=f.u1-f.u0,d=f.v1-f.v0;// (el frente abajo: la v va al revés)
  g.save();g.translate(X((f.u0+f.u1)/2),Y((f.v0+f.v1)/2));g.rotate(-ry);glyph(g,f.kind,(alX?d:w)*m,(alX?w:d)*m,m,f.pc);g.restore();}
 // paredes: el contorno de cada cuarto (la fachada más gruesa) y, encima, los vanos de las puertas en blanco
 g.strokeStyle='#3a3d40';g.lineCap='square';for(const q of L.rooms){g.lineWidth=2;g.strokeRect(X(q.u0),Y(q.v1),(q.u1-q.u0)*m,(q.v1-q.v0)*m);}
 g.lineWidth=5;g.strokeRect(X(0),Y(P.D),P.W*m,P.D*m);
 const seg=(o,col,w)=>{g.strokeStyle=col;g.lineWidth=w;g.beginPath();if(o.axis==='u'){g.moveTo(X(o.from),Y(o.at));g.lineTo(X(o.from+o.len),Y(o.at));}else{g.moveTo(X(o.at),Y(o.from));g.lineTo(X(o.at),Y(o.from+o.len));}g.stroke();};
 for(const w of L.windows)seg(w,'#5aa9d6',4);
 for(const d of L.doors){seg(d,d.street?'#c0672f':'#f4f2ec',d.street?5:4);if(d.open)continue;g.strokeStyle='rgba(60,60,60,.45)';g.lineWidth=1;g.beginPath();
  if(d.axis==='u'){const q=L.rooms.find(r=>r.id===d.a),into=q&&q.v0<d.at-.01?-1:1,x=X(d.from),y=Y(d.at);g.moveTo(x,y);g.arc(x,y,d.len*m,0,into>0?-Math.PI/2:Math.PI/2,into>0);}
  g.stroke();}
 g.textAlign='center';for(const q of L.rooms){if(q.type==='hall')continue;const cx=X((q.u0+q.u1)/2),cy=Y((q.v0+q.v1)/2);g.font='bold 11px sans-serif';g.fillStyle='rgba(255,255,255,.8)';
  const t=q.label,w=g.measureText(t).width+6;g.fillRect(cx-w/2,cy-12,w,26);g.fillStyle='#2b2f33';g.fillText(t,cx,cy);g.font='10px sans-serif';g.fillText(`${(q.u1-q.u0).toFixed(2)} × ${(q.v1-q.v0).toFixed(2)}`,cx,cy+11);}
 g.font='11px sans-serif';g.fillStyle='#7a6d5c';g.fillText('calle',width/2,Y(0)+16);g.fillText(`${P.W} m`,width/2,Y(P.D)-8);}
