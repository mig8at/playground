/* El plano de la ciudad fuera del hilo principal (2026-10-14): generateBlueprint tarda ~1,7 s en frío y no depende de los
   modelos, así que se arma mientras ellos se descargan. El plano son datos puros (objetos, listas y arreglos tipados): se
   copia entero de vuelta. */
import {generateBlueprint} from './blueprint.js';

self.onmessage=e=>{try{self.postMessage({plan:generateBlueprint(e.data)});}catch(err){self.postMessage({error:String(err?.stack||err)});}};
