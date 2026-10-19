// Intermediario con Jev (TypeSafe). La credencial se lee en el servidor (JEV_TOKEN en el entorno o en el .env de
// CREDITOP) y nunca llega al navegador. Mismas reglas que lab/server.py, con equipos de hasta 8 por lado.
// Jev es un SERVICIO del playground: el pedido sale por su conector (`bin/pg jev ask`, connectors/jev), que es el único
// que conoce la URL y garantiza no seguir redirecciones ni filtrar el token. Acá sólo se arma el pedido y se lee la respuesta.
import fs from 'node:fs';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {send,readBody} from './datos.js';

const PG=fileURLToPath(new URL('../../bin/pg',import.meta.url));
// Si el juego no trae su token, el conector usa el suyo (connectors/.env): Jev es un servicio del playground, no del juego.
const CONNECTOR_ENV=fileURLToPath(new URL('../../connectors/.env',import.meta.url));
function connectorHasToken(){try{return /^(JEV_TOKEN|TYPESAFE_API_KEY)=\S/m.test(fs.readFileSync(CONNECTOR_ENV,'utf8'));}catch{return false;}}

/** Manda el pedido por el conector. Devuelve {ok, status?, json?}: `status` es el HTTP de Jev cuando el conector lo informa. */
function askJev(body,token,timeoutMs){
 return new Promise((resolve)=>{
  const child=spawn(PG,['jev','ask'],{env:token?{...process.env,JEV_TOKEN:token}:process.env,stdio:['pipe','pipe','pipe']});
  let out='',err='';
  const timer=setTimeout(()=>child.kill(),timeoutMs);
  child.stdout.on('data',(d)=>{out+=d;});
  child.stderr.on('data',(d)=>{err+=d;});
  child.on('error',()=>{clearTimeout(timer);resolve({ok:false});});
  child.on('close',(code)=>{
   clearTimeout(timer);
   if(code===0){try{resolve({ok:true,json:JSON.parse(out)});}catch{resolve({ok:false});}return;}
   const m=/Jev HTTP (\d+)/.exec(err);resolve({ok:false,status:m?Number(m[1]):undefined});
  });
  child.stdin.end(JSON.stringify(body));
 });
}
const RULES='Juego no letal de policías contra ladrones, por equipos del mismo tamaño. Los ladrones ganan entregando la cuota de bolsas; '+
 'los policías ganan encarcelando a todos o agotando el tiempo. El bate noquea, luego el policía debe acercarse para arrestar. '+
 'Los ladrones pueden rescatar presos y despertar aliados. La información de cada pregunta es solo la percepción de ese personaje. '+
 'walkDistance mide el trayecto real con paredes; danger mide enemigos visibles cercanos al destino. '+
 'Coordina con las metas conocidas de compañeros: evita acumular todo el equipo en un punto. '+
 'Los ladrones con bolsa priorizan entregarla por una ruta segura; sin bolsa evalúan rescate o robo. '+
 'Los policías reparten vigilancia entre objetivos, cárcel y escapes o escondites; persiguen solo enemigos visibles. '+
 'Un preso se fuga solo tras el tiempo jail de active_parameters si aún hay un compañero libre. '+
 'Elige exactamente una de las opciones ofrecidas. Las opciones ya respetan las reglas y accesibilidad.';
const AGENT=/^a([0-9]|1[0-5])$/;

