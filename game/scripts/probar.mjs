// El probador del 2D (2026-10-16, decisión de Miguel: el 2D prueba todo; cualquier arreglo del 3D se corrige en el 2D).
// Por NIVELES, de lo más grande a lo más chico (2026-10-16, Miguel: «niveles de pruebas empezando por lo más grande hasta
// lo más chico»): un error grande —una calle mal puesta— se arrastra y hace fallar todo lo de abajo, así que se corre un
// nivel por vez (sus pruebas en paralelo) y, si uno falla, los de abajo no se corren: los números que quedan apuntan a la
// causa y no a sus consecuencias. Al final, una tabla por nivel con el peor caso de cada prueba que falla y su detalle.
// Cómo se corre (2026-10-18, Miguel: «optimizar las pruebas haciendo paralelismo donde se pueda»): ya no de a un nivel —se
// esperaba a la prueba más lenta de cada nivel para empezar el siguiente—; todas a la vez, mientras alcancen los núcleos,
// la memoria y los navegadores (cada prueba dice cuánto usa: costo), las más largas primero (lo que tardaron la última
// vez: referencias/tiempos.json). El informe sale igual, por nivel; y si un nivel falla (sin --seguir), se cortan las de
// los niveles de abajo que estén corriendo y no se informan: la regla de arriba sigue valiendo. Las pruebas que van ciudad
// por ciudad sin mirar el conjunto (partir) se corren de a una ciudad por proceso y se suman sus fallas.
// Uso: node scripts/probar.mjs [ciudades=4] [semilla0=1] [--rapido: 1 ciudad y sin las pruebas lentas —para el día a día;
//      la entera, antes de dar algo por terminado—] [--nivel=3 | --nivel=2-5]
//      [--solo=nombre,nombre] [--seguir: no cortar en el nivel que falla] [--todo: salida completa de cada prueba] [--tiempo=600: s que puede tardar cada prueba]
import {spawn} from 'node:child_process';import {cpus,totalmem} from 'node:os';import {existsSync,readFileSync,writeFileSync} from 'node:fs';import {fileURLToPath} from 'node:url';import {dirname,join} from 'node:path';

