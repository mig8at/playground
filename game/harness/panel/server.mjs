// EL PANEL DEL HARNESS DEL JUEGO: http://localhost:5197 (npm run panel, en harness/).
//
// Una cáscara sobre lo que ya existe (como el de LocalMart): lanza las tomas, los textos, la banda sonora y el montaje de
// promo/, muestra en vivo lo que se está grabando (los scripts escriben «CUADRO <archivo>» en su salida), los videos, las
// tomas (en hojas de contacto), los textos y la banda, y la consola. Un trabajo a la vez. Sin dependencias: http de Node y
// Server-Sent Events. Si el servidor del juego (:5181) no está encendido, lo dice y lo enciende.
import http from 'node:http';import {spawn,execFile} from 'node:child_process';
import {createReadStream,existsSync,mkdirSync,readFileSync,readdirSync,statSync,writeFileSync} from 'node:fs';
import {join,extname,resolve,dirname,sep} from 'node:path';import {fileURLToPath} from 'node:url';
import {PROMO,WORK,TOMAS,TEXTOS,BANDA,VIDEOS,OUT,JUEGO_DIR} from '../promo/rutas.mjs';

const HERE=dirname(fileURLToPath(import.meta.url)),HARNESS=resolve(HERE,'..');
const PORT=+(process.env.PANEL_PORT||5197),JUEGO=process.env.JUEGO_URL||'http://127.0.0.1:5181';
const HOJAS=join(WORK,'hojas');mkdirSync(HOJAS,{recursive:true});

// ---------- lo que hay ----------
const leerJson=f=>{try{return JSON.parse(readFileSync(f,'utf8'));}catch{return null;}};
const fecha=f=>{try{return statSync(f).mtimeMs;}catch{return null;}};
// las tomas: cada script de promo/tomas, con su título y descripción (la primera línea: «// TOMA · título — qué es…»)
// y lo que sale (la línea «// SALE: a, b, c»: carpetas de .work/tomas)
function tomas(){return readdirSync(join(PROMO,'tomas')).filter(f=>f.endsWith('.mjs')).sort().map(f=>{const src=readFileSync(join(PROMO,'tomas',f),'utf8'),id=f.replace(/\.mjs$/,'');
 const m=src.match(/^\/\/ TOMA · ([^—\n]+)—\s*([^\n]*(?:\n\/\/ (?!SALE:)[^\n]*)*)/),sale=(src.match(/^\/\/ SALE: (.+)$/m)?.[1]||'').split(',').map(s=>s.trim()).filter(Boolean);
 return {id,titulo:m?m[1].trim():id,descripcion:m?m[2].replace(/\n\/\/ /g,' ').trim():'',salidas:sale.map(s=>{const dir=join(TOMAS,s),n=existsSync(dir)?readdirSync(dir).filter(x=>x.endsWith('.jpg')).length:0;return {id:s,cuadros:n,fecha:n?fecha(dir):null};})};});}
function videos(){return readdirSync(VIDEOS).filter(f=>f.endsWith('.json')).sort().map(f=>{const id=f.replace(/\.json$/,''),d=leerJson(join(VIDEOS,f))||{},mp4=join(OUT,id+'.mp4');
 const usa=[...new Set((d.escenas||[]).flatMap(e=>e.cortes.map(c=>c[1]).filter(Boolean)))];
 return {id,titulo:d.titulo||id,descripcion:d.descripcion||'',duracion:d.duracion,escenas:(d.escenas||[]).map(e=>({nombre:e.nombre,desde:e.desde,cortes:e.cortes.length,tomas:[...new Set(e.cortes.map(c=>c[1]).filter(Boolean))]})),
  textos:(d.textos||[]).map(t=>({id:t.id,desde:t.desde,hasta:t.hasta,texto:t.vo||t.palabra||t.titulo?.replace(/\|/g,' ')||t.pregunta||t.final||'',hecho:existsSync(join(TEXTOS,id,t.id+'.png'))})),
  faltan:usa.filter(t=>!existsSync(join(TOMAS,t))),archivo:existsSync(mp4)?{tam:statSync(mp4).size,fecha:fecha(mp4)}:null};});}
