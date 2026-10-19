// Dibujo del plano por etapas (engine/blueprint.js): la ciudad entera hasta la etapa elegida y el plano de un piso.
import {CELL,TYPES} from '../engine/blueprint.js';
import {City} from '../engine/index.js';
import {planHouse,FURN_SIZE,FLOOR0,FH} from '../engine/vivienda.js';
const K=City.K;
const css=name=>getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export const ROOM_LABEL={sala:'Sala',dormitorio:'Dormitorio',cocina:'Cocina',bano:'Baño',oficina:'Oficina',abierta:'Oficina abierta',reuniones:'Reuniones',
 cocineta:'Cocineta',habitacion:'Habitación',habitacion_h:'Habitación',enfermeria:'Enfermería',aula:'Aula',sala_prof:'Profesores',lectura:'Lectura',
 archivo:'Archivo',celda:'Celda',boveda:'Bóveda',local:'Local',recepcion:'Recepción',urgencias:'Urgencias',consultorio:'Consultorio',vestibulo:'Vestíbulo',
 garaje:'Garaje',deposito:'Depósito',sala_cocina:'Sala y cocineta',estudio:'Estudio',dormitorio_b:'Dormitorio',hall:'Hall',ropas:'Zona de ropas'};
// Colores del plano (claros también en modo oscuro: es un plano impreso, como el del juego).
const ROOM_COLOR={hall:'#efe9df',ropas:'#e2eef0',sala:'#f3e6cf',dormitorio:'#e8e0f0',cocina:'#f6eccd',bano:'#d9ecf2',oficina:'#dfe9f2',abierta:'#e3edf5',reuniones:'#e9e4f2',cocineta:'#f6eccd',
 habitacion:'#ede3ef',habitacion_h:'#f7e4e4',enfermeria:'#f7e9e9',aula:'#f1edcf',sala_prof:'#ece7d2',lectura:'#ece4d4',archivo:'#e4ddcf',celda:'#d6dde6',
 boveda:'#f2e3a6',local:'#f6ddd0',recepcion:'#e2ecf3',urgencias:'#f8dcdc',consultorio:'#f5e6e6',vestibulo:'#efede6',garaje:'#e2e2e2',deposito:'#e6dfd2',sala_cocina:'#f3e6cf',estudio:'#efe2d6',dormitorio_b:'#e8e0f0'};