const A=process.argv.slice(2),num=A.filter(a=>!a.startsWith('--')),RAP=A.includes('--rapido'),TODO=A.includes('--todo'),SEGUIR=A.includes('--seguir');
const N=String(RAP?1:+(num[0]||4)),S0=String(+(num[1]||1)),solo=(A.find(a=>a.startsWith('--solo='))||'').slice(7).split(',').filter(Boolean);
const nv=(A.find(a=>a.startsWith('--nivel='))||'').slice(8),[NV0,NV1]=nv?(nv.includes('-')?nv.split('-').map(Number):[+nv,+nv]):[0,99];
const aqui=dirname(fileURLToPath(import.meta.url)),grande=['--max-old-space-size=8192'],F=/^fallas: (\d+)/m;
// Los niveles: qué valida cada uno y sus pruebas (script, argumentos, cómo se leen sus fallas y qué línea resume).
const NIVELES=[
 {n:0,t:'Medidas',d:'cada número con una sola fuente, y las reglas que salen de otras cuadran',p:[
  {n:'medidas',f:'validar-medidas.mjs',a:[],fallas:F,res:/^medidas/}]},
 {n:1,t:'Mundo',d:'la isla, la montaña, la ciudad y las zonas prohibidas',p:[
  {n:'mundo',f:'validar-mundo.mjs',a:[N,S0],fallas:F,res:/^\d+ mundos/},
  {n:'zonas',f:'validar-zonas.mjs',a:[N,S0],fallas:F,res:/^descartados/}]},
 {n:2,t:'Vías y manzanas',d:'calles, pendientes, terrazas, cruces, carriles, direcciones',p:[
  {n:'circulación',f:'validar-circulacion.mjs',a:[N,S0],fallas:F,res:/^vehículos/,node:grande},
  {n:'terrazas',f:'validar-terrazas.mjs',a:[N,S0],fallas:F,res:/^terrazas/},
  {n:'tráfico',f:'validar-trafico.mjs',a:[N,S0],fallas:F,res:/^tráfico/},
  {n:'tránsito',f:'validar-transito.mjs',a:[N,S0],fallas:F,res:/^tránsito ·/},
  {n:'direcciones',f:'validar-direcciones.mjs',a:[N,S0],fallas:F,res:/^direcciones/},
  {n:'ubicación',f:'validar-ubicacion.mjs',a:[N,S0],fallas:F,res:/^ubicación/}]},
 {n:3,t:'Lotes y edificios',d:'plantas, pisos, escaleras, fachadas y el acceso a los patios',p:[
  {n:'ciudad',f:'validar-ciudad.mjs',a:[N,S0],fallas:/edificios con alguna falla: (\d+)/,res:/^\d+ ciudades/},
  {n:'núcleos',f:'validar-nucleos.mjs',a:[N,S0],fallas:/(\d+) con fallas/,res:/con escalera/},
  {n:'escaleras de casa',f:'validar-escaleras-casa.mjs',a:[],fallas:/(\d+) con fallas/,res:/casas de dos pisos/},
  {n:'vanos de casa',f:'validar-vanos.mjs',a:[Math.min(N,3),S0],fallas:F,res:/^vanos/},
  {n:'fachada y uso',f:'validar-fachada-uso.mjs',a:[N,S0],fallas:F,res:/^fachada y uso/},
  {n:'fachada 3D',f:'validar-fachada3d.mjs',a:[],fallas:F,res:/^fachada low poly/},
  {n:'patios',f:'validar-patios.mjs',a:[N,S0],fallas:F,res:/^patios/}]},
 {n:4,t:'Interiores',d:'pasillos, muebles, usos y cortinas',p:[
  {n:'pasillos',f:'validar-pasillos.mjs',a:[N,S0],fallas:F,res:/^pasillos libres/},
  {n:'interiores',f:'validar-interiores.mjs',a:[N,S0],fallas:F,res:/^se llega caminando/},
  {n:'muebles',f:'validar-muebles.mjs',a:[N,S0],fallas:F,res:/^muebles/},
  {n:'usos',f:'validar-usos.mjs',a:[N,S0],fallas:F,res:/^usos/},
  {n:'aulas',f:'validar-aulas.mjs',a:[N,S0],fallas:F,res:/^aulas/},
  {n:'giros',f:'validar-giros.mjs',a:[N,S0],fallas:F,res:/^giros/},
  {n:'cortinas',f:'validar-cortinas.mjs',a:[N,S0],fallas:F,res:/^cortinas/}]},
 {n:5,t:'Exterior',d:'árboles, equipamiento, pintura, color y botín',p:[
  {n:'vegetación',f:'validar-vegetacion.mjs',a:[N,S0],fallas:F,res:/^3-30-300/},
  {n:'equipamiento',f:'validar-equipamiento.mjs',a:[N,S0],fallas:F,res:/^cobertura/},
  {n:'pintura',f:'validar-pintura.mjs',a:[N,S0],fallas:F,res:/^pintura/},
  {n:'color',f:'validar-color.mjs',a:[N,S0],fallas:F,res:/^color/,lento:true},
  {n:'botín',f:'validar-botin.mjs',a:[N,S0,'--equipos=3,8'],fallas:F,res:/^reparto:/,node:grande,lento:true}]},
 {n:6,t:'Geometría sin pantalla',d:'lo que se dibuja contra el plano: piezas en su lugar, caras que no titilan, sin huecos ni triángulos que nunca se ven, empalmes al milímetro y objetos que no se tapan',p:[
  {n:'titileo',f:'validar-titileo.mjs',a:[1,S0],fallas:F,res:/^titileo/},
  {n:'contrato 3D',f:'validar-contrato.mjs',a:[N,S0],fallas:F,res:/entradas del contrato/,lento:true},
  {n:'huecos',f:'validar-huecos.mjs',a:[2,S0],fallas:F,res:/^huecos/,node:grande},
  {n:'triángulos',f:'validar-triangulos.mjs',a:[1,S0,'--mundo'],fallas:F,res:/^triángulos/,node:['--max-old-space-size=12000']},
  {n:'empalmes',f:'validar-empalmes.mjs',a:[RAP?1:2,S0],fallas:F,res:/^empalmes/,node:['--max-old-space-size=12000']},
  {n:'oclusión',f:'validar-oclusion.mjs',a:[RAP?1:2,S0],fallas:F,res:/^oclusión/,node:['--max-old-space-size=12000']}]},
 {n:7,t:'Física',d:'por dónde se pasa, qué frena y que el suelo que se pisa sea el que se ve, y las azoteas: saltar de un techo a otro y lo que duele caer',p:[
  {n:'azoteas',f:'validar-azoteas.mjs',a:[N,S0],fallas:F,res:/^azoteas/},
  {n:'mansarda',f:'validar-mansarda.mjs',a:[N,S0],fallas:F,res:/^mansarda/},
  {n:'azoteas con objetos',f:'validar-azoteas-objetos.mjs',a:[N,S0],fallas:F,res:/^azoteas con objetos/},
  {n:'colisiones',f:'validar-colisiones.mjs',a:[N,S0],fallas:F,res:/^paso libre/,node:grande},
  {n:'suelo',f:'validar-suelo.mjs',a:[2,S0],fallas:F,res:/^suelo/,node:grande},
  {n:'pisos',f:'validar-pisos.mjs',a:[RAP?1:2,S0],fallas:F,res:/^pisos/,node:grande}]},
 {n:8,t:'Visibilidad',d:'qué se ve desde adentro y qué se aclara',p:[
  {n:'visibilidad',f:'validar-visibilidad.mjs',a:[2,S0],fallas:F,res:/^visibilidad/},
  {n:'visibles',f:'validar-visibles.mjs',a:[2,S0,800],fallas:F,res:/^visibles/,lento:true}]},
 {n:9,t:'Juego',d:'recorridos, distancias, reparto entre equipos, un solo cuerpo, las guaridas, las viviendas, el motor del modo «Botín», el allanamiento, la sociedad (familias, trabajos y horarios) y la rutina (agenda, necesidades, buses y eventos)',p:[
  {n:'juego',f:'validar-juego.mjs',a:[N,S0],fallas:F,res:/^a pie:/,node:grande},
  {n:'cuerpo',f:'validar-cuerpo.mjs',a:[],fallas:F,res:/^cuerpo/},
  {n:'guaridas',f:'validar-guaridas.mjs',a:[N,S0],fallas:F,res:/^guaridas/},
  {n:'viviendas',f:'validar-viviendas.mjs',a:[N,S0],fallas:F,res:/^viviendas/},
  {n:'motor botín',f:'validar-botin.mjs',a:[N,S0,3],fallas:F,res:/^motor/},
  {n:'sociedad',f:'validar-sociedad.mjs',a:[N,S0,14],fallas:F,res:/^sociedad/},
  {n:'caminar',f:'validar-caminar.mjs',a:[S0],fallas:F,res:/^caminar a las 15/},
  {n:'descanso',f:'validar-descanso.mjs',a:[Math.min(N,2),S0],fallas:F,res:/^descanso · ciudad/},
  {n:'identidad',f:'validar-identidad.mjs',a:[Math.min(N,2),S0],fallas:F,res:/^identidad · ciudad/},
  {n:'allanamiento',f:'validar-allanamiento.mjs',a:[Math.min(N,3),S0],fallas:F,res:/^allanamiento ·/,node:grande},
  {n:'rutina',f:'validar-rutina.mjs',a:[N,S0],fallas:F,res:/^rutina/}]},
 {n:10,t:'Pantalla',d:'el 3D de verdad en un navegador sin ventana: costo de cada cuadro, capturas, errores, asomarse por una ventana, la ronda del ladrón y la del policía',p:[
  {n:'3d',f:'validar-3d.mjs',a:[S0],fallas:F,res:/^3d/,lento:true},
  {n:'asomarse',f:'validar-asomarse.mjs',a:[S0],fallas:F,res:/^asomarse/,lento:true},
  {n:'ronda',f:'validar-ronda.mjs',a:[S0],fallas:F,res:/^ronda/,lento:true},
  {n:'allanar 3d',f:'validar-allanar3d.mjs',a:[S0],fallas:F,res:/^allanar ·/,lento:true},
  {n:'tránsito 3d',f:'validar-transito3d.mjs',a:[S0],fallas:F,res:/^tránsito 3d/,lento:true},
  {n:'caídas',f:'validar-caidas.mjs',a:[S0],fallas:F,res:/^caídas/,lento:true},
  {n:'salto',f:'validar-salto.mjs',a:[S0],fallas:F,res:/^salto/,lento:true},
  {n:'entrada',f:'validar-entrada.mjs',a:[],fallas:F,res:/^entrada/},
  {n:'policía',f:'validar-policia.mjs',a:[S0],fallas:F,res:/^policía/,lento:true},
  {n:'gente',f:'validar-gente.mjs',a:[S0],fallas:F,res:/^gente/,lento:true},
  {n:'fluidez',f:'validar-fluidez.mjs',a:[S0],fallas:F,res:/^fluidez/,lento:true},
  {n:'patrulla',f:'validar-patrulla.mjs',a:[S0],fallas:F,res:/^patrulla/,lento:true},
  {n:'menú',f:'validar-menu.mjs',a:[S0],fallas:F,res:/^menú/,lento:true},
  {n:'ladrón',f:'validar-ladron.mjs',a:[S0],fallas:F,res:/^ladrón/,lento:true}]}]
 .filter(L=>L.n>=NV0&&L.n<=NV1).map(L=>({...L,p:L.p.filter(p=>(!solo.length||solo.some(s=>p.n.startsWith(s)))&&!(RAP&&p.lento&&!solo.length))})).filter(L=>L.p.length);
