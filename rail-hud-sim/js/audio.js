// 효과음: BigSoundBank(CC0) 실제 녹음 + Web Audio 합성(VVVF 인버터음, ATC 경보)
//  rolling_interior : 파리 지하철 차내 주행음 → 속도에 따라 재생속도·음량 변화
//  tunnel_rumble    : 터널 주행 굉음 (지하 구간)
//  compressor       : 공기압축기(CM) 구동음, air_release(공기 배출), horn(기적)
//  출입문 차임은 너무 크지 않도록 합성음 사용
window.RS = window.RS || {};

RS.Audio = (function () {
  let ctx = null, master, muted = false;
  const buf = {};
  const loops = {};
  let vvvf = null, alarm = null;

  async function decode(name) {
    const S = RS.ASSETS && RS.ASSETS.sfx;
    if (!S || !S[name]) return null;
    const b64 = S[name].split(',')[1];
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    try { return await ctx.decodeAudioData(arr.buffer); } catch (e) { return null; }
  }

  function loop(name) {
    if (!buf[name]) return null;
    const src = ctx.createBufferSource(); src.buffer = buf[name]; src.loop = true;
    const g = ctx.createGain(); g.gain.value = 0;
    src.connect(g); g.connect(master); src.start();
    return { src, g };
  }

  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = 0.8;
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp); comp.connect(ctx.destination);

    // VVVF 인버터 + 견인전동기 (합성)
    const o1 = ctx.createOscillator(); o1.type = 'sawtooth';
    const o2 = ctx.createOscillator(); o2.type = 'square';
    const o3 = ctx.createOscillator(); o3.type = 'sine';
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 2.5;
    const g2 = ctx.createGain(); g2.gain.value = 0.35;
    const g = ctx.createGain(); g.gain.value = 0;
    o1.connect(bp); o2.connect(g2); g2.connect(bp); o3.connect(g); bp.connect(g); g.connect(master);
    o1.start(); o2.start(); o3.start();
    vvvf = { o1, o2, o3, bp, g };

    const ao = ctx.createOscillator(); ao.type = 'square'; ao.frequency.value = 1180;
    const ag = ctx.createGain(); ag.gain.value = 0;
    ao.connect(ag); ag.connect(master); ao.start();
    alarm = { ao, ag };

    ['rolling_interior', 'tunnel_rumble', 'compressor', 'air_release', 'horn'].forEach(async n => {
      buf[n] = await decode(n);
      if (['rolling_interior', 'tunnel_rumble', 'compressor'].includes(n) && buf[n]) loops[n] = loop(n);
    });
  }

  function play(name, gain, rate) {
    if (!ctx || muted || !buf[name]) return;
    const s = ctx.createBufferSource(); s.buffer = buf[name]; s.playbackRate.value = rate || 1;
    const g = ctx.createGain(); g.gain.value = gain == null ? 0.8 : gain;
    s.connect(g); g.connect(master); s.start();
  }

  function beep(freqs, dur, vol) {
    if (!ctx || muted) return;
    freqs.forEach((fr, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      const t0 = ctx.currentTime + i * 0.16;
      o.type = 'sine'; o.frequency.value = fr;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol || 0.15, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + (dur || 0.5));
      o.connect(g); g.connect(master); o.start(t0); o.stop(t0 + (dur || 0.5) + 0.05);
    });
  }

  // 매 프레임: 속도·역행/제동·지하 여부에 따라 음량/음높이 조절
  function update(dt, s) {
    if (!ctx) return;
    const t = ctx.currentTime, vK = s.vK, m = muted ? 0 : 1;
    const set = (p, v, tc) => p.setTargetAtTime(v, t, tc || 0.15);
    const roll = loops.rolling_interior, tun = loops.tunnel_rumble, cm = loops.compressor;
    if (roll) { set(roll.g.gain, m * Math.min(0.55, 0.05 + vK / 140)); set(roll.src.playbackRate, 0.55 + vK / 110); if (vK < 0.5) set(roll.g.gain, 0); }
    if (tun) { set(tun.g.gain, m * (s.tunnel ? Math.min(0.5, vK / 150) : 0.02 * vK / 80), 0.4); set(tun.src.playbackRate, 0.6 + vK / 160); }
    if (cm) set(cm.g.gain, m * (s.cm ? 0.18 : 0), 0.3);
    // VVVF: 저속 비동기 변조(캐리어 일정) → 고속 동기 변조
    const f = 18 + vK * 9.5;
    const carrier = vK < 15 ? 520 + Math.floor(vK / 3) * 70 : f * (vK < 40 ? 9 : vK < 60 ? 5 : 3);
    set(vvvf.o1.frequency, f, 0.05); set(vvvf.o2.frequency, carrier, 0.03); set(vvvf.o3.frequency, f / 2, 0.05);
    set(vvvf.bp.frequency, 260 + vK * 22, 0.1);
    const load = Math.max(s.tAct, Math.min(1, s.bAct * 1.6) * (s.regen ? 0.8 : 0.25));
    set(vvvf.g.gain, m * Math.min(0.16, load * 0.16) * Math.min(1, vK / 2), 0.08);
    const on = s.alarm && !muted && (Math.floor(t * 5) % 2 === 0);
    alarm.ag.gain.setTargetAtTime(on ? 0.05 : 0, t, 0.01);
  }

  // 안내방송: 브라우저 내장 음성합성(Web Speech API). 한국어 음성이 없으면 기본 음성으로 읽음
  let annOn = true, voices = [];
  const synth = window.speechSynthesis;
  const loadVoices = () => { if (synth) voices = synth.getVoices(); };
  if (synth) { loadVoices(); synth.onvoiceschanged = loadVoices; }
  function pickVoice(lang) {
    const v = voices.filter(x => x.lang && x.lang.replace('_', '-').toLowerCase().startsWith(lang.slice(0, 2).toLowerCase()));
    return v.find(x => /female|여|heami|yuna|sunhi|google/i.test(x.name)) || v[0] || null;
  }
  // 녹음된 안내방송(assets/voice, 신경망 TTS + 방송 스피커 음색)을 순서대로 재생. 없으면 브라우저 TTS
  const voiceBuf = {};
  let annQueue = [], annBusy = false, annSrc = null, annGain = null;
  async function voice(key) {
    if (voiceBuf[key] !== undefined) return voiceBuf[key];
    const V = RS.ASSETS && RS.ASSETS.voice;
    if (!ctx || !V || !V[key]) return (voiceBuf[key] = null);
    const bin = atob(V[key].split(',')[1]);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    try { voiceBuf[key] = await ctx.decodeAudioData(arr.buffer); } catch (e) { voiceBuf[key] = null; }
    return voiceBuf[key];
  }
  function speakTTS(l) {
    return new Promise(res => {
      if (!synth) return res();
      const ut = new SpeechSynthesisUtterance(l.ko || l.en);
      ut.lang = l.lang || 'ko-KR';
      const v = pickVoice(ut.lang); if (v) ut.voice = v;
      ut.rate = 1.0; ut.volume = 0.9; ut.onend = ut.onerror = () => res();
      synth.speak(ut);
    });
  }
  function playBuf(b) {
    return new Promise(res => {
      if (!annGain) { annGain = ctx.createGain(); annGain.gain.value = 1.0; annGain.connect(master); }
      const s = ctx.createBufferSource(); s.buffer = b; s.connect(annGain);
      s.onended = () => { annSrc = null; res(); };
      annSrc = s; s.start();
    });
  }
  async function runQueue() {
    if (annBusy) return;
    annBusy = true;
    while (annQueue.length) {
      const lines = annQueue.shift();
      chime();
      await new Promise(r => setTimeout(r, 1300));
      for (const l of lines) {
        if (!annOn || muted) break;
        const b = l.key ? await voice(l.key) : null;
        if (b) await playBuf(b); else await speakTTS(l);
        await new Promise(r => setTimeout(r, 250));
      }
    }
    annBusy = false;
  }
  // 안내 차임 (도-미-솔 계열의 부드러운 3음)
  function chime() {
    if (!ctx || muted) return;
    [[784, 0], [988, 0.32], [1175, 0.64]].forEach(([f, d]) => {
      const t0 = ctx.currentTime + d;
      for (const [mul, vol] of [[1, 0.05], [2, 0.012], [3, 0.006]]) {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = 'sine'; o.frequency.value = f * mul;
        g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.1);
        o.connect(g); g.connect(master); o.start(t0); o.stop(t0 + 1.15);
      }
    });
  }
  function announce(lines) {
    if (!annOn || muted || !ctx) return;
    annQueue.push(lines);
    runQueue();
  }
  function stopAnn() {
    annQueue = [];
    if (annSrc) { try { annSrc.stop(); } catch (e) {} annSrc = null; }
    if (synth) synth.cancel();
  }

  return {
    init, update, play, announce,
    toggleAnn: () => { annOn = !annOn; if (!annOn) stopAnn(); return annOn; },
    stopAnn,
    codeChange: () => beep([1320], 0.35, 0.12),
    // 출입문: 작은 차임 + 약한 공기음 (녹음 대신 부드러운 합성음)
    doorOpen: () => { beep([659, 880], 0.45, 0.035); play('air_release', 0.1, 0.85); },
    doorClose: () => { beep([880, 740, 659], 0.4, 0.035); setTimeout(() => play('air_release', 0.07, 0.7), 1500); },
    buzzer: () => beep([1500, 1500], 0.12, 0.04),
    notch: () => beep([2600], 0.04, 0.05),
    call: () => beep([880, 1320], 0.2, 0.08),
    toggleMute: () => { muted = !muted; if (muted) stopAnn(); return muted; },
  };
})();
