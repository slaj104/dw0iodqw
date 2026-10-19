// 효과음 (Web Audio API로 실시간 합성 → 외부 음원 파일 불필요)
window.RS = window.RS || {};

RS.Audio = (function () {
  let ctx = null, master, motorOsc, motorOsc2, motorGain, motorFilter, rollGain, rollFilter, alarmGain, alarmOsc;
  let muted = false;

  function init() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = 0.5; master.connect(ctx.destination);

    // VVVF 인버터 + 견인전동기 소리
    motorOsc = ctx.createOscillator(); motorOsc.type = 'sawtooth';
    motorOsc2 = ctx.createOscillator(); motorOsc2.type = 'square';
    motorFilter = ctx.createBiquadFilter(); motorFilter.type = 'bandpass'; motorFilter.Q.value = 3;
    motorGain = ctx.createGain(); motorGain.gain.value = 0;
    motorOsc.connect(motorFilter); motorOsc2.connect(motorFilter);
    motorFilter.connect(motorGain); motorGain.connect(master);
    motorOsc.start(); motorOsc2.start();

    // 주행음 (필터링된 잡음)
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5; }
    const noise = ctx.createBufferSource(); noise.buffer = buf; noise.loop = true;
    rollFilter = ctx.createBiquadFilter(); rollFilter.type = 'lowpass'; rollFilter.frequency.value = 400;
    rollGain = ctx.createGain(); rollGain.gain.value = 0;
    noise.connect(rollFilter); rollFilter.connect(rollGain); rollGain.connect(master);
    noise.start();

    // ATC 과속 경보
    alarmOsc = ctx.createOscillator(); alarmOsc.type = 'square'; alarmOsc.frequency.value = 1250;
    alarmGain = ctx.createGain(); alarmGain.gain.value = 0;
    alarmOsc.connect(alarmGain); alarmGain.connect(master);
    alarmOsc.start();
  }

  let jointTimer = 0;
  function update(dt, vKmh, tAct, bAct, alarm) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const f = 40 + vKmh * 14;
    motorOsc.frequency.setTargetAtTime(f, t, 0.05);
    motorOsc2.frequency.setTargetAtTime(vKmh < 12 ? 520 + vKmh * 30 : f * 1.5, t, 0.05);
    motorFilter.frequency.setTargetAtTime(300 + vKmh * 25, t, 0.1);
    const mg = muted ? 0 : Math.min(0.12, (tAct * 0.12 + Math.min(bAct, 0.6) * 0.06) * Math.min(1, vKmh / 3));
    motorGain.gain.setTargetAtTime(mg, t, 0.08);
    rollGain.gain.setTargetAtTime(muted ? 0 : Math.min(0.35, vKmh / 220), t, 0.2);
    rollFilter.frequency.setTargetAtTime(200 + vKmh * 8, t, 0.2);
    const on = alarm && !muted && (Math.floor(t * 4) % 2 === 0);
    alarmGain.gain.setTargetAtTime(on ? 0.06 : 0, t, 0.01);

    // 레일 이음매 소리 (덜컹)
    if (vKmh > 3) {
      jointTimer -= dt * vKmh / 3.6;
      if (jointTimer <= 0) { jointTimer = 25; clack(); setTimeout(clack, Math.max(40, 18000 / vKmh / 3.6 * 0.12)); }
    }
  }

  function clack() {
    if (!ctx || muted) return;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = 'triangle'; o.frequency.value = 90;
    g.gain.value = 0.12; g.gain.setTargetAtTime(0, ctx.currentTime, 0.03);
    o.connect(g); g.connect(master); o.start(); o.stop(ctx.currentTime + 0.15);
  }

  function chime(freqs) {
    if (!ctx || muted) return;
    freqs.forEach((fr, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      const t0 = ctx.currentTime + i * 0.18;
      o.type = 'sine'; o.frequency.value = fr;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.18, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.6);
      o.connect(g); g.connect(master); o.start(t0); o.stop(t0 + 0.65);
    });
  }

  return {
    init, update,
    codeChange: () => chime([1046]),
    door: () => chime([784, 659]),
    notch: () => chime([2200]),
    toggleMute: () => { muted = !muted; return muted; },
  };
})();
