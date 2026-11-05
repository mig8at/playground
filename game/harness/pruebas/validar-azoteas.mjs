// Nivel 7 del probador (2026-10-17, REGLAS.md paso 2: «saltar por las azoteas, una barra de vida: si se bota del
// edificio, se mató»). Medido sobre el plano, con las reglas de engine/juego/huida.js:
//  · el salto: alcanceSalto (la fórmula) contra la parábola paso a paso como la mueve el 3D (DemoView: vy −= g·dt,
//    feet += vy·dt, a 60 cuadros por segundo), a ±3 %; danoDeCaida, de 0 en VIDA.segura a todo en VIDA.mortal;
//  · las azoteas de la ciudad (alto = pisos × 3 m): de cada techo, a qué otros se pasa —pegados (bajando lo que sea que
//    no mate, subiendo ≤ ALCANCE) o saltando un callejón o una calle (el hueco ≤ lo que se alcanza al caer el desnivel,
//    con medio metro de margen)— y cuánto duele. Se cuentan los techos con salida a otro sin morir y la red más grande.
//    Falla si menos de MIN_SALIDA de los techos con escalera tiene salida a otro: la huida por los techos no existiría.
// Uso: node scripts/validar-azoteas.mjs [ciudades=2] [semilla0=1]
import {generateBlueprint} from '../src/engine/blueprint.js';
import {alcanceSalto,danoDeCaida} from '../src/engine/juego/huida.js';
import {CIRCULACION as C,VIDA,ALCANCE,MANSARDA} from '../src/engine/medidas.js';
import {alturaMansarda} from '../src/engine/techos.js';

const A=process.argv.slice(2).filter(a=>!a.startsWith('--')),N=+(A[0]||2),S0=+(A[1]||1),PISO=3,MARGEN=.5,HUECO_MAX=16,MIN_SALIDA=.5;
const fallas=new Map();const falla=(k,ej)=>{const f=fallas.get(k)||fallas.set(k,{n:0,ej:[]}).get(k);f.n++;if(f.ej.length<3)f.ej.push(ej);};
// el salto, paso a paso como el 3D, para cada desnivel
const S=C.peaton.salto,V=C.peaton.velocidad.corre;
for(const dh of [0,1.5,3,6,9]){let vy=S.velocidad,y=0,x=0;const dt=1/60;for(let k=0;k<2000;k++){vy-=S.gravedad*dt;y+=vy*dt;x+=V*dt;if(y<=-dh&&vy<0)break;}
 const f=alcanceSalto(dh);if(Math.abs(x-f)/f>.03)falla('la fórmula del salto no coincide con el 3D',{desnivel:dh,formula:+f.toFixed(2),pasoAPaso:+x.toFixed(2)});}