// El peor caso de una salida: el tipo de falla con más casos y su primer ejemplo (el formato «  N\ttipo» + ejemplos).
const peor=out=>{const L=out.split('\n'),i=L.findIndex(l=>F.test(l));if(i<0)return null;let best=null;
 for(let k=i+1;k<L.length;k++){const m=/^\s+(\d+)\t(.+)$/.exec(L[k]);if(m&&(!best||+m[1]>best.n))best={n:+m[1],tipo:m[2].trim(),ej:(L[k+1]||'').trim()};}return best;};
// (2026-10-18: una prueba que se cuelga —la del dron quedó 1 h 30 min esperando a un navegador que no contestaba— ya no
// frena la corrida: a los TIEMPO s se mata con todo lo que abrió —su grupo de procesos: el navegador también— y cuenta
// como error. Las del 3D —nivel 10, un navegador cada una— van de a TOPE_3D a la vez: con más, la máquina no da y se
// cortan solas («la página no contestó»); si una se corta así —un error, no una falla—, se reintenta una vez y se avisa)
const TIEMPO=+(process.argv.find(a=>a.startsWith('--tiempo='))?.slice(9)||600),TOPE_3D=2;
const correr=(p,vivo=()=>{})=>new Promise(ok=>{const t=Date.now(),ch=spawn(process.execPath,[...(p.node||[]),join(aqui,p.f),...p.a],{cwd:join(aqui,'..'),detached:true});vivo(ch);let out='',vencio=false;
 const reloj=setTimeout(()=>{vencio=true;out+=`\nse pasó de ${TIEMPO} s: se cortó (con su navegador)\n`;try{process.kill(-ch.pid,'SIGKILL');}catch{try{ch.kill('SIGKILL');}catch{}}},TIEMPO*1000);
 ch.stdout.on('data',d=>out+=d);ch.stderr.on('data',d=>out+=d);ch.on('close',code=>{clearTimeout(reloj);const m=vencio?null:out.match(p.fallas),res=vencio?`se pasó de ${TIEMPO} s`:out.split('\n').find(l=>p.res.test(l))||'';
  ok({...p,seg:(Date.now()-t)/1000,fallas:m?+m[1]:null,error:vencio||code!==0||!m,vencio,res:res.trim(),out,peor:peor(out)});});});
