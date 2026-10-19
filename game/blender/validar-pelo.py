# Valida un OBJ de pelo (Z arriba, frente -Y) contra la cabeza calva: topología, orientación, simetría y calce.
import sys, math
from collections import Counter, defaultdict
def load(p):
    V=[];F=[]
    for l in open(p):
        s=l.split()
        if s and s[0]=='v': V.append(tuple(map(float,s[1:4])))
        if s and s[0]=='f': F.append(tuple(int(x.split('/')[0])-1 for x in s[1:]))
    return V,F
V,F=load(sys.argv[1]); HV,HF=load(sys.argv[2])
print(f'vertices {len(V)} · caras {len(F)} · no triangulares {sum(1 for f in F if len(f)!=3)}')
F=[f for f in F if len(f)==3]
bad=[i+1 for f in F for i in f if i>=len(V)]; print('índices fuera de rango',bad[:10])
print('vertices sin usar',sorted(set(range(1,len(V)+1))-set(i+1 for f in F for i in f)))
deg=[f for f in F if len(set(f))<3]; print('caras degeneradas',len(deg))
dup=[f for f,n in Counter(tuple(sorted(f)) for f in F).items() if n>1]; print('caras duplicadas',[tuple(i+1 for i in d) for d in dup])
E=Counter();D=defaultdict(list)
for fi,(a,b,c) in enumerate(F):
    for u,v in ((a,b),(b,c),(c,a)): E[tuple(sorted((u,v)))]+=1; D[(u,v)].append(fi)
nm=[k for k,n in E.items() if n>2]; print('aristas no-manifold (>2 caras)',[(a+1,b+1,E[(a,b)]) for a,b in nm])
flip=[k for k,fs in D.items() if len(fs)>1]; print('aristas con caras vecinas invertidas',[(a+1,b+1) for a,b in flip])
bd=[k for k,n in E.items() if n==1]
# lazos de borde
adj=defaultdict(set)
for a,b in bd: adj[a].add(b); adj[b].add(a)
seen=set();loops=[]
for s in adj:
    if s in seen: continue
    st=[s];comp=[]
    while st:
        x=st.pop()
        if x in seen: continue
        seen.add(x);comp.append(x);st+=list(adj[x]-seen)
    loops.append(comp)
print('bordes abiertos',len(bd),'aristas en',len(loops),'lazo(s):',[sorted(i+1 for i in l)[:12] for l in loops])
cz=sum(v[2] for v in HV)/len(HV)
def nrm(t):
    A,B,C=t;u=[B[i]-A[i] for i in range(3)];w=[C[i]-A[i] for i in range(3)]
    return (u[1]*w[2]-u[2]*w[1],u[2]*w[0]-u[0]*w[2],u[0]*w[1]-u[1]*w[0])
inw=[]
for a,b,c in F:
    n=nrm((V[a],V[b],V[c]));m=[(V[a][i]+V[b][i]+V[c][i])/3 for i in range(3)]
    if m[0]*n[0]+m[1]*n[1]+(m[2]-cz)*n[2]<0: inw.append((a+1,b+1,c+1))
print('caras mirando hacia adentro',len(inw),inw[:12])
S={(round(-v[0],2),round(v[1],2),round(v[2],2)) for v in V}
asym=[i+1 for i,v in enumerate(V) if (round(v[0],2),round(v[1],2),round(v[2],2)) not in S]
print('vértices sin espejo en X (±0,01)',asym[:12])
# calce: distancia firmada de los vértices del pelo a la cabeza (por ray-casting de paridad para "adentro")
def inside(p,V,F):
    cnt=0
    for a,b,c in F:
        A,B,C=V[a],V[b],V[c]
        # rayo +x
        e1=[B[i]-A[i] for i in range(3)];e2=[C[i]-A[i] for i in range(3)];d=(1,0.0013,0.0007)
        h=(d[1]*e2[2]-d[2]*e2[1],d[2]*e2[0]-d[0]*e2[2],d[0]*e2[1]-d[1]*e2[0]);det=sum(e1[i]*h[i] for i in range(3))
        if abs(det)<1e-12: continue
        s=[p[i]-A[i] for i in range(3)];u=sum(s[i]*h[i] for i in range(3))/det
        if u<0 or u>1: continue
        q=(s[1]*e1[2]-s[2]*e1[1],s[2]*e1[0]-s[0]*e1[2],s[0]*e1[1]-s[1]*e1[0]);v=sum(d[i]*q[i] for i in range(3))/det
        if v<0 or u+v>1: continue
        t=sum(e2[i]*q[i] for i in range(3))/det
        if t>0: cnt+=1
    return cnt%2==1
HFs=[f for f in HF if len(f)==3]
inn=[i+1 for i,v in enumerate(V) if inside(v,HV,HFs)]
print('vértices del pelo DENTRO de la cabeza',len(inn),inn[:20])
hin=[i for i,v in enumerate(HV) if v[2]>0.75 and inside(v,V,F)]
print('vértices de la cabeza (z>0,75) cubiertos por el pelo',len(hin),'de',sum(1 for v in HV if v[2]>0.75))
xs=[v[0] for v in V];ys=[v[1] for v in V];zs=[v[2] for v in V]
print('caja pelo x %.2f..%.2f y %.2f..%.2f z %.2f..%.2f'%(min(xs),max(xs),min(ys),max(ys),min(zs),max(zs)))
