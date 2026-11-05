/* FUGA en Vue. Además de la app, el servidor de desarrollo calcula la firma del motor (abajo). (2026-10-30: se quitaron el
   calibrador web —/api/experimentos y /api/referencia, con datos/— y el intermediario con Jev —/api/decide—: nadie los
   usaba. Las pruebas y el calibrador por consola están en harness/pruebas.) */
import {defineConfig} from 'vite';
import vue from '@vitejs/plugin-vue';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {readdirSync,readFileSync,statSync} from 'node:fs';

const here=path.dirname(fileURLToPath(import.meta.url));
const PORT=5181;


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
 plugins:[vue(),firmaMotor()],
 resolve:{alias:{'@':path.join(here,'src')}},
 server:{host:'127.0.0.1',port:PORT,strictPort:true},
 worker:{format:'es'},
});