export function readToken(envFile){
 if(process.env.JEV_TOKEN)return process.env.JEV_TOKEN;
 try{
  for(const raw of fs.readFileSync(envFile,'utf8').split('\n')){
   const line=raw.trim();if(!line||line.startsWith('#')||!line.includes('='))continue;
   const i=line.indexOf('='),key=line.slice(0,i).trim().replace(/^export\s+/,'');
   if(key==='JEV_TOKEN')return line.slice(i+1).trim().replace(/^["']|["']$/g,'');
  }
 }catch{}
 return '';
}

function makeRequest(data){
 const agents=data?.agents;
 if(!Array.isArray(agents)||agents.length<1||agents.length>16)throw new Error('Se esperan entre 1 y 16 personajes.');
 const questions={};
 for(const agent of agents){
  if(!agent||typeof agent!=='object'||!AGENT.test(agent.id))throw new Error('Personaje inválido.');
  const options=agent.options;if(!Array.isArray(options)||options.length<1||options.length>12)throw new Error('Lista de acciones inválida.');
  const criteria={};
  for(const o of options){if(!o||typeof o.id!=='string')throw new Error('Acción inválida.');criteria[o.id.slice(0,100)]={description:o.description,walkDistance:o.walkDistance,danger:o.danger,teammatesAssigned:o.teammatesAssigned};}
  const {options:_,...observation}=agent;
  questions[agent.id]={type:'choice',instructions:{task:'¿Qué objetivo inmediato debe elegir ESTE personaje para ayudar a su equipo a ganar?',observation},criteria};
 }
 const supplied=data.rules||{},active={};
 for(const k of ['duration','quota','jail','rescue','stun','copSpeed','thiefSpeed','carrySpeed','hearing','stash'])if(typeof supplied[k]==='number')active[k]=supplied[k];
 if(typeof data.team==='number')active.team=data.team;
 return {model:'jev-latest',state:{game_rules:RULES,active_parameters:active},questions};
}

export function jevRoutes({envFile,port}){
 const token=readToken(envFile),configured=!!token||connectorHasToken(),metrics={calls:0,input_tokens:0,output_tokens:0,last_latency_ms:null};
 let busy=false,lastCall=0;
 const allowed=[`http://127.0.0.1:${port}`,`http://localhost:${port}`];
 return {configured,handle:async(req,res,url)=>{
  if(url.pathname==='/api/health'&&req.method==='GET'){send(res,200,{app:'fuga',configured,model:'jev-latest',metrics:{...metrics}});return true;}
  if(url.pathname!=='/api/decide')return false;
  if(req.method!=='POST'){send(res,405,{error:'Método no permitido.'});return true;}
  // Sólo la propia página: nada de otros orígenes.
  const origin=req.headers.origin;
  if((origin&&!allowed.includes(origin))||req.headers['sec-fetch-site']==='cross-site'){send(res,403,{error:'Origen no permitido.'});return true;}
  if((req.headers['content-type']||'').split(';')[0]!=='application/json'){send(res,415,{error:'Se requiere JSON.'});return true;}
  if(!configured){send(res,503,{error:'Falta JEV_TOKEN (en el .env de CREDITOP o en connectors/.env).'});return true;}
  let body;try{body=makeRequest(await readBody(req,120_000));}catch{send(res,400,{error:'Estado o acciones inválidas.'});return true;}
  if(busy){send(res,429,{error:'Hay una decisión en curso; intenta más tarde.'});return true;}
  if(Date.now()-lastCall<2000){send(res,429,{error:'Espera dos segundos entre consultas.'});return true;}
  busy=true;lastCall=Date.now();
  const started=Date.now();
  try{
   const r=await askJev(body,token,20000);
   if(!r.ok){const messages={401:'Jev rechazó la credencial.',403:'La credencial no tiene acceso a Jev.',429:'Jev alcanzó el límite de consultas.',529:'Jev está temporalmente ocupado.'};
    if(r.status){send(res,502,{error:messages[r.status]||`Jev respondió HTTP ${r.status}.`,upstream_status:r.status});return true;}
    send(res,502,{error:'No se pudo completar la consulta a Jev. Se mantienen las reglas locales.'});return true;}
   const result=r.json,latency=Date.now()-started,answers={};
   for(const [id,a] of Object.entries(result.answers||{}))if(body.questions[id]&&a&&typeof a==='object'&&a.choice in body.questions[id].criteria)answers[id]={choice:a.choice,confidence:a.confidence};
   if(!Object.keys(answers).length){send(res,502,{error:'Jev no devolvió acciones válidas.'});return true;}
   const usage=result.usage||{};metrics.calls++;metrics.input_tokens+=Number(usage.input_tokens||0);metrics.output_tokens+=Number(usage.output_tokens||0);metrics.last_latency_ms=latency;
   send(res,200,{answers,model:result.model,usage,latency_ms:latency,metrics:{...metrics}});
  }catch{send(res,502,{error:'No se pudo completar la consulta a Jev. Se mantienen las reglas locales.'});}
  finally{busy=false;}
  return true;
 }};
}
