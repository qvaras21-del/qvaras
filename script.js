(() => {
  const canvas = document.getElementById('stage');
  const ctx = canvas.getContext('2d');
  const intro = document.getElementById('intro');
  const outro = document.getElementById('outro');
  const replayBtn = document.getElementById('replay');

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const LOVE_TEXT = 'I love you';

  // ===== Таймлайн (секунды) =====
  const T_FORM = 3.2;              // частицы собираются в сердце
  const T_TEXT = T_FORM + 0.4;     // начинается «написание» I love you
  const TEXT_SPREAD = 2.0;         // за сколько секунд «рука» проходит слева направо
  const TEXT_PART = 0.8;           // сколько летит каждая частица
  const T_BEAT = T_TEXT + TEXT_SPREAD + TEXT_PART + 2.4; // дрожь перед распадом
  const T_BURST = T_BEAT + 1.6;    // сердце распадается
  const T_GATHER = T_BURST + 5.5;  // частицы летят к фото
  const T_FADE = T_GATHER + 2.2;   // проявляется настоящее фото

  const BLUE_SHADES = ['#3b82f6', '#60a5fa', '#93c5fd', '#2563eb', '#bfdbfe', '#1d4ed8', '#f9a8d4'];
  const TEXT_RGB = [255, 236, 246];

  let W, H, DPR, cx, cy, heartR;
  let particles = [];
  let stars = [];
  let photo = null, photoRect = null;
  let startTime = 0;
  let introShown = false, outroShown = false;
  const pointer = { x: 0, y: 0, active: false };

  // Декор: сердечки, падающие звёзды, боке, свечение вокруг фото
  const hearts = [];
  const shooters = [];
  let orbs = [];
  let halo = null;
  const HALO_PAD = 80;
  let heartTimer = 0, shooterTimer = 3, burstSpawned = false;
  let lastNow = 0;
  let active = false, ready = false, wantStart = false; // шоу ждёт команды Show.start()

  // Новое: искры за курсором, огоньки по рамке, вспышка при проявлении фото
  const sparks = [];
  let frameGrad = null, revealSpawned = false;
  const MOTES = Array.from({ length: 16 }, (_, i) => ({
    s: i / 16, sp: 0.018 + (i % 4) * 0.004, size: 1.4 + (i % 3) * 0.7, pink: i % 3 === 0
  }));

  // ===== Утилиты =====
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeOutCubic = t => 1 - Math.pow(1 - t, 3);
  const easeInOut = t => (t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const hexToRgb = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const PALETTE = BLUE_SHADES.map(hexToRgb);
  const tmp = [0, 0, 0];
  const mix = (a, b, t) => {
    tmp[0] = a[0] + (b[0] - a[0]) * t;
    tmp[1] = a[1] + (b[1] - a[1]) * t;
    tmp[2] = a[2] + (b[2] - a[2]) * t;
    return tmp;
  };

  // Случайная точка внутри сердца (формула: (x²+y²-1)³ - x²y³ ≤ 0), координаты примерно -1..1
  function randomHeartPoint() {
    while (true) {
      const x = (Math.random() * 2 - 1) * 1.3;
      const y = (Math.random() * 2 - 1) * 1.3;
      const a = x * x + y * y - 1;
      if (a * a * a - x * x * y * y * y <= 0) return [x * 0.82, -y * 0.82 - 0.05];
    }
  }

  // ===== Декор =====
  function heartPath(x, y, s) {
    ctx.beginPath();
    ctx.moveTo(x, y + s * 0.4);
    ctx.bezierCurveTo(x - s * 0.9, y - s * 0.1, x - s * 0.5, y - s * 0.9, x, y - s * 0.35);
    ctx.bezierCurveTo(x + s * 0.5, y - s * 0.9, x + s * 0.9, y - s * 0.1, x, y + s * 0.4);
    ctx.closePath();
  }

  function spawnHeart(x, y, vx, vy, size, life, drag) {
    const pink = Math.random() < 0.6;
    hearts.push({
      x, y, vx, vy, size, life, drag, age: 0,
      ph: Math.random() * Math.PI * 2,
      rgb: pink ? [249, 168, 212] : [147, 197, 253]
    });
    if (hearts.length > 160) hearts.shift();
  }

  function spawnHeartBurst(x, y, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 70 + Math.random() * 170;
      spawnHeart(x, y, Math.cos(a) * sp, Math.sin(a) * sp - 40, 6 + Math.random() * 11, 1.8 + Math.random() * 1.4, true);
    }
  }

  function updateHearts(dt) {
    for (let i = hearts.length - 1; i >= 0; i--) {
      const h = hearts[i];
      h.age += dt;
      if (h.age >= h.life) { hearts.splice(i, 1); continue; }
      if (h.drag) {
        const d = Math.pow(0.15, dt);
        h.vx *= d; h.vy *= d; h.vy -= 22 * dt;
      }
      h.x += (h.vx + Math.sin(h.age * 2 + h.ph) * 12) * dt;
      h.y += h.vy * dt;
    }
  }

  function drawHearts() {
    for (let i = 0; i < hearts.length; i++) {
      const h = hearts[i];
      const u = h.age / h.life;
      const al = Math.min(1, u * 6) * (1 - u) * 0.75;
      ctx.fillStyle = `rgba(${h.rgb[0]},${h.rgb[1]},${h.rgb[2]},${al})`;
      heartPath(h.x, h.y, h.size * (0.6 + 0.4 * Math.min(1, u * 5)));
      ctx.fill();
    }
  }

  // Четырёхлучевая звёздочка
  function drawStar(x, y, r, color) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x, y - r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.quadraticCurveTo(x, y, x, y + r);
    ctx.quadraticCurveTo(x, y, x - r, y);
    ctx.quadraticCurveTo(x, y, x, y - r);
    ctx.fill();
  }

  // Искры, которые тянутся за курсором или пальцем
  let lastSparkX = -999, lastSparkY = -999;
  function spawnSpark(x, y) {
    const pink = Math.random() < 0.45;
    sparks.push({
      x, y,
      vx: (Math.random() - .5) * 40, vy: -10 - Math.random() * 40,
      age: 0, life: 0.7 + Math.random() * 0.7,
      size: 3 + Math.random() * 5,
      rgb: pink ? '249,168,212' : '191,219,254'
    });
    if (sparks.length > 140) sparks.shift();
  }

  function drawSparks(dt) {
    for (let i = sparks.length - 1; i >= 0; i--) {
      const k = sparks[i];
      k.age += dt;
      if (k.age >= k.life) { sparks.splice(i, 1); continue; }
      k.x += k.vx * dt; k.y += k.vy * dt; k.vy += 30 * dt;
      const u = k.age / k.life;
      drawStar(k.x, k.y, k.size * (1 - u * 0.6), `rgba(${k.rgb},${(1 - u) * 0.9})`);
    }
  }

  // Точка на периметре рамки вокруг фото, s от 0 до 1
  function framePoint(s, pad) {
    const x0 = photoRect.x - pad, y0 = photoRect.y - pad;
    const w = photoRect.w + pad * 2, h = photoRect.h + pad * 2;
    let d = ((s % 1) + 1) % 1 * 2 * (w + h);
    if (d < w) return [x0 + d, y0];
    d -= w; if (d < h) return [x0 + w, y0 + d];
    d -= h; if (d < w) return [x0 + w - d, y0 + h];
    d -= w; return [x0, y0 + h - d];
  }

  function spawnShooter() {
    const ang = Math.PI * (0.78 + Math.random() * 0.08); // летит влево-вниз
    const sp = 520 + Math.random() * 300;
    shooters.push({
      x: W * (0.4 + Math.random() * 0.6), y: Math.random() * H * 0.35,
      vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
      age: 0, life: 0.9
    });
  }

  function drawShooters(dt) {
    ctx.lineCap = 'round';
    for (let i = shooters.length - 1; i >= 0; i--) {
      const s = shooters[i];
      s.age += dt;
      if (s.age >= s.life) { shooters.splice(i, 1); continue; }
      s.x += s.vx * dt; s.y += s.vy * dt;
      const al = 1 - s.age / s.life;
      const tx = s.x - s.vx * 0.16, ty = s.y - s.vy * 0.16;
      const g = ctx.createLinearGradient(s.x, s.y, tx, ty);
      g.addColorStop(0, `rgba(255,255,255,${al})`);
      g.addColorStop(1, 'rgba(147,197,253,0)');
      ctx.strokeStyle = g;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(tx, ty);
      ctx.stroke();
    }
  }

  // Мягкое голубое свечение вокруг фото (рисуем один раз, потом просто копируем)
  function buildHalo() {
    const w = photoRect.w, h = photoRect.h, pad = HALO_PAD;
    const c = document.createElement('canvas');
    c.width = Math.ceil((w + pad * 2) * DPR);
    c.height = Math.ceil((h + pad * 2) * DPR);
    const g = c.getContext('2d');
    g.scale(DPR, DPR);
    const OFF = 5000; // рисуем прямоугольник далеко, а на холсте остаётся только его тень
    g.shadowColor = 'rgba(96,165,250,0.75)';
    g.shadowBlur = 45 * DPR;
    g.shadowOffsetX = OFF * DPR;
    g.fillStyle = '#000';
    g.fillRect(pad - OFF, pad, w, h);
    halo = c;

    // Тонкая плавающая рамка: от голубого к розовому
    const fg = ctx.createLinearGradient(photoRect.x, photoRect.y, photoRect.x + photoRect.w, photoRect.y + photoRect.h);
    fg.addColorStop(0, 'rgba(147,197,253,0.9)');
    fg.addColorStop(0.5, 'rgba(249,168,212,0.9)');
    fg.addColorStop(1, 'rgba(147,197,253,0.9)');
    frameGrad = fg;
  }

  // Подпись появляется по буквам
  function splitCaption() {
    const caption = outro.querySelector('.caption');
    if (!caption || caption.dataset.split) return;
    caption.dataset.split = '1';
    const text = caption.textContent.trim();
    caption.textContent = '';
    let n = 0;
    const words = text.split(/\s+/);
    words.forEach((word, wi) => {
      const w = document.createElement('span');
      w.className = 'w';
      for (const ch of word) {
        const s = document.createElement('span');
        s.textContent = ch;
        s.style.transitionDelay = (0.6 + n++ * 0.05) + 's';
        w.appendChild(s);
      }
      caption.appendChild(w);
      if (wi < words.length - 1) caption.appendChild(document.createTextNode(' '));
    });
  }

  // ===== Загрузка фото =====
  function loadPhoto() {
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = window.PHOTO_SRC || 'photo.jpg';
    });
  }

  // ===== Точки надписи "I love you" =====
  function buildTextPoints(maxCount) {
    const tw = Math.round(heartR * 1.55);
    const probe = document.createElement('canvas').getContext('2d');
    const fontFor = size => `italic 500 ${size}px "Cormorant Garamond", Georgia, serif`;
    probe.font = fontFor(100);
    const m = probe.measureText(LOVE_TEXT).width || 400;
    const size = 100 * (tw - 12) / m;
    const th = Math.round(size * 1.6);

    const c = document.createElement('canvas');
    c.width = tw; c.height = th;
    const t = c.getContext('2d', { willReadFrequently: true });
    t.font = fontFor(size);
    t.textAlign = 'center';
    t.textBaseline = 'middle';
    t.fillStyle = '#fff';
    t.strokeStyle = '#fff';
    t.lineWidth = Math.max(1, size * 0.035); // чуть утолщаем, чтобы хватало точек
    t.strokeText(LOVE_TEXT, tw / 2, th / 2);
    t.fillText(LOVE_TEXT, tw / 2, th / 2);

    let data;
    try { data = t.getImageData(0, 0, tw, th).data; } catch (e) { return []; }

    const yOff = -heartR * 0.04;
    let stride = 1, pts = [];
    while (true) {
      pts = [];
      for (let y = 0; y < th; y += stride) {
        for (let x = 0; x < tw; x += stride) {
          if (data[(y * tw + x) * 4 + 3] > 128) {
            pts.push({ x: cx - tw / 2 + x, y: cy + yOff - th / 2 + y, nx: x / tw });
          }
        }
      }
      if (pts.length <= maxCount || stride > 6) break;
      stride++;
    }
    return pts;
  }

  // ===== Подготовка частиц =====
  function build() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = W * DPR; canvas.height = H * DPR;
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

    cx = W / 2; cy = H / 2;
    heartR = Math.min(W, H) * 0.3;

    // Размер фото на экране (вписываем с запасом под заголовок и подпись)
    const maxH = H * (W < 700 ? 0.62 : 0.74);
    const maxW = W * 0.9;
    const ratio = photo ? photo.width / photo.height : 1;
    let ph = maxH, pw = ph * ratio;
    if (pw > maxW) { pw = maxW; ph = pw / ratio; }
    photoRect = { x: cx - pw / 2, y: cy - ph / 2 - (W < 700 ? 8 : 0), w: pw, h: ph };

    // Считываем цвета фото на сетке
    const maxParticles = W < 700 ? 5200 : 9500;
    const step = Math.max(2, Math.ceil(Math.sqrt((pw * ph) / maxParticles)));
    const off = document.createElement('canvas');
    off.width = Math.round(pw); off.height = Math.round(ph);
    const octx = off.getContext('2d', { willReadFrequently: true });
    let data = null;
    if (photo) {
      octx.drawImage(photo, 0, 0, off.width, off.height);
      try { data = octx.getImageData(0, 0, off.width, off.height).data; } catch (e) { data = null; }
    }

    const targets = [];
    for (let y = step / 2; y < off.height; y += step) {
      for (let x = step / 2; x < off.width; x += step) {
        let rgb = [180, 200, 255];
        if (data) {
          const i = (Math.floor(y) * off.width + Math.floor(x)) * 4;
          rgb = [data[i], data[i + 1], data[i + 2]];
        }
        targets.push({ x: photoRect.x + x, y: photoRect.y + y, rgb });
      }
    }

    particles = targets.map(t => {
      const [hx, hy] = randomHeartPoint();
      const ang = Math.random() * Math.PI * 2;
      const far = Math.max(W, H) * (0.6 + Math.random() * 0.6);
      const dist = Math.hypot(t.x - cx, t.y - cy) / (Math.hypot(photoRect.w, photoRect.h) / 2);
      const base = PALETTE[Math.floor(Math.random() * PALETTE.length)];
      return {
        // старт: случайное место за пределами сердца
        sx: cx + Math.cos(ang) * far, sy: cy + Math.sin(ang) * far,
        // сердце
        hx: cx + hx * heartR, hy: cy + hy * heartR,
        // надпись (заполняется ниже)
        hasText: false, tx: 0, ty: 0, td: 0,
        // разлёт (заполняется ниже)
        bx: 0, by: 0,
        // фото
        px: t.x, py: t.y, prgb: t.rgb,
        base,
        size: step * (0.7 + Math.random() * 0.5),
        formDelay: Math.random() * 0.45,
        gatherDelay: clamp(dist * 0.55 + Math.random() * 0.35, 0, 0.9),
        swirl: (Math.random() - .5) * 2,
        phase: Math.random() * Math.PI * 2,
        twinkle: 0.6 + Math.random() * 0.8
      };
    });

    // Часть частиц становится буквами "I love you"
    const textPts = buildTextPoints(Math.floor(particles.length * 0.3));
    const idx = particles.map((_, i) => i);
    for (let i = idx.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [idx[i], idx[j]] = [idx[j], idx[i]];
    }
    for (let i = 0; i < textPts.length && i < idx.length; i++) {
      const p = particles[idx[i]];
      p.hasText = true;
      p.tx = textPts[i].x;
      p.ty = textPts[i].y;
      p.td = clamp(textPts[i].nx * 0.88 + Math.random() * 0.12); // «пишется» слева направо
      p.glint = Math.random() < 0.12; // часть букв будет искриться
    }

    // Точки разлёта — от того места, где частица была в момент взрыва
    for (const p of particles) {
      const ox = p.hasText ? p.tx : p.hx;
      const oy = p.hasText ? p.ty : p.hy;
      const burstAng = Math.atan2(oy - cy, ox - cx) + (Math.random() - .5) * 1.2;
      const burstDist = heartR * (1.2 + Math.random() * 2.6);
      p.bx = ox + Math.cos(burstAng) * burstDist;
      p.by = oy + Math.sin(burstAng) * burstDist;
    }

    // Фоновая звёздная пыль
    const starCount = W < 700 ? 60 : 120;
    stars = [];
    for (let i = 0; i < starCount; i++) {
      stars.push({
        x: Math.random() * W, y: Math.random() * H,
        r: 0.8 + Math.random() * 1.6,
        ph: Math.random() * Math.PI * 2,
        sp: 0.4 + Math.random() * 1.2,
        vy: 2 + Math.random() * 6,
        flare: Math.random() < 0.14
      });
    }

    // Большие мягкие огни (боке) на фоне
    const orbColors = ['96,165,250', '244,114,182', '99,102,241', '147,197,253'];
    orbs = [];
    for (let i = 0; i < 7; i++) {
      orbs.push({
        x: Math.random() * W, y: Math.random() * H,
        r: Math.min(W, H) * (0.14 + Math.random() * 0.22),
        ph: Math.random() * Math.PI * 2,
        sp: 0.12 + Math.random() * 0.2,
        rgb: orbColors[i % orbColors.length],
        a: 0.022 + Math.random() * 0.02
      });
    }

    buildHalo();
  }

  // ===== Пульс сердца (двойной удар) =====
  function beat(t) {
    const p = (t % 1.05) / 1.05;
    return 1 + 0.07 * Math.exp(-Math.pow((p - 0.12) * 11, 2)) + 0.045 * Math.exp(-Math.pow((p - 0.32) * 11, 2));
  }
  const S_BURST = beat(T_BURST - T_FORM);

  // ===== Позиция и цвет частицы в момент времени t =====
  function place(p, t, out) {
    let x, y, rgb = p.base, a = 0.95, size = p.size;

    if (t < T_FORM) {
      // 1. Собираются в сердце по спирали
      const e = easeOutCubic(clamp((t / T_FORM - p.formDelay) / (1 - p.formDelay)));
      const curve = (1 - e) * p.swirl * 160;
      x = lerp(p.sx, p.hx, e) + Math.sin(e * Math.PI) * curve;
      y = lerp(p.sy, p.hy, e) + Math.sin(e * Math.PI) * -curve * 0.6;
      a = 0.2 + 0.75 * e;
    } else if (t < T_BURST) {
      // 2. Сердце бьётся, часть частиц «пишет» I love you
      const s = beat(t - T_FORM);
      const k = clamp((t - T_BEAT) / (T_BURST - T_BEAT)); // дрожь перед распадом
      const jit = k * k * 7;
      let amp = 1.5 + jit;

      x = cx + (p.hx - cx) * s;
      y = cy + (p.hy - cy) * s;
      a = 0.75 + 0.25 * Math.sin(t * 5 * p.twinkle + p.phase);

      if (p.hasText) {
        const w = clamp((t - T_TEXT - p.td * TEXT_SPREAD) / TEXT_PART);
        const e = easeInOut(w);
        const ts = 1 + (s - 1) * 0.6; // надпись пульсирует мягче сердца
        const txs = cx + (p.tx - cx) * ts;
        const tys = cy + (p.ty - cy) * ts;
        // небольшая дуга при перелёте — выглядит как росчерк
        const arc = Math.sin(w * Math.PI) * 14 * p.swirl;
        x = lerp(x, txs, e) + arc;
        y = lerp(y, tys, e) - arc * 0.6;
        // вспышка на «кончике пера»
        const flash = Math.sin(w * Math.PI);
        rgb = mix(p.base, TEXT_RGB, clamp(e + flash * 0.4));
        a = lerp(a, 1, e);
        size = p.size * (1 - 0.25 * e + 0.5 * flash);
        amp *= (1 - 0.85 * e); // буквы почти не дрожат, чтобы читались
      }

      x += Math.sin(t * 3 + p.phase) * amp;
      y += Math.cos(t * 2.6 + p.phase) * amp;
    } else if (t < T_GATHER) {
      const u = t - T_BURST;
      const burstDur = 1.7;
      if (u < burstDur) {
        // 3. Взрыв — частицы разлетаются
        const e = easeOutCubic(u / burstDur);
        const ox = p.hasText ? p.tx : p.hx;
        const oy = p.hasText ? p.ty : p.hy;
        const sx0 = cx + (ox - cx) * (p.hasText ? 1 + (S_BURST - 1) * 0.6 : S_BURST);
        const sy0 = cy + (oy - cy) * (p.hasText ? 1 + (S_BURST - 1) * 0.6 : S_BURST);
        x = lerp(sx0, p.bx, e) + Math.sin(t * 2 + p.phase) * 4 * e;
        y = lerp(sy0, p.by, e) + Math.cos(t * 2 + p.phase) * 4 * e;
        a = 0.95;
        if (p.hasText) {
          rgb = mix(TEXT_RGB, p.base, easeOutCubic(clamp(u / 0.9)));
          size = p.size * (0.75 + 0.25 * e);
        }
      } else {
        // 4. Летят к своим местам в фотографии и меняют цвет
        const span = T_GATHER - T_BURST - burstDur;
        const e = easeInOut(clamp(((u - burstDur) / span - p.gatherDelay * 0.55) / 0.45));
        const arc = Math.sin(e * Math.PI) * p.swirl * 90;
        x = lerp(p.bx, p.px, e) + arc;
        y = lerp(p.by, p.py, e) - arc * 0.5;
        const c = easeInOut(clamp((e - 0.35) / 0.65));
        rgb = mix(p.base, p.prgb, c);
        a = 0.95;
        size = lerp(p.size, p.size * 1.15, e);
      }
    } else {
      // 5. Фото собрано — лёгкое мерцание
      const w = Math.min(1, (t - T_GATHER) / 1.5);
      x = p.px + Math.sin(t * 1.4 + p.phase) * 0.6 * (1 - w * 0.6);
      y = p.py + Math.cos(t * 1.2 + p.phase) * 0.6 * (1 - w * 0.6);
      rgb = p.prgb; a = 1; size = p.size * 1.15;
    }

    // Частицы мягко отталкиваются от курсора / пальца
    if (pointer.active && t < T_GATHER) {
      const dx = x - pointer.x, dy = y - pointer.y;
      const R = 110, d2 = dx * dx + dy * dy;
      if (d2 < R * R && d2 > 0.01) {
        const d = Math.sqrt(d2);
        const f = Math.pow(1 - d / R, 2) * 38;
        x += (dx / d) * f;
        y += (dy / d) * f;
      }
    }

    out.x = x; out.y = y; out.rgb = rgb; out.a = a; out.size = size;
  }

  // ===== Кадр =====
  const o = { x: 0, y: 0, rgb: null, a: 1, size: 1 };

  function frame(now) {
    const dt = Math.min(0.05, Math.max(0, (now - lastNow) / 1000));
    lastNow = now;
    const idle = !active;            // до старта рисуем только атмосферу
    const ta = now / 1000;           // «живое» время для фона
    const t = idle ? 0 : (reduceMotion ? T_FADE + 3 : (now - startTime) / 1000);
    const settled = t > T_GATHER + 0.5;

    // Шлейф: полупрозрачная заливка вместо полной очистки
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = settled ? 'rgba(5,7,18,0.5)' : 'rgba(5,7,18,0.22)';
    ctx.fillRect(0, 0, W, H);

    // Мягкое свечение за сердцем
    if (t < T_GATHER) {
      const glow = t < T_FORM ? t / T_FORM : 1;
      const s = t >= T_FORM && t < T_BURST ? beat(t - T_FORM) : 1;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, heartR * 1.7 * s);
      g.addColorStop(0, `rgba(59,130,246,${0.16 * glow})`);
      g.addColorStop(0.6, `rgba(244,114,182,${0.05 * glow})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }

    // Звёздная пыль на фоне
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < stars.length; i++) {
      const s = stars[i];
      const y = (s.y - ta * s.vy + H * 10) % H;
      const al = 0.12 + 0.28 * (0.5 + 0.5 * Math.sin(ta * s.sp + s.ph));
      ctx.fillStyle = `rgba(191,219,254,${al})`;
      ctx.fillRect(s.x, y, s.r, s.r);
      if (s.flare && !reduceMotion) {
        const f = Math.pow(0.5 + 0.5 * Math.sin(ta * s.sp * 1.3 + s.ph), 3);
        drawStar(s.x, y, 3 + 9 * f, `rgba(219,234,254,${0.15 + 0.5 * f})`);
      }
    }

    if (!reduceMotion) {
      // Большие мягкие огни (боке)
      for (let i = 0; i < orbs.length; i++) {
        const b = orbs[i];
        const bx = b.x + Math.sin(ta * b.sp + b.ph) * 50;
        const by = b.y + Math.cos(ta * b.sp * 0.8 + b.ph) * 40;
        const g = ctx.createRadialGradient(bx, by, 0, bx, by, b.r);
        g.addColorStop(0, `rgba(${b.rgb},${b.a})`);
        g.addColorStop(1, `rgba(${b.rgb},0)`);
        ctx.fillStyle = g;
        ctx.fillRect(bx - b.r, by - b.r, b.r * 2, b.r * 2);
      }

      // Сердечки плывут снизу вверх, пока сердце бьётся и после превращения
      heartTimer -= dt;
      if (heartTimer <= 0) {
        if (idle || (t > T_FORM + 0.5 && t < T_BURST) || t > T_GATHER) {
          const vy = -(32 + Math.random() * 40);
          spawnHeart(Math.random() * W, H + 20, 0, vy, 6 + Math.random() * 11, (H + 40) / -vy, false);
        }
        heartTimer = idle ? 0.9 : (t < T_BURST ? 0.35 : 0.6);
      }
      // Взрыв сердечек в момент распада
      if (t >= T_BURST && !burstSpawned) {
        burstSpawned = true;
        spawnHeartBurst(cx, cy, 26);
      }
      if (t >= T_FADE - 0.2 && !revealSpawned) {
        revealSpawned = true;
        spawnHeartBurst(cx, cy, 30);
        spawnHeartBurst(photoRect.x, photoRect.y + photoRect.h, 12);
        spawnHeartBurst(photoRect.x + photoRect.w, photoRect.y + photoRect.h, 12);
      }
      updateHearts(dt);
      drawHearts();

      // Падающие звёзды
      shooterTimer -= dt;
      if (shooterTimer <= 0) {
        spawnShooter();
        shooterTimer = 4 + Math.random() * 5;
      }
      drawShooters(dt);
      drawSparks(dt);
    }

    // Кольцо пульса с каждым ударом сердца
    if (t >= T_FORM && t < T_BURST) {
      const p = ((t - T_FORM) % 1.05) / 1.05;
      if (p > 0.08 && p < 0.9) {
        const q = (p - 0.08) / 0.82;
        ctx.strokeStyle = `rgba(147,197,253,${0.16 * (1 - q)})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(cx, cy, heartR * (0.95 + q * 1.1), 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // Ударная волна при распаде сердца
    if (t >= T_BURST && t < T_BURST + 1.5) {
      const u = (t - T_BURST) / 1.5;
      const q = 1 - Math.pow(1 - u, 3);
      ctx.strokeStyle = `rgba(191,219,254,${0.55 * (1 - u) * (1 - u)})`;
      ctx.lineWidth = 1 + (1 - u) * 6;
      ctx.beginPath();
      ctx.arc(cx, cy, heartR * (0.5 + q * 3.6), 0, Math.PI * 2);
      ctx.stroke();
    }

    // Светящиеся частицы пока они синие, обычные — когда становятся фото
    ctx.globalCompositeOperation = t < T_GATHER ? 'lighter' : 'source-over';
    for (let i = 0; i < (idle ? 0 : particles.length); i++) {
      const p = particles[i];
      place(p, t, o);
      ctx.fillStyle = `rgba(${o.rgb[0] | 0},${o.rgb[1] | 0},${o.rgb[2] | 0},${o.a})`;
      ctx.fillRect(o.x - o.size / 2, o.y - o.size / 2, o.size, o.size);

      // Искорки-блики на буквах «I love you»
      if (p.glint && t < T_BURST && t > T_TEXT + p.td * TEXT_SPREAD + TEXT_PART) {
        const g = Math.pow(Math.max(0, Math.sin(t * 2.1 + p.phase * 3)), 14);
        if (g > 0.08) {
          const L = 5 + 12 * g;
          ctx.fillStyle = `rgba(255,245,250,${g * 0.9})`;
          ctx.fillRect(o.x - L, o.y - 0.6, L * 2, 1.2);
          ctx.fillRect(o.x - 0.6, o.y - L, 1.2, L * 2);
        }
      }
    }

    // Настоящее фото плавно проявляется поверх частиц — эффект реальности
    if (photo && t > T_GATHER) {
      const k = easeInOut(clamp((t - T_GATHER) / (T_FADE - T_GATHER)));
      ctx.globalCompositeOperation = 'source-over';

      // Мягкое свечение вокруг фото, слегка «дышит»
      if (halo) {
        ctx.globalAlpha = k * (reduceMotion ? 0.8 : 0.75 + 0.2 * Math.sin(t * 1.5));
        ctx.drawImage(halo, photoRect.x - HALO_PAD, photoRect.y - HALO_PAD,
          photoRect.w + HALO_PAD * 2, photoRect.h + HALO_PAD * 2);
      }

      ctx.globalAlpha = k;
      ctx.drawImage(photo, photoRect.x, photoRect.y, photoRect.w, photoRect.h);

      // Тонкая рамка на небольшом расстоянии от фото
      if (frameGrad) {
        ctx.globalAlpha = k * k * (reduceMotion ? 0.7 : 0.55 + 0.25 * Math.sin(t * 1.5));
        ctx.strokeStyle = frameGrad;
        ctx.lineWidth = 1.2;
        ctx.strokeRect(photoRect.x - 9, photoRect.y - 9, photoRect.w + 18, photoRect.h + 18);
      }
      ctx.globalAlpha = 1;

      // Огоньки бегут по рамке
      if (!reduceMotion && t > T_FADE - 1) {
        const vis = clamp((t - (T_FADE - 1)) / 1.5);
        ctx.globalCompositeOperation = 'lighter';
        for (const m of MOTES) {
          const base = m.s + t * m.sp;
          for (let j = 0; j < 7; j++) {
            const [mx, my] = framePoint(base - j * 0.004, 9);
            const a = vis * (1 - j / 7) * 0.9;
            ctx.fillStyle = m.pink ? `rgba(249,168,212,${a})` : `rgba(191,219,254,${a})`;
            ctx.beginPath();
            ctx.arc(mx, my, m.size * (1 - j / 10), 0, Math.PI * 2);
            ctx.fill();
          }
          const [hx, hy] = framePoint(base, 9);
          drawStar(hx, hy, 5 + 3 * Math.sin(t * 3 + m.s * 20), `rgba(255,255,255,${vis * 0.85})`);
        }
        ctx.globalCompositeOperation = 'source-over';
      }

      // Вспышка света в момент, когда фото проявилось
      if (!reduceMotion && t > T_FADE - 0.2 && t < T_FADE + 2) {
        const u = (t - (T_FADE - 0.2)) / 2.2;
        const fa = Math.pow(1 - u, 2);
        const R = Math.max(photoRect.w, photoRect.h) * (0.5 + u * 0.9);
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
        g.addColorStop(0, `rgba(255,255,255,${0.22 * fa})`);
        g.addColorStop(0.5, `rgba(147,197,253,${0.12 * fa})`);
        g.addColorStop(1, 'rgba(147,197,253,0)');
        ctx.globalCompositeOperation = 'lighter';
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
        ctx.strokeStyle = `rgba(249,168,212,${0.5 * fa})`;
        ctx.lineWidth = 1 + 3 * fa;
        ctx.beginPath();
        ctx.arc(cx, cy, Math.hypot(photoRect.w, photoRect.h) * (0.3 + u * 0.9), 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalCompositeOperation = 'source-over';
      }

      // Блик света, который время от времени скользит по фото
      if (t > T_FADE && !reduceMotion) {
        const ps = ((t - T_FADE) % 7) / 1.8;
        if (ps < 1) {
          const pr = photoRect;
          const bw = pr.w * 0.22;
          const bx = pr.x - bw + ps * (pr.w + bw * 2);
          const g = ctx.createLinearGradient(bx - bw, 0, bx + bw, 0);
          g.addColorStop(0, 'rgba(255,255,255,0)');
          g.addColorStop(0.5, 'rgba(255,255,255,0.2)');
          g.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.save();
          ctx.beginPath();
          ctx.rect(pr.x, pr.y, pr.w, pr.h);
          ctx.clip();
          ctx.globalCompositeOperation = 'lighter';
          ctx.fillStyle = g;
          ctx.fillRect(pr.x, pr.y, pr.w, pr.h);
          ctx.restore();
        }
      }
    }

    // Тексты
    if (!introShown && t > T_FORM - 0.8) { intro.classList.add('show'); introShown = true; }
    if (t > T_BURST + 0.2) intro.classList.add('hide');
    if (!outroShown && t > T_FADE - 0.5) { outro.classList.add('show'); outroShown = true; document.dispatchEvent(new Event('show:outro')); }

    requestAnimationFrame(frame);
  }

  // ===== Запуск и повтор =====
  function restart() {
    intro.classList.remove('show', 'hide');
    outro.classList.remove('show');
    introShown = outroShown = false;
    burstSpawned = false;
    revealSpawned = false;
    sparks.length = 0;
    hearts.length = 0;
    shooters.length = 0;
    heartTimer = 0;
    shooterTimer = 3;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#050712';
    ctx.fillRect(0, 0, W, H);
    startTime = performance.now();
    document.dispatchEvent(new Event('show:start'));
  }

  splitCaption();
  replayBtn.addEventListener('click', restart);

  // Курсор / палец
  const setPointer = e => {
    pointer.x = e.clientX; pointer.y = e.clientY; pointer.active = true;
    if (!reduceMotion && Math.hypot(e.clientX - lastSparkX, e.clientY - lastSparkY) > 14) {
      lastSparkX = e.clientX; lastSparkY = e.clientY;
      spawnSpark(e.clientX, e.clientY);
    }
  };
  window.addEventListener('pointermove', setPointer, { passive: true });
  window.addEventListener('pointerdown', e => {
    setPointer(e);
    // Тап или клик — маленький фонтан сердечек
    if (!reduceMotion && !e.target.closest('button, [role=button], .secret-card, .letter')) spawnHeartBurst(e.clientX, e.clientY, 8);
  }, { passive: true });
  window.addEventListener('pointerup', e => { if (e.pointerType !== 'mouse') pointer.active = false; });
  window.addEventListener('pointerleave', () => { pointer.active = false; });
  document.addEventListener('mouseleave', () => { pointer.active = false; });

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(build, 150);
  });

  // Ждём шрифт (чтобы надпись выглядела красиво), но не дольше 1.5 с
  const fontReady = (document.fonts && document.fonts.load)
    ? Promise.race([
        document.fonts.load('italic 500 60px "Cormorant Garamond"').catch(() => {}),
        new Promise(r => setTimeout(r, 1500))
      ])
    : Promise.resolve();

  // Внешний пульт: app.js вызывает Show.start(), когда пора показывать сердце
  window.Show = {
    start() {
      wantStart = true;
      if (ready) { active = true; restart(); }
    }
  };

  Promise.all([loadPhoto(), fontReady]).then(([img]) => {
    photo = img;
    build();
    ready = true;
    requestAnimationFrame(frame);
    if (wantStart) { active = true; restart(); }
  });
})();
