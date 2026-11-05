"""Siluetas de pelo y barba más suaves, con caras planas y presupuesto reducido.
blender -b --factory-startup -P scripts/blender/pelos-suaves.py -- game_dir fuente_dir
La fuente se obtiene con scripts/extraer-pelos-fuente.mjs. Conserva los originales.
"""
import bpy,bmesh,json,sys,os
ROOT,SOURCE=sys.argv[sys.argv.index('--')+1:]
OUT=os.path.join(ROOT,'public/models/pelos_suaves');os.makedirs(OUT,exist_ok=True)
index=json.load(open(os.path.join(SOURCE,'index.json')));result=[]
for entry in index:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    d=json.load(open(os.path.join(SOURCE,entry['file'])))
    me=bpy.data.meshes.new('Mechones');me.from_pydata([d['pos'][i:i+3] for i in range(0,len(d['pos']),3)],[],[d['idx'][i:i+3] for i in range(0,len(d['idx']),3)])
    ob=bpy.data.objects.new(entry['id'],me);bpy.context.collection.objects.link(ob);bpy.context.view_layer.objects.active=ob;ob.select_set(True)
    bm=bmesh.new();bm.from_mesh(me);bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.00015);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(me);bm.free()
    beard=entry['kind']=='barba';voxel=.018 if beard else .028
    # Une mechones solapados y elimina las astillas más finas; el alisado de la
    # superficie redondea sus extremos sin cambiar a sombreado liso.
    ob.data.remesh_voxel_size=voxel;ob.data.remesh_voxel_adaptivity=0
    bpy.ops.object.voxel_remesh()
    smooth=ob.modifiers.new('Extremos redondeados','SMOOTH');smooth.factor=1.0;smooth.iterations=4 if beard else 5
    bpy.ops.object.modifier_apply(modifier=smooth.name)
    budget=(220 if 'Chef_Hat' in entry['id'] else 440) if beard else 800
    tris=sum(len(p.vertices)-2 for p in ob.data.polygons)
    dec=ob.modifiers.new('Caras low poly','DECIMATE');dec.ratio=min(1,budget/max(1,tris));dec.use_collapse_triangulate=True
    bpy.ops.object.modifier_apply(modifier=dec.name)
    bm=bmesh.new();bm.from_mesh(ob.data);bmesh.ops.triangulate(bm,faces=list(bm.faces));bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(ob.data);bm.free()
    d['pos']=[round(c,5) for v in ob.data.vertices for c in v.co];d['idx']=[i for p in ob.data.polygons for i in p.vertices];d['tris']=len(d['idx'])//3
    with open(os.path.join(OUT,entry['file']),'w') as f:json.dump(d,f,separators=(',',':'))
    result.append({**entry,'tris':d['tris']});print(entry['id'],entry['tris'],'->',d['tris'])
with open(os.path.join(OUT,'index.json'),'w') as f:json.dump(result,f,separators=(',',':'))
print('LISTO',len(result),'piezas')