// ---------- las pruebas (pruebas/probar.mjs): la lista de niveles y el último resultado de cada prueba ----------
const PROBAR=join(HARNESS,'pruebas','probar.mjs'),ULTIMA=join(WORK,'pruebas-ultima.json');
let listaPruebas=null;
function cargarLista(){return new Promise(ok=>execFile(process.execPath,[PROBAR,'--lista'],{cwd:JUEGO_DIR},(e,out)=>{const l=(out||'').split('\n').find(x=>x.startsWith('LISTA '));if(l)listaPruebas=JSON.parse(l.slice(6));ok(listaPruebas);}));}
const ultimas=()=>leerJson(ULTIMA)||{};
function anotarPrueba(r){const u=ultimas();u[r.n]={...r,fecha:Date.now()};writeFileSync(ULTIMA,JSON.stringify(u,null,1));}
async function juegoEnLinea(){try{const r=await fetch(JUEGO,{signal:AbortSignal.timeout(1500)});return r.ok;}catch{return false;}}

// ---------- los trabajos (uno a la vez) ----------
const NODE=process.execPath;
const PASOS={
 toma:id=>[{t:`Grabar la toma «${id}»`,cmd:NODE,args:[join(PROMO,'tomas',id+'.mjs')]}],
 textos:v=>[{t:`Textos de «${v}»`,cmd:NODE,args:[join(PROMO,'textos.mjs'),v]}],
 audio:()=>[{t:'Banda sonora',cmd:NODE,args:[join(PROMO,'audio.mjs')]}],
 montaje:v=>[{t:`Montaje de «${v}»`,cmd:NODE,args:[join(PROMO,'montaje.mjs'),v]}],
 armar:v=>[...PASOS.textos(v),...PASOS.audio(),...PASOS.montaje(v)],
 tomas:()=>tomas().flatMap(t=>PASOS.toma(t.id)),
 // el probador: rápido (1 ciudad, sin las lentas: el del día a día), completo (4 ciudades, todo) o un nivel (rápido)
 probar:modo=>[{t:modo==='completo'?'Probador completo':modo==='rapido'?'Probador rápido':`Probador · nivel ${modo}`,cmd:NODE,cwd:JUEGO_DIR,
  args:[PROBAR,'--eventos',...(modo==='completo'?[]:['--rapido']),...(/^\d+$/.test(modo)?['--nivel='+modo,'--seguir']:[])]}]};
