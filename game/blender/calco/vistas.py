# Renderiza el .blend en las 4 vistas ortogonales (con las referencias) para revisar la alineación.
import bpy, os, math
D=os.path.dirname(os.path.abspath(__file__)); bpy.ops.wm.open_mainfile(filepath=os.path.join(D,'quiff-calco.blend'))
sc=bpy.context.scene; sc.render.engine='BLENDER_WORKBENCH'; sc.render.resolution_x=sc.render.resolution_y=500; sc.display.shading.light='FLAT'; sc.display.shading.color_type='MATERIAL'
# (los vacíos con imagen no salen en el render: se pasan a planos con la imagen como textura)
for e in [o for o in sc.objects if o.type=='EMPTY' and o.data]:
    img=e.data; w,h=img.size; s=e.empty_display_size; sx,sy=(s,s*h/w) if w>=h else (s*w/h,s)
    ox,oy=e.empty_image_offset; bpy.ops.mesh.primitive_plane_add(size=1); pl=bpy.context.active_object
    pl.scale=(sx,sy,1); pl.matrix_world=e.matrix_world@__import__('mathutils').Matrix.Translation(((ox+.5)*sx,(oy+.5)*sy,0))@__import__('mathutils').Matrix.Diagonal((sx,sy,1,1))
    m=bpy.data.materials.new('r'); m.use_nodes=True; t=m.node_tree.nodes.new('ShaderNodeTexImage'); t.image=img; m.node_tree.links.new(t.outputs[0],m.node_tree.nodes['Principled BSDF'].inputs[0]); pl.data.materials.append(m)
sc.display.shading.color_type='TEXTURE'; sc.display.shading.show_backface_culling=True; sc.display.shading.show_xray=True; sc.display.shading.xray_alpha=.55
pelo=sc.objects['Pelo']; pelo.hide_render=True
cam=bpy.data.objects.new('cam',bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera=cam; cam.data.type='ORTHO'; cam.data.ortho_scale=1.8
for n,loc,rot in [('frente',(0,-5,2.75),(90,0,0)),('perfil',(5,0,2.75),(90,0,90)),('atras',(0,5,2.75),(90,0,180)),('arriba',(0,0,8),(0,0,0))]:
    cam.location=loc; cam.rotation_euler=[math.radians(a) for a in rot]; sc.render.filepath=os.path.join(D,'_v-'+n+'.png'); bpy.ops.render.render(write_still=True)
