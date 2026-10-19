# Prestar el esqueleto (y las animaciones) de un animal de Quaternius a un OBJ sin huesos.
# blender -b -P rig.py -- donante.gltf objetivo.obj salida.glb vista.png
import bpy,sys,math,mathutils
from mathutils import Vector
donor,target,out,png=sys.argv[sys.argv.index('--')+1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=donor)
arm=[o for o in bpy.context.scene.objects if o.type=='ARMATURE'][0]
dmesh=[o for o in bpy.context.scene.objects if o.type=='MESH' and o.parent==arm][0]
for o in list(bpy.context.scene.objects):
  if o.type=='MESH' and o!=dmesh:bpy.data.objects.remove(o)
bpy.ops.wm.obj_import(filepath=target)
tm=[o for o in bpy.context.scene.objects if o.type=='MESH' and o!=dmesh][0]
dg=bpy.context.evaluated_depsgraph_get()
# pose de reposo para medir
arm.data.pose_position='REST';bpy.context.view_layer.update()
def verts(o):
  m=o.evaluated_get(bpy.context.evaluated_depsgraph_get()).to_mesh();M=o.matrix_world;v=[M@x.co for x in m.vertices];return v
def prof(V):
  # z0..z1, la barriga (lo más bajo donde el cuerpo ocupa más del 45 % del largo), y los centros de las patas (adelante/atrás) bajo la barriga
  zs=[p.z for p in V];ys=[p.y for p in V];xs=[p.x for p in V];z0,z1=min(zs),max(zs);y0,y1=min(ys),max(ys);L=y1-y0
  belly=z0+(z1-z0)*.5
  for k in range(4,40):
    z=z0+(z1-z0)*k/40;sl=[p.y for p in V if abs(p.z-z)<(z1-z0)/30]
    occ=len(set(int((y-y0)/L*20) for y in sl))
    if occ>=11:belly=z;break
  legs=[p.y for p in V if p.z<z0+(belly-z0)*.7];ym=(y0+y1)/2
  a=[y for y in legs if y<ym] or [y0+L*.2];b=[y for y in legs if y>=ym] or [y1-L*.2]
  return dict(x0=min(xs),x1=max(xs),y0=y0,y1=y1,z0=z0,z1=z1,belly=belly,la=sum(a)/len(a),lb=sum(b)/len(b))
D=prof(verts(dmesh));T=prof(verts(tm))
print('D',{k:round(v,2) for k,v in D.items()});print('T',{k:round(v,2) for k,v in T.items()})
def pw(v,src,dst):
  for i in range(len(src)-1):
    if v<=src[i+1] or i==len(src)-2:
      t=(v-src[i])/((src[i+1]-src[i]) or 1);return dst[i]+(dst[i+1]-dst[i])*t
def f(p):  # del espacio del donante al del objetivo
  return Vector((pw(p.x,[D['x0'],D['x1']],[T['x0'],T['x1']]),pw(p.y,[D['y0'],D['la'],D['lb'],D['y1']],[T['y0'],T['la'],T['lb'],T['y1']]),pw(p.z,[D['z0'],D['belly'],D['z1']],[T['z0'],T['belly'],T['z1']])))
# 1) la malla donante, deformada a la forma del objetivo (sólo para pasar pesos)
Mi=dmesh.matrix_world.inverted();Mw=dmesh.matrix_world
for v in dmesh.data.vertices:v.co=Mi@f(Mw@v.co)
# 2) los huesos del esqueleto, a la forma del objetivo
bpy.context.view_layer.objects.active=arm;arm.select_set(True);bpy.ops.object.mode_set(mode='EDIT')
A=arm.matrix_world;Ai=A.inverted()
for b in arm.data.edit_bones:
  h,t=f(A@b.head),f(A@b.tail);b.head=Ai@h;b.tail=Ai@t
bpy.ops.object.mode_set(mode='OBJECT')
# 3) pesos: del más cercano de la malla donante
tm.parent=arm;tm.matrix_parent_inverse=arm.matrix_world.inverted()
for g in dmesh.vertex_groups:tm.vertex_groups.new(name=g.name)
mod=tm.modifiers.new('dt','DATA_TRANSFER');mod.object=dmesh;mod.use_vert_data=True;mod.data_types_verts={'VGROUP_WEIGHTS'};mod.vert_mapping='POLYINTERP_NEAREST';mod.layers_vgroup_select_src='ALL';mod.layers_vgroup_select_dst='NAME'
bpy.context.view_layer.objects.active=tm;bpy.ops.object.datalayout_transfer(modifier='dt');bpy.ops.object.modifier_apply(modifier='dt')
am=tm.modifiers.new('arm','ARMATURE');am.object=arm
bpy.data.objects.remove(dmesh)
arm.data.pose_position='POSE'
# vista: el objetivo caminando (a la mitad de Walk)
act=bpy.data.actions.get('Walk');arm.animation_data.action=act;s=bpy.context.scene;s.frame_set(int(act.frame_range[0]+(act.frame_range[1]-act.frame_range[0])*.3))
bpy.ops.object.camera_add();cam=bpy.context.object;s.camera=cam
ctr=Vector(((T['x0']+T['x1'])/2,(T['y0']+T['y1'])/2,(T['z0']+T['z1'])/2));size=(Vector((T['x1'],T['y1'],T['z1']))-Vector((T['x0'],T['y0'],T['z0']))).length
cam.location=ctr+Vector((size*1.1,-size*.25,size*.35));cam.rotation_euler=(ctr-cam.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.object.light_add(type='SUN');bpy.context.object.rotation_euler=(.6,.3,.5);bpy.context.object.data.energy=3
w=bpy.data.worlds.new('w');w.color=(.85,.87,.83);s.world=w;s.render.resolution_x=420;s.render.resolution_y=300;s.render.filepath=png;bpy.ops.render.render(write_still=True)
# exportar: esqueleto + malla, todas las acciones
bpy.ops.object.select_all(action='DESELECT');arm.select_set(True);tm.select_set(True)
bpy.ops.export_scene.gltf(filepath=out,export_format='GLB',use_selection=True,export_animations=True,export_animation_mode='ACTIONS',export_apply=False)
print('LISTO',out,len(tm.data.polygons))
