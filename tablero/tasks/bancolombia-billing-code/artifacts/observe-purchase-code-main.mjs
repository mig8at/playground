import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const repo=process.env.FRONTEND_REPO;
if(!repo)throw new Error('Set FRONTEND_REPO to the local frontend clone with wizard dependencies installed.');
const ref=process.env.FRONTEND_REF??'68ce7349c4e2a52c83fe4ee174a23ac71fe667cc';
const require=createRequire(repo+'/apps/loan-request-wizard/package.json');
const ts=require('typescript'),React=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const root='modules/loan-request-wizard/bancolombia-origination/src/ui/components/origination/shared/finalize-purchase';
const get=path=>execFileSync('git',['show',`${ref}:${path}`],{cwd:repo,encoding:'utf8'});
const generic=({children})=>React.createElement('div',null,children);
generic.CustomIcon=generic;
const ui={useUIKit:()=>Object.fromEntries(['Button','Card','CardContent','Separator','BaseAlert','BaseAlertTitle','BaseAlertDescription'].map(x=>[x,generic])),WarningIllustration:()=>null,SmartphoneCashIllustration:()=>null};
const components={LoanHeader:({title,subtitle})=>React.createElement('header',null,title,subtitle),SupportContact:()=>null};
const modules=new Map(),readFiles=[];
function load(path){
 if(modules.has(path))return modules.get(path);
 const source=get(path);readFiles.push(path);
 const {outputText}=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}});
 const module={exports:{}};modules.set(path,module.exports);
 const localRequire=id=>id==='@ui'?ui:id==='@components'?components:id.startsWith('./')?load(path.slice(0,path.lastIndexOf('/')+1)+id.slice(2)+'.tsx'):require(id);
 vm.runInThisContext(`(function(require,module,exports){${outputText}\n})`,{filename:path})(localRequire,module,module.exports);
 return module.exports;
}
const {FinalizePurchase}=load(root+'/FinalizePurchase.tsx');
const renders=[];
for(const isExpired of [false,true])for(const showBarCode of [false,true]){
 const html=renderToStaticMarkup(React.createElement(FinalizePurchase,{code:'LOCAL_SYNTHETIC_PIN',codeType:'ean128',paymentMethod:'BC_PAGA_DESP',remainingTime:{hours:'01',minutes:'00',seconds:'00'},isExpired,showBarCode}));
 const r={isExpired,showBarCode,codeVisible:html.includes('LOCAL_SYNTHETIC_PIN'),readyMessage:html.includes('Todo está listo'),unavailableMessage:html.includes('No encontramos el PIN'),expiredMessage:html.includes('Tiempo caducado')};
 assert.equal(r.codeVisible,!isExpired);
 assert.equal(r.readyMessage,!isExpired);
 assert.equal(r.unavailableMessage,isExpired&&!showBarCode);
 assert.equal(r.expiredMessage,isExpired&&showBarCode);
 renders.push(r);
}
const routePath='apps/loan-request-wizard/app/routes/bancolombia/purchase-code.tsx';
const route=get(routePath);
const fn=route.match(/function calculateDeadlineTimestamp\(\): number \{[\s\S]*?return deadline\.getTime\(\);\n\}/)?.[0];assert.ok(fn);
const runnable=ts.transpileModule(fn,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
const clocks=[];
for(const [now,expected] of [['2026-10-05T01:29:59Z','2026-10-05T01:30:00.000Z'],['2026-10-05T01:30:00Z','2026-10-06T01:30:00.000Z'],['2026-10-05T02:00:00Z','2026-10-06T01:30:00.000Z'],['2026-10-05T20:00:00Z','2026-10-06T01:30:00.000Z']]){
 class FrozenDate extends Date{constructor(...args){super(...(args.length?args:[now]));}}
 const result=new Date(vm.runInNewContext(runnable+'\ncalculateDeadlineTimestamp()',{Date:FrozenDate})).toISOString();assert.equal(result,expected);
 clocks.push({nowUtc:now,deadlineUtc:result});
}
const schemaPath='modules/loan-request-wizard/bancolombia-origination/src/domain/schemas/origination/bnpl/bnpl-api.schema.ts';
const schemaSource=get(schemaPath);
const schemaText=schemaSource.match(/export const BnplPurchaseCodePayloadSchema = z\.object\(\{[\s\S]*?\n\}\);/)?.[0];assert.ok(schemaText);
const schemaCode=ts.transpileModule(schemaText,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
const schemaModule={exports:{}};vm.runInThisContext(`(function(z,module,exports){${schemaCode}\n})`)(require('zod').z,schemaModule,schemaModule.exports);
const schema=schemaModule.exports.BnplPurchaseCodePayloadSchema;
const body={codeType:'ean128',code:'LOCAL_SYNTHETIC_PIN',codeImageUrl:'local.png',lender_id:68,payment_method:'BC_PAGA_DESP',allied_id:209,showBarCode:false};
const parsing={unavailablePinPayloadAccepted:schema.safeParse(body).success,nullCodeTypeAccepted:schema.safeParse({...body,codeType:null}).success,nullImageAccepted:schema.safeParse({...body,codeImageUrl:null}).success};
assert.equal(parsing.unavailablePinPayloadAccepted,true);assert.equal(parsing.nullCodeTypeAccepted,false);assert.equal(parsing.nullImageAccepted,false);
const evidence={sourceCommit:execFileSync('git',['rev-parse',ref],{cwd:repo,encoding:'utf8'}).trim(),renders,clocks,parsing,readFiles:[...readFiles,routePath,schemaPath],limits:['Render de componentes de main con React 19 SSR. Los wrappers visuales, ilustraciones y header/support compartidos se sustituyen; no es validación del diseño ni navegador.','Lógica de selección, contenido del PIN y contador sin cambios de producto. Sin HTTP, base, SMS ni banco.','Observación del comportamiento disponible; el caso showBarCode:false con reloj vigente evidencia el problema, no un criterio correcto.']};
writeFileSync(process.env.OBSERVATION_OUTPUT??'purchase-code-main-observation.json',JSON.stringify(evidence,null,2)+'\n');
console.log(JSON.stringify({renders,clocks,parsing}));