// ---- el planificador ----
// recursos: núcleos (uno libre para la máquina), memoria (el 70 %, en GB) y navegadores a la vez (TOPE_3D); el costo de una
// prueba: un núcleo y 1 GB; las de node grande 3 GB, las de 12 GB 6; las del 3D, un navegador, dos núcleos y 2,5 GB
const CPUS=Math.max(2,cpus().length-1),MEM=Math.floor(totalmem()/2**30*.7),TIEMPOS=join(aqui,'referencias','tiempos.json');
const costo=(p,L)=>L.n===10?{cpu:2,mem:2.5,nav:1}:{cpu:1,mem:(p.node||[]).some(a=>/12000/.test(a))?6:p.node?3:1,nav:0};
const previo=existsSync(TIEMPOS)?JSON.parse(readFileSync(TIEMPOS,'utf8')):{};
const t0=Date.now(),hechos=[];let corte=null;
// los trabajos: cada prueba, o cada ciudad de una prueba partida
const grupos=[],trabajos=[];
for(const [li,L] of NIVELES.entries())for(const p of L.p){const n=p.partir?+p.a[0]:1,partes=n>1?Array.from({length:n},(_,i)=>({...p,a:['1',String(+p.a[1]+i),...p.a.slice(2)],parte:i+1})):[p];
 const g={L,li,p,n:partes.length,rs:[]};grupos.push(g);for(const q of partes)trabajos.push({g,p:q,c:costo(q,L),dura:previo[p.n]?previo[p.n]/partes.length:60});}
