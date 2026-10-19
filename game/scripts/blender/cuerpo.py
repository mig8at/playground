# El cuerpo base con otras proporciones y articulaciones mejores, hecho en Blender (FUGA, 2026-10-12).
# blender -b --factory-startup -P cuerpo.py -- BaseCharacter.gltf salida.glb piernas tronco brazos partes_entrada partes_salida vistas_dir
#  1) Alarga piernas, tronco y brazos en el esqueleto Y en la malla (cada vértice sigue a sus huesos con sus pesos) y lo
#     sube para que los pies sigan en el piso. El pie queda en la punta de la canilla.
#  2) Huesos de apoyo en codos y rodillas (Elbow.*, Knee.*): giran la mitad que el antebrazo o la canilla y se llevan
#     parte del peso de la articulación (así no se angosta al doblar).
#  3) Las 16 animaciones se pasan del esqueleto original al nuevo cuadro por cuadro (giros locales; el pie, en la
#     punta de la canilla; la cadera sube y baja en proporción, y sentado queda a la altura del asiento).
#  4) Las partes de ropa (public/models/partes/*.json) se recalculan con la misma deformación.
import bpy,sys,os,json,math
from mathutils import Vector
args=sys.argv[sys.argv.index('--')+1:]
src_path,out_path=args[0],args[1];PIERNAS,TRONCO,BRAZOS=map(float,args[2:5]);PARTS_IN,PARTS_OUT,VISTAS=args[5],args[6],args[7]
FACT={'UpperLeg':PIERNAS,'LowerLeg':PIERNAS,'Hips':TRONCO,'Abdomen':TRONCO,'Torso':TRONCO,'UpperArm':BRAZOS,'LowerArm':BRAZOS}
SIT={'SitDown','StandUp'}
strip=lambda n:n.split('.')[0]
# (Blender 5: las curvas viven en capas → tiras → canales; antes, en action.fcurves)
def fcurves(a):
  if hasattr(a,'fcurves'):return list(a.fcurves)
  out=[]
  for ly in a.layers:
    for st in ly.strips:
      for cb in st.channelbags:out+=list(cb.fcurves)
  return out
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src_path)
for o in list(bpy.context.scene.objects):
  if o.type=='MESH' and o.parent is None:bpy.data.objects.remove(o)
arm=[o for o in bpy.context.scene.objects if o.type=='ARMATURE'][0];body=[o for o in bpy.context.scene.objects if o.type=='MESH'][0]
for a in list(bpy.data.actions):a.name='src_'+a.name
# el original, con sus animaciones, queda como fuente
src=arm.copy();src.data=arm.data.copy();bpy.context.scene.collection.objects.link(src);src.name='Fuente'
src.animation_data_create()
# ---------- 1) las medidas nuevas ----------
M=arm.matrix_world;B={b.name:b for b in arm.data.bones}
old={n:(M@b.head_local,M@b.tail_local) for n,b in B.items()}
axis={n:(t-h).normalized() for n,(h,t) in old.items()}
L={n:FACT.get(strip(n),1.0) for n in B}
new={}
def mapb(n,p):
  h0,_=old[n];h1=new[n][0];d=p-h0;al=d.dot(axis[n]);return h1+d+axis[n]*(al*(L[n]-1) if al>0 else 0)
for b in arm.data.bones:  # (padres primero)
  n=b.name
  if b.parent is None or n.startswith('PoleTarget'):h1=old[n][0].copy()
  elif strip(n)=='Foot':s=n.split('.')[1];h1=None
  else:h1=mapb(b.parent.name,old[n][0])
  if h1 is not None:new[n]=[h1,None];new[n][1]=mapb(n,old[n][1])
for s in ('L','R'):  # el pie, en la punta de la canilla (con su largo de siempre)
  n='Foot.'+s;t=new['LowerLeg.'+s][1];new[n]=[t.copy(),t+(old[n][1]-old[n][0])]
FOOT_D={s:new['Foot.'+s][0]-old['Foot.'+s][0] for s in ('L','R')}
def mapb2(n,p):
  if strip(n)=='Foot':return p+FOOT_D[n.split('.')[1]]
  return mapb(n,p)
