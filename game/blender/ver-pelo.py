# Renderiza cabeza calva + pelo (OBJ Z arriba) en 4 vistas, una hoja. blender -b -P ver-pelo.py -- pelo.obj salida.png [arreglar]
import bpy, math, sys, os, bmesh
a=sys.argv[sys.argv.index('--')+1:]; pelo,out=a[0],a[1]; fix=len(a)>2
bpy.ops.wm.read_factory_settings(use_empty=True)
D=os.path.dirname(os.path.abspath(__file__))
for f,col in [(os.path.join(D,'cabeza-calva-zup.obj'),(0.85,0.65,0.5,1)),(pelo,(0.42,0.26,0.15,1))]:
    bpy.ops.wm.obj_import(filepath=f,forward_axis='Y',up_axis='Z')
    o=bpy.context.selected_objects[0]; m=bpy.data.materials.new('m'); m.diffuse_color=col; o.data.materials.clear(); o.data.materials.append(m)
    if f==pelo and fix:
        bm=bmesh.new(); bm.from_mesh(o.data); bmesh.ops.recalc_face_normals(bm,faces=bm.faces); bm.to_mesh(o.data); bm.free()
sc=bpy.context.scene; sc.render.engine='BLENDER_WORKBENCH'; sc.render.resolution_x=sc.render.resolution_y=360
sc.display.shading.light='STUDIO'; sc.display.shading.color_type='MATERIAL'; sc.display.shading.show_backface_culling=True
cam=bpy.data.objects.new('c',bpy.data.cameras.new('c')); sc.collection.objects.link(cam); sc.camera=cam; cam.data.type='ORTHO'; cam.data.ortho_scale=1.55
paths=[]
for n,loc,rot in [('frente',(0,-5,.6),(90,0,0)),('lado',(5,0,.6),(90,0,90)),('atras',(0,5,.6),(90,0,180)),('arriba',(0,0,6),(0,0,0)),('tres',(3.2,-3.2,2.4),(68,0,45))]:
    cam.location=loc; cam.rotation_euler=[math.radians(x) for x in rot]; p=out.replace('.png',f'-{n}.png'); sc.render.filepath=p; bpy.ops.render.render(write_still=True); paths.append(p)