// (las más largas primero, dentro del orden de los niveles: un nivel bajo no espera a que termine uno alto)
trabajos.sort((a,b)=>b.dura-a.dura);
const usado={cpu:0,mem:0,nav:0},vivos=new Map(),porNivel=NIVELES.map(()=>[]);let cortado=Infinity;
const cabe=c=>!usado.cpu||usado.cpu+c.cpu<=CPUS&&usado.mem+c.mem<=MEM&&usado.nav+c.nav<=TOPE_3D;
const juntar=g=>{if(g.n===1)return g.rs[0];const rs=g.rs.sort((a,b)=>a.parte-b.parte),err=rs.some(r=>r.error);
 return {...g.p,partes:g.n,seg:Math.max(...rs.map(r=>r.seg)),fallas:err?null:rs.reduce((a,r)=>a+(r.fallas||0),0),error:err,reintento:rs.some(r=>r.reintento),
  res:`${rs[0].res}${g.n>1?` (y ${g.n-1} ciudades más, de a una por proceso)`:''}`,out:rs.map(r=>`[ciudad ${r.parte}]\n`+r.out.trim()).join('\n'),peor:rs.map(r=>r.peor).filter(Boolean).sort((a,b)=>b.n-a.n)[0]||null};};
await new Promise(fin=>{const pendientes=[...trabajos];
 const mirar=()=>{for(let i=0;i<pendientes.length;i++){const j=pendientes[i];if(j.g.li>cortado){pendientes.splice(i--,1);continue;}if(!cabe(j.c))continue;pendientes.splice(i--,1);lanzar(j);}
  if(!pendientes.length&&!vivos.size)fin();};
 const lanzar=async j=>{for(const k in usado)usado[k]+=j.c[k];
  let r=await correr(j.p,ch=>vivos.set(j,ch));
  if(j.g.L.n===10&&r.error&&r.fallas==null&&j.g.li<=cortado){process.stderr.write(`  ↻ ${r.n}: se cortó, otra vez\n`);r={...(await correr(j.p,ch=>vivos.set(j,ch))),reintento:true};}
  vivos.delete(j);for(const k in usado)usado[k]-=j.c[k];
  if(j.g.li<=cortado){j.g.rs.push(r);process.stderr.write(`  ${r.error||r.fallas?'✗':'✓'} ${j.g.L.n}·${r.n}${j.p.parte?` (ciudad ${j.p.parte})`:''} (${r.seg.toFixed(0)} s)${r.reintento?' · al segundo intento':''}\n`);
   if(j.g.rs.length===j.g.n){porNivel[j.g.li].push(juntar(j.g));const L=j.g.L;
    // (un nivel entero hecho y con fallas, sin --seguir: se cortan los de abajo —los que corren se matan—)
    if(porNivel[j.g.li].length===L.p.length&&!SEGUIR&&porNivel[j.g.li].some(r=>r.error||r.fallas)&&j.g.li<cortado){cortado=j.g.li;
     for(const [k,ch] of vivos)if(k.g.li>cortado){try{process.kill(-ch.pid,'SIGKILL');}catch{}}}}}
  mirar();};
 mirar();});
