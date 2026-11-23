import * as THREE from 'three';
const SKIN=new Map(),PARTS=new Map();
export function polishedSkin(sk,cu=null){const key=cu||'paquete';if(!SKIN.has(key))SKIN.set(key,fetch('/models/personajes/PielPulida_'+key+'.json').then(r=>r.ok?r.json():null).catch(()=>null));
 return SKIN.get(key).then(d=>{if(!d)return null;const byName=new Map(sk.bones.map((b,i)=>[b.name.replace(/_\d+$/,''),i])),remap=d.joints.map(n=>byName.get(n)??0),g=new THREE.BufferGeometry();
  g.setAttribute('position',new THREE.Float32BufferAttribute(d.pos,3));g.setAttribute('skinIndex',new THREE.Uint16BufferAttribute(d.ji.map(j=>remap[j]),4));g.setAttribute('skinWeight',new THREE.Float32BufferAttribute(d.w,4));g.setIndex(d.idx);g.userData.torsoProfile=d.torsoProfile;return g;});}
export async function polishedPartsFolder(model,cu=null){const dir='partes'+(cu?'_'+cu:'');if(!PARTS.has(dir))PARTS.set(dir,fetch('/models/'+dir+'_pulidas/index.json').then(r=>r.ok?r.json():[]).catch(()=>[]));
 return (await PARTS.get(dir)).includes(model)?dir+'_pulidas':dir;}
