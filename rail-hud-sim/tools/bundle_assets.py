#!/usr/bin/env python3
# assets/ 폴더의 CC0 텍스처·효과음·폰트를 js/assets_bundle.js 하나로 묶는다 (base64 data URI).
# 이렇게 하면 index.html 을 더블클릭(file://)으로 열어도 WebGL 텍스처·오디오가 막히지 않는다.
#   python3 tools/bundle_assets.py
import base64, json, os, glob
root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
def uri(path, mime):
    return 'data:%s;base64,%s' % (mime, base64.b64encode(open(path, 'rb').read()).decode())
out = {'tex': {}, 'sfx': {}, 'font': {}}
for f in sorted(glob.glob(os.path.join(root, 'assets/tex/*.jpg'))):
    name = os.path.splitext(os.path.basename(f))[0]
    if name.startswith('sky_'): name = 'sky'
    out['tex'][name] = uri(f, 'image/jpeg')
for f in sorted(glob.glob(os.path.join(root, 'assets/sfx/*.mp3'))):
    out['sfx'][os.path.splitext(os.path.basename(f))[0]] = uri(f, 'audio/mpeg')
for f in sorted(glob.glob(os.path.join(root, 'assets/font/*.woff2'))):
    out['font'][os.path.splitext(os.path.basename(f))[0]] = uri(f, 'font/woff2')
js = '// 자동 생성: python3 tools/bundle_assets.py (원본과 라이선스는 assets/ 폴더 참고)\nwindow.RS = window.RS || {};\nRS.ASSETS = ' + json.dumps(out) + ';\n'
open(os.path.join(root, 'js/assets_bundle.js'), 'w').write(js)
print('assets_bundle.js', round(len(js) / 1024 / 1024, 2), 'MB', {k: len(v) for k, v in out.items()})
