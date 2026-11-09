/* 地表绘制：卫星分类底色 + OSM 面状要素 + 道路 + 建筑阴影；以及植被遮罩 */
(function () {
  'use strict';
  const JZ = window.JZ;
  const P = JZ.poly;
  const T = JZ.Tex;
  const { clamp, lerp, smoothstep } = JZ.math;

  class Raster {
    constructor(rect, W, H) {
      this.rect = rect;
      this.W = W;
      this.H = H || W;
      this.c = T.canvas(this.W, this.H);
      this.g = this.c.getContext('2d', { willReadFrequently: false });
      this.s = this.W / (rect[2] - rect[0]);
    }
    X(x) { return (x - this.rect[0]) * this.s; }
    Y(y) { return (this.rect[3] - y) * this.s; }
    ring(pts) {
      const g = this.g;
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        if (i === 0) g.moveTo(this.X(p[0]), this.Y(p[1]));
        else g.lineTo(this.X(p[0]), this.Y(p[1]));
      }
      g.closePath();
    }
    fillPoly(pts, holes, style) {
      const g = this.g;
      g.beginPath();
      this.ring(pts);
      if (holes) holes.forEach((h) => this.ring(h));
      g.fillStyle = style;
      g.fill('evenodd');
    }
    strokeLine(pts, wM, style, cap) {
      const g = this.g;
      g.beginPath();
      pts.forEach((p, i) => (i ? g.lineTo(this.X(p[0]), this.Y(p[1])) : g.moveTo(this.X(p[0]), this.Y(p[1]))));
      g.lineWidth = Math.max(1, wM * this.s);
      g.strokeStyle = style;
      g.lineCap = cap || 'round';
      g.lineJoin = 'round';
      g.stroke();
    }
    strokePoly(pts, wM, style) {
      const g = this.g;
      g.beginPath();
      this.ring(pts);
      g.lineWidth = Math.max(1, wM * this.s);
      g.strokeStyle = style;
      g.lineJoin = 'round';
      g.stroke();
    }
  }
  JZ.Raster = Raster;

  const ROAD = {
    primary: { w: 15, c: '#57595c', e: '#a8a398', ew: 3, car: true },
    secondary: { w: 12, c: '#57595c', e: '#a8a398', ew: 2.5, car: true },
    tertiary: { w: 9, c: '#5b5e61', e: '#a39e94', ew: 1.6, car: true },
    unclassified: { w: 6.5, c: '#636568', e: '#9f9a90', ew: 1, car: true },
    residential: { w: 6, c: '#656769', e: '#9f9a90', ew: 1, car: true },
    service: { w: 4.6, c: '#8f8c85', e: '#aaa69d', ew: 0.6, car: true },
    living_street: { w: 5, c: '#8f8c85' },
    pedestrian: { w: 4, c: '#b2aa9c' },
    footway: { w: 2.4, c: '#aca395' },
    path: { w: 1.6, c: '#a2927a' },
    bridleway: { w: 2, c: '#a2927a' },
    track: { w: 3, c: '#9d8b6e' },
    cycleway: { w: 2, c: '#9b8179' },
    steps: { w: 2.6, c: '#bdb7aa', steps: true },
  };
  JZ.ROAD_STYLE = ROAD;
  JZ.roadVisible = (r) => !(r.tunnel === 'yes' || (r.layer && Number(r.layer) < 0) || r.bridge === 'yes' || r.construction);

  const BUILT = new Set(['residential', 'military', 'school', 'hospital', 'industrial', 'churchyard', 'religious', 'recreation', 'cemetery', 'brownfield']);

  function loadImage(src) {
    return new Promise((res, rej) => {
      const im = new Image();
      im.onload = () => res(im);
      im.onerror = rej;
      im.src = src;
    });
  }

  const Ground = (JZ.Ground = {});

  Ground.loadLandcover = async function (data) {
    const L = data.landcover;
    const im = await loadImage(L.png);
    const c = T.canvas(im.width, im.height);
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(im, 0, 0);
    const px = g.getImageData(0, 0, im.width, im.height).data;
    const w = im.width, h = im.height;
    const lc = { w, h, cell: L.cell, x0: L.x0, y1: L.y1, px };
    // 双线性取值：ch 0=植被 1=裸露亮面 2=阴影
    lc.get = function (x, y, ch) {
      const fx = (x - L.x0) / L.cell - 0.5, fy = (L.y1 - y) / L.cell - 0.5;
      const i = clamp(Math.floor(fx), 0, w - 2), j = clamp(Math.floor(fy), 0, h - 2);
      const tx = clamp(fx - i, 0, 1), ty = clamp(fy - j, 0, 1);
      const k = (j * w + i) * 4 + ch;
      const a = px[k], b = px[k + 4], cc = px[k + w * 4], d = px[k + w * 4 + 4];
      return lerp(lerp(a, b, tx), lerp(cc, d, tx), ty) / 255;
    };
    return lc;
  };

  // 建成区遮罩（与地表分类同分辨率）
  Ground.builtMask = function (data, lc) {
    const r = new Raster([data.landcover.x0, data.landcover.y0, data.landcover.x1, data.landcover.y1], lc.w, lc.h);
    const g = r.g;
    g.fillStyle = '#000';
    g.fillRect(0, 0, r.W, r.H);
    for (const a of data.areas) if (BUILT.has(a.kind)) r.fillPoly(a.pts, a.holes, '#fff');
    for (const rd of data.roads) if (JZ.roadVisible(rd)) r.strokeLine(rd.pts, (ROAD[rd.hw] || ROAD.footway).w + 8, '#fff');
    for (const b of data.buildings) {
      r.fillPoly(b.pts, null, '#fff');
      r.strokePoly(b.pts, 14, '#fff');
    }
    const d = g.getImageData(0, 0, r.W, r.H).data;
    const m = new Uint8Array(r.W * r.H);
    for (let i = 0; i < m.length; i++) m[i] = d[i * 4];
    return m;
  };

  // 底色：由卫星分类得到的植被/裸岩/铺装
  Ground.baseCanvas = function (data, lc, built) {
    const W = lc.w, H = lc.h;
    const c = T.canvas(W, H), g = c.getContext('2d');
    const img = g.createImageData(W, H);
    const rand = JZ.rng(7);
    const forestA = [56, 84, 40], forestB = [76, 104, 50], soil = [139, 128, 102], rock = [176, 170, 156];
    const paving = [150, 146, 137], lawn = [96, 136, 62];
    const noise = T.fbm(256, 3, 4, 8);
    for (let j = 0; j < H; j++)
      for (let i = 0; i < W; i++) {
        const k = j * W + i, o = k * 4;
        const veg = lc.px[o] / 255, rk = lc.px[o + 1] / 255, dk = lc.px[o + 2] / 255;
        const b = built[k] / 255;
        const n = noise[(j % 256) * 256 + (i % 256)];
        let col = [0, 0, 0];
        const forest = forestA.map((v, q) => lerp(v, forestB[q], n));
        const nat = soil.map((v, q) => lerp(lerp(v, rock[q], clamp(rk * 1.3, 0, 1)), forest[q], smoothstep(0.15, 0.7, veg)));
        const urb = paving.map((v, q) => lerp(v, lawn[q] * (0.85 + n * 0.3), smoothstep(0.3, 0.8, veg)));
        for (let q = 0; q < 3; q++) col[q] = lerp(nat[q], urb[q], b) * (1 - dk * 0.25) * (0.95 + rand() * 0.1);
        img.data[o] = col[0];
        img.data[o + 1] = col[1];
        img.data[o + 2] = col[2];
        img.data[o + 3] = 255;
      }
    g.putImageData(img, 0, 0);
    return c;
  };

  const AREA_STYLE = {
    farmland: 'rgba(132,150,82,0.85)',
    cemetery: 'rgba(120,132,100,0.6)',
    grass: 'rgba(98,142,60,0.88)',
    park: 'rgba(90,134,58,0.45)',
    garden: 'rgba(96,140,62,0.7)',
    recreation: 'rgba(110,140,70,0.4)',
    pitch: '#4c8a3e',
    track: '#b04f3c',
    parking: '#6f6f72',
    plaza: '#b7b0a3',
    water: '#2f4b44',
    basin: '#3f6f7a',
    pool: '#3d8fb0',
    beach: '#d8c9a3',
  };

  // 在给定画布上绘制完整地表
  Ground.paint = function (r, data, base, opts = {}) {
    const g = r.g;
    const L = data.landcover;
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = 'high';
    const cs = base.width / (L.x1 - L.x0);
    g.drawImage(base, (r.rect[0] - L.x0) * cs, (L.y1 - r.rect[3]) * cs, (r.rect[2] - r.rect[0]) * cs, (r.rect[3] - r.rect[1]) * cs, 0, 0, r.W, r.H);
    // 海
    if (data.sea && data.sea.length > 2) r.fillPoly(data.sea, null, '#3e5d58');
    // 面状要素
    const order = ['farmland', 'cemetery', 'recreation', 'park', 'grass', 'garden', 'pitch', 'track', 'parking', 'plaza', 'water', 'basin', 'pool', 'beach'];
    for (const kind of order)
      for (const a of data.areas) {
        if (a.kind !== kind) continue;
        let st = AREA_STYLE[kind];
        if (kind === 'pitch' && (a.sport === 'basketball' || a.sport === 'volleyball')) st = '#a5523f';
        r.fillPoly(a.pts, a.holes, st);
        if (kind === 'plaza' && opts.detail) {
          g.save();
          g.beginPath();
          r.ring(a.pts);
          g.clip();
          g.strokeStyle = 'rgba(0,0,0,0.07)';
          g.lineWidth = 1;
          const bb = P.bbox(a.pts);
          for (let x = Math.floor(bb[0]); x <= bb[2]; x += 1) { g.beginPath(); g.moveTo(r.X(x), r.Y(bb[1])); g.lineTo(r.X(x), r.Y(bb[3])); g.stroke(); }
          for (let y = Math.floor(bb[1]); y <= bb[3]; y += 1) { g.beginPath(); g.moveTo(r.X(bb[0]), r.Y(y)); g.lineTo(r.X(bb[2]), r.Y(y)); g.stroke(); }
          g.restore();
        }
        if (kind === 'parking' && opts.detail) r.strokePoly(a.pts, 0.25, 'rgba(240,240,235,0.8)');
      }
    // 额外：程序生成的地面（如校门前广场）
    if (opts.extraAreas) for (const a of opts.extraAreas) r.fillPoly(a.pts, null, a.color);
    // 道路：先描边再填充
    const roads = data.roads.filter(JZ.roadVisible).map((rd) => ({ rd, st: ROAD[rd.hw] || ROAD.footway }));
    roads.sort((a, b) => a.st.w - b.st.w);
    for (const { rd, st } of roads) if (st.e) r.strokeLine(rd.pts, st.w + st.ew * 2, st.e);
    for (const { rd, st } of roads) {
      r.strokeLine(rd.pts, st.w, st.c);
      if (st.steps && opts.detail) {
        g.setLineDash([0.09 * r.s, 0.26 * r.s]);
        r.strokeLine(rd.pts, st.w, 'rgba(90,85,75,0.55)', 'butt');
        g.setLineDash([]);
      }
      if (st.car && opts.detail && st.w >= 6) {
        g.setLineDash([3 * r.s, 4 * r.s]);
        r.strokeLine(rd.pts, 0.15, 'rgba(235,235,225,0.75)', 'butt');
        g.setLineDash([]);
      }
    }
    // 建筑接地阴影（环境光遮蔽）
    g.save();
    g.shadowColor = 'rgba(0,0,0,0.55)';
    g.shadowBlur = Math.max(2, 2.2 * r.s);
    for (const b of data.buildings) r.fillPoly(b.pts, null, '#77746c');
    g.restore();
  };

  // 植被遮罩（1 m 格网）：建筑、道路、水体、球场等处不种树
  Ground.blockedMask = function (data, extraPolys) {
    const rect = data.region;
    const W = rect[2] - rect[0], H = rect[3] - rect[1];
    const r = new Raster(rect, W, H);
    const g = r.g;
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, H);
    if (data.sea && data.sea.length > 2) {
      r.fillPoly(data.sea, null, '#fff');
      r.strokePoly(data.sea, 6, '#fff');
    }
    for (const a of data.areas) {
      if (['water', 'basin', 'pool', 'pitch', 'track', 'parking', 'plaza', 'beach'].includes(a.kind)) {
        r.fillPoly(a.pts, a.holes, '#fff');
        r.strokePoly(a.pts, a.kind === 'track' || a.kind === 'pitch' ? 5 : 2.5, '#fff');
      }
    }
    for (const rd of data.roads) {
      if (rd.tunnel === 'yes' || (rd.layer && Number(rd.layer) < 0)) continue;
      const st = ROAD[rd.hw] || ROAD.footway;
      r.strokeLine(rd.pts, st.w + (st.car ? 3 : 1.6), '#fff');
    }
    for (const b of data.buildings) {
      r.fillPoly(b.pts, null, '#fff');
      r.strokePoly(b.pts, 3.5, '#fff');
    }
    if (extraPolys) for (const p of extraPolys) { r.fillPoly(p, null, '#fff'); r.strokePoly(p, 3, '#fff'); }
    const d = g.getImageData(0, 0, W, H).data;
    const m = new Uint8Array(W * H);
    for (let i = 0; i < m.length; i++) m[i] = d[i * 4] > 100 ? 1 : 0;
    return {
      W, H, x0: rect[0], y1: rect[3], m,
      at(x, y) {
        const i = Math.floor(x - rect[0]), j = Math.floor(rect[3] - y);
        if (i < 0 || j < 0 || i >= W || j >= H) return 1;
        return m[j * W + i];
      },
    };
  };
})();
