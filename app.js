(() => {
  const $ = id => document.getElementById(id);
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const sleep = ms => new Promise(r => setTimeout(r, reduce ? 0 : ms));

  // ===== Музыка =====
  // Хочешь свою песню — положи рядом файл (например music.mp3) и впиши имя сюда.
  // Если оставить пусто, играет мягкая мелодия, которую браузер создаёт сам.
  const MUSIC_FILE = '';

  // ===== Этапы =====
  const STEPS = ['Начало', 'Письмо', 'Сердце', 'Финал'];
  const stepNow = $('stepNow'), stepName = $('stepName');
  const dots = [...document.querySelectorAll('#dots i')];
  function setStep(n) {
    stepNow.textContent = String(n).padStart(2, '0');
    stepName.textContent = STEPS[n - 1];
    dots.forEach((d, i) => d.classList.toggle('on', i < n));
  }

  const sceneStart = $('sceneStart'), sceneLetter = $('sceneLetter');
  function showScene(scene) {
    [sceneStart, sceneLetter].forEach(s => s.classList.toggle('active', s === scene));
  }

  // Шоу на canvas само сообщает, где оно находится
  document.addEventListener('show:start', () => setStep(3));
  document.addEventListener('show:outro', () => setStep(4));

  // ===== 01 → 02 =====
  $('openBtn').addEventListener('click', () => {
    showScene(sceneLetter);
    setStep(2);
  });

  // ===== Конверт и письмо с эффектом печатной машинки =====
  const wrap = $('envWrap'), envelope = $('envelope'), hint = $('envHint');
  const nextBtn = $('nextBtn'), letter = $('letter');
  const paras = [...$('letterBody').querySelectorAll('p')];
  const texts = paras.map(p => p.textContent.trim());
  paras.forEach(p => { p.textContent = ''; });

  let opened = false, typing = false, skip = false;

  async function typeLetter() {
    typing = true;
    if (reduce) skip = true;
    for (let i = 0; i < paras.length; i++) {
      const p = paras[i], txt = texts[i];
      p.classList.add('caret');
      for (let k = 0; k < txt.length && !skip; k++) {
        p.textContent = txt.slice(0, k + 1);
        await sleep(/[.,!?…—]/.test(txt[k]) ? 230 : 38);
      }
      p.textContent = txt;
      p.classList.remove('caret');
      if (skip) { for (let j = i + 1; j < paras.length; j++) paras[j].textContent = texts[j]; break; }
      await sleep(380);
    }
    typing = false;
    nextBtn.hidden = false;
    nextBtn.classList.add('fade-in');
  }

  async function openEnvelope() {
    if (opened) return;
    opened = true;
    wrap.classList.add('open');
    hint.classList.add('gone');
    envelope.removeAttribute('tabindex');
    envelope.setAttribute('aria-label', 'Конверт открыт');
    await sleep(1600);
    wrap.classList.add('read');
    await sleep(1200);
    typeLetter();
  }

  envelope.addEventListener('click', openEnvelope);
  envelope.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openEnvelope(); }
  });
  letter.addEventListener('click', () => { if (typing) skip = true; }); // тап по письму — допечатать сразу

  // ===== 02 → 03: запускаем сердце =====
  nextBtn.addEventListener('click', async () => {
    nextBtn.disabled = true;
    showScene(null);
    await sleep(900);
    if (window.Show) window.Show.start();
  });

  // ===== Секретная страница =====
  const secret = $('secret'), secretBtn = $('secretBtn'), secretClose = $('secretClose');
  function openSecret() {
    secret.classList.add('show');
    secret.setAttribute('aria-hidden', 'false');
    setTimeout(() => secretClose.focus({ preventScroll: true }), 50);
  }
  function closeSecret() {
    secret.classList.remove('show');
    secret.setAttribute('aria-hidden', 'true');
    secretBtn.focus({ preventScroll: true });
  }
  secretBtn.addEventListener('click', openSecret);
  secretClose.addEventListener('click', closeSecret);
  secret.addEventListener('click', e => { if (e.target === secret) closeSecret(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && secret.classList.contains('show')) closeSecret(); });

  // ===== Музыка по кнопке =====
  const musicBtn = $('music');
  let musicOn = false, engine = null;

  // Мягкая мелодия: Am – F – C – G, арпеджио и тёплый «пэд», всё считается в браузере
  function createSynth() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    const ac = new AC();
    const master = ac.createGain(); master.gain.value = 0; master.connect(ac.destination);
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2400; lp.connect(master);
    const delay = ac.createDelay(1); delay.delayTime.value = 0.46;
    const fb = ac.createGain(); fb.gain.value = 0.4;
    const wet = ac.createGain(); wet.gain.value = 0.5;
    lp.connect(delay); delay.connect(fb); fb.connect(delay); delay.connect(wet); wet.connect(master);

    const CHORDS = [
      [220.00, 261.63, 329.63],   // Am
      [174.61, 220.00, 261.63],   // F
      [261.63, 329.63, 392.00],   // C
      [196.00, 246.94, 293.66]    // G
    ];
    const PATTERN = [0, 1, 2, 1, 2, 1, 0, 1];
    const STEP = 0.46;
    let next = 0, n = 0, timer = null;

    function note(freq, t, dur, vol, type, attack) {
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = type; o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(lp);
      o.start(t); o.stop(t + dur + 0.05);
    }
    function schedule() {
      while (next < ac.currentTime + 1.3) {
        const chord = CHORDS[Math.floor(n / 8) % 4], k = n % 8;
        if (k === 0) chord.forEach(f => note(f / 2, next, STEP * 8 + 0.6, 0.05, 'sine', 0.9));
        note(chord[PATTERN[k]] * 2, next, 1.8, 0.1, 'triangle', 0.02);
        if (k === 4) note(chord[2] * 4, next, 2.4, 0.035, 'sine', 0.02);
        next += STEP; n++;
      }
    }
    return {
      start() {
        ac.resume();
        next = ac.currentTime + 0.1;
        clearInterval(timer); timer = setInterval(schedule, 250); schedule();
        master.gain.setTargetAtTime(0.7, ac.currentTime, 0.5);
      },
      stop() {
        master.gain.setTargetAtTime(0, ac.currentTime, 0.3);
        setTimeout(() => { clearInterval(timer); ac.suspend(); }, 1200);
      }
    };
  }

  function createFilePlayer(src) {
    const a = new Audio(src); a.loop = true; a.volume = 0.6;
    return { start() { a.play().catch(() => {}); }, stop() { a.pause(); } };
  }

  musicBtn.addEventListener('click', () => {
    if (!engine) engine = MUSIC_FILE ? createFilePlayer(MUSIC_FILE) : createSynth();
    if (!engine) return;
    musicOn = !musicOn;
    musicOn ? engine.start() : engine.stop();
    musicBtn.setAttribute('aria-pressed', String(musicOn));
    musicBtn.setAttribute('aria-label', musicOn ? 'Выключить музыку' : 'Включить музыку');
  });
})();