let job=null,hijo=null,parado=false;const clientes=new Set();
const emitir=ev=>{const s=`data: ${JSON.stringify(ev)}\n\n`;for(const c of clientes)c.write(s);};
// (las últimas líneas de la consola, para quien abre el panel a mitad de un trabajo)
const HISTORIA=[];const log=(linea,tipo='log')=>{const ev={tipo,linea,t:Date.now()};HISTORIA.push(ev);if(HISTORIA.length>400)HISTORIA.shift();emitir(ev);};
async function lanzar(nombre){if(job)throw Error('ya hay un trabajo corriendo: '+job.label);
 const [k,arg]=nombre.split(':');if(!PASOS[k])throw Error('trabajo desconocido: '+nombre);
 if((k==='toma'||k==='tomas')&&!(await juegoEnLinea()))throw Error(`el juego no responde en ${JUEGO}: enciéndelo primero`);
 const pasos=PASOS[k](arg);job={nombre,label:pasos.length>1?`${k==='armar'?'Armar':'Grabar'} «${arg||'todas'}» (${pasos.length} pasos)`:pasos[0].t,inicio:Date.now(),pasos:pasos.map(p=>p.t),paso:0};parado=false;
 emitir({tipo:'estado',job});log(`▶ ${job.label}`,'cab');
 (async()=>{let ok=true;for(const [i,p] of pasos.entries()){if(parado){ok=false;break;}job.paso=i;emitir({tipo:'estado',job});log(`— ${p.t}`,'cab');
   const code=await new Promise(res=>{hijo=spawn(p.cmd,p.args,{cwd:p.cwd||HARNESS,env:{...process.env,FORCE_COLOR:'0',JUEGO_URL:JUEGO}});
    const linea=s=>{if(s.startsWith('LISTA '))return;// (la de una corrida viene filtrada: la del panel es la completa, de --lista)
     if(s.startsWith('PRUEBA ')){const r=JSON.parse(s.slice(7));anotarPrueba(r);emitir({tipo:'prueba',r:{...r,fecha:Date.now()}});log(`${r.error?'✗ error':r.fallas?'✗ '+r.fallas+' fallas':'✓'}  ${r.nivel} · ${r.n}  (${r.seg} s)`,r.error||r.fallas?'err':'ok');return;}
     if(s.startsWith('CUADRO ')){const f=s.slice(7).trim();if(f.startsWith(TOMAS))emitir({tipo:'cuadro',url:'/archivos/tomas/'+f.slice(TOMAS.length+1),t:Date.now()});}else if(s.trim())log(s);};
    let resto='';const leer=b=>{const t=resto+b.toString();const ls=t.split('\n');resto=ls.pop();ls.forEach(linea);};
    hijo.stdout.on('data',leer);hijo.stderr.on('data',b=>b.toString().split('\n').filter(Boolean).forEach(s=>log(s,/error|Error|✗/.test(s)?'err':'log')));hijo.on('close',c=>{if(resto)linea(resto);res(c);});});
   hijo=null;if(code!==0){ok=false;log(parado?'■ detenido':`✗ falló (salida ${code})`,'err');break;}}
  const fin={nombre:job.nombre,label:job.label,ok,seg:Math.round((Date.now()-job.inicio)/1000)};job=null;emitir({tipo:'fin',fin});if(ok)log(`✓ listo en ${fin.seg} s`,'ok');})();}
function detener(){if(!job)return;parado=true;hijo?.kill('SIGTERM');}
// el servidor del juego: si no está, se enciende (aparte del panel: sigue si el panel se cierra)
function encenderJuego(){const puerto=new URL(JUEGO).port||'5181';log(`encendiendo el juego en ${JUEGO}…`,'cab');
 const p=spawn('npm',['run','dev','--','--port',puerto],{cwd:JUEGO_DIR,detached:true,stdio:'ignore'});p.unref();}

