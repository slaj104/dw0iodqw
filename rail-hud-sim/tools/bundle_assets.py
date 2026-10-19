#!/usr/bin/env python3
# assets/ 폴더의 CC0 텍스처·효과음·폰트를 js/assets_bundle.js 하나로 묶는다 (base64 data URI).
# 이렇게 하면 index.html 을 더블클릭(file://)으로 열어도 WebGL 텍스처·오디오가 막히지 않는다.
#   python3 tools/bundle_assets.py
import base64, json, os, glob
root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
def uri(path, mime):
    return 'data:%s;base64,%s' % (mime, base64.b64encode(open(path, 'rb').read()).decode())
def write(fname, obj, note):
    js = '// 자동 생성: python3 tools/bundle_assets.py — ' + note + '\nwindow.RS = window.RS || {};\nRS.ASSETS = RS.ASSETS || {};\n' + ''.join(f'RS.ASSETS.{k} = ' + json.dumps(v) + ';\n' for k, v in obj.items())
    open(os.path.join(root, 'js', fname), 'w').write(js)
    print(fname, round(len(js) / 1024 / 1024, 2), 'MB', {k: len(v) for k, v in obj.items()})

tex, sfx, font, voice, models = {}, {}, {}, {}, {}
for f in sorted(glob.glob(os.path.join(root, 'assets/tex/*.jpg'))):
    name = os.path.splitext(os.path.basename(f))[0]
    if name.startswith('sky_'): name = 'sky'
    tex[name] = uri(f, 'image/jpeg')
for f in sorted(glob.glob(os.path.join(root, 'assets/sfx/*.mp3'))):
    sfx[os.path.splitext(os.path.basename(f))[0]] = uri(f, 'audio/mpeg')
for f in sorted(glob.glob(os.path.join(root, 'assets/font/*.woff2'))):
    font[os.path.splitext(os.path.basename(f))[0]] = uri(f, 'font/woff2')
for f in sorted(glob.glob(os.path.join(root, 'assets/voice/*.mp3'))):
    voice[os.path.splitext(os.path.basename(f))[0]] = uri(f, 'audio/mpeg')
for f in sorted(glob.glob(os.path.join(root, 'assets/models/*.gltf'))):
    models[os.path.splitext(os.path.basename(f))[0]] = open(f).read()
write('assets_bundle.js', {'tex': tex, 'sfx': sfx, 'font': font}, '텍스처·효과음·폰트')
write('assets_voice.js', {'voice': voice}, '안내방송')
write('assets_models.js', {'models': models}, '3D 모델 (glTF, 데이터 내장)')