def mapv(p,ws):
  acc=Vector();tot=0
  for n,w in ws:
    if w<=0 or n not in new:continue
    acc+=mapb2(n,p)*w;tot+=w
  return acc/tot if tot else p.copy()
bm=body.matrix_world;bmi=bm.inverted();gn=[g.name for g in body.vertex_groups]
P0=[bm@v.co for v in body.data.vertices]
W=[[(gn[g.group],g.weight) for g in v.groups] for v in body.data.vertices]
P1=[mapv(p,w) for p,w in zip(P0,W)]
lift=min(p.z for p in P0)-min(p.z for p in P1)
for n in new:
  if B[n].parent is None or n.startswith('PoleTarget'):continue
  new[n][0].z+=lift;new[n][1].z+=lift
for p in P1:p.z+=lift
print('LIFT',round(lift,3),'ALTO',round(max(p.z for p in P0),2),'->',round(max(p.z for p in P1),2))
for v,p in zip(body.data.vertices,P1):v.co=bmi@p
bpy.context.view_layer.objects.active=arm;arm.select_set(True);bpy.ops.object.mode_set(mode='EDIT')
Mi=M.inverted()
for eb in arm.data.edit_bones:
  r=eb.roll;eb.head=Mi@new[eb.name][0];eb.tail=Mi@new[eb.name][1];eb.roll=r
# ---------- 2) huesos de apoyo en codos y rodillas ----------
HELP={}
for s in ('L','R'):
  for hn,up,lo in (('Elbow.'+s,'UpperArm.'+s,'LowerArm.'+s),('Knee.'+s,'UpperLeg.'+s,'LowerLeg.'+s)):
    e=arm.data.edit_bones.new(hn);lb=arm.data.edit_bones[lo];e.head=lb.head.copy();e.tail=lb.head+(lb.tail-lb.head)*.25;e.roll=lb.roll;e.parent=arm.data.edit_bones[up];e.use_deform=True;HELP[hn]=(up,lo)
bpy.ops.object.mode_set(mode='OBJECT')
for hn,(up,lo) in HELP.items():
  g=body.vertex_groups.new(name=hn);gu=body.vertex_groups[up].index;gl=body.vertex_groups[lo].index
  for v in body.data.vertices:
    wu=wl=0
    for x in v.groups:
      if x.group==gu:wu=x.weight
      if x.group==gl:wl=x.weight
    m=min(wu,wl)
    if m>.05:g.add([v.index],m,'REPLACE');body.vertex_groups[up].add([v.index],wu-m/2,'REPLACE');body.vertex_groups[lo].add([v.index],wl-m/2,'REPLACE')
# ---------- 3) pasar las animaciones ----------
for pb in arm.pose.bones:
  n=pb.name
  if n in HELP:
    c=pb.constraints.new('COPY_ROTATION');c.target=arm;c.subtarget=HELP[n][1];c.owner_space=c.target_space='LOCAL';c.influence=.5;continue
  if strip(n)=='Foot':
    c=pb.constraints.new('COPY_LOCATION');c.target=arm;c.subtarget='LowerLeg.'+n.split('.')[1];c.head_tail=1.0
    c=pb.constraints.new('COPY_ROTATION');c.target=src;c.subtarget=n;continue
  if n=='Body' or pb.parent is None or n.startswith('PoleTarget'):
    c=pb.constraints.new('COPY_TRANSFORMS');c.target=src;c.subtarget=n;c.owner_space=c.target_space='LOCAL';continue
  c=pb.constraints.new('COPY_ROTATION');c.target=src;c.subtarget=n;c.owner_space=c.target_space='LOCAL'
scene=bpy.context.scene;arm.animation_data_create()
names=[a.name[4:] for a in bpy.data.actions if a.name.startswith('src_')]
# (la cadera de la fuente: el eje vertical del hueso Body es su Y local)
offmin=0
sd=bpy.data.actions.get('src_SitDown')
if sd:
  for fc in fcurves(sd):
    if fc.data_path=='pose.bones["Body"].location' and fc.array_index==1:offmin=min(k.co[1] for k in fc.keyframe_points)