// Las calles y los patios, también claros en modo oscuro (los del tema cambian).
const PAPER={street:'#fbfaf6',avenue:'#f0eee6',alley:'#f5eee1',courtyard:'#e9e3d0',border:'#7f877f',kiosk:'#97b596'};
const USE_COLOR={edificios:'#d3d8cf',parque:'#cfe2c8',plaza:'#e2eedd',patio:'#ece6d3',comisaria:'#b9cfe6'};
const ITEM_COLOR={sofa:'#b88b6a',cama:'#9c86b8',cama_s:'#9c86b8',litera:'#7a5a3a',cama_h:'#ffffff',catre:'#8a8f96',camilla:'#ffffff',armario:'#8b6a4e',estante:'#8b6a4e',archivador:'#7d8790',casillero:'#4f7fa8',caminadora:'#3a3e43',bicicleta:'#3a3e43',banco:'#24262a',mancuernas:'#5d6266',colchoneta:'#2f6f8f',espejo_pared:'#cfe3ea',perchero:'#8d969d',maniqui:'#e9e4dc',estanteria_ropa:'#c39a6b',probador:'#8a3b4a',
 escritorio:'#a7825f',pupitre:'#a7825f',mesa:'#b0906c',mesa_centro:'#b0906c',mesa_reunion:'#9a7b5b',mesa_lectura:'#a7825f',mostrador:'#8d7360',meson:'#c9c3b8',
 nevera:'#e8eef2',estufa:'#4b4f53',inodoro:'#ffffff',lavamanos:'#ffffff',ducha:'#bfe0ec',tv:'#2f3437',planta:'#7fae74',silla:'#5d6670',mesa_noche:'#8b6a4e',
 tablero:'#3f5a46',vehiculo:'#c0392b',caja:'#b98a4f',buzones:'#9aa3a8',caja_fuerte:'#5d6266'};

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
export function drawCityStage(canvas,bp,{cell,stage,level=0,selected=-1,fronts=true}){
 const {map}=bp,{W,H,kind}=map,dpr=window.devicePixelRatio||1,m=cell/CELL;// px por metro
 canvas.width=Math.round(W*cell*dpr);canvas.height=Math.round(H*cell*dpr);
 const g=canvas.getContext('2d');g.setTransform(dpr,0,0,dpr,0,0);
 // Etapa 1: el terreno con su rejilla de casillas.
 g.fillStyle=PAPER.courtyard;g.fillRect(0,0,W*cell,H*cell);
 if(stage===1){g.strokeStyle='rgba(0,0,0,.08)';g.lineWidth=1;g.beginPath();for(let x=0;x<=W;x++){g.moveTo(x*cell,0);g.lineTo(x*cell,H*cell);}for(let y=0;y<=H;y++){g.moveTo(0,y*cell);g.lineTo(W*cell,y*cell);}g.stroke();
  g.strokeStyle=PAPER.border;g.lineWidth=2;g.strokeRect(1,1,W*cell-2,H*cell-2);return;}
 // Etapa 2: calles y manzanas con su uso.
 const street={[K.street]:PAPER.street,[K.avenue]:PAPER.avenue,[K.alley]:PAPER.alley,[K.border]:PAPER.border};
 for(let y=0;y<H;y++)for(let x=0;x<W;x++){const k=kind[y*W+x];g.fillStyle=street[k]||(k===K.kiosk?PAPER.avenue:'#d3d8cf');g.fillRect(x*cell,y*cell,cell+.5,cell+.5);}
 for(const b of bp.blocks){g.fillStyle=USE_COLOR[b.use];g.fillRect(b.x0*cell,b.y0*cell,b.w*cell,b.h*cell);
  if(b.use==='plaza'||b.use==='parque'){for(let y=b.y0;y<=b.y1;y++)for(let x=b.x0;x<=b.x1;x++)if(kind[y*W+x]===K.kiosk){g.fillStyle=PAPER.kiosk;g.beginPath();g.arc((x+.5)*cell,(y+.5)*cell,cell*.32,0,7);g.fill();}}
  if(stage>=3)for(let y=b.y0;y<=b.y1;y++)for(let x=b.x0;x<=b.x1;x++)if(kind[y*W+x]===K.alley){g.fillStyle=PAPER.alley;g.fillRect(x*cell,y*cell,cell+.5,cell+.5);}}
 if(stage===2){g.strokeStyle='rgba(0,0,0,.25)';g.lineWidth=1;for(const b of bp.blocks)g.strokeRect(b.x0*cell+.5,b.y0*cell+.5,b.w*cell-1,b.h*cell-1);return;}
 // Etapa 3: lotes por tipo; patios de manzana.
 for(const c of bp.courts){g.fillStyle=PAPER.courtyard;g.fillRect(c.x0*cell,c.y0*cell,(c.x1-c.x0+1)*cell,(c.y1-c.y0+1)*cell);}
 for(const L of bp.lots){g.fillStyle=TYPES[L.type].color;for(const P of L.parts)g.fillRect(P.x*m,P.y*m,P.w*m,P.h*m);}
 // Etapas 5–8: el piso elegido de cada edificio, en chico.
 if(stage>=5)for(const L of bp.lots){const lv=L.levels[Math.min(level,L.levels.length-1)];if(level>=L.floors)continue;drawLevel(g,lv,{m,stage,small:true});}
 for(const L of bp.lots){g.strokeStyle=L.id===selected?'#c0392b':'rgba(40,46,50,.55)';g.lineWidth=L.id===selected?2.5:1;outline(g,L.parts,v=>v*m,v=>v*m);
  if(level>=L.floors&&stage>=5){g.fillStyle='rgba(255,255,255,.55)';for(const P of L.parts)g.fillRect(P.x*m,P.y*m,P.w*m,P.h*m);}
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
 g.fillStyle='#f4f2ec';for(const c of lv.corridor)R(c,(a,b,w,h)=>g.fillRect(a,b,w,h));
 const core=lv.core;g.fillStyle='#d7d4cc';R(core,(a,b,w,h)=>g.fillRect(a,b,w,h));
 if(!small){g.strokeStyle='#8b877f';g.lineWidth=1;// escalera en U: dos carriles con sus peldaños, el descanso al fondo y la pared al medio; ascensor: una X
  const st=lv.stair;if(st){const Pt=(a,b)=>[X(st.x+st.ux*a+st.vx*b),Y(st.z+st.uz*a+st.vz*b)],FR=st.fr,BK=st.bk,run=st.d-FR-BK,W=st.w||2,HW=W/2;g.beginPath();
   const N=st.steps||Math.max(8,Math.round(run/.25));for(let k=0;k<=N;k++){const b=FR+run*k/N;for(const [a0,a1] of [[0,HW],[HW,W]]){const [x0,y0]=Pt(a0,b),[x1,y1]=Pt(a1,b);g.moveTo(x0,y0);g.lineTo(x1,y1);}}
   const [cx0,cy0]=Pt(HW,FR),[cx1,cy1]=Pt(HW,FR+run);g.moveTo(cx0,cy0);g.lineTo(cx1,cy1);g.stroke();
   // flechas: sube por el carril A hacia el fondo y vuelve por el B
   g.strokeStyle='#5d5a54';g.beginPath();const [a0x,a0y]=Pt(HW/2,FR+.2),[a1x,a1y]=Pt(HW/2,FR+run+BK/2),[b1x,b1y]=Pt(W-HW/2,FR+run+BK/2),[b0x,b0y]=Pt(W-HW/2,FR+.2);g.moveTo(a0x,a0y);g.lineTo(a1x,a1y);g.lineTo(b1x,b1y);g.lineTo(b0x,b0y);g.stroke();}
  const L=lv.liftRect;if(L){g.strokeStyle='#8b877f';g.strokeRect(X(L.x+.2),Y(L.y+.2),(L.w-.4)*m,(L.h-.4)*m);g.beginPath();g.moveTo(X(L.x+.2),Y(L.y+.2));g.lineTo(X(L.x+L.w-.2),Y(L.y+L.h-.2));g.moveTo(X(L.x+L.w-.2),Y(L.y+.2));g.lineTo(X(L.x+.2),Y(L.y+L.h-.2));g.stroke();}}
 if(stage<6){g.strokeStyle='#5d5a54';g.lineWidth=small?.8:1.5;R(core,(a,b,w,h)=>g.strokeRect(a,b,w,h));return;}
 // Cuartos (6).
 for(const q of lv.rooms){g.fillStyle=ROOM_COLOR[q.type]||'#eee';R(q,(a,b,w,h)=>g.fillRect(a,b,w,h));}
 g.strokeStyle='#3a3d40';g.lineWidth=small?.7:2;for(const q of [...lv.rooms,core])R(q,(a,b,w,h)=>g.strokeRect(a,b,w,h));
 // Cada departamento, con su contorno más grueso (la pared que lo separa del vecino y del pasillo).
 if(lv.units?.length){g.strokeStyle='#1f2224';g.lineWidth=small?1.3:4;for(const u of lv.units)R(u,(a,b,w,h)=>g.strokeRect(a,b,w,h));}
 // Puertas y ventanas (7): la puerta corta la pared; la ventana es una doble raya celeste.
 if(stage>=7){for(const d of lv.doors){g.strokeStyle=d.street?'#f4f2ec':'#f4f2ec';g.lineWidth=small?1.4:4;g.beginPath();g.moveTo(X(d.x0),Y(d.y0));g.lineTo(X(d.x1),Y(d.y1));g.stroke();
    // La hoja: gira desde una jamba hacia adentro del cuarto (un cuarto de círculo).
   if(!small&&!d.core&&!d.wide){const room=lv.rooms.find(q=>q.id===d.a)||lv.rooms.find(q=>q.id===d.b);if(room){
    const len=Math.hypot(d.x1-d.x0,d.y1-d.y0),ux=(d.x1-d.x0)/len,uy=(d.y1-d.y0)/len,cx=room.x+room.w/2,cy=room.y+room.h/2;
    let nx=-uy,ny=ux;if((cx-d.x0)*nx+(cy-d.y0)*ny<0){nx=-nx;ny=-ny;}
    g.strokeStyle=d.street?'#c0392b':'#7d7972';g.lineWidth=1.2;g.beginPath();g.moveTo(X(d.x0),Y(d.y0));g.lineTo(X(d.x0+nx*len),Y(d.y0+ny*len));
    const a0=Math.atan2(ny,nx),a1=Math.atan2(uy,ux);let da=a1-a0;da=Math.atan2(Math.sin(da),Math.cos(da));g.arc(X(d.x0),Y(d.y0),len*m,a0,a0+da,da<0);g.stroke();}}}
  g.strokeStyle='#5aa9d6';g.lineWidth=small?1.2:3.5;for(const w of lv.windows){g.beginPath();g.moveTo(X(w.x0),Y(w.y0));g.lineTo(X(w.x1),Y(w.y1));g.stroke();}}
 // Muebles (8).
 if(stage>=8)for(const f of lv.furniture){g.fillStyle=ITEM_COLOR[f.kind]||'#999';R(f,(a,b,w,h)=>g.fillRect(a,b,w,h));
  if(!small){g.strokeStyle='rgba(0,0,0,.35)';g.lineWidth=.8;R(f,(a,b,w,h)=>g.strokeRect(a,b,w,h));
   if(f.kind==='caja'){g.beginPath();R(f,(a,b,w,h)=>{g.moveTo(a,b);g.lineTo(a+w,b+h);g.moveTo(a+w,b);g.lineTo(a,b+h);});g.stroke();}}
  if(f.pc){g.fillStyle='#2f7fc0';const s=Math.min(f.w,f.h)*.6;g.fillRect(X(f.x+f.w/2)-s*m/2,Y(f.y+f.h/2)-s*m/4,s*m,s*m/2);}}
 if(labels&&stage>=6){g.font='600 11px system-ui,sans-serif';g.textAlign='center';g.textBaseline='middle';
  for(const q of lv.rooms){if(q.w*m<34)continue;const t=ROOM_LABEL[q.type]||q.type;g.fillStyle='rgba(40,44,48,.8)';g.fillText(t,X(q.x+q.w/2),Y(q.y+q.h/2)-(stage>=8?q.h*m/2-9:0));}
  // El número de cada departamento, sobre su sala (o su estudio).
  g.font='700 11px ui-monospace,monospace';for(const u of lv.units||[]){const s=lv.rooms.find(q=>q.unit===u.n&&(q.type==='sala'||q.type==='sala_cocina'||q.type==='estudio'));if(!s)continue;
   const t='Apto '+u.n,tw=g.measureText(t).width+10,cx=X(s.x+s.w/2),cy=Y(s.y+s.h/2)+(stage>=8?s.h*m/2-12:14);g.fillStyle='rgba(31,34,36,.82)';g.fillRect(cx-tw/2,cy-8,tw,16);g.fillStyle='#fff';g.fillText(t,cx,cy);}}
}

// El plano grande de un piso del edificio L (centrado en el canvas, con escala en metros).
export function drawFloorPlan(canvas,L,{level,stage,width}){
 const dpr=window.devicePixelRatio||1,pad=26,r=L.rect,m=Math.min(42,(width-2*pad)/r.w),hgt=r.h*m+2*pad;
 canvas.width=Math.round(width*dpr);canvas.height=Math.round(hgt*dpr);canvas.style.height=hgt+'px';
 const g=canvas.getContext('2d');g.setTransform(dpr,0,0,dpr,0,0);g.clearRect(0,0,width,hgt);
 const ox=r.x-(width/m-r.w)/2,oy=r.y-pad/m;
 g.fillStyle=TYPES[L.type].color;for(const P of L.parts)g.fillRect((P.x-ox)*m,(P.y-oy)*m,P.w*m,P.h*m);
 // Rejilla de 1 m.
 g.save();g.beginPath();for(const P of L.parts)g.rect((P.x-ox)*m,(P.y-oy)*m,P.w*m,P.h*m);g.clip();
 g.strokeStyle='rgba(0,0,0,.06)';g.lineWidth=1;g.beginPath();for(let x=0;x<=r.w;x++){g.moveTo((r.x+x-ox)*m,(r.y-oy)*m);g.lineTo((r.x+x-ox)*m,(r.y+r.h-oy)*m);}for(let y=0;y<=r.h;y++){g.moveTo((r.x-ox)*m,(r.y+y-oy)*m);g.lineTo((r.x+r.w-ox)*m,(r.y+y-oy)*m);}g.stroke();g.restore();
 // El contorno antes que el piso: así puertas y ventanas de la fachada quedan encima.
 g.strokeStyle='#1f2224';g.lineWidth=5;g.lineCap='square';outline(g,L.parts,v=>(v-ox)*m,v=>(v-oy)*m);g.lineCap='butt';
 if(stage>=5)drawLevel(g,L.levels[level],{m,stage,ox,oy,labels:true});
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
const ISLA_COL={pradera:'#b9cf8e',playa:'#ecdcae',agua:'#a9d2e3',agua_honda:'#7fb3d5'};
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
export function drawHouse(g,c,{stage,level}){let P=houseCache.get(c);if(!P){P=planHouse(c.spec);houseCache.set(c,P);}
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
  if(stage>=8)for(const f of P.furniture){const sz=FURN_SIZE[f.m];if(!sz||Math.abs(f.y-y0)>.5)continue;g.save();g.translate(f.x,f.z);g.rotate(-(f.rot||0));g.fillStyle=/Bed/.test(f.m)?'#9c86b8':/Sofa|Couch/.test(f.m)?'#b88b6a':/Kitchen/.test(f.m)?'#c9c3b8':/Bathroom/.test(f.m)?'#ffffff':'#a7825f';
   g.fillRect(-sz[0]/2,-sz[1]/2,sz[0],sz[1]);g.restore();}
  if(stage>=8&&HL)for(const f of HL.furniture){g.fillStyle=ITEM_COLOR[f.kind]||'#a7825f';g.fillRect(hx(f.u0),hz(f.v1),f.u1-f.u0,f.v1-f.v0);}}
 g.strokeStyle='#6b4e36';g.lineWidth=.35;g.strokeRect(-P.w/2,-P.d/2,P.w,P.d);g.restore();}
export function drawIslaStage(canvas,bp,{cell,stage=9,level=0,selected=-1,fronts=true,dim=true}){
 const I=bp.isla,B=I.bounds,dpr=window.devicePixelRatio||1,m=cell/CELL,city=document.createElement('canvas');
 drawCityStage(city,bp,{cell,stage:Math.min(stage,8),level,selected,fronts});
 canvas.width=Math.round((B.x1-B.x0)*cell*dpr);canvas.height=Math.round((B.y1-B.y0)*cell*dpr);const g=canvas.getContext('2d');
 g.setTransform(1,0,0,1,0,0);g.fillStyle='#2b3a44';g.fillRect(0,0,canvas.width,canvas.height);g.drawImage(city,-B.x0*cell*dpr,-B.y0*cell*dpr);
 g.setTransform(dpr*m,0,0,dpr*m,-B.x0*cell*dpr,-B.y0*cell*dpr);g.globalAlpha=dim&&level>0?.5:1;
 // 1: el terreno; desde la 2, las terrazas del monte (el suelo aplanado de cada manzana) con el borde de cada manzana
 for(const q of I.cells){g.fillStyle=q.plaza!=null?'#e6dfcd':stage>=2&&q.terraza!=null?'#dccfae':q.zona==='montaña'?`hsl(${80-Math.min(40,q.h/3)},${Math.max(8,28-q.h/4)}%,${Math.min(78,52+q.h/4)}%)`:ISLA_COL[q.zona];g.fillRect(q.x*CELL,q.y*CELL,CELL+.05,CELL+.05);
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
  if(stage>=5)drawLevel(g,L.levels[level],{m,stage,small:true});
  g.strokeStyle=L.id===selected?'#c0392b':ISLA_BORDE[L.kind]||'rgba(40,46,50,.7)';g.lineWidth=L.id===selected?2.5:L.kind==='puesto'||L.kind==='tienda'?2.2:1.2;outline(g,L.parts,v=>v*m,v=>v*m);
  if((L.kind==='puesto'||L.kind==='tienda')&&level===0){const q=L.rect,t=L.kind==='puesto'?'POLICÍA':'TIENDA';const fs=Math.max(6,m*1.1);g.font=`bold ${fs}px sans-serif`;g.textAlign='center';const w=g.measureText(t).width+3,cx=(q.x+q.w/2)*m,y=q.y*m-2;
   g.fillStyle=L.kind==='puesto'?'#2f5f9a':'#c0672f';g.fillRect(cx-w/2,y-fs,w,fs+2);g.fillStyle='#fff';g.fillText(t,cx,y);}}
 g.setTransform(dpr*m,0,0,dpr*m,-B.x0*cell*dpr,-B.y0*cell*dpr);
 // Las casas armadas del monte, con su plano (etapa 3 en adelante).
 if(stage>=3)for(const c of I.casas||[])if(c.spec)drawHouse(g,c,{stage,level});
 if(level===0){g.font='bold 5px sans-serif';g.textAlign='center';g.fillStyle='#3b4446';
  // El nombre de cada pueblo, sobre su plaza (con un fondo para que se lea).
  for(const P of I.pueblos||[]){const x=(P.x+.5)*CELL,y=(P.y+.5)*CELL,w=g.measureText(P.name).width+3;g.fillStyle='rgba(255,252,244,.85)';g.fillRect(x-w/2,y-4.2,w,6);g.fillStyle=P.kind==='costa'?'#2f5f7a':'#4b5a2e';g.fillText(P.name,x,y);}
  g.fillStyle='#3b4446';
  if(I.globo){const {x,y}=I.globo;g.fillStyle='#e0503a';g.beginPath();g.arc(x,y-2.2,2.4,0,7);g.fill();g.strokeStyle='#5a4632';g.lineWidth=.3;g.beginPath();g.moveTo(x-1.5,y-.8);g.lineTo(x-.7,y+.6);g.moveTo(x+1.5,y-.8);g.lineTo(x+.7,y+.6);g.stroke();g.fillStyle='#8a6a4c';g.fillRect(x-.8,y+.6,1.6,1.2);g.fillStyle='#3b4446';g.fillText('globo',x,y+7);}
  if(I.parapente){const {x,y}=I.parapente;g.fillStyle='#4f7fa8';g.beginPath();g.ellipse(x,y-1.6,3.2,1.3,0,Math.PI,0);g.fill();g.strokeStyle='#3b4446';g.lineWidth=.2;g.beginPath();g.moveTo(x-3,y-1.6);g.lineTo(x,y+.8);g.lineTo(x+3,y-1.6);g.stroke();g.fillStyle='#3b4446';g.fillText('parapente',x,y+6);}}
 g.setTransform(1,0,0,1,0,0);return {x0:B.x0,y0:B.y0};}

// ---------- Las casas desde la familia (engine/hogar.js, 2026-10-12) ----------
// El plano de un piso: cuartos (con su nombre y medida), paredes, puertas (con su giro), ventanas y muebles. u a lo
// ancho, v hacia el fondo; el frente (la calle) abajo del dibujo.
export function drawHogar(canvas,P,{level=0,width=560}={}){
 const dpr=window.devicePixelRatio||1,pad=30,m=Math.min(56,(width-2*pad)/P.W),hgt=P.D*m+2*pad+18;
 canvas.width=Math.round(width*dpr);canvas.height=Math.round(hgt*dpr);canvas.style.width=width+'px';canvas.style.height=hgt+'px';
 const g=canvas.getContext('2d');g.setTransform(dpr,0,0,dpr,0,0);g.clearRect(0,0,width,hgt);
 const ox=(width-P.W*m)/2,X=u=>ox+u*m,Y=v=>pad+(P.D-v)*m;// (el frente abajo)
 const L=P.levels[Math.min(level,P.levels.length-1)],COL={...ROOM_COLOR,escalera:'#e4ddd0',hall:'#efe9df',deposito:'#e4ddcf',oficina:'#e9e4d6'};
 for(const q of L.rooms){g.fillStyle=COL[q.type]||'#eee';g.fillRect(X(q.u0),Y(q.v1),(q.u1-q.u0)*m,(q.v1-q.v0)*m);}
 // la escalera: sus peldaños
 for(const q of L.rooms.filter(q=>q.type==='escalera')){g.strokeStyle='#b9ad98';g.lineWidth=1;for(let v=q.v0+.25;v<q.v1;v+=.27){g.beginPath();g.moveTo(X(q.u0),Y(v));g.lineTo(X(q.u1),Y(v));g.stroke();}}
 for(const f of L.furniture){g.fillStyle=ITEM_COLOR[f.kind]||'#999';g.fillRect(X(f.u0),Y(f.v1),(f.u1-f.u0)*m,(f.v1-f.v0)*m);g.strokeStyle='rgba(0,0,0,.25)';g.lineWidth=.8;g.strokeRect(X(f.u0),Y(f.v1),(f.u1-f.u0)*m,(f.v1-f.v0)*m);}
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
