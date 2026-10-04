import {createServer} from 'node:http';
const requests=[];
const payload=id=>({codeType:'ean128',code:'LOCAL_SYNTHETIC_PIN',codeImageUrl:'http://127.0.0.1:8127/code.svg',lender_id:68,payment_method:'BC_PAGA_DESP',allied_id:209,showBarCode:id!==910002});
const server=createServer((req,res)=>{
 const url=new URL(req.url,'http://127.0.0.1:8127');
 if(url.pathname==='/stats'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(requests));return;}
 if(url.pathname==='/code.svg'){res.setHeader('Content-Type','image/svg+xml');res.end('<svg xmlns="http://www.w3.org/2000/svg" width="240" height="90"><rect width="240" height="90" fill="white"/><path d="M20 10v60m8-60v60m12-60v60m8-60v60m12-60v60m15-60v60m8-60v60m14-60v60m8-60v60m16-60v60m8-60v60m12-60v60m8-60v60m12-60v60m10-60v60" stroke="black" stroke-width="4"/></svg>');return;}
 requests.push({method:req.method,path:url.pathname});
 const match=url.pathname.match(/^\/api\/onboarding\/purchase-code\/generate\/(910001|910002|910003)$/);
 res.setHeader('Content-Type','application/json');
 if(match&&req.method==='POST'){
  const id=Number(match[1]);res.statusCode=id===910003?500:200;
  res.end(JSON.stringify(id===910003?{success:false,error_code:'PCS000',payload:null}:{success:true,error_code:'PCS001',payload:payload(id)}));
 }else{res.statusCode=404;res.end(JSON.stringify({success:false,error_code:'UNEXPECTED_LOCAL_REQUEST',payload:null}));}
});
server.listen(8127,'127.0.0.1',()=>console.log('Controlled purchase-code API on 127.0.0.1:8127'));
for(const s of ['SIGINT','SIGTERM'])process.on(s,()=>server.close(()=>process.exit(0)));
