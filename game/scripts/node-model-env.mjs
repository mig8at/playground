// Adaptador de recursos locales para verificar geometría sin WebGL ni red.
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const publicRoot=resolve(import.meta.dirname,'../public'),nativeFetch=globalThis.fetch,NativeRequest=globalThis.Request;
globalThis.Request=class extends NativeRequest{constructor(url,options){super(typeof url==='string'&&url.startsWith('/')?'http://model.local'+url:url,options);}};
globalThis.ProgressEvent=class{constructor(type,data){Object.assign(this,{type},data);}};
globalThis.fetch=async input=>{const raw=typeof input==='string'?input:input.url;if(raw.startsWith('data:'))return nativeFetch(input);const path=raw.startsWith('/')?raw:new URL(raw).pathname;const file=resolve(publicRoot,'.'+decodeURIComponent(path));if(!file.startsWith(publicRoot+'/'))throw Error('Recurso fuera de public');try{return new Response(await readFile(file),{status:200});}catch{return new Response('',{status:404});}};