for(const [li,L] of NIVELES.entries()){if(li>cortado)break;const rs=porNivel[li];if(rs.length<L.p.length)continue;rs.sort((a,b)=>L.p.findIndex(p=>p.n===a.n)-L.p.findIndex(p=>p.n===b.n));hechos.push({L,rs});if(li===cortado)corte=L;}
// (lo que tardó cada prueba —entera—, para ordenar la próxima vez)
try{const t={...previo};for(const {rs} of hechos)for(const r of rs)if(!r.error)t[r.n]=Math.round(r.seg*(r.partes||1));writeFileSync(TIEMPOS,JSON.stringify(t,null,1));}catch{}
console.log(`\nProbador del 2D · ${N} ciudades desde la semilla ${S0} · ${((Date.now()-t0)/1000).toFixed(0)} s en total (${CPUS} núcleos, ${MEM} GB, ${TOPE_3D} navegadores)\n`);
for(const {L,rs} of hechos){const mal=rs.filter(r=>r.error||r.fallas);console.log(`${mal.length?'✗':'✓'} nivel ${L.n} · ${L.t} — ${L.d}`);
 for(const r of rs){console.log(`  ${r.error?'ERROR':r.fallas?'FALLA':'  ok '} ${r.n.padEnd(18)} ${String(r.fallas??'—').padStart(4)} fallas ${r.seg.toFixed(0).padStart(4)} s   ${r.reintento?'(al segundo intento) ':''}${r.res.slice(0,140)}`);
  if((r.error||r.fallas)&&r.peor)console.log(`        peor: ${r.peor.n} × ${r.peor.tipo}${r.peor.ej?'  ·  '+r.peor.ej.slice(0,160):''}`);}}
const sin=NIVELES.filter(L=>!hechos.some(h=>h.L===L));
if(corte&&sin.length)console.log(`\n(sin correr, por el nivel ${corte.n}: ${sin.map(L=>L.n+' '+L.t).join(', ')} — con --seguir se corren igual)`);
const malos=hechos.flatMap(h=>h.rs).filter(r=>r.error||r.fallas);
for(const r of TODO?hechos.flatMap(h=>h.rs):malos)console.log(`\n──── ${r.n} (${r.f} ${r.a.join(' ')}) ────\n${r.out.trim().split('\n').slice(-30).join('\n')}`);
console.log(malos.length?`\n${malos.length} con fallas o errores${corte&&sin.length?`: se cortó en el nivel ${corte.n}`:''}.`:`\nTodo en 0 (${hechos.length} niveles, ${hechos.reduce((a,h)=>a+h.rs.length,0)} pruebas).`);process.exit(malos.length?1:0);
