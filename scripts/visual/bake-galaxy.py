"""Blender 4/5: deterministic stellar emission and absorption bake, no downloads.
Run: Blender --background --python scripts/visual/bake-galaxy.py
Then: node scripts/visual/compress-assets.mjs
"""
import bpy, numpy as np, math
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/'artifacts/galaxy/source'; OUT.mkdir(parents=True,exist_ok=True)
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
rng=np.random.default_rng(42); N=1536
Y,X=np.mgrid[-1:1:complex(N),-1:1:complex(N)].astype(np.float32)
r=np.sqrt(X*X+Y*Y); theta=np.arctan2(Y,X)
def noise(scale):
    a=rng.random((scale+1,scale+1)).astype(np.float32)
    u=np.linspace(0,scale-.001,N); i=u.astype(int); f=u-i; f=f*f*(3-2*f)
    return ((a[i[:,None],i]*(1-f)+a[i[:,None],i+1]*f)*(1-f[:,None])+(a[i[:,None]+1,i]*(1-f)+a[i[:,None]+1,i+1]*f)*f[:,None])
n=sum(noise(s)*w for s,w in [(8,.4),(24,.25),(64,.18),(180,.11),(480,.06)])
phase=theta-5.6*r + .7*(n-.5)+.12*np.sin(theta*3)
arm=(.5+.5*np.cos(phase*3))**4
arm *= .55 + .65*n + .22*np.sin(theta*5+r*13)
edge=np.clip((1-r)/.19,0,1)
dust=np.clip((n-.38)*4.2,0,1)*(.5+.5*np.cos(phase*3+.55))**9*edge
core=np.exp(-r*17)
density=(arm*(.1+.95*n)*np.exp(-r*2.2)+.11*np.exp(-r*3))*edge
warm=np.array([1,.72,.40]); cool=np.array([.37,.51,.86])
col=cool[None,None,:]*(density*(1-dust*.94))[...,None]+warm[None,None,:]*core[...,None]*1.4
# Unresolved stars and emission knots baked into the disk; most are subpixel.
for _ in range(42000):
    radius=rng.power(1.4)*.97; angle=rng.integers(3)*math.tau/3+5.6*radius+rng.normal(0,.10+radius*.07)
    x=int((math.cos(angle)*radius+1)*.5*(N-1)); y=int((math.sin(angle)*radius+1)*.5*(N-1))
    brightness=rng.power(.45)*.65*(1-dust[y,x]*.9)
    col[y,x]+=np.array([.72,.8,1])*brightness
col=np.clip(col*1.6,0,1)
def img(name,rgb,alpha=None):
    im=bpy.data.images.new(name,width=N,height=N,alpha=True,float_buffer=False)
    pixels=np.ones((N,N,4),dtype=np.float32); pixels[:,:,:3]=rgb
    if alpha is not None: pixels[:,:,3]=alpha
    im.pixels.foreach_set(pixels.ravel()); im.filepath_raw=str(OUT/(name+'.png')); im.file_format='PNG';im.save(); im.pack();return im
emission=img('stellar-emission',col)
img('dust-absorption',np.repeat(dust[:,:,None],3,axis=2))
# A separate deep field avoids repeating the foreground galaxy/core in the sky.
band=np.exp(-((Y-.40*X+.22*np.sin(X*3))/.46)**2)
cloud=band*np.clip((n-.34)*2.5,0,1)
absorption=np.clip((noise(90)-.48)*4,0,1)*band
sky=np.array([.15,.24,.44])[None,None,:]*(cloud*(1-absorption*.85))[...,None]*.45
sky+=np.array([.38,.18,.12])[None,None,:]*(cloud*np.clip(n-.5,0,1))[...,None]*.3
for _ in range(8500):
 x,y=rng.integers(0,N,2);sky[y,x]+=rng.power(.4)*.55*np.array([.8,.85,1])
img('deep-field',np.clip(sky,0,1))

# Actual editable Blender scene: baked galactic disk plus individual foreground stars.
bpy.ops.mesh.primitive_plane_add(size=12)
disk=bpy.context.object;disk.name='Irregular stellar disk and dust lanes';disk.rotation_euler=(1.08,.0,-.5);disk.location=(2.5,-1.6,0)
mat=bpy.data.materials.new('Baked stellar emission');mat.use_nodes=True
nodes=mat.node_tree.nodes;nodes.clear();o=nodes.new('ShaderNodeOutputMaterial');e=nodes.new('ShaderNodeEmission');t=nodes.new('ShaderNodeTexImage');t.image=emission
mat.node_tree.links.new(t.outputs['Color'],e.inputs['Color']);mat.node_tree.links.new(e.outputs[0],o.inputs[0]);disk.data.materials.append(mat)
verts=[];faces=[]
for _ in range(1600):
 x,y=rng.uniform(-12,12),rng.uniform(-8,8);s=rng.uniform(.002,.010);i=len(verts)
 verts.extend([(x-s,y-s,1),(x+s,y-s,1),(x+s,y+s,1),(x-s,y+s,1)]);faces.append((i,i+1,i+2,i+3))
mesh=bpy.data.meshes.new('Luminous star population');mesh.from_pydata(verts,[],faces);obj=bpy.data.objects.new('Foreground stars',mesh);bpy.context.collection.objects.link(obj)
star=bpy.data.materials.new('Cool starlight');star.use_nodes=True;p=star.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(.45,.55,.8,1);p.inputs['Emission Color'].default_value=(.55,.65,1,1);p.inputs['Emission Strength'].default_value=1.5;obj.data.materials.append(star)
bpy.ops.object.camera_add(location=(0,0,18));camera=bpy.context.object;camera.data.type='ORTHO';camera.data.ortho_scale=18;bpy.context.scene.camera=camera
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=8;scene.cycles.use_denoising=False
scene.world.use_nodes=True;scene.world.node_tree.nodes.get('Background').inputs['Color'].default_value=(0,0,0,1);scene.view_settings.view_transform='Standard'
scene.render.resolution_x=2400;scene.render.resolution_y=1500;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG';scene.render.filepath=str(OUT/'galaxy-desktop.png')
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'cinematic-galaxy.blend'));bpy.ops.render.render(write_still=True)
