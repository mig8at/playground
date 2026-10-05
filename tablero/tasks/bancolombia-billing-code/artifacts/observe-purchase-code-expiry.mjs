import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const frontend=process.env.FRONTEND_REPO,application=process.env.APPLICATION_REPO;
if(!frontend||!application)throw new Error('Set FRONTEND_REPO and APPLICATION_REPO to the local clones.');
const frontendRef=process.env.FRONTEND_REF??'68ce7349c4e2a52c83fe4ee174a23ac71fe667cc';
const applicationRef=process.env.APPLICATION_REF??'fc74ac8bc1b364191f859bb6830e8d47c15bb882';
const require=createRequire(frontend+'/apps/loan-request-wizard/package.json');
const ts=require('typescript'),React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const routePath='apps/loan-request-wizard/app/routes/bancolombia/purchase-code.tsx';
const vuePath='resources/js/pages/customer/purchase-code/FinalizePurchase.vue';
const countdownPath='modules/loan-request-wizard/bancolombia-origination/src/ui/components/origination/shared/finalize-purchase/CountdownDisplay.tsx';
const schemaPath='modules/loan-request-wizard/bancolombia-origination/src/domain/schemas/origination/bnpl/bnpl-api.schema.ts';
const get=(repo,ref,path)=>execFileSync('git',['show',`${ref}:${path}`],{cwd:repo,encoding:'utf8'});
const route=get(frontend,frontendRef,routePath),vue=get(application,applicationRef,vuePath);
const calculate=route.match(/function calculateDeadlineTimestamp\(\): number \{[\s\S]*?return deadline\.getTime\(\);\n\}/)?.[0];assert.ok(calculate);
const runnable=ts.transpileModule(calculate,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const initialize=vue.match(/initializeTimer\(\) \{([\s\S]*?)\n        \},\n        handleTimerEnd\(\)/)?.[1];assert.ok(initialize);
const countdownModule={exports:{}};
const countdownCode=ts.transpileModule(get(frontend,frontendRef,countdownPath),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
vm.runInThisContext(`(function(require,module,exports){${countdownCode}\n})`)(require,countdownModule,countdownModule.exports);
const fixtures=[
 ['2026-10-06T01:29:59Z','2026-10-06T01:30:00.000Z'],
 ['2026-10-06T01:30:00Z','2026-10-07T01:30:00.000Z'],
 ['2026-10-06T01:30:01Z','2026-10-07T01:30:00.000Z'],
 ['2026-10-06T04:59:59Z','2026-10-07T01:30:00.000Z'],
 ['2026-10-06T05:00:00Z','2026-10-07T01:30:00.000Z'],
 ['2026-10-06T07:00:00Z','2026-10-07T01:30:00.000Z'],
 ['2027-01-01T01:31:00Z','2027-01-02T01:30:00.000Z'],
 ['2028-03-01T01:31:00Z','2028-03-02T01:30:00.000Z'],
];
const day=instant=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Bogota',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(instant));
const clocks=[];const initialTimezone=process.env.TZ;
try{
 for(const timezone of ['America/Bogota','America/Los_Angeles','Europe/Madrid','UTC']){
  process.env.TZ=timezone;
  for(const [now,expected] of fixtures){
   class FrozenDate extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return Date.parse(now);}}
   const deadline=vm.runInNewContext(runnable+'\ncalculateDeadlineTimestamp()',{Date:FrozenDate});
   const deadlineUtc=new Date(deadline).toISOString();assert.equal(deadlineUtc,expected,'wizard cutoff is independent of host zone');
   const seconds=(deadline-Date.parse(now))/1000;
   const legacy={remainingTime:0,timerInterval:null,endedAtMount:false,endedAfterTick:false,handleTimerEnd(){this.endedAtMount=true;}};
   let tick;
   const init=vm.runInNewContext('(function(){'+initialize+'\n})',{Date:FrozenDate,setInterval:callback=>{tick=callback;return 1;},clearInterval:()=>{}});
   init.call(legacy);const legacySeconds=legacy.remainingTime;const endedAtMount=legacy.endedAtMount;
   legacy.handleTimerEnd=()=>{legacy.endedAfterTick=true;};if(tick)tick();
   const html=renderToStaticMarkup(React.createElement(countdownModule.exports.CountdownDisplay,{hours:String(Math.floor(seconds/3600)).padStart(2,'0'),minutes:String(Math.floor(seconds%3600/60)).padStart(2,'0'),seconds:String(seconds%60).padStart(2,'0')}));
   assert.ok(html.includes('(Vence hoy a las 8:30 p.m.)'));
   const r={timezone,nowUtc:now,wizardDeadlineUtc:deadlineUtc,wizardSeconds:seconds,labelSaysToday:true,labelMatchesBogotaDay:day(now)===day(deadline),legacySeconds,legacyEndedAtMount:endedAtMount,legacyEndedAfterTick:legacy.endedAfterTick};
   if(timezone==='America/Bogota'&&now==='2026-10-06T01:29:59Z')assert.equal(legacySeconds,1);
   if(timezone==='America/Bogota'&&now==='2026-10-06T01:30:01Z'){assert.equal(legacySeconds,0);assert.equal(endedAtMount,true);assert.equal(seconds,86399);assert.equal(r.labelMatchesBogotaDay,false);}
   clocks.push(r);
  }
 }
 const first=clocks.filter(x=>x.nowUtc===fixtures[0][0]);assert.deepEqual(first.map(x=>x.legacySeconds),[1,7201,61201,68401]);
}finally{if(initialTimezone===undefined)delete process.env.TZ;else process.env.TZ=initialTimezone;}
const schemaSource=get(frontend,frontendRef,schemaPath);
const schemaText=schemaSource.match(/export const BnplPurchaseCodePayloadSchema = z\.object\(\{[\s\S]*?\n\}\);/)?.[0];assert.ok(schemaText);
const schemaModule={exports:{}};const schemaCode=ts.transpileModule(schemaText,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
vm.runInThisContext(`(function(z,module,exports){${schemaCode}\n})`)(require('zod').z,schemaModule,schemaModule.exports);
const payloadKeys=Object.keys(schemaModule.exports.BnplPurchaseCodePayloadSchema.shape);
assert.ok(!payloadKeys.some(k=>/expir|deadline|created|ttl/i.test(k)));
const evidence={observedAt:new Date().toISOString(),refs:{frontend:execFileSync('git',['rev-parse',frontendRef],{cwd:frontend,encoding:'utf8'}).trim(),application:execFileSync('git',['rev-parse',applicationRef],{cwd:application,encoding:'utf8'}).trim()},files:{routePath,vuePath,countdownPath,schemaPath},clocks,payloadKeys,conclusions:['El wizard mueve el próximo corte al día siguiente al llegar a 20:30 Bogotá; no depende de fecha de emisión, PIN ni TTL.','Application calcula 20:30 del día local del navegador y avisa al haber pasado, sin renovar el reloj al siguiente corte.','El texto del wizard dice hoy incluso cuando el corte es mañana en Bogotá.','El reloj legacy cambia al cambiar la zona del navegador; el wizard usa UTC fijo.','El payload del wizard no ofrece fecha de emisión ni fecha límite.'],limits:['Evaluación de funciones tomadas literalmente de Git con reloj controlado; no ejecuta loaders HTTP, efectos React, navegador, base, SMS, scheduler ni banco.','Render del CountdownDisplay real de main con React SSR; el contrato del proveedor y su caducidad efectiva requieren evidencia separada.','No demuestra que el mismo PIN esté disponible después del corte: muestra cómo lo presenta el reloj si el backend lo devuelve disponible.']};
writeFileSync(process.env.OBSERVATION_OUTPUT??'purchase-code-expiry-observation.json',JSON.stringify(evidence,null,2)+'\n');
console.log(JSON.stringify({clockCases:clocks.length,payloadKeys,afterCutoff:clocks.find(x=>x.timezone==='America/Bogota'&&x.nowUtc==='2026-10-06T01:30:01Z')}));
