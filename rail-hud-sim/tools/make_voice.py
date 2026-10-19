#!/usr/bin/env python3
# 안내방송 음성 생성: MeloTTS(MIT, 신경망 TTS)로 문장을 합성 → 차내 방송 스피커 음색 처리 → assets/voice/*.mp3
# 준비: pip install torch torchaudio + MeloTTS(https://github.com/myshell-ai/MeloTTS) + python-mecab-ko
#   python tools/make_voice.py
import os, subprocess, warnings, numpy as np
from scipy import signal
from scipy.io import wavfile
warnings.filterwarnings('ignore')

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
OUT = os.path.join(ROOT, 'assets', 'voice')
TMP = os.environ.get('TMPDIR', '/tmp')

STATIONS = [  # js/route.js 의 RS.LINE.stations 와 같은 순서 (idx)
    ('남태령', 'Namtaeryeong', 'R'), ('선바위', 'Seonbawi', 'L'), ('경마공원', 'Seoul Racecourse Park', 'L'),
    ('대공원', 'Seoul Grand Park', 'L'), ('과천', 'Gwacheon', 'L'), ('정부과천청사', 'Government Complex Gwacheon', 'L'),
    ('인덕원', 'Indeogwon', 'L'), ('평촌', 'Pyeongchon', 'L'), ('범계', 'Beomgye', 'L'), ('금정', 'Geumjeong', 'L'), ('산본', 'Sanbon', 'L'),
]

# 영어 TTS가 로마자 역명을 영어식으로 읽지 않도록 발음 표기 (실제 영어 안내방송의 한국어식 발음에 가깝게)
SAY_EN = {
    'Namtaeryeong': 'Nam-tae-ryung', 'Seonbawi': 'Sun-bah-wee', 'Seoul Racecourse Park': 'Seoul Race-course Park',
    'Seoul Grand Park': 'Seoul Grand Park', 'Gwacheon': 'Gwah-chun', 'Government Complex Gwacheon': 'Government Complex Gwah-chun',
    'Indeogwon': 'In-dug-won', 'Pyeongchon': 'Pyung-chon', 'Beomgye': 'Bum-gay', 'Geumjeong': 'Gum-jung', 'Sanbon': 'Sahn-bon',
}

def lines():
    ko, en = {}, {}
    for i, (n, e0, side) in enumerate(STATIONS):
        e = SAY_EN[e0]
        door, doorEn = ('왼쪽', 'left') if side == 'L' else ('오른쪽', 'right')
        xfer = ' 1호선으로 갈아타실 고객께서는 이번 역에서 내리시기 바랍니다.' if n == '금정' else ''
        xferEn = ' You can transfer to Line 1.' if n == '금정' else ''
        ko[f'dep_{i}'] = f'이번 역은, {n}. {n}역입니다. 내리실 문은 {door}입니다.{xfer}'
        ko[f'last_{i}'] = f'이번 역은, 이 열차의 종착역인 {n}. {n}역입니다. 내리실 문은 {door}입니다. 두고 내리시는 물건이 없는지, 다시 한번 확인하시기 바랍니다.'
        ko[f'arr_{i}'] = f'{n}. {n}역입니다. 내리실 문은 {door}입니다.'
        ko[f'dest_{i}'] = f'이 열차는 {n}까지 가는 열차입니다.'
        en[f'en_next_{i}'] = f'The next station is {e}. The doors are on your {doorEn}.{xferEn}'
        en[f'en_last_{i}'] = f'This stop is {e}, the last stop of this train. The doors are on your {doorEn}.'
        en[f'en_arr_{i}'] = f'This stop is {e}.'
    ko['close'] = '출입문 닫습니다.'
    ko['dead'] = '잠시 후, 전기 공급 방식이 바뀌는 구간을 지나갑니다. 객실 냉난방과 일부 조명이 잠시 꺼질 수 있으니, 양해 바랍니다.'
    return ko, en

def pa_effect(x, sr):
    """차내 방송 스피커: 대역 제한(250 Hz~5.5 kHz) + 존재감 대역 강조 + 약한 포화 + 객실 잔향"""
    x = x.astype(np.float64)
    x /= (np.max(np.abs(x)) + 1e-9)
    sos = signal.butter(4, [250, 5500], btype='band', fs=sr, output='sos')
    y = signal.sosfilt(sos, x)
    b, a = signal.iirpeak(2600, 1.2, fs=sr)
    y = y + 0.35 * signal.lfilter(b, a, y)
    y = np.tanh(y * 2.2) / np.tanh(2.2)
    # 객실 잔향: 조기 반사 + 지수 감쇠 잡음 (RT60 약 0.45 s)
    n = int(0.6 * sr)
    t = np.arange(n) / sr
    rng = np.random.default_rng(7)
    ir = rng.standard_normal(n) * np.exp(-6.9 * t / 0.45)
    ir = signal.sosfilt(signal.butter(2, 3500, fs=sr, output='sos'), ir)
    for d, g in [(0.011, 0.5), (0.019, 0.35), (0.027, 0.3), (0.041, 0.2)]:
        ir[int(d * sr)] += g * 8
    ir /= np.sqrt(np.sum(ir ** 2))
    wet = signal.fftconvolve(y, ir)[: len(y) + int(0.35 * sr)]
    dry = np.concatenate([y, np.zeros(len(wet) - len(y))])
    z = dry * 0.82 + wet * 0.30
    z = np.concatenate([np.zeros(int(0.05 * sr)), z])
    return (z / (np.max(np.abs(z)) + 1e-9) * 0.89).astype(np.float32)

def main():
    from melo.api import TTS
    os.makedirs(OUT, exist_ok=True)
    ko, en = lines()
    jobs = [('KR', 'KR', ko, 0.92), ('EN', 'EN-US', en, 0.95)]
    for lang, spk, table, speed in jobs:
        m = TTS(language=lang, device='cpu')
        sid = m.hps.data.spk2id[spk]
        for key, text in table.items():
            dst = os.path.join(OUT, key + '.mp3')
            if os.path.exists(dst): continue
            raw = os.path.join(TMP, 'v_raw.wav')
            m.tts_to_file(text, sid, raw, speed=speed, quiet=True)
            sr, x = wavfile.read(raw)
            y = pa_effect(x, sr)
            fx = os.path.join(TMP, 'v_fx.wav')
            wavfile.write(fx, sr, y)
            subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', fx, '-ac', '1', '-ar', '24000', '-b:a', '40k', dst], check=True)
            print(key, text)

if __name__ == '__main__':
    main()
