// ======== El contrato del 2D con el 3D (2026-10-16, decisión de Miguel: el 2D prueba todo) ========
// Lo que el 3D dibuja del plano sale de acá, y de ningún otro lado: por cada cosa del 2D —un árbol, una palmera, una
// sombrilla (bp.vegetacion) o una pieza del equipamiento (bp.equipamiento)— una entrada con dónde va (x, z: los mismos
// del plano), su giro, qué modelo la dibuja y qué medida tiene que tener. Es puro (sin THREE): el validador del
// probador lo lee en node y el 3D (src/lib/plano3d.js) sólo lo dibuja y anota lo que puso, con la medida real del modelo
// ya escalado, para compararlo en el navegador (window.__contrato.revisar()).
// Cada entrada: {id, capa, tipo, x, z, ang, kit, modelo, copa?, alto?, tronco? (el DAP), tint?, o?} — kit: 'nature2' (Naturaleza2),
// 'plants' (Cultivos: las palmeras) u 'objeto' (el catálogo de objetos3d.js, con su medida o: {w, d, h, color}).
import {VEGETACION} from './medidas.js';
import {cuerpoCasa} from './circulacion.js';

// La forma de cada especie: qué modelos la dibujan y su alto en función de la copa (el 2D da el radio de la copa, r).
// Proporciones de árboles maduros: copa ancha (alto ≈ 1,25 × el diámetro de la copa: un árbol de calle de 8 m de copa,
// 10 m de alto), esbelta (×1,6: el yarumo, el cedro), cónica (×2: el pino colombiano) y palma (×3: 5 m de copa, 15 de
// alto).
export const FORMAS={
 copa:{modelos:['CommonTree_1','CommonTree_2','CommonTree_3','CommonTree_4'],alto:1.25},
 esbelta:{modelos:['BirchTree_1','BirchTree_2','BirchTree_3'],alto:1.6},
 conica:{modelos:['CommonTree_5'],alto:2},
 palma:{modelos:null,alto:3}};
export const FORMA_ESPECIE={yarumo:'esbelta',cedro:'esbelta',encenillo:'esbelta',guayacan_manizales:'esbelta',pino_colombiano:'conica',coco:'palma',palma_real:'palma'};
export const PALMA_MODELO={coco:'PalmTree_3',palma_real:'PalmTree_4'};
// Las telas de las sombrillas: las pone el plano (VEGETACION.sombrilla.telas, una por concesión).
export const TELAS=VEGETACION.sombrilla.telas;
// El objeto del catálogo de cada pieza del equipamiento (las de pared o de piso, con su medida del plano).
// El objeto de cada botín (y a qué altura va: el cuadro, colgado; ry: su frente mira al cuarto —botin.js ang—).
export const OBJETO_BOTIN={caja_fuerte:'caja_fuerte',joyas:'vitrina',escultura:'escultura',cuadro:'cuadro'},ALTURA_BOTIN={cuadro:1.25};
// La placa de dirección (como las de Bogotá, un poco más grande para leerla en el juego): ancho × alto × fondo (m), lo que
// sale de la fachada, y a qué altura va su centro sobre el piso de adentro (encima del dintel de la puerta).
export const PLACA={ancho:.66,alto:.26,fondo:.03,sale:.14,edificio:2.78,casa:2.38};
export const OBJETO_EQUIPO={farol:'farol',banca:'banca',papelera:'papelera',cebra:'cebra',hidrante:'hidrante',semaforo:'semaforo',salvavidas:'salvavidas',kiosco:'kiosco',parada:'parada'};
// El giro en el 3D (ry, sobre y): el plano da ang como la dirección del LARGO de la pieza en x-z (cos ang, sin ang), y el
// x local del objeto girado por ry va a (cos ry, −sin ry): ry = −ang. El farol de calle va con su brazo (+z local, que
// girado va a (sin ry, cos ry)) hacia la calzada: ry = atan2(cos hacia, sin hacia). Igual todo lo que tiene frente (hacia): la parada mira a la calzada, la torre de
// salvavidas y el kiosco al mar. Los faroles peatonales, sin brazo.
// (el giro del semáforo: mira a su brazo —la calle que regula—; el frente del objeto es +z, girado por ry)
const BRAZO={N:Math.PI,S:0,E:Math.PI/2,W:-Math.PI/2};

const hash=(x,z,k=0)=>{let h=Math.imul((Math.round(x*10)|0)^0x9e3779b9,0x85ebca6b)^Math.imul((Math.round(z*10)|0)+k*7919,0xc2b2ae35);h^=h>>>13;h=Math.imul(h,0x27d4eb2f);return ((h^(h>>>16))>>>0)/4294967296;};
const hex=h=>[1,3,5].map(i=>parseInt(h.slice(i,i+2),16)/255),toHex=c=>'#'+c.map(v=>Math.round(Math.max(0,Math.min(1,v))*255).toString(16).padStart(2,'0')).join('');
// El tinte de un modelo: los de Naturaleza2 ya son verdes; multiplicados por el follaje se oscurecían. Se tiñen con el
// follaje (y la flor, si florece) llevado a brillo 1 y mezclado con blanco (60 %): cada especie con su color, sin apagar
// el modelo.
export function tinte(follaje,flor){const a=hex(follaje),b=flor?hex(flor):null,m=b?a.map((v,i)=>v*.45+b[i]*.55):a,k=Math.max(...m)||1;return toHex(m.map(v=>.6+.4*v/k));}

