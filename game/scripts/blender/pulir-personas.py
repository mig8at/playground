"""Soporte del abdomen y de la ropa, y simplificación de pelo en Blender.

blender -b --factory-startup -P scripts/blender/pulir-personas.py -- game_dir pelos_fuente
No cambia caras, huesos ni animaciones. Los JSON originales se conservan para
comparar. Sólo subdivide aristas largas del tronco y conserva los pesos.
"""
import bpy, bmesh, sys, os, json, math
from mathutils import Vector
ROOT, HAIR = sys.argv[sys.argv.index('--')+1:]
TRUNK={'Body','Hips','Abdomen','Torso'}
def clean(n):return n.replace('.','').split('_')[0]
def write(p,d):
    os.makedirs(os.path.dirname(p),exist_ok=True)
    with open(p,'w') as f:json.dump(d,f,separators=(',',':'))
def refine(me,names,cuts=1,minimum=.18,skin_material=None,selector=None):
    bm=bmesh.new();bm.from_mesh(me);layer=bm.verts.layers.deform.verify()
    def trunk(v):return sum(w for j,w in v[layer].items() if clean(names[j]) in TRUNK)>.72
    edges=[e for e in bm.edges if e.calc_length()>minimum and all(selector(v) if selector else trunk(v) for v in e.verts)
           and (skin_material is None or all(f.material_index==skin_material for f in e.link_faces))]
    if edges:bmesh.ops.subdivide_edges(bm,edges=edges,cuts=cuts,use_grid_fill=True)
    bmesh.ops.triangulate(bm,faces=list(bm.faces));bm.to_mesh(me);bm.free();me.update()
def jsonmesh(me,names,transform=lambda v:v,material=None):
    bm=bmesh.new();bm.from_mesh(me);layer=bm.verts.layers.deform.verify();bm.verts.ensure_lookup_table()
    faces=[f for f in bm.faces if material is None or f.material_index==material]
    used=sorted({v.index for f in faces for v in f.verts});index={v:i for i,v in enumerate(used)}
    pos=[];ji=[];weights=[]
    for i in used:
        v=bm.verts[i];q=transform(v.co);pos.extend(round(c,5) for c in q)
        ws=sorted(v[layer].items(),key=lambda p:-p[1])[:4];total=sum(w for _,w in ws)
        ws=[(j,w/total) for j,w in ws] if total else [(0,1)]
        ws+= [(0,0)]*(4-len(ws));ji.extend(j for j,_ in ws);weights.extend(round(w,6) for _,w in ws)
    idx=[index[v.index] for f in faces for v in f.verts];bm.free()
    return dict(pos=pos,idx=idx,ji=ji,w=weights)

