/* 程序化纹理：立面（白天/粗糙度金属度/夜间发光）、屋面、地表细节、水面法线、文字 */
(function () {
  'use strict';
  const JZ = window.JZ;
  const T = (JZ.Tex = {});

  T.canvas = function (w, h) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h || w;
    return c;
  };
  T.texture = function (canvas, o = {}) {
    const t = new THREE.CanvasTexture(canvas);
    t.colorSpace = o.linear ? THREE.NoColorSpace : THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = o.clamp ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
    t.anisotropy = JZ.maxAniso || 8;
    if (o.flipY === false) t.flipY = false;
    t.needsUpdate = true;
    return t;
  };

  // ---------- 可平铺噪声 ----------
  function periodicNoise(size, period, rand) {
    const lat = new Float32Array(period * period);
    for (let i = 0; i < lat.length; i++) lat[i] = rand();
    const out = new Float32Array(size * size);
    for (let y = 0; y < size; y++) {
      const fy = (y / size) * period, iy = Math.floor(fy), ty = fy - iy;
      const sy = ty * ty * (3 - 2 * ty);
      const y0 = iy % period, y1 = (iy + 1) % period;
      for (let x = 0; x < size; x++) {
        const fx = (x / size) * period, ix = Math.floor(fx), tx = fx - ix;
        const sx = tx * tx * (3 - 2 * tx);
        const x0 = ix % period, x1 = (ix + 1) % period;
        const a = lat[y0 * period + x0], b = lat[y0 * period + x1];
        const c = lat[y1 * period + x0], d = lat[y1 * period + x1];
        const top = a + (b - a) * sx, bot = c + (d - c) * sx;
        out[y * size + x] = top + (bot - top) * sy;
      }
    }
    return out;
  }
  T.fbm = function (size, seed, octaves, basePeriod) {
    const rand = JZ.rng(seed);
    const out = new Float32Array(size * size);
    let amp = 1, tot = 0, per = basePeriod || 4;
    for (let o = 0; o < octaves; o++) {
      const n = periodicNoise(size, Math.min(per, size), rand);
      for (let i = 0; i < out.length; i++) out[i] += n[i] * amp;
      tot += amp;
      amp *= 0.5;
      per *= 2;
    }
    for (let i = 0; i < out.length; i++) out[i] /= tot;
    return out;
  };

  // 地表细节纹理（线性）：R=细噪声 G=粗噪声 B=颗粒
  T.detail = function () {
    const S = 256;
    const a = T.fbm(S, 11, 5, 8), b = T.fbm(S, 23, 4, 2);
    const rand = JZ.rng(5);
    const c = T.canvas(S);
    const g = c.getContext('2d');
    const img = g.createImageData(S, S);
    for (let i = 0; i < S * S; i++) {
      img.data[i * 4] = Math.round(JZ.math.clamp((a[i] - 0.5) * 2.2 + 0.5, 0, 1) * 255);
      img.data[i * 4 + 1] = Math.round(JZ.math.clamp((b[i] - 0.5) * 2.0 + 0.5, 0, 1) * 255);
      img.data[i * 4 + 2] = Math.round(rand() * 255);
      img.data[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    const t = T.texture(c, { linear: true });
    t.generateMipmaps = true;
    return t;
  };

  // 水面法线贴图
  T.waterNormal = function () {
    const S = 256;
    const h = T.fbm(S, 77, 5, 4);
    const c = T.canvas(S);
    const g = c.getContext('2d');
    const img = g.createImageData(S, S);
    const k = 3.2;
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const hx = h[y * S + ((x + 1) % S)] - h[y * S + ((x - 1 + S) % S)];
        const hy = h[((y + 1) % S) * S + x] - h[((y - 1 + S) % S) * S + x];
        let nx = -hx * k, ny = -hy * k, nz = 1;
        const l = Math.hypot(nx, ny, nz);
        nx /= l; ny /= l; nz /= l;
        const i = (y * S + x) * 4;
        img.data[i] = (nx * 0.5 + 0.5) * 255;
        img.data[i + 1] = (ny * 0.5 + 0.5) * 255;
        img.data[i + 2] = (nz * 0.5 + 0.5) * 255;
        img.data[i + 3] = 255;
      }
    g.putImageData(img, 0, 0);
    return T.texture(c, { linear: true });
  };

  // ---------- 立面纹理 ----------
  // 每张纹理 = 4 开间 × 4 层；u 向右，w 向上（画布底部为楼层地面）
  const STYLES = {
    teaching: { wall: '#efeee9', glass: '#5f7c8f', frame: '#cfd5d8', win: [0.07, 0.28, 0.93, 0.82], mull: 3, transom: 0.72, slab: '#dcdad3', slabH: 0.1, sill: '#d7d4cc', streak: 0.55 },
    office: { wall: '#ecebe6', glass: '#56707f', frame: '#bfc6ca', win: [0.16, 0.24, 0.84, 0.84], mull: 2, transom: 0.7, slab: '#d9d6cf', slabH: 0.1, pilaster: '#e2e0da', streak: 0.45 },
    lab: { wall: '#ebe9e3', glass: '#647f8c', frame: '#cdd2d4', win: [0.12, 0.3, 0.88, 0.8], mull: 2, transom: 0.68, slab: '#d6d3cb', slabH: 0.1, sill: '#d4d0c8', streak: 0.5 },
    dorm: { wall: '#f1ebe0', glass: '#61727c', frame: '#d9d9d4', win: [0.2, 0.3, 0.8, 0.8], mull: 1, slab: '#ddd6c8', slabH: 0.09, balcony: true, ac: 0.5, streak: 0.6 },
    residential: { wall: '#ebe5dc', glass: '#5b6b74', frame: '#d6d4cf', win: [0.24, 0.32, 0.76, 0.8], mull: 1, slab: '#dcd4c6', slabH: 0.08, tiles: true, ac: 0.6, balcony: 'alt', streak: 0.6 },
    villa: { wall: '#efe0bf', glass: '#3f4a45', frame: '#f4efe4', win: [0.32, 0.16, 0.68, 0.82], mull: 1, arch: true, shutter: '#5b7a5a', slab: '#e2cfa8', slabH: 0.07, cornice: true, streak: 0.5 },
    hall: { wall: '#e9e5dc', glass: '#56676f', frame: '#cfccc4', win: [0.36, 0.14, 0.64, 0.9], mull: 1, slab: '#dcd7cc', slabH: 0.05, pilaster: '#dfdad0', streak: 0.4 },
    church: { wall: '#e4e0d6', glass: '#4b5f6b', frame: '#d8d2c4', win: [0.36, 0.16, 0.64, 0.84], mull: 1, arch: true, slab: '#d6d0c2', slabH: 0.05, stone: true, streak: 0.5 },
    glass: { wall: '#e8eaea', glass: '#4f7286', frame: '#d4dadc', win: [0.0, 0.12, 1.0, 1.0], mull: 2, transom: 0.55, slab: '#dfe2e2', slabH: 0.12, streak: 0.15 },
    gym: { wall: '#ecebe7', glass: '#58788a', frame: '#d0d6d8', win: [0.04, 0.45, 0.96, 0.92], mull: 4, slab: '#dedcd6', slabH: 0.06, streak: 0.4 },
    canteen: { wall: '#eeece6', glass: '#5d7987', frame: '#d1d6d8', win: [0.06, 0.22, 0.94, 0.84], mull: 3, transom: 0.75, slab: '#dad8d1', slabH: 0.1, streak: 0.5 },
    generic: { wall: '#ebe8e1', glass: '#5c6c75', frame: '#d6d6d2', win: [0.25, 0.3, 0.75, 0.8], mull: 1, slab: '#dcd8cf', slabH: 0.08, ac: 0.3, streak: 0.6 },
    industrial: { wall: '#dedbd3', glass: '#5c6a70', frame: '#cfcfcb', win: [0.3, 0.62, 0.7, 0.85], mull: 2, slab: '#d2cec5', slabH: 0.04, ribs: true, streak: 0.7 },
    stand: { wall: '#e6e4de', glass: '#4d5a60', frame: '#cfcfca', win: [0.1, 0.2, 0.9, 0.7], mull: 0, open: true, slab: '#d9d6ce', slabH: 0.12, streak: 0.4 },
  };
  T.FACADE_STYLES = STYLES;

  function drawFacade(g, S, st, mode, seed) {
    // rand: 布局随机（各模式一致，保证贴图对齐）；rd: 仅用于反照率装饰
    const rand = JZ.rng(seed);
    const rd = JZ.rng(seed ^ 0x9e3779b9);
    const cell = S / 4;
    const ORM = (rough, metal) => `rgb(255,${Math.round(rough * 255)},${Math.round(metal * 255)})`;
    const C = (albedo, rough, metal, emis) => (mode === 'albedo' ? albedo : mode === 'orm' ? ORM(rough, metal) : emis || '#000');
    // 背景墙
    g.fillStyle = C(st.wall, 0.92, 0);
    g.fillRect(0, 0, S, S);
    if (mode === 'albedo') {
      // 墙面细微噪点
      for (let i = 0; i < 2600; i++) {
        const v = rd();
        g.fillStyle = v < 0.5 ? 'rgba(0,0,0,0.035)' : 'rgba(255,255,255,0.05)';
        g.fillRect(rd() * S, rd() * S, 1 + rd() * 3, 1 + rd() * 3);
      }
      if (st.tiles) {
        g.strokeStyle = 'rgba(0,0,0,0.06)';
        g.lineWidth = 1;
        for (let y = 0; y < S; y += 6) { g.beginPath(); g.moveTo(0, y + 0.5); g.lineTo(S, y + 0.5); g.stroke(); }
        for (let x = 0; x < S; x += 12) { g.beginPath(); g.moveTo(x + 0.5, 0); g.lineTo(x + 0.5, S); g.stroke(); }
      }
      if (st.stone) {
        g.strokeStyle = 'rgba(0,0,0,0.08)';
        for (let y = 0; y < S; y += 16) {
          g.beginPath(); g.moveTo(0, y + 0.5); g.lineTo(S, y + 0.5); g.stroke();
          for (let x = (y / 16) % 2 ? 0 : 16; x < S; x += 32) { g.beginPath(); g.moveTo(x + 0.5, y); g.lineTo(x + 0.5, y + 16); g.stroke(); }
        }
      }
      if (st.ribs) {
        g.fillStyle = 'rgba(0,0,0,0.05)';
        for (let x = 0; x < S; x += 8) g.fillRect(x, 0, 3, S);
      }
    }
    for (let fy = 0; fy < 4; fy++)
      for (let bx = 0; bx < 4; bx++) {
        const X = (u) => bx * cell + u * cell;
        const Y = (w) => S - fy * cell - w * cell; // w 自下而上
        // 楼板线
        if (st.slabH) {
          g.fillStyle = C(st.slab, 0.85, 0);
          g.fillRect(X(0), Y(st.slabH), cell, st.slabH * cell);
        }
        if (st.pilaster) {
          g.fillStyle = C(st.pilaster, 0.88, 0);
          g.fillRect(X(0), Y(1), cell * 0.06, cell);
          g.fillRect(X(0.94), Y(1), cell * 0.06, cell);
        }
        if (st.cornice && fy === 3) {
          g.fillStyle = C(st.slab, 0.85, 0);
          g.fillRect(X(0), Y(1), cell, cell * 0.06);
        }
        let [u0, w0, u1, w1] = st.win;
        const lit = rand() < 0.42;
        const warm = rand() < 0.7 ? '#ffd9a1' : '#e8f1ff';
        const dim = 0.55 + rand() * 0.45;
        if (st.open) {
          // 看台：开敞的深色洞口
          g.fillStyle = C('#3a3d3f', 0.9, 0);
          g.fillRect(X(u0), Y(w1), (u1 - u0) * cell, (w1 - w0) * cell);
          continue;
        }
        // 窗框
        g.fillStyle = C(st.frame, 0.45, 0.6);
        g.fillRect(X(u0), Y(w1), (u1 - u0) * cell, (w1 - w0) * cell);
        // 玻璃
        const inset = Math.max(2, cell * 0.025);
        const gx = X(u0) + inset, gy = Y(w1) + inset, gw = (u1 - u0) * cell - inset * 2, gh = (w1 - w0) * cell - inset * 2;
        if (mode === 'albedo') {
          const grad = g.createLinearGradient(gx, gy, gx + gw * 0.4, gy + gh);
          const base = new THREE.Color(st.glass);
          const hi = base.clone().lerp(new THREE.Color('#c9d6de'), 0.35);
          grad.addColorStop(0, '#' + hi.getHexString());
          grad.addColorStop(1, st.glass);
          g.fillStyle = grad;
        } else g.fillStyle = C(st.glass, 0.08, 0.55, lit ? warm : '#000');
        if (mode === 'emis' && lit) g.globalAlpha = dim;
        if (st.arch) {
          const r = gw / 2;
          g.beginPath();
          g.moveTo(gx, gy + gh);
          g.lineTo(gx, gy + r);
          g.arc(gx + r, gy + r, r, Math.PI, 0);
          g.lineTo(gx + gw, gy + gh);
          g.closePath();
          g.fill();
        } else g.fillRect(gx, gy, gw, gh);
        g.globalAlpha = 1;
        // 窗帘（部分窗户）
        if (mode === 'albedo' && !st.arch && rd() < 0.35) {
          g.fillStyle = rd() < 0.5 ? 'rgba(235,232,220,0.55)' : 'rgba(190,200,210,0.45)';
          const cw = gw * (0.2 + rd() * 0.35);
          g.fillRect(rd() < 0.5 ? gx : gx + gw - cw, gy, cw, gh);
        }
        // 竖梃 & 横档
        g.fillStyle = C(st.frame, 0.45, 0.6);
        const mw = Math.max(2, cell * 0.018);
        for (let m = 1; m <= st.mull; m++) {
          const mx = gx + (gw * m) / (st.mull + 1);
          g.fillRect(mx - mw / 2, gy, mw, gh);
        }
        if (st.transom) g.fillRect(gx, gy + gh * (1 - st.transom), gw, mw);
        // 窗台
        if (st.sill) {
          g.fillStyle = C(st.sill, 0.8, 0);
          g.fillRect(X(u0) - 2, Y(w0) - 1, (u1 - u0) * cell + 4, Math.max(3, cell * 0.03));
        }
        // 百叶
        if (st.shutter) {
          g.fillStyle = C(st.shutter, 0.8, 0);
          const sw = (u1 - u0) * cell * 0.42;
          g.fillRect(X(u0) - sw - 2, Y(w1), sw, (w1 - w0) * cell);
          g.fillRect(X(u1) + 2, Y(w1), sw, (w1 - w0) * cell);
          if (mode === 'albedo') {
            g.fillStyle = 'rgba(0,0,0,0.18)';
            for (let k = Y(w1); k < Y(w0); k += 4) {
              g.fillRect(X(u0) - sw - 2, k, sw, 1);
              g.fillRect(X(u1) + 2, k, sw, 1);
            }
          }
        }
        // 阳台栏杆
        const hasBal = st.balcony === true || (st.balcony === 'alt' && bx % 2 === 0);
        if (hasBal) {
          g.fillStyle = C('#3f4446', 0.9, 0);
          g.fillRect(X(0.06), Y(0.38), cell * 0.88, cell * 0.04);
          g.fillStyle = C(st.slab, 0.85, 0);
          g.fillRect(X(0.04), Y(0.36), cell * 0.92, cell * 0.24);
          g.fillStyle = C('#b9bcbc', 0.5, 0.7);
          for (let k = 0; k < 14; k++) g.fillRect(X(0.06 + (k * 0.88) / 14), Y(0.34), Math.max(1, cell * 0.01), cell * 0.2);
          g.fillRect(X(0.04), Y(0.36), cell * 0.92, Math.max(2, cell * 0.02));
        }
        // 空调外机
        if (st.ac && rand() < st.ac) {
          const ax = rand() < 0.5 ? X(0.03) : X(u1 + 0.02);
          g.fillStyle = C('#e6e6e2', 0.7, 0.2);
          g.fillRect(ax, Y(w0 + 0.05), cell * 0.16, cell * 0.12);
          if (mode === 'albedo') {
            g.fillStyle = 'rgba(0,0,0,0.35)';
            g.beginPath();
            g.arc(ax + cell * 0.08, Y(w0 + 0.05) + cell * 0.06, cell * 0.04, 0, Math.PI * 2);
            g.fill();
          }
        }
        // 雨水污迹（华南常见）
        if (mode === 'albedo' && st.streak) {
          const n = Math.floor(rd() * 4 * st.streak);
          for (let k = 0; k < n; k++) {
            const sx = X(u0 + rd() * (u1 - u0));
            const sy = Y(w0);
            const len = cell * (0.1 + rd() * 0.25);
            const grad = g.createLinearGradient(0, sy, 0, sy + len);
            grad.addColorStop(0, 'rgba(60,55,45,0.16)');
            grad.addColorStop(1, 'rgba(60,55,45,0)');
            g.fillStyle = grad;
            g.fillRect(sx, sy, 2 + rd() * 4, len);
          }
        }
      }
    // 整体底部（近地面）略脏
    if (mode === 'albedo') {
      const grad = g.createLinearGradient(0, 0, 0, S);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(1, 'rgba(40,35,25,0.04)');
      g.fillStyle = grad;
      g.fillRect(0, 0, S, S);
    }
  }

  const facadeCache = {};
  T.facade = function (style) {
    if (facadeCache[style]) return facadeCache[style];
    const st = STYLES[style] || STYLES.generic;
    const S = 512;
    const seed = JZ.hashStr(style);
    const mk = (mode) => {
      const c = T.canvas(S);
      drawFacade(c.getContext('2d'), S, st, mode, seed);
      return c;
    };
    const res = {
      map: T.texture(mk('albedo')),
      orm: T.texture(mk('orm'), { linear: true }),
      emis: T.texture(mk('emis')),
      bays: 4,
      floors: 4,
    };
    facadeCache[style] = res;
    return res;
  };

  // ---------- 屋面 ----------
  T.roofConcrete = function () {
    const S = 512, c = T.canvas(S), g = c.getContext('2d');
    const rand = JZ.rng(3);
    g.fillStyle = '#d4d3cf';
    g.fillRect(0, 0, S, S);
    const n = T.fbm(128, 9, 4, 4);
    const tmp = T.canvas(128), tg = tmp.getContext('2d'), img = tg.createImageData(128, 128);
    for (let i = 0; i < n.length; i++) {
      const v = 150 + n[i] * 105;
      img.data[i * 4] = v; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v - 4; img.data[i * 4 + 3] = 255;
    }
    tg.putImageData(img, 0, 0);
    g.globalAlpha = 0.55;
    g.drawImage(tmp, 0, 0, S, S);
    g.globalAlpha = 1;
    // 防水层接缝
    g.strokeStyle = 'rgba(70,70,70,0.25)';
    g.lineWidth = 2;
    for (let k = 0; k <= S; k += 128) {
      g.beginPath(); g.moveTo(k, 0); g.lineTo(k, S); g.stroke();
      g.beginPath(); g.moveTo(0, k); g.lineTo(S, k); g.stroke();
    }
    // 污渍
    for (let i = 0; i < 26; i++) {
      const x = rand() * S, y = rand() * S, r = 10 + rand() * 50;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, 'rgba(60,60,55,0.18)');
      gr.addColorStop(1, 'rgba(60,60,55,0)');
      g.fillStyle = gr;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
    return T.texture(c);
  };
  T.roofTiles = function () {
    const S = 512, c = T.canvas(S), g = c.getContext('2d');
    const rand = JZ.rng(4);
    g.fillStyle = '#e9e4df';
    g.fillRect(0, 0, S, S);
    const rowH = 32, colW = 24;
    for (let y = 0; y < S; y += rowH) {
      for (let x = -colW; x < S + colW; x += colW) {
        const off = ((y / rowH) % 2) * (colW / 2);
        const gx = x + off;
        const grad = g.createLinearGradient(gx, 0, gx + colW, 0);
        const v = 0.85 + rand() * 0.15;
        grad.addColorStop(0, `rgba(${Math.round(150 * v)},${Math.round(145 * v)},${Math.round(140 * v)},1)`);
        grad.addColorStop(0.5, `rgba(${Math.round(255 * v)},${Math.round(250 * v)},${Math.round(245 * v)},1)`);
        grad.addColorStop(1, `rgba(${Math.round(170 * v)},${Math.round(165 * v)},${Math.round(160 * v)},1)`);
        g.fillStyle = grad;
        g.fillRect(gx + 1, y, colW - 2, rowH - 2);
      }
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fillRect(0, y + rowH - 3, S, 3);
    }
    return T.texture(c);
  };
  T.domePanels = function () {
    const W = 1024, H = 256, c = T.canvas(W, H), g = c.getContext('2d');
    g.fillStyle = '#f4f4f0';
    g.fillRect(0, 0, W, H);
    g.strokeStyle = 'rgba(120,125,130,0.45)';
    g.lineWidth = 2;
    for (let i = 0; i <= 48; i++) { const x = (i / 48) * W; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
    for (let j = 1; j < 6; j++) { const y = (j / 6) * H; g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
    return T.texture(c);
  };

  // ---------- 文字牌匾 ----------
  T.textCanvas = function (text, o = {}) {
    const w = o.w || 1024, h = o.h || 256;
    const c = T.canvas(w, h), g = c.getContext('2d');
    if (o.bg) { g.fillStyle = o.bg; g.fillRect(0, 0, w, h); }
    if (o.border) { g.strokeStyle = o.border; g.lineWidth = h * 0.05; g.strokeRect(h * 0.05, h * 0.05, w - h * 0.1, h - h * 0.1); }
    g.fillStyle = o.color || '#c8a24a';
    g.font = `${o.weight || 'bold'} ${Math.round(h * (o.size || 0.62))}px ${o.font || '"KaiTi","STKaiti","楷体","Microsoft YaHei",serif'}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    if (o.shadow) { g.shadowColor = o.shadow; g.shadowBlur = h * 0.04; }
    g.fillText(text, w / 2, h / 2 + h * 0.03, w * 0.92);
    return c;
  };
})();