// ---------- la hoja de contacto de una toma (24 cuadros, en caché mientras la toma no cambie) ----------
function hoja(id){return new Promise((ok,mal)=>{const dir=join(TOMAS,id);if(!existsSync(dir))return mal(Error('no hay toma'));
 const n=readdirSync(dir).filter(x=>x.endsWith('.jpg')).length,out=join(HOJAS,id.replace(/\//g,'_')+'.jpg');if(!n)return mal(Error('sin cuadros'));
 if(existsSync(out)&&fecha(out)>=fecha(dir))return ok(out);
 const paso=Math.max(1,Math.floor(n/24));execFile('ffmpeg',['-v','error','-y','-pattern_type','glob','-i',join(dir,'*.jpg'),'-vf',`select='not(mod(n\\,${paso}))',scale=320:-1,tile=6x4`,'-frames:v','1',out],e=>e?mal(e):ok(out));});}

// ---------- archivos ----------
const TIPOS={'.html':'text/html; charset=utf-8','.js':'text/javascript','.json':'application/json','.jpg':'image/jpeg','.png':'image/png','.mp4':'video/mp4','.wav':'audio/wav','.css':'text/css'};
function servir(req,res,f){if(!existsSync(f))return res.writeHead(404).end('no está');const st=statSync(f),tipo=TIPOS[extname(f)]||'application/octet-stream',r=req.headers.range;
 // (con «Range»: el reproductor puede adelantar el video)
 if(r&&/^bytes=/.test(r)){const [a,b]=r.slice(6).split('-'),ini=+a||0,fin=b?+b:st.size-1;res.writeHead(206,{'Content-Type':tipo,'Content-Range':`bytes ${ini}-${fin}/${st.size}`,'Accept-Ranges':'bytes','Content-Length':fin-ini+1,'Cache-Control':'no-store'});return createReadStream(f,{start:ini,end:fin}).pipe(res);}
 res.writeHead(200,{'Content-Type':tipo,'Content-Length':st.size,'Accept-Ranges':'bytes','Cache-Control':'no-store'});createReadStream(f).pipe(res);}
// (sólo dentro de su carpeta)
const dentro=(base,rel)=>{const f=resolve(base,decodeURIComponent(rel));return f.startsWith(base+sep)?f:null;};
const cuerpo=req=>new Promise(ok=>{let b='';req.on('data',c=>b+=c);req.on('end',()=>{try{ok(JSON.parse(b||'{}'));}catch{ok({});}});});
const json=(res,o,c=200)=>res.writeHead(c,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify(o));

http.createServer(async(req,res)=>{const u=new URL(req.url,'http://x'),p=u.pathname;
 try{
  if(p==='/api/eventos'){res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-store',Connection:'keep-alive'});for(const ev of HISTORIA)res.write(`data: ${JSON.stringify(ev)}\n\n`);res.write(`data: ${JSON.stringify({tipo:'estado',job})}\n\n`);clientes.add(res);req.on('close',()=>clientes.delete(res));return;}
  if(p==='/api/estado')return json(res,{juego:{url:JUEGO,enLinea:await juegoEnLinea()},job,pruebas:{lista:listaPruebas||await cargarLista(),ultimas:ultimas()},videos:videos(),tomas:tomas(),banda:existsSync(BANDA)?{fecha:fecha(BANDA)}:null});
  if(p==='/api/lanzar'&&req.method==='POST'){const {job:n}=await cuerpo(req);try{await lanzar(n);json(res,{ok:true});}catch(e){json(res,{error:e.message},409);}return;}
  if(p==='/api/detener'&&req.method==='POST'){detener();return json(res,{ok:true});}
  if(p==='/api/juego'&&req.method==='POST'){if(!(await juegoEnLinea()))encenderJuego();return json(res,{ok:true});}
  if(p.startsWith('/archivos/hoja/')){try{return servir(req,res,await hoja(decodeURIComponent(p.slice(15)).replace(/\.jpg$/,'')));}catch(e){return res.writeHead(404).end(e.message);}}
  const zonas={'/archivos/tomas/':TOMAS,'/archivos/textos/':TEXTOS,'/archivos/videos/':OUT};
  for(const [pre,base] of Object.entries(zonas))if(p.startsWith(pre)){const f=dentro(base,p.slice(pre.length));return f?servir(req,res,f):res.writeHead(403).end();}
  if(p==='/archivos/banda.wav')return servir(req,res,BANDA);
  // (todas las páginas son la misma: el panel elige qué mostrar por la ruta)
  if(p==='/'||p.startsWith('/promo')||p.startsWith('/pruebas'))return servir(req,res,join(HERE,'index.html'));
  res.writeHead(404).end('no está');
 }catch(e){json(res,{error:String(e.message||e)},500);}
}).on('error',async e=>{
 if(e.code!=='EADDRINUSE')throw e;
 // el puerto ocupado: si es este mismo panel (ya abierto), se avisa; si es otra cosa, se dice cuál
 const ya=await fetch(`http://127.0.0.1:${PORT}/api/estado`).then(r=>r.ok).catch(()=>false);
 console.log(ya?`el panel ya está abierto en http://localhost:${PORT}`:`el puerto ${PORT} lo usa otro programa (ss -ltnp | grep ${PORT})`);
 process.exit(ya?0:1);
}).listen(PORT,'127.0.0.1',()=>console.log(`panel del juego en http://localhost:${PORT} (el juego: ${JUEGO})`));
