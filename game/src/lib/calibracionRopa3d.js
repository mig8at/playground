import * as T from 'three';
// Calibración compartida por familia. Registrar una prenda nueva aquí permite
// heredar sus márgenes; no es necesario duplicar la lógica dentro de persona3d.
export const GARMENT_CONTACT_FAMILIES=Object.freeze({
 short:{longSleeve:false},
 long:{longSleeve:true},
 sleeveless:{longSleeve:false,openShoulder:true},
 buttoned:{longSleeve:false,collar:true},
 buttonedLong:{longSleeve:true,collar:true},
 jacket:{longSleeve:true},
 vest:{longSleeve:true,openShoulder:true,extraShoulder:.10},
});
export const GARMENT_CONTACT_PROFILE=Object.freeze({
 'prenda:Casual_Male:Shirt:top':'short',
 'ropero:camiseta-manga-larga':'long',
 'ropero:camiseta-sin-mangas':'sleeveless',
 'ropero:camisa-botones':'buttoned',
 'ropero:polo':'buttoned',
 'ropero:camisa-manga-larga':'buttonedLong',
 'ropero:sudadera':'long',
 'ropero:sudadera-capucha':'long',
 'ropero:chaqueta-abierta':'jacket',
 'ropero:chaleco-abierto':'vest',
 'ropero:chaqueta-cerrada':'jacket',
});
const OPEN_SHOULDER={gordo:.40,robusto:.18,'atlético':.20,normal:.10,delgado:.075};
const MARGINS={gordo:{long:.13,short:.20},robusto:{long:.13,short:.09},default:{long:.105,short:.065}};
export function applyGarmentContactCalibration(geometry,look){
 if(!geometry.userData.wardrobeParts?.some(r=>r.basicShirt))return;
 const contact=geometry.userData.armContact;if(!contact)return;
 const family=id=>GARMENT_CONTACT_FAMILIES[GARMENT_CONTACT_PROFILE[id]]||GARMENT_CONTACT_FAMILIES.short;
 const top=family(look.prendas?.top),outer=family(look.prendas?.outer),longSleeve=top.longSleeve||outer.longSleeve;
 contact.avoidHead=!!(top.longSleeve||outer.longSleeve&&!outer.openShoulder);
 const margin=(MARGINS[look.contextura]||MARGINS.default)[longSleeve?'long':'short'];
 if(top.openShoulder||outer.openShoulder){contact.upperSamples=[.4,.6,.8,1];contact.shoulderOffset=OPEN_SHOULDER[look.contextura]??.10;}
 if(outer.extraShoulder)contact.shoulderOffset+=outer.extraShoulder;
 if(longSleeve&&look.contextura==='gordo')contact.shoulderOffset=Math.max(contact.shoulderOffset||0,.18);
 if(longSleeve&&look.contextura==='robusto')contact.shoulderOffset=Math.max(contact.shoulderOffset||0,.10);
 if(longSleeve&&look.contextura==='atlético')contact.shoulderOffset=Math.max(contact.shoulderOffset||0,.14);
 if(top.collar)contact.shoulderOffset=Math.max(contact.shoulderOffset||0,look.contextura==='gordo'?.18:look.contextura==='robusto'?.06:0);
 for(const arm of contact.arms){arm.radii=arm.radii.map(r=>r+margin);if(longSleeve&&look.contextura==='gordo'&&arm.hand)arm.hand.r+=.04;}
 for(const ring of contact.rings){ring.rx+=.018;ring.rz+=.018;}
}

// Evitar que la barbilla de la cabeza grande atraviese el cuello al inclinarse.
// Compensa la bajada de la barbilla con una extensión corta del cuello.
// Mantiene el giro lateral; restaura la pose base antes de cada actualización.
export function installCollarHeadLimit(root,mixer,mesh){
 const head=mesh.skeleton.bones.find(b=>b.name==='Head');if(!head)return;
 const up=mixer.update.bind(mixer),base=head.quaternion.clone(),position=head.position.clone(),e=new T.Euler();let applied=false;
 mixer.update=dt=>{if(applied){head.quaternion.copy(base);head.position.copy(position);}const result=up(dt);base.copy(head.quaternion);position.copy(head.position);e.setFromQuaternion(base,'XYZ');e.x=Math.min(e.x,.30);head.position.y+=.45*Math.sin(Math.max(0,e.x-.04));e.z=T.MathUtils.clamp(e.z,-.08,.08);head.quaternion.setFromEuler(e);head.updateWorldMatrix(false,true);applied=true;return result;};
}