for n in names:
  a=bpy.data.actions['src_'+n];tmp=a.copy();tmp.name='tmp_'+n
  for fc in fcurves(tmp):
    if fc.data_path!='pose.bones["Body"].location':continue
    for k in fc.keyframe_points:
      v=k.co[1]
      if n in SIT and fc.array_index==1 and offmin<0:
        s=max(0,min(1,v/offmin));nv=v*PIERNAS*(1-s)+(v-lift)*s
      else:nv=v*PIERNAS
      k.co[1]=nv;k.handle_left[1]+=nv-v;k.handle_right[1]+=nv-v
  src.animation_data.action=tmp;f0,f1=map(int,a.frame_range)
  scene.frame_start,scene.frame_end=f0,f1
  bpy.ops.object.select_all(action='DESELECT');arm.select_set(True);bpy.context.view_layer.objects.active=arm
  bpy.ops.object.mode_set(mode='POSE');bpy.ops.pose.select_all(action='SELECT')
  arm.animation_data.action=None
  bpy.ops.nla.bake(frame_start=f0,frame_end=f1,only_selected=False,visual_keying=True,clear_constraints=False,use_current_action=False,bake_types={'POSE'})
  bpy.ops.object.mode_set(mode='OBJECT')
  arm.animation_data.action.name=n;print('HORNEADA',n,f0,f1)
for pb in arm.pose.bones:
  for c in list(pb.constraints):pb.constraints.remove(c)
arm.animation_data.action=None
for a in list(bpy.data.actions):
  if a.name.startswith('src_') or a.name.startswith('tmp_'):bpy.data.actions.remove(a)
bpy.data.objects.remove(src)
# ---------- vistas: Walk, SitDown (final) y PickUp, de lado ----------
os.makedirs(VISTAS,exist_ok=True)
bpy.ops.object.camera_add();cam=bpy.context.object;scene.camera=cam;cam.location=(6,-.3,1.6);cam.rotation_euler=(Vector((0,0,1.4))-cam.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.object.light_add(type='SUN');bpy.context.object.rotation_euler=(.7,.2,.9);bpy.context.object.data.energy=3
w=bpy.data.worlds.new('w');w.color=(.8,.82,.78);scene.world=w;scene.render.resolution_x=300;scene.render.resolution_y=360
for n,t in (('Walk',.3),('SitDown',1),('PickUp',.5),('Run',.3)):
  a=bpy.data.actions.get(n)
  if not a:continue
  arm.animation_data.action=a;f0,f1=a.frame_range;scene.frame_set(int(f0+(f1-f0)*t));scene.render.filepath=os.path.join(VISTAS,n+'.png');bpy.ops.render.render(write_still=True)
arm.animation_data.action=None;scene.frame_set(0)
bpy.ops.object.select_all(action='DESELECT');arm.select_set(True);body.select_set(True)
bpy.ops.export_scene.gltf(filepath=out_path,export_format='GLTF_EMBEDDED' if out_path.endswith('.gltf') else 'GLB',use_selection=True,export_animations=True,export_animation_mode='ACTIONS')
print('LISTO',out_path)
# ---------- 4) la ropa (partes del paquete, en coordenadas de three: y arriba) ----------
if PARTS_IN!='-':
  os.makedirs(PARTS_OUT,exist_ok=True);byname={n.replace('.',''):n for n in new}
  to_b=lambda x,y,z:Vector((x,-z,y))
  for f in sorted(os.listdir(PARTS_IN)):
    if not f.endswith('.json'):continue
    d=json.load(open(os.path.join(PARTS_IN,f)));J=[byname.get(j,j) for j in d['joints']]
    for p in d['parts']:
      pos,ji,wt=p['pos'],p['ji'],p['w']
      for i in range(len(pos)//3):
        q=to_b(pos[i*3],pos[i*3+1],pos[i*3+2]);ws=[(J[int(ji[i*4+k])],wt[i*4+k]) for k in range(4)]
        r=mapv(q,ws)  # (los huesos nuevos ya llevan la subida)
        pos[i*3],pos[i*3+1],pos[i*3+2]=round(r.x,4),round(r.z,4),round(-r.y,4)
    json.dump(d,open(os.path.join(PARTS_OUT,f),'w'))
  print('PARTES',len(os.listdir(PARTS_OUT)))
