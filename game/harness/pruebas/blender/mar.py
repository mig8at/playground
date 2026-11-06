# Un esqueleto de nado para un OBJ de mar: cadena de huesos de la cabeza a la cola (o, en la manta, a cada ala) y
# una acción «Swim» que ondula. blender -b -P mar.py -- objetivo.obj salida.glb modo vista.png
#   modo: lado (peces, tiburón), vertical (delfín, ballena), alas (manta)
import bpy,sys,math
from mathutils import Vector
src,out,modo,png=sys.argv[sys.argv.index('--')+1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.wm.obj_import(filepath=src)
m=[o for o in bpy.context.scene.objects if o.type=='MESH'][0]
V=[m.matrix_world@v.co for v in m.data.vertices]
x0,x1=min(v.x for v in V),max(v.x for v in V);y0,y1=min(v.y for v in V),max(v.y for v in V);z0,z1=min(v.z for v in V),max(v.z for v in V);zc=(z0+z1)/2;xc=(x0+x1)/2
bpy.ops.object.armature_add(location=(0,0,0));arm=bpy.context.object;bpy.ops.object.mode_set(mode='EDIT');eb=arm.data.edit_bones;eb.remove(eb[0])
chains=[]
if modo=='alas':
  # cuerpo corto en el medio y dos cadenas hacia las puntas de las alas
  root=eb.new('Body');root.head=(xc,y0,zc);root.tail=(xc,y1,zc)
  for sd,xe in (('L',x1),('R',x0)):
    prev=root;ch=[]
    for i in range(3):
      b=eb.new(f'Wing{i}.{sd}');a=xc+(xe-xc)*(.2+.8*i/3)*(1 if i else .5) if False else xc+(xe-xc)*(i/3);c=xc+(xe-xc)*((i+1)/3);b.head=(a,(y0+y1)/2,zc);b.tail=(c,(y0+y1)/2,zc);b.parent=prev;b.use_connect=False;prev=b;ch.append(b.name)
    chains.append((ch,sd))
else:
  N=5;prev=None;ch=[]
  # la cabeza está en -Y (el +z de three)
  for i in range(N):
    b=eb.new(f'Spine{i}');b.head=(xc,y0+(y1-y0)*i/N,zc);b.tail=(xc,y0+(y1-y0)*(i+1)/N,zc)
    if prev:b.parent=prev;b.use_connect=True
    prev=b;ch.append(b.name)
  chains.append((ch,''))
bpy.ops.object.mode_set(mode='OBJECT')
bpy.ops.object.select_all(action='DESELECT');m.select_set(True);arm.select_set(True);bpy.context.view_layer.objects.active=arm
bpy.ops.object.parent_set(type='ARMATURE_AUTO')
# la acción: una vuelta de 24 cuadros (1 s); la amplitud crece hacia la cola (o la punta del ala) y el desfase la hace ondular
act=bpy.data.actions.new('Swim');arm.animation_data_create();arm.animation_data.action=act
F=24
for ch,sd in chains:
  for i,n in enumerate(ch):
    pb=arm.pose.bones[n];pb.rotation_mode='XYZ'
    amp={'lado':.1+.13*i,'vertical':.05+.08*i,'alas':.25+.12*i}[modo]*(0 if (modo!='alas' and i==0) else 1)
    for f in range(0,F+1,3):
      ph=2*math.pi*f/F-i*.9
      if modo=='lado':pb.rotation_euler=(0,0,math.sin(ph)*amp)
      elif modo=='vertical':pb.rotation_euler=(math.sin(ph)*amp,0,0)
      else:pb.rotation_euler=(0,math.sin(2*math.pi*f/F-i*.5)*amp*(1 if sd=='L' else -1),0)
      pb.keyframe_insert('rotation_euler',frame=f)
s=bpy.context.scene;s.frame_start=0;s.frame_end=F;s.frame_set(6)
bpy.ops.object.camera_add();cam=bpy.context.object;s.camera=cam;ctr=Vector((xc,(y0+y1)/2,zc));size=max(x1-x0,y1-y0,z1-z0)
cam.location=ctr+Vector((size*.3,size*.2,size*1.2)) if modo!='vertical' else ctr+Vector((size*1.2,size*.1,size*.2));cam.rotation_euler=(ctr-cam.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.object.light_add(type='SUN');bpy.context.object.data.energy=3;s.render.resolution_x=360;s.render.resolution_y=260;s.render.filepath=png;bpy.ops.render.render(write_still=True)
bpy.ops.object.select_all(action='DESELECT');arm.select_set(True);m.select_set(True)
bpy.ops.export_scene.gltf(filepath=out,export_format='GLB',use_selection=True,export_animations=True,export_animation_mode='ACTIONS')
print('LISTO',out,len(m.data.polygons),[v.name for v in m.vertex_groups][:6])
