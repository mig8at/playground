// Experimentos del calibrador como archivos JSON en datos/: no se pierden, se comparten y se leen fuera del navegador.
import fs from 'node:fs/promises';
import path from 'node:path';

const ID=/^[a-z0-9-]{1,80}$/;
export const send=(res,status,body)=>{res.statusCode=status;res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.end(JSON.stringify(body));};
export async function readBody(req,limit=50_000_000){
 const chunks=[];let size=0;
 for await(const c of req){size+=c.length;if(size>limit)throw new Error('Petición demasiado grande.');chunks.push(c);}
 return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');
}

export function dataRoutes(dir){
 return async(req,res,url)=>{
  if(url.pathname==='/api/experimentos'&&req.method==='GET'){
   await fs.mkdir(dir,{recursive:true});
   const list=[];
   for(const f of (await fs.readdir(dir)).filter(f=>f.startsWith('exp-')&&f.endsWith('.json'))){
    const e=JSON.parse(await fs.readFile(path.join(dir,f),'utf8'));
    list.push({id:e.id,name:e.name,notes:e.notes,status:e.status,created:e.created,updated:e.updated,config:e.config,done:e.results?.length||0,total:e.total||0});
   }
   send(res,200,list.sort((a,b)=>String(b.created).localeCompare(String(a.created))));return true;
  }
  const m=/^\/api\/experimentos\/([^/]+)$/.exec(url.pathname);
  if(m){
   if(!ID.test(m[1])){send(res,400,{error:'Identificador inválido.'});return true;}
   const file=path.join(dir,'exp-'+m[1]+'.json');
   if(req.method==='GET'){try{send(res,200,JSON.parse(await fs.readFile(file,'utf8')));}catch{send(res,404,{error:'No existe ese experimento.'});}return true;}
   if(req.method==='PUT'){
    const body=await readBody(req);if(body.id!==m[1]){send(res,400,{error:'El id no coincide.'});return true;}
    await fs.mkdir(dir,{recursive:true});const tmp=file+'.tmp';await fs.writeFile(tmp,JSON.stringify(body));await fs.rename(tmp,file);send(res,200,{ok:true});return true;
   }
   if(req.method==='DELETE'){await fs.rm(file,{force:true});send(res,200,{ok:true});return true;}
  }
  if(url.pathname==='/api/referencia'){
   const file=path.join(dir,'referencia-regresion.json');
   if(req.method==='GET'){try{send(res,200,JSON.parse(await fs.readFile(file,'utf8')));}catch{send(res,404,{error:'Todavía no hay referencia.'});}return true;}
   if(req.method==='PUT'){const body=await readBody(req);await fs.mkdir(dir,{recursive:true});await fs.writeFile(file,JSON.stringify(body));send(res,200,{ok:true});return true;}
  }
  return false;
 };
}
