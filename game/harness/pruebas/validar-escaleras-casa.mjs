// Valida la escalera de las casas de vivienda.js (las de la familia, hogar.js, y las del configurador) (2026-10-15).
// Uso: node scripts/validar-escaleras-casa.mjs
// Por casa de dos pisos: la escalera cabe (al pie queda ≥ 80 cm hasta la pared), la huella no baja de 22 cm, y por toda
// la subida el cuerpo (radio 22 cm, de 0,4 a 1,85 m sobre el peldaño) no toca ninguna caja de la casa.
import {planHouse,houseSpec,OPTIONS,STAIR,T,FH} from '../src/engine/vivienda.js';
import {HOGARES,planHogar} from '../src/engine/hogar.js';

const casos=[];
for(const ancho of OPTIONS.ancho)for(const fondo of OPTIONS.fondo)for(const arriba of OPTIONS.arriba)for(const garaje of OPTIONS.garaje)
 casos.push({nombre:`configurador ${ancho}×${fondo} ${arriba} garaje:${garaje}`,spec:houseSpec({ancho,fondo,pisos:2,arriba,garaje})});
for(const kind of Object.keys(HOGARES))for(let variant=0;variant<4;variant++){const hogar=planHogar(kind,{variant});if(hogar.floors>1)casos.push({nombre:`familia ${kind}#${variant}`,spec:houseSpec({pisos:2,hogar})});}
let malas=0;const fallas={};
for(const c of casos){let P;try{P=planHouse(c.spec);}catch(e){(fallas['no se arma']||(fallas['no se arma']=[])).push(c.nombre+': '+e.message);malas++;continue;}
 const r=P.ramps[0];if(!r){(fallas['sin escalera']||(fallas['sin escalera']=[])).push(c.nombre);malas++;continue;}
 const run=r.zLow-r.zHigh,tread=run/STAIR.steps,D=P.D,f=[];
 if(tread<.22-1e-6)f.push(`huella de ${(tread*100).toFixed(1)} cm`);
 const pie=(c.spec.arriba==='retirado'&&!c.spec.hogar?D-3:D)-T-r.zLow;if(pie<.8-1e-6)f.push(`al pie quedan ${pie.toFixed(2)} m`);
 const xc=(r.x0+r.x1)/2,R=.22;
 for(let z=r.zLow-.1;z>r.zHigh+.1;z-=.1){const y=r.yLow+(r.yHigh-r.yLow)*(r.zLow-z)/run,y0=y+.4,y1=y+1.85;
  const o=P.boxes.find(b=>b.x0<xc+R&&b.x1>xc-R&&b.z0<z+R&&b.z1>z-R&&b.y0<y1&&b.y1>y0);
  if(o){f.push(`choca a ${(r.zLow-z).toFixed(1)} m del pie (pies ${y.toFixed(2)}): ${o.cat} y ${o.y0.toFixed(2)}–${o.y1.toFixed(2)}`);break;}}
 if(f.length){malas++;for(const x of f){const k=x.replace(/[0-9.,–-]+/g,'#');(fallas[k]||(fallas[k]=[])).push(c.nombre+': '+x);}}}
console.log(`${casos.length} casas de dos pisos (ancho ${STAIR.w} m, ${STAIR.steps} peldaños) · ${malas} con fallas`);
for(const [k,l] of Object.entries(fallas)){console.log(`  ${l.length}\t${k}`);for(const e of l.slice(0,3))console.log('      '+e);}
process.exitCode=malas?1:0;
