import {createRequire} from 'node:module';
import {writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
if(!process.env.HARNESS_REPO||!process.env.VALIDATION_OUTPUT_DIR)throw new Error('Set HARNESS_REPO and VALIDATION_OUTPUT_DIR.');
const require=createRequire(process.env.HARNESS_REPO+'/harness/package.json');
const {chromium}=require('playwright');
const output=process.env.VALIDATION_OUTPUT_DIR.replace(/\/$/,'')+'/';
const browser=await chromium.launch({headless:true});
const checks=[];
const initialRequests=await fetch("http://127.0.0.1:8127/stats").then(r=>r.json());
try{
 for(const flow of ['bnpl','consumo'])for(const kind of ['available','unavailable','expired','error']){
  const context=await browser.newContext({viewport:{width:390,height:844},timezoneId:'America/Bogota'});
  const page=await context.newPage();const errors=[];const blocked=[];
  page.on('pageerror',e=>errors.push(e.message));
  await context.route('**/*',route=>{
   const u=new URL(route.request().url());
   if(['127.0.0.1','localhost'].includes(u.hostname))return route.continue();
   blocked.push(u.origin);return route.abort();
  });
  const id=kind==='unavailable'?910002:kind==='error'?910003:910001;
  const token=((BigInt(id)<<32n)|0x12345678n).toString(36);
  const response=await page.goto(`http://127.0.0.1:5187/bancolombia/${flow}/purchase-code/${token}`,{waitUntil:'networkidle',timeout:60000});
  const message=kind==='unavailable'?'No encontramos el PIN para facturar':kind==='error'?'Error al cargar el código':'¡Todo está listo!';
  await page.getByText(message,{exact:false}).first().waitFor({timeout:15000});
  if(kind==='expired'){
   await page.clock.setFixedTime(new Date('2099-01-01T00:00:00Z'));
   await page.getByText('Tiempo caducado',{exact:true}).waitFor({timeout:10000});
  }
  const code=page.getByText('LOCAL_SYNTHETIC_PIN',{exact:true});
  const codeVisible=await code.count()>0&&await code.isVisible();
  assert.equal(codeVisible,kind==='available',`${flow}/${kind} PIN visibility`);
  const ready=await page.getByText('¡Todo está listo!',{exact:true}).count();
  assert.equal(ready>0,kind==='available',`${flow}/${kind} readiness`);
  const imageVisible=await page.locator('img[src="http://127.0.0.1:8127/code.svg"]').count()>0;
  assert.equal(imageVisible,kind==='available');
  assert.equal(await page.locator('body').evaluate(el=>el.scrollWidth<=innerWidth),true,'no horizontal overflow');
  const unexpectedErrors=errors.filter(e=>!(kind==='error'&&e==='PCS000'));
  assert.deepEqual(unexpectedErrors,[],`${flow}/${kind} unexpected client errors`);
  if(flow==='bnpl')await page.screenshot({path:output+`purchase-code-${kind}.png`,fullPage:true});
  checks.push({flow,kind,status:response.status(),codeVisible,imageVisible,clientErrors:errors,unexpectedClientErrors:unexpectedErrors,blockedExternalOrigins:[...new Set(blocked)],expiryClock:kind==='expired'?'2099-01-01T00:00:00Z':null});
  await context.close();
 }
 const requests=(await fetch('http://127.0.0.1:8127/stats').then(r=>r.json())).slice(initialRequests.length);
 writeFileSync(output+'purchase-code-requests.json',JSON.stringify(requests,null,2));
 assert.ok(requests.every(r=>(r.method==='POST'&&/^\/api\/onboarding\/purchase-code\/generate\/(910001|910002|910003)$/.test(r.path))||(r.method==='GET'&&r.path==='/app/local-fixture')));
 assert.equal(requests.filter(r=>r.method==='POST').length,8);
 writeFileSync(output+'purchase-code-browser-validation.json',JSON.stringify({checks,requests,limits:['Wizard y ruta reales con API HTTP local controlado; no acredita Corbeta, banco, SMS, base ni TTL del proveedor.','Vencimiento inducido al adelantar Date.now del navegador; deadline original calculado por el loader real.','Solicitudes externas del navegador bloqueadas; el inicio de autenticación consulta /app/local-fixture en el mismo mock local y recibe 404.','La respuesta 500 induce PCS000 en la promesa diferida: el navegador registra ese error esperado y muestra el errorElement real.']},null,2)+'\n');
 console.log(JSON.stringify(checks));
}finally{await browser.close();}
