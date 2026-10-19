// Intermediario con Jev (TypeSafe). La credencial se lee en el servidor (JEV_TOKEN en el entorno o en el .env de
// CREDITOP) y nunca llega al navegador. Mismas reglas que lab/server.py, con equipos de hasta 8 por lado.
import fs from 'node:fs';
import {send,readBody} from './datos.js';

const API_URL='https://api.typesafe.ai/v1/systemone';
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
 const token=readToken(envFile),metrics={calls:0,input_tokens:0,output_tokens:0,last_latency_ms:null};
 let busy=false,lastCall=0;
 const allowed=[`http://127.0.0.1:${port}`,`http://localhost:${port}`];
 return {configured:!!token,handle:async(req,res,url)=>{
  if(url.pathname==='/api/health'&&req.method==='GET'){send(res,200,{app:'fuga',configured:!!token,model:'jev-latest',metrics:{...metrics}});return true;}
  if(url.pathname!=='/api/decide')return false;
  if(req.method!=='POST'){send(res,405,{error:'Método no permitido.'});return true;}
  // Sólo la propia página: nada de otros orígenes.
  const origin=req.headers.origin;
  if((origin&&!allowed.includes(origin))||req.headers['sec-fetch-site']==='cross-site'){send(res,403,{error:'Origen no permitido.'});return true;}
  if((req.headers['content-type']||'').split(';')[0]!=='application/json'){send(res,415,{error:'Se requiere JSON.'});return true;}
  if(!token){send(res,503,{error:'Falta JEV_TOKEN en el .env de CREDITOP.'});return true;}
  let body;try{body=makeRequest(await readBody(req,120_000));}catch{send(res,400,{error:'Estado o acciones inválidas.'});return true;}
  if(busy){send(res,429,{error:'Hay una decisión en curso; intenta más tarde.'});return true;}
  if(Date.now()-lastCall<2000){send(res,429,{error:'Espera dos segundos entre consultas.'});return true;}
  busy=true;lastCall=Date.now();
  const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),15000),started=Date.now();
  try{
   const r=await fetch(API_URL,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(body),signal:abort.signal});
   if(!r.ok){const messages={401:'Jev rechazó la credencial.',403:'La credencial no tiene acceso a Jev.',429:'Jev alcanzó el límite de consultas.',529:'Jev está temporalmente ocupado.'};
    send(res,502,{error:messages[r.status]||`Jev respondió HTTP ${r.status}.`,upstream_status:r.status});return true;}
   const result=await r.json(),latency=Date.now()-started,answers={};
   for(const [id,a] of Object.entries(result.answers||{}))if(body.questions[id]&&a&&typeof a==='object'&&a.choice in body.questions[id].criteria)answers[id]={choice:a.choice,confidence:a.confidence};
   if(!Object.keys(answers).length){send(res,502,{error:'Jev no devolvió acciones válidas.'});return true;}
   const usage=result.usage||{};metrics.calls++;metrics.input_tokens+=Number(usage.input_tokens||0);metrics.output_tokens+=Number(usage.output_tokens||0);metrics.last_latency_ms=latency;
   send(res,200,{answers,model:result.model,usage,latency_ms:latency,metrics:{...metrics}});
  }catch{send(res,502,{error:'No se pudo completar la consulta a Jev. Se mantienen las reglas locales.'});}
  finally{clearTimeout(timer);busy=false;}
  return true;
 }};
}
