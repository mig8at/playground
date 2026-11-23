# Faldas a la medida de un cuerpo (FUGA, 2026-10-12).
# blender -b --factory-startup -P faldas.py -- cuerpo.(glb|gltf) partes_dir vista.png
# Mide la cadera y las piernas del cuerpo por alturas y arma tres faldas (corta, a la rodilla y larga): un tubo de
# anillos que sigue la cintura y se abre hacia el ruedo. Pesos como en los juegos: arriba, la cadera (Body/Hips); hacia
# abajo, cada lado toma de a poco la pierna de su lado (UpperLeg), hasta la mitad en el ruedo: al caminar se mece sin
# partirse. Se guardan en partes_dir/Prendas.json con el mismo formato que las partes del paquete (y arriba en three).
import bpy,sys,os,json,math
from mathutils import Vector
src,PARTS,PNG=sys.argv[sys.argv.index('--')+1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
for o in list(bpy.context.scene.objects):
  if o.type=='MESH' and o.parent is None:bpy.data.objects.remove(o)
arm=[o for o in bpy.context.scene.objects if o.type=='ARMATURE'][0];body=[o for o in bpy.context.scene.objects if o.type=='MESH']
B={b.name:arm.matrix_world@b.head_local for b in arm.data.bones}
# la piel (sólo la del cuerpo, sin la cara), en el mundo
V=[]
for o in body:
  M=o.matrix_world
  for v in o.data.vertices:V.append(M@v.co)
hip=B['Body'];knee=(B['LowerLeg.L'].z+B['LowerLeg.R'].z)/2;ankle=(B['Foot.L'].z+B['Foot.R'].z)/2
waist=B['Hips'].z+(B['Abdomen'].z-B['Hips'].z)*.95  # (alta: queda metida bajo la blusa; más baja quedaba piel al aire en la cintura)
def slice_(z,dz=.05):
  pts=[p for p in V if abs(p.z-z)<dz and abs(p.x)<.75];return pts
def ext(z):
  pts=slice_(z)
  if not pts:return .3,.25,0
  xs=[p.x for p in pts];ys=[p.y for p in pts];return max(abs(min(xs)),abs(max(xs))),(max(ys)-min(ys))/2,(max(ys)+min(ys))/2
print('cintura',round(waist,2),'cadera',round(hip.z,2),'rodilla',round(knee,2),'tobillo',round(ankle,2))
FALDAS={'FaldaCorta':hip.z-(hip.z-knee)*.55,'FaldaRodilla':knee+.04,'FaldaLarga':knee-(knee-ankle)*.55}
N,R=20,8;joints=['Body','Hips','UpperLeg.L','UpperLeg.R'];out=[]
for name,hem in FALDAS.items():
  rows=[];top=waist
  # (un cono suave: de la cintura se abre rápido hasta lo más ancho de la cadera y los muslos, y después se ensancha de
  # a poco hasta el ruedo; medir cada altura por separado la dejaba con forma de reloj de arena)
  wx,wy,cy0=ext(top);zs=[top+(max(hem,knee+.05)-top)*k/12 for k in range(13)];E=[ext(z) for z in zs];mx=max(e[0] for e in E);my=max(e[1] for e in E)
  for k in range(R+1):
    t=k/R;z=top+(hem-top)*t;q=min(1,t*2.6);q=q*q*(3-2*q)
    ax=wx+.03+(mx+.05-wx-.03)*q+.09*t;ay=wy+.03+(my+.05-wy-.03)*q+.07*t
    rows.append([(Vector((ax*math.cos(a),cy0+ay*math.sin(a),z)),a) for a in [i/N*2*math.pi for i in range(N)]])
  pos=[];idx=[];ji=[];w=[]
  for k,row in enumerate(rows):
    t=k/R
    for p,a in row:
      pos.append(p);s=math.cos(a)  # (+x: su izquierda)
      # (hacia el ruedo pasa a su pierna; el muñeco la convierte en un hueso de falda —persona3d: SkirtL/R— que sigue
      # al muslo a medias de pie y casi entero sentado; lo de adelante y atrás, un poco menos)
      leg=t**1.3  # (también adelante y atrás: con poco peso de pierna, sentada la parte de atrás colgaba por debajo del asiento)
      # (adelante y atrás, repartido entre las dos piernas de a poco: cortar en seco abría la falda al separarse las piernas)
      fl=min(1,max(0,(s+.35)/.7));fl=fl*fl*(3-2*fl)
      ws={'Body':(1-leg)*.6,'Hips':(1-leg)*.4,'UpperLeg.L':leg*fl,'UpperLeg.R':leg*(1-fl)};ji.append([joints.index(n) for n in ws]);w.append(list(ws.values()))
  for k in range(R):
    for i in range(N):
      a=k*N+i;b=k*N+(i+1)%N;c=(k+1)*N+(i+1)%N;d=(k+1)*N+i
      idx+=[a,d,c,a,c,b]
  # (sólo la cara de afuera: con la de adentro pasaba de 900 triángulos y al cargarla se simplificaba, arrugada)
  out.append({'name':name,'color':'#3d5370','pos':[round(v,4) for p in pos for v in (p.x,p.z,-p.y)],'idx':idx,'ji':[j for q in ji for j in q],'w':[round(x,3) for q in w for x in q]})
  print('FALDA',name,'ruedo',round(hem,2),len(idx)//3,'triángulos')
os.makedirs(PARTS,exist_ok=True)
json.dump({'model':'Prendas','joints':[j.replace('.','') for j in joints],'parts':out},open(os.path.join(PARTS,'Prendas.json'),'w'))
# vista: el cuerpo y la falda a la rodilla
me=bpy.data.meshes.new('f');P=out[1]['pos'];me.from_pydata([Vector((P[i*3],-P[i*3+2],P[i*3+1])) for i in range(len(P)//3)],[],[tuple(out[1]['idx'][j:j+3]) for j in range(0,len(out[1]['idx']),3)]);ob=bpy.data.objects.new('f',me);bpy.context.scene.collection.objects.link(ob)
s=bpy.context.scene;bpy.ops.object.camera_add();cam=bpy.context.object;s.camera=cam;cam.location=(3,-5,1.6);cam.rotation_euler=(Vector((0,0,1.4))-cam.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.object.light_add(type='SUN');bpy.context.object.data.energy=3;s.render.resolution_x=300;s.render.resolution_y=360;s.render.filepath=PNG;bpy.ops.render.render(write_still=True)
print('LISTO')
