/* FUGA en Vue. Además de la app, el servidor de desarrollo:
   - guarda los experimentos del calibrador en datos/ (/api/experimentos, /api/referencia);
   - hace de intermediario con Jev (/api/health, /api/decide) sin pasar la credencial al navegador. La credencial se lee
     de JEV_TOKEN en el entorno o del .env de CREDITOP (FUGA_ENV para otro archivo). */
import {defineConfig} from 'vite';
import vue from '@vitejs/plugin-vue';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {dataRoutes,send} from './server/datos.js';
import {jevRoutes} from './server/jev.js';
import {createHash} from 'node:crypto';
import {readdirSync,readFileSync,statSync} from 'node:fs';

const here=path.dirname(fileURLToPath(import.meta.url));
const PORT=5180;

function api(){
 return {name:'fuga-api',configureServer(server){
  const data=dataRoutes(path.join(here,'datos'));
  const jev=jevRoutes({envFile:process.env.FUGA_ENV||path.resolve(here,'../../.env'),port:PORT});
  server.config.logger.info(`  Jev: ${jev.configured?'credencial encontrada':'sin credencial (sólo reglas locales)'}`);
  server.middlewares.use(async(req,res,next)=>{
   const url=new URL(req.url,'http://localhost');
   if(!url.pathname.startsWith('/api/'))return next();
   try{if(await data(req,res,url)||await jev.handle(req,res,url))return;send(res,404,{error:'Ruta no encontrada.'});}
   catch(error){send(res,500,{error:String(error.message||error)});}
  });
 }};
}

// La firma del motor (2026-10-18, los mapas guardados en IndexedDB —src/lib/mapasGuardados.js—): un hash de todo
// src/engine. Un mapa guardado con otra firma no se usa (el motor cambió: el plano sería otro). Se recalcula cada vez que
// cambia un archivo del motor.
function firmaMotor(){
 const dir=path.join(here,'src/engine'),ID='virtual:firma-motor',RID='\0'+ID;
 const calcular=()=>{const h=createHash('sha1');const ir=d=>{for(const n of readdirSync(d).sort()){const p=path.join(d,n);if(statSync(p).isDirectory())ir(p);else if(/\.(js|json)$/.test(n))h.update(n).update(readFileSync(p));}};ir(dir);return h.digest('hex').slice(0,12);};
 return {name:'fuga-firma-motor',resolveId:id=>id===ID?RID:null,load:id=>id===RID?`export default ${JSON.stringify(calcular())};`:null,
  configureServer(server){server.watcher.on('change',f=>{if(f.startsWith(dir)){const m=server.moduleGraph.getModuleById(RID);if(m)server.moduleGraph.invalidateModule(m);}});}};
}

export default defineConfig({
 plugins:[vue(),api(),firmaMotor()],
 resolve:{alias:{'@':path.join(here,'src')}},
 server:{host:'127.0.0.1',port:PORT,strictPort:true},
 worker:{format:'es'},
});