for kind,name in [('paquete','BaseCharacter.gltf'),('intermedio','BaseIntermedio.glb'),('realista','BaseRealista.glb')]:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.join(ROOT,'public/models/personajes',name))
    body=next(o for o in bpy.context.scene.objects if o.type=='MESH' and o.vertex_groups)
    names=[g.name for g in body.vertex_groups];mi=next(i for i,m in enumerate(body.data.materials) if m.name=='Skin')
    before=sum(len(p.vertices)-2 for p in body.data.polygons if p.material_index==mi)
    arm=next(o for o in bpy.context.scene.objects if o.type=='ARMATURE')
    hips=(arm.matrix_world@arm.data.bones['Hips'].head_local).z
    torso=(arm.matrix_world@arm.data.bones['Torso'].head_local).z
    low,high=hips+.09,torso+.30
    M=body.matrix_world;inv=M.inverted()
    source=[M@v.co for v in body.data.vertices]
    faces=[tuple(p.vertices) for p in body.data.polygons if p.material_index==mi]
    # Secciones reales del tronco: la misma anchura y profundidad, ahora ovaladas.
    sections=[]
    for k in range(41):
        z=low+(high-low)*k/40;pts=[]
        for f in faces:
            for a,b in zip(f,f[1:]+f[:1]):
                pa,pb=source[a],source[b]
                if (pa.z-z)*(pb.z-z)>0 or abs(pa.z-pb.z)<1e-8:continue
                q=pa+(pb-pa)*((z-pa.z)/(pb.z-pa.z))
                if abs(q.x)<.63:pts.append(q)
        rx=max((abs(p.x) for p in pts),default=.35)
        ymin=min((p.y for p in pts),default=-.23);ymax=max((p.y for p in pts),default=.23)
        sections.append((rx,(ymin+ymax)/2,(ymax-ymin)/2))
    def eligible(v):
        p=M@v.co
        return low<p.z<high and abs(p.x)<.58
    refine(body.data,names,cuts=2,minimum=.12,skin_material=mi,selector=eligible)
    skinverts={i for p in body.data.polygons if p.material_index==mi for i in p.vertices}
    for v in body.data.vertices:
        p=M@v.co
        if v.index not in skinverts or not low<p.z<high:continue
        t=(p.z-low)/(high-low);u=t*40;i=min(39,int(u));a=u-i
        rx,cy,ry=[sections[i][j]*(1-a)+sections[i+1][j]*a for j in range(3)]
        if abs(p.x)>rx*1.01 or ry<.05:continue
        dx,dy=p.x,p.y-cy;r=math.hypot(dx/rx,dy/ry)
        if r<.1:continue
        amount=math.sin(math.pi*t)**.7
        p.x+=dx*(1/r-1)*amount;p.y+=dy*(1/r-1)*amount
        v.co=inv@p
    data=jsonmesh(body.data,names,lambda v:Vector(((body.matrix_world@v).x,(body.matrix_world@v).z,-(body.matrix_world@v).y)),mi)
    data['joints']=[clean(n) for n in names]
    data['torsoProfile']={'low':low,'high':high,'sections':[[rx,-cy,ry] for rx,cy,ry in sections]}
    write(os.path.join(ROOT,'public/models/personajes','PielPulida_'+kind+'.json'),data)
    print('PIEL',kind,before,'->',len(data['idx'])//3)
    folder='partes'+('' if kind=='paquete' else '_'+kind)
    changed_models=[]
    for fn in sorted(os.listdir(os.path.join(ROOT,'public/models',folder))):
        if not fn.endswith('.json'):continue
        with open(os.path.join(ROOT,'public/models',folder,fn)) as f:d=json.load(f)
        changed=False
        for p in d['parts']:
            if p['name']=='Face' or p['name'].startswith('Falda'):continue
            me=bpy.data.meshes.new('ropa');me.from_pydata([p['pos'][i:i+3] for i in range(0,len(p['pos']),3)],[],[p['idx'][i:i+3] for i in range(0,len(p['idx']),3)])
            bm=bmesh.new();bm.from_mesh(me);bm.verts.ensure_lookup_table();layer=bm.verts.layers.deform.verify()
            for v in bm.verts:
                for k in range(4):
                    w=p['w'][v.index*4+k]
                    if w:v[layer][p['ji'][v.index*4+k]]=w
            bm.to_mesh(me);bm.free();n0=len(p['idx'])
            refine(me,d['joints'],minimum=.19)
            r=jsonmesh(me,d['joints'])
            if len(r['idx'])>n0:p.update(r);changed=True
            bpy.data.meshes.remove(me)
        if changed:
            write(os.path.join(ROOT,'public/models',folder+'_pulidas',fn),d)
            changed_models.append(d['model'])

    write(os.path.join(ROOT,'public/models',folder+'_pulidas/index.json'),changed_models)

# Trabaja con los pelos originales sin simplificar, en coordenadas de Head.
# El presupuesto se decide por pelo; no aplasta ni subdivide los mechones.
with open(os.path.join(HAIR,'index.json')) as f:index=json.load(f)
out=[]
for entry in index:
    if entry['kind']!='pelo':continue
    with open(os.path.join(HAIR,entry['file'])) as f:d=json.load(f)
    me=bpy.data.meshes.new('pelo');me.from_pydata([d['pos'][i:i+3] for i in range(0,len(d['pos']),3)],[],[d['idx'][i:i+3] for i in range(0,len(d['idx']),3)])
    ob=bpy.data.objects.new('pelo',me);bpy.context.collection.objects.link(ob);bpy.context.view_layer.objects.active=ob
    dec=ob.modifiers.new('Simplificación conservando silueta','DECIMATE');dec.ratio=min(1,1150/(len(d['idx'])/3));dec.use_collapse_triangulate=True
    bpy.ops.object.modifier_apply(modifier=dec.name)
    bm=bmesh.new();bm.from_mesh(ob.data);bmesh.ops.triangulate(bm,faces=list(bm.faces));bm.to_mesh(ob.data);bm.free()
    d['pos']=[round(c,5) for v in ob.data.vertices for c in v.co];d['idx']=[i for p in ob.data.polygons for i in p.vertices];d['tris']=len(d['idx'])//3
    write(os.path.join(ROOT,'public/models/pelos_pulidos',entry['file']),d)
    out.append({**entry,'tris':d['tris']});bpy.data.objects.remove(ob,do_unlink=True)
print('PELOS',len(out),'a ~1150 triángulos, sin cambiar sus mechones originales')
write(os.path.join(ROOT,'public/models/pelos_pulidos/index.json'),out)
print('LISTO')