export function contrato(bp){const out=[],V=bp.vegetacion||{},E=bp.equipamiento||[],forma=e=>FORMA_ESPECIE[e]||'copa';
 // (una copa podada en óvalo —a.ra, a.eje: vegetacion.js V.poda—: copa a lo largo de la calle, copaAncho de ancho, y el
 // giro que pone el largo del modelo —su x— a lo largo del eje: ry = −eje; si no, al azar)
 (V.arboles||[]).forEach((a,i)=>{const F=FORMAS[forma(a.especie)],copa=2*a.r,esp=VEGETACION.especies.find(s=>s.id===a.especie);
  out.push({id:'arbol:'+i,capa:'vegetacion',tipo:'arbol',especie:a.especie,x:a.x,z:a.z,ang:a.ra?+(-a.eje).toFixed(4):+(hash(a.x,a.z,1)*Math.PI*2).toFixed(4),...(a.ra?{copaAncho:+(2*a.ra).toFixed(2)}:{}),kit:'nature2',modelo:F.modelos[Math.floor(hash(a.x,a.z,2)*F.modelos.length)],copa,alto:+(copa*F.alto).toFixed(2),tronco:+(copa/VEGETACION.tronco.copaPorDap).toFixed(3),tint:tinte(a.follaje||esp?.follaje||'#5f8a4b',esp?.flor)});});
 (V.palmeras||[]).forEach((a,i)=>{const copa=2*a.r;out.push({id:'palmera:'+i,capa:'vegetacion',tipo:'palmera',especie:a.especie,x:a.x,z:a.z,ang:+(hash(a.x,a.z,1)*Math.PI*2).toFixed(4),kit:'plants',modelo:PALMA_MODELO[a.especie]||'PalmTree_3',copa,alto:+(copa*FORMAS.palma.alto).toFixed(2),tronco:VEGETACION.tronco.palma[a.especie]??.35});});
 (V.sombrillas||[]).forEach((a,i)=>{out.push({id:'sombrilla:'+i,capa:'vegetacion',tipo:'sombrilla',x:a.x,z:a.z,ang:+(hash(a.x,a.z,1)*Math.PI*2).toFixed(4),kit:'objeto',modelo:'sombrilla',o:{w:2*a.r,d:2*a.r,color:a.tela||TELAS[0]}});});
 E.forEach((e,i)=>{const m=OBJETO_EQUIPO[e.tipo];if(!m)return;
  const modelo=e.tipo==='farol'&&e.peatonal?'farol_parque':m,ry=e.tipo==='semaforo'?BRAZO[e.brazo]??0:e.hacia!=null?Math.atan2(Math.cos(e.hacia),Math.sin(e.hacia)):-(e.ang||0);
  out.push({id:'equipo:'+i,capa:'equipamiento',tipo:e.tipo,x:e.x,z:e.z,ang:+ry.toFixed(4),kit:'objeto',modelo,...(e.tipo==='farol'?{alto:e.alto}:{}),o:{...(e.largo?{w:e.largo}:{}),...(e.fondo?{d:e.fondo}:{}),...(e.alto&&e.tipo==='salvavidas'?{h:e.alto}:{})}});});
 // las placas de dirección (direcciones.js): sobre cada puerta de calle, pegadas a la fachada y mirando a la calle; arriba de
 // la puerta —altura: la de su centro sobre el piso de adentro—. Su medida: PLACA (m).
 let np=0;const placa=(dir,x,z,nx,nz,alto)=>{if(!dir)return;out.push({id:'placa:'+(np++),capa:'direccion',tipo:'placa',x:+(x+nx*PLACA.sale).toFixed(3),z:+(z+nz*PLACA.sale).toFixed(3),ang:+Math.atan2(nx,nz).toFixed(4),kit:'placa',modelo:'placa',
  texto:dir.texto,via:dir.viaLarga,numero:`# ${dir.cruce}-${dir.metros}`,altura:alto,dentro:{x:+(x-nx*.4).toFixed(3),z:+(z-nz*.4).toFixed(3)},o:{w:PLACA.ancho,d:PLACA.fondo}});};
 for(const L of [...bp.lots,...(bp.isla?.lots||[]).filter(l=>l.levels)]){const lv=L.levels?.find(l=>l.level===0);if(!lv)continue;const dentro=(x,z)=>(L.parts||[]).some(p=>x>p.x&&x<p.x+p.w&&z>p.y&&z<p.y+p.h);
  for(const d of lv.doors||[]){if(!d.street||!d.direccion)continue;const hz=Math.abs(d.y1-d.y0)<1e-6,mx=(d.x0+d.x1)/2,mz=(d.y0+d.y1)/2,nx=hz?0:(dentro(mx+.3,mz)?-1:1),nz=hz?(dentro(mx,mz+.3)?-1:1):0;placa(d.direccion,mx,mz,nx,nz,PLACA.edificio);}}
 for(const h of bp.isla?.casas||[]){if(!h.direccion)continue;const c=cuerpoCasa(h);placa(h.direccion,c.puerta.x,c.puerta.z,c.afuera.x,c.afuera.z,PLACA.casa);}
 (bp.botines||[]).forEach((b,i)=>{const m=OBJETO_BOTIN[b.objeto];if(!m)return;out.push({id:'botin:'+i,capa:'botin',tipo:'botin',objeto:b.objeto,x:b.x,z:b.z,ang:+(b.ang||0).toFixed(4),kit:'objeto',modelo:m,o:{w:b.largo,d:b.fondo,...(b.objeto==='cuadro'?{h:.7}:{})},...(ALTURA_BOTIN[b.objeto]?{y0:ALTURA_BOTIN[b.objeto]}:{})});});
 return out;}