if(danoDeCaida(VIDA.segura)!==0||danoDeCaida(VIDA.mortal)!==VIDA.max||danoDeCaida((VIDA.segura+VIDA.mortal)/2)<=0)falla('el daño de caída no va de segura a mortal',{});
const med={mansardas:0,techos:0,conEscalera:0,salida:0,salidaSinDano:0,pegados:0,saltos:0,mortales:0,red:[],ciudades:0};
for(let s=S0;s<S0+N;s++){const bp=generateBlueprint({seed:s,team:3});med.ciudades++;
 const T=[];bp.lots.forEach((L,li)=>{if(!L.parts?.length||!L.levels)return;const H=L.floors*PISO;for(const p of L.parts)T.push({li,H,esc:L.floors>=2&&L.levels.some(l=>l.core),x0:p.x,x1:p.x+p.w,z0:p.y,z1:p.y+p.h});});
 // los pasos de un techo a otro: pegados (comparten borde ≥ 1 m) o enfrentados a través de un hueco (con ≥ 1,5 m enfrentados)
 const pasos=new Map(T.map((t,i)=>[i,[]]));
 for(let i=0;i<T.length;i++)for(let j=0;j<T.length;j++){if(i===j||T[i].li===T[j].li)continue;const a=T[i],b=T[j];
  const ox=Math.min(a.x1,b.x1)-Math.max(a.x0,b.x0),oz=Math.min(a.z1,b.z1)-Math.max(a.z0,b.z0),gx=Math.max(b.x0-a.x1,a.x0-b.x1),gz=Math.max(b.z0-a.z1,a.z0-b.z1);
  let hueco=null;if(ox>=1&&gz>=-.01)hueco=Math.max(0,gz);else if(oz>=1&&gx>=-.01)hueco=Math.max(0,gx);if(hueco==null||hueco>HUECO_MAX)continue;
  // (el hueco tiene que estar vacío: en un lote en L la otra parte llena el «hueco» entre dos techos —2026-10-17,
  // validar-salto: se caía en ella—)
  if(hueco>=.05){const R=gz>=-.01&&ox>=1?{x0:Math.max(a.x0,b.x0),x1:Math.min(a.x1,b.x1),z0:Math.min(a.z1,b.z1),z1:Math.max(a.z0,b.z0)}:{x0:Math.min(a.x1,b.x1),x1:Math.max(a.x0,b.x0),z0:Math.max(a.z0,b.z0),z1:Math.min(a.z1,b.z1)};
   if(T.some(t=>t!==a&&t!==b&&t.x0<R.x1-.05&&t.x1>R.x0+.05&&t.z0<R.z1-.05&&t.z1>R.z0+.05))continue;}
  // (2026-10-18, la mansarda —techos.js—: por su pendiente de 72° se baja en el aire, no se toma carrera; desde una
  // mansarda se salta desde la cresta: MANSARDA.retiro más lejos y MANSARDA.alto más arriba, si ese lado tiene pendiente;
  // a una mansarda se cae en su pendiente: al pie, su techo de siempre)
  const La=bp.lots[a.li];let cresta=0;if(La.mansarda){const zgap=ox>=1&&gz>=-.01,m=zgap?(Math.max(a.x0,b.x0)+Math.min(a.x1,b.x1))/2:(Math.max(a.z0,b.z0)+Math.min(a.z1,b.z1))/2;
   const e=zgap?(b.z0>=a.z1-.01?a.z1-.3:a.z0+.3):(b.x0>=a.x1-.01?a.x1-.3:a.x0+.3),h=zgap?alturaMansarda(La.mansarda,m,e):alturaMansarda(La.mansarda,e,m);
   cresta=h<La.mansarda.alto-.01?1:2;med.mansardas++;}
  if(cresta)hueco+=cresta===1?MANSARDA.retiro:0;
  const dh=a.H+(cresta?MANSARDA.alto:0)-b.H;// (positivo: se baja)
  let puede=false,tipo;if(hueco<.05&&cresta!==1){tipo='pegado';puede=dh>=-ALCANCE;}else{tipo='salto';puede=(ox>=1.5||oz>=1.5)&&hueco+MARGEN<=alcanceSalto(dh);}
  if(!puede)continue;const dano=danoDeCaida(Math.max(0,dh));if(dano>=VIDA.max){med.mortales++;continue;}
  pasos.get(i).push({j,tipo,dano});}
 // por techo con escalera: ¿sale a otro sin morir? ¿sin daño? y la red más grande (lo que se alcanza desde un techo)
 for(let i=0;i<T.length;i++){med.techos++;if(!T[i].esc)continue;med.conEscalera++;const ps=pasos.get(i);if(ps.length)med.salida++;if(ps.some(p=>p.dano===0))med.salidaSinDano++;for(const p of ps)p.tipo==='pegado'?med.pegados++:med.saltos++;}
 let mayor=0;for(let i=0;i<T.length;i++){if(!T[i].esc)continue;const vis=new Set([i]),q=[i];while(q.length){const k=q.pop();for(const p of pasos.get(k))if(!vis.has(p.j)){vis.add(p.j);q.push(p.j);}}mayor=Math.max(mayor,new Set([...vis].map(k=>T[k].li)).size);}
 med.red.push(mayor);}
const parte=med.salida/Math.max(1,med.conEscalera);
if(parte<MIN_SALIDA)falla('pocos techos con salida a otro sin morir',{parte:+parte.toFixed(2),minimo:MIN_SALIDA});
console.log(`azoteas · ${N} ciudades · salto: ${alcanceSalto(0).toFixed(1)} m a nivel, ${alcanceSalto(PISO).toFixed(1)} m bajando un piso · caída segura ${VIDA.segura} m, mortal ${VIDA.mortal} m · techos ${med.techos} (con escalera ${med.conEscalera}) · con salida a otro sin morir ${(parte*100).toFixed(0)} % (sin daño ${(med.salidaSinDano/Math.max(1,med.conEscalera)*100).toFixed(0)} %) · pasos: ${med.pegados} pegados, ${med.saltos} saltando un hueco, ${med.mortales} que matarían · red más grande: ${med.red.join(', ')} edificios`);
console.log(`fallas: ${[...fallas.values()].reduce((a,f)=>a+f.n,0)}`);for(const [k,f] of fallas)console.log(`  ${f.n}\t${k}\n${f.ej.map(e=>'        '+JSON.stringify(e)).join('\n')}`);
