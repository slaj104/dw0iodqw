#!/usr/bin/env python3
# 무료(CC0) 고품질 에셋 다운로드·가공
#  - Poly Haven PBR 텍스처 1K: 색(diff) · 노멀(nor_gl) · ARM(AO/거칠기/금속) → assets/tex/
#  - ambientCG 건물 외벽(Facade) → assets/tex/
#  - Poly Haven 3D 모델(glTF) → 텍스처 축소 후 한 파일(.gltf, 데이터 내장)로 → assets/models/
#   python3 tools/fetch_assets.py
import os, io, json, base64, subprocess, zipfile, urllib.request
from PIL import Image
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
TEX = os.path.join(ROOT, 'assets', 'tex'); MOD = os.path.join(ROOT, 'assets', 'models')
os.makedirs(TEX, exist_ok=True); os.makedirs(MOD, exist_ok=True)

def get(url):
    return subprocess.run(['curl', '-s', '-L', '-m', '300', url], capture_output=True, check=True).stdout

def save_img(data, path, size, quality=84):
    im = Image.open(io.BytesIO(data)).convert('RGB')
    if size: im = im.resize((size, size), Image.LANCZOS)
    im.save(path, quality=quality, optimize=True)

# 1) 텍스처 (이름: 용도)
TEXTURES = {
    'concrete_wall_008': '터널 벽·콘크리트', 'gravel_concrete': '콘크리트 도상', 'gravel_stones': '자갈 도상',
    'large_grey_tiles': '승강장 바닥', 'long_white_tiles': '역 벽 타일', 'leafy_grass': '지면',
    'rusty_metal_02': '레일·금속', 'concrete_floor_02': '플랫폼 끝·바닥',
}
for name in TEXTURES:
    if os.path.exists(os.path.join(TEX, f'{name}_arm.jpg')): continue
    f = json.loads(get(f'https://api.polyhaven.com/files/{name}'))
    for key, suf, size in [('Diffuse', 'diff', 1024), ('nor_gl', 'nor', 1024), ('arm', 'arm', 512)]:
        try: url = f[key]['1k']['jpg']['url']
        except KeyError: continue
        save_img(get(url), os.path.join(TEX, f'{name}_{suf}.jpg'), size)
    print('tex', name)

# 2) 건물 외벽 (ambientCG Facade006 = 아파트, Facade002 = 사무동)
for fid in ['Facade006', 'Facade002']:
    if os.path.exists(os.path.join(TEX, f'{fid.lower()}_diff.jpg')): continue
    z = zipfile.ZipFile(io.BytesIO(get(f'https://ambientcg.com/get?file={fid}_1K-JPG.zip')))
    for n in z.namelist():
        for k, suf in [('_Color.jpg', 'diff'), ('_NormalGL.jpg', 'nor'), ('_Roughness.jpg', 'rough')]:
            if n.endswith(k): save_img(z.read(n), os.path.join(TEX, f'{fid.lower()}_{suf}.jpg'), 1024 if suf == 'diff' else 512)
    print('facade', fid)

# 3) 모델: glTF + bin + 텍스처 → 텍스처 512px 로 줄이고 data URI 로 내장한 단일 .gltf
MODELS = ['korean_fire_extinguisher_01', 'security_camera_01', 'mounted_fluorescent_lights', 'utility_box_01',
          'power_box_01', 'street_lamp_01', 'shrub_02', 'metal_trash_can', 'utility_box_02']
for name in MODELS:
    f = json.loads(get(f'https://api.polyhaven.com/files/{name}'))['gltf']['1k']['gltf']
    inc = {k: v['url'] for k, v in f['include'].items()}
    g = json.loads(get(f['url']))
    for b in g.get('buffers', []):
        b['uri'] = 'data:application/octet-stream;base64,' + base64.b64encode(get(inc[b['uri']])).decode()
    for im in g.get('images', []):
        data = get(inc[im['uri']])
        img = Image.open(io.BytesIO(data))
        alpha = img.mode in ('RGBA', 'LA') and img.getextrema()[-1][0] < 250
        img = img.convert('RGBA' if alpha else 'RGB').resize((512, 512), Image.LANCZOS)
        out = io.BytesIO()
        if alpha: img.save(out, 'PNG', optimize=True); mime = 'image/png'
        else: img.save(out, 'JPEG', quality=82, optimize=True); mime = 'image/jpeg'
        im['uri'] = f'data:{mime};base64,' + base64.b64encode(out.getvalue()).decode()
    open(os.path.join(MOD, name + '.gltf'), 'w').write(json.dumps(g))
    print('model', name, round(os.path.getsize(os.path.join(MOD, name + '.gltf')) / 1e6, 2), 'MB')
