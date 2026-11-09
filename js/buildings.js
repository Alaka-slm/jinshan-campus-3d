/* 建筑生成：OSM 轮廓挤出 + 立面纹理 + 多种屋顶（平顶女儿墙 / 四坡 / 穹顶 / 壳体 / 天象厅） */
(function () {
  'use strict';
  const JZ = window.JZ;
  const P = JZ.poly;
  const T = JZ.Tex;
  const { clamp, lerp, smoothstep } = JZ.math;

  const TYPE_DEFAULTS = {
    school: { levels: 4, style: 'teaching' },
    dormitory: { levels: 5, style: 'dorm' },
    apartments: { levels: 6, style: 'residential' },
    residential: { levels: 5, style: 'residential' },
    house: { levels: 2, style: 'villa', shape: 'hip' },
    hospital: { levels: 5, style: 'office' },
    industrial: { levels: 2, style: 'industrial' },
    commercial: { levels: 6, style: 'office' },
    roof: { levels: 1, style: 'generic' },
    yes: { levels: 3, style: 'generic' },
  };
  const FLOOR_H = { teaching: 3.6, office: 3.6, lab: 3.7, canteen: 4.2, dorm: 3.1, residential: 3.0, villa: 3.5, hall: 5.2, church: 4.6, glass: 4.0, gym: 5.0, generic: 3.2, industrial: 4.5, stand: 3.6 };
  const BAY_W = { teaching: 3.9, office: 3.6, lab: 3.6, canteen: 4.2, dorm: 3.4, residential: 3.3, villa: 3.3, hall: 4.6, church: 4.2, glass: 2.6, gym: 4.5, generic: 3.4, industrial: 5.2, stand: 5.0 };
  const TINTS = {
    teaching: ['#f6f4ee', '#f1ece2', '#eef0ee', '#f4efe3'],
    office: ['#f3f1ea', '#ece8de', '#f0ede6'],
    lab: ['#f2efe7', '#ebe9e2'],
    canteen: ['#f2eee6', '#efe9dc'],
    dorm: ['#f7efe2', '#f3ead8', '#efe7dc', '#f5f1e8'],
    residential: ['#efe6d8', '#ece2d6', '#e6e1d8', '#f0e3cf', '#e9dfd6'],
    villa: ['#f1dfb8', '#eed8b0', '#f3e6cc', '#e8d2b4'],
    hall: ['#ece6da', '#e6e1d7'],
    church: ['#e6e1d6'],
    glass: ['#f0f2f2'],
    gym: ['#f2f2ee'],
    generic: ['#eee9df', '#e9e4da', '#f0ece4', '#e4dfd5'],
    industrial: ['#dcd8cf', '#d4d2cb'],
    stand: ['#ecebe6'],
  };

  function hexToRgb(h) {
    h = h.replace('#', '');
    return [parseInt(h.substr(0, 2), 16), parseInt(h.substr(2, 2), 16), parseInt(h.substr(4, 2), 16)];
  }
  function rgbToHex(c) {
    return '#' + c.map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
  }
  // 卫星影像采样色偏暗偏灰：提亮并适度还原饱和度
  function fixRoofColor(hex, mode) {
    let c = hexToRgb(hex);
    const avg = (c[0] + c[1] + c[2]) / 3;
    c = c.map((v) => avg + (v - avg) * 1.15);
    c = c.map((v) => v * 1.18 + 16);
    if (mode === 'flat') c = c.map((v) => lerp(v, 205, 0.18));
    return rgbToHex(c);
  }

  // ---------- 几何累加器 ----------
  class Acc {
    constructor() {
      this.pos = []; this.nrm = []; this.uv = []; this.col = []; this.bid = [];
    }
    tri(a, b, c, uva, uvb, uvc, color, bid, n) {
      if (!n) {
        const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
        const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
        let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        const l = Math.hypot(nx, ny, nz) || 1;
        n = [nx / l, ny / l, nz / l];
      }
      this.pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
      for (let i = 0; i < 3; i++) this.nrm.push(n[0], n[1], n[2]);
      this.uv.push(uva[0], uva[1], uvb[0], uvb[1], uvc[0], uvc[1]);
      for (let i = 0; i < 3; i++) this.col.push(color.r, color.g, color.b);
      this.bid.push(bid);
    }
    // a,b,c,d 从外侧看逆时针
    quad(a, b, c, d, uva, uvb, uvc, uvd, color, bid) {
      this.tri(a, b, c, uva, uvb, uvc, color, bid);
      this.tri(a, c, d, uva, uvc, uvd, color, bid);
    }
    get empty() { return this.pos.length === 0; }
    geometry() {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
      g.computeBoundingSphere();
      g.userData.faceBid = Int32Array.from(this.bid);
      return g;
    }
  }
  JZ.Acc = Acc;

  // 世界坐标
  const W3 = (x, y, h) => [x, h, -y];

  // 盒子（无底面），angle 为长边方向（本地坐标系，弧度）
  function addBox(acc, cx, cy, y0, w, d, h, angle, color, bid, uvScale) {
    const cs = Math.cos(angle), sn = Math.sin(angle);
    const pt = (u, v) => [cx + u * cs - v * sn, cy + u * sn + v * cs];
    const c = [pt(-w / 2, -d / 2), pt(w / 2, -d / 2), pt(w / 2, d / 2), pt(-w / 2, d / 2)]; // CCW
    const s = uvScale || 0.25;
    for (let i = 0; i < 4; i++) {
      const p = c[i], q = c[(i + 1) % 4];
      const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
      acc.quad(W3(p[0], p[1], y0), W3(q[0], q[1], y0), W3(q[0], q[1], y0 + h), W3(p[0], p[1], y0 + h), [0, 0], [L * s, 0], [L * s, h * s], [0, h * s], color, bid);
    }
    acc.quad(W3(c[0][0], c[0][1], y0 + h), W3(c[1][0], c[1][1], y0 + h), W3(c[2][0], c[2][1], y0 + h), W3(c[3][0], c[3][1], y0 + h), [0, 0], [w * s, 0], [w * s, d * s], [0, d * s], color, bid);
  }
  JZ.addBox = addBox;

  // 多边形三角剖分（本地 x/y），返回三角形顶点索引
  function triangulate(pts) {
    const v = pts.map((p) => new THREE.Vector2(p[0], p[1]));
    return THREE.ShapeUtils.triangulateShape(v, []);
  }
  JZ.triangulate = triangulate;

  const Buildings = (JZ.Buildings = {});

  // 第一步：元数据、地基高度、登记地形平台
  Buildings.prepare = function (data, info, terrain) {
    const list = [];
    const ann = (info && info.buildings) || {};
    for (const b of data.buildings) {
      const a = ann[b.id] || ann[b.id.split('_')[0]] || {};
      if (a.skip) continue;
      const def = TYPE_DEFAULTS[b.building] || TYPE_DEFAULTS.yes;
      const meta = Object.assign({}, def, a);
      if (!a.levels && b['building:levels']) meta.levels = parseFloat(b['building:levels']) || meta.levels;
      if (b.amenity === 'place_of_worship' && !a.style) { meta.style = 'church'; meta.shape = meta.shape || 'hip'; }
      const pts = P.ccw(b.pts);
      const areaM2 = Math.abs(P.area(pts));
      if (areaM2 < 6) continue;
      if (!a.levels && !b['building:levels'] && b.building === 'yes' && areaM2 < 60) meta.levels = 1;
      meta.floorH = meta.floorH || FLOOR_H[meta.style] || 3.2;
      const c = P.centroid(pts);
      const base = terrain.avgBase(pts) + (meta.baseOffset || 0);
      const rand = JZ.rng(JZ.hashStr(b.id));
      const B = {
        id: b.id, idx: list.length, osm: b, name: a.label !== undefined ? a.label : b.name || '', meta, pts, area: areaM2,
        c, bb: P.bbox(pts), base, rand,
      };
      B.wallH = meta.wallH || meta.levels * meta.floorH;
      B.top = base + B.wallH;
      if (meta.shape !== 'pavilion') terrain.pad(pts, base, 1.2, meta.padBlend || 4, 'building');
      list.push(B);
    }
    return list;
  };

  // 第二步：生成网格
  Buildings.build = function (list, terrain, opts) {
    const group = new THREE.Group();
    group.name = 'buildings';
    const wallAcc = {}, parapet = new Acc(), roofFlat = new Acc(), roofTile = new Acc(), equip = new Acc();
    const specials = [];
    const obstacles = [];
    const labels = [];
    const tmpC = new THREE.Color();

    for (const B of list) {
      const m = B.meta;
      if (m.shape === 'pavilion') {
        const r = Math.sqrt(B.area / Math.PI);
        const g = JZ.Props.pavilion({ x: B.c[0], y: B.c[1], r: Math.max(2.5, r), sides: m.sides || 6, h: terrain.height(B.c[0], B.c[1]), roofColor: m.roofColor });
        group.add(g);
        if (B.name) labels.push({ name: B.name, x: B.c[0], y: B.c[1], h: terrain.height(B.c[0], B.c[1]) + 8, kind: 'landmark', bid: B.idx });
        continue;
      }
      const pts = B.pts;
      // 墙底：取轮廓外侧最低地面
      let minG = Infinity;
      for (const p of P.resample(pts, 4)) {
        const g = terrain.height(p[0], p[1]);
        if (g < minG) minG = g;
      }
      B.bottom = Math.min(minG, B.base) - 1.2;
      const style = m.style || 'generic';
      const tint = tmpC.set(m.wallColor || TINTS[style][Math.floor(B.rand() * TINTS[style].length)] || '#eeeeee').clone();
      tint.multiplyScalar(0.94 + B.rand() * 0.08);
      if (!wallAcc[style]) wallAcc[style] = new Acc();
      const acc = wallAcc[style];
      const bayW = m.bayW || BAY_W[style] || 3.4;
      const uOff = Math.floor(B.rand() * 4) / 4;
      const vScale = 1 / (m.floorH * 4);

      // 屋顶高度函数（壳体屋顶时变化）
      let topAt = () => B.top;
      let ring = pts;
      if (m.shape === 'shell') {
        const sh = m.shell || {};
        const dir = sh.dir || [-1, 1];
        const dl = Math.hypot(dir[0], dir[1]);
        let apex = pts[0], best = -Infinity;
        for (const p of pts) {
          const v = (p[0] * dir[0] + p[1] * dir[1]) / dl;
          if (v > best) { best = v; apex = p; }
        }
        let rmax = 0;
        for (const p of pts) rmax = Math.max(rmax, Math.hypot(p[0] - apex[0], p[1] - apex[1]));
        const hMax = sh.hMax || B.wallH + 4, hMin = sh.hMin || B.wallH * 0.5, pw = sh.pow || 1.4;
        topAt = (x, y) => B.base + hMax - (hMax - hMin) * Math.pow(clamp(Math.hypot(x - apex[0], y - apex[1]) / rmax, 0, 1), pw);
        ring = P.resample(pts, 3);
        B.top = B.base + hMax;
      }

      // 外墙
      let uAcc = uOff;
      for (let i = 0; i < ring.length; i++) {
        const p = ring[i], q = ring[(i + 1) % ring.length];
        const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
        if (L < 0.05) continue;
        const tp = topAt(p[0], p[1]), tq = topAt(q[0], q[1]);
        let u0, u1;
        if (m.shape === 'shell') {
          u0 = uAcc; u1 = uAcc + L / bayW / 4; uAcc = u1;
        } else if (L < 1.6) {
          u0 = 0.004; u1 = 0.02;
        } else {
          const nb = Math.max(1, Math.round(L / bayW));
          u0 = uOff; u1 = uOff + nb / 4;
        }
        const vb = (B.bottom - B.base) * vScale;
        acc.quad(W3(p[0], p[1], B.bottom), W3(q[0], q[1], B.bottom), W3(q[0], q[1], tq), W3(p[0], p[1], tp),
          [u0, vb], [u1, vb], [u1, (tq - B.base) * vScale], [u0, (tp - B.base) * vScale], tint, B.idx);
      }

      // 屋顶
      if (m.shape === 'hip' && addHipRoof(B, roofTile, m, tint)) {
        // 四坡屋顶已添加
      } else if (m.shape === 'dome') {
        specials.push(buildDome(B, opts));
      } else if (m.shape === 'shell') {
        specials.push(buildShell(B, ring, topAt, opts));
      } else if (m.shape === 'planetarium') {
        roofCap(B, roofFlat, '#d8d8d4');
        specials.push(buildPlanetarium(B, opts));
      } else {
        // 平屋顶 + 女儿墙
        const ph = m.parapet !== undefined ? m.parapet : 1.1;
        if (ph > 0) {
          for (let i = 0; i < pts.length; i++) {
            const p = pts[i], q = pts[(i + 1) % pts.length];
            const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
            parapet.quad(W3(p[0], p[1], B.top), W3(q[0], q[1], B.top), W3(q[0], q[1], B.top + ph), W3(p[0], p[1], B.top + ph), [0, 0], [L / 4, 0], [L / 4, ph / 4], [0, ph / 4], tint, B.idx);
          }
        }
        roofCap(B, roofFlat, m.roofColor || (B.osm.rc ? fixRoofColor(B.osm.rc, 'flat') : '#c9c7c0'));
        if (!m.noEquip) addRoofEquipment(B, equip);
      }
      obstacles.push({ pts, bb: B.bb, bid: B.idx });
      if (B.name) labels.push({ name: B.name, x: B.c[0], y: B.c[1], h: B.top + 3, kind: 'building', bid: B.idx, cat: m.cat });
    }

    // ---- 合并网格 ----
    const meshes = [];
    for (const style in wallAcc) {
      const fac = T.facade(style);
      const mat = new THREE.MeshStandardMaterial({
        map: fac.map, roughnessMap: fac.orm, metalnessMap: fac.orm, emissiveMap: fac.emis,
        emissive: 0xffffff, emissiveIntensity: 0, vertexColors: true, roughness: 1, metalness: 1,
      });
      mat.userData.night = true;
      const mesh = new THREE.Mesh(wallAcc[style].geometry(), mat);
      mesh.name = 'walls-' + style;
      meshes.push(mesh);
    }
    if (!parapet.empty) meshes.push(new THREE.Mesh(parapet.geometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide })));
    if (!roofFlat.empty) meshes.push(new THREE.Mesh(roofFlat.geometry(), new THREE.MeshStandardMaterial({ map: T.roofConcrete(), vertexColors: true, roughness: 0.95 })));
    if (!roofTile.empty) meshes.push(new THREE.Mesh(roofTile.geometry(), new THREE.MeshStandardMaterial({ map: T.roofTiles(), vertexColors: true, roughness: 0.78, side: THREE.DoubleSide })));
    if (!equip.empty) meshes.push(new THREE.Mesh(equip.geometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.1 })));
    for (const mesh of meshes) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.pick = true;
      group.add(mesh);
    }
    for (const s of specials) if (s) group.add(s);
    return { group, obstacles, labels, list };
  };

  function roofCap(B, acc, colorHex) {
    const pts = B.pts;
    const col = new THREE.Color(colorHex);
    const tris = triangulate(pts);
    const y = B.top + 0.02;
    for (const t of tris) {
      let a = pts[t[0]], b = pts[t[1]], c = pts[t[2]];
      // 本地坐标逆时针 = 俯视逆时针 = 法线朝上
      const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      if (cross < 0) { const s = b; b = c; c = s; }
      acc.tri(W3(a[0], a[1], y), W3(b[0], b[1], y), W3(c[0], c[1], y), [a[0] / 8, a[1] / 8], [b[0] / 8, b[1] / 8], [c[0] / 8, c[1] / 8], col, B.idx, [0, 1, 0]);
    }
  }

  function addRoofEquipment(B, acc) {
    const m = B.meta;
    if (B.area < 140 || m.levels < 3) return;
    const ob = P.obb(B.pts);
    const ang = ob ? ob.angle : 0;
    const rand = B.rand;
    const grey = new THREE.Color('#cfcdc6'), dark = new THREE.Color('#9a9993'), blue = new THREE.Color('#8fa7b8');
    // 楼梯间
    const nStairs = B.area > 900 ? 2 : 1;
    for (let k = 0; k < nStairs; k++) {
      const p = P.interiorPoint(B.pts, 3.2, rand);
      if (p) addBox(acc, p[0], p[1], B.top, 4.5, 3.4, 3.0, ang, grey, B.idx);
    }
    // 水箱
    if (rand() < 0.75) {
      const p = P.interiorPoint(B.pts, 2.2, rand);
      if (p) addBox(acc, p[0], p[1], B.top + 3.0 * (rand() < 0.3 ? 1 : 0), 2.4, 2.0, 1.6, ang, rand() < 0.5 ? blue : grey, B.idx);
    }
    // 空调外机/太阳能热水器
    const n = Math.min(12, Math.floor(B.area / 160));
    for (let k = 0; k < n; k++) {
      const p = P.interiorPoint(B.pts, 1.2, rand);
      if (p) addBox(acc, p[0], p[1], B.top, 1.2, 0.7, 0.9, ang, dark, B.idx);
    }
  }

  // 四坡屋顶（近似矩形轮廓），失败返回 false
  function addHipRoof(B, acc, m, wallTint) {
    const ob = P.obb(B.pts);
    if (!ob || B.area / ob.area < 0.72) return false;
    const o = m.overhang !== undefined ? m.overhang : 0.6;
    const hl = ob.hl + o, hw = ob.hw + o;
    const pitch = ((m.pitch || 27) * Math.PI) / 180;
    const rise = hw * Math.tan(pitch);
    const rl = Math.max(0, hl - hw);
    const y0 = B.top - 0.05, y1 = y0 + rise;
    const P2 = (u, v) => [ob.cx + ob.ux * u + ob.vx * v, ob.cy + ob.uy * u + ob.vy * v];
    const c1 = P2(-hl, -hw), c2 = P2(hl, -hw), c3 = P2(hl, hw), c4 = P2(-hl, hw);
    const r1 = P2(-rl, 0), r2 = P2(rl, 0);
    let colHex = m.roofColor;
    if (!colHex) {
      colHex = B.osm.rc ? fixRoofColor(B.osm.rc, 'tile') : '#b5583f';
      const rgb = hexToRgb(colHex);
      if ((rgb[0] + rgb[1] + rgb[2]) / 3 < 95) colHex = '#b65a40';
    }
    const col = new THREE.Color(colHex);
    const V = (p, h) => W3(p[0], p[1], h);
    const slope = Math.hypot(hw, rise);
    const upY = (x, y, z) => (y[2] - x[2]) * (z[0] - x[0]) - (y[0] - x[0]) * (z[2] - x[2]); // 法线 y 分量
    const face = (a, b, c, d) => {
      // a→b 为檐口；c 为靠近 b 的屋脊点，d 为靠近 a 的屋脊点（d 为空则为三角形）
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const uvA = [0, 0], uvB = [L / 4, 0];
      const A = V(a, y0), Bv = V(b, y0), C = V(c, y1);
      if (!d) {
        const uvC = [L / 8, slope / 4];
        if (upY(A, Bv, C) >= 0) acc.tri(A, Bv, C, uvA, uvB, uvC, col, B.idx);
        else acc.tri(A, C, Bv, uvA, uvC, uvB, col, B.idx);
      } else {
        const D = V(d, y1);
        const uvC = [(L / 2 + rl) / 4, slope / 4], uvD = [(L / 2 - rl) / 4, slope / 4];
        if (upY(A, Bv, C) >= 0) acc.quad(A, Bv, C, D, uvA, uvB, uvC, uvD, col, B.idx);
        else acc.quad(A, D, C, Bv, uvA, uvD, uvC, uvB, col, B.idx);
      }
    };
    face(c1, c2, r2, r1);
    face(c3, c4, r1, r2);
    face(c2, c3, r2, null);
    face(c4, c1, r1, null);
    // 檐下封板
    const soffit = new THREE.Color('#e9e4da');
    const S = [c1, c2, c3, c4].map((p) => V(p, y0 - 0.02));
    acc.quad(S[0], S[3], S[2], S[1], [0, 0], [0, 1], [1, 1], [1, 0], soffit, B.idx);
    B.top = y1;
    if (m.cross) {
      // 教堂十字架
      const cr = new THREE.Color('#f2efe6');
      addBox(acc, r1[0], r1[1], y1 - 0.2, 0.3, 0.3, 3.2, ob.angle, cr, B.idx);
      addBox(acc, r1[0], r1[1], y1 + 1.8, 1.6, 0.3, 0.3, ob.angle, cr, B.idx);
    }
    return true;
  }

  function buildDome(B, opts) {
    const m = B.meta;
    const ring = P.resample(B.pts, Math.max(1, P.perimeter(B.pts) / 96)).slice(0, 96);
    const N = ring.length, K = 14;
    const c = B.c;
    const domeH = m.domeH || 8;
    const pos = [], uv = [], idx = [];
    const over = 1.012;
    for (let k = 0; k <= K; k++) {
      const th = (k / K) * (Math.PI / 2);
      const s = k === 0 ? over : Math.cos(th) * over;
      const h = B.top + domeH * Math.sin(th);
      for (let i = 0; i <= N; i++) {
        const p = ring[i % N];
        pos.push(c[0] + (p[0] - c[0]) * s, h, -(c[1] + (p[1] - c[1]) * s));
        uv.push(i / N, k / K);
      }
    }
    for (let k = 0; k < K; k++)
      for (let i = 0; i < N; i++) {
        const a = k * (N + 1) + i, b = a + 1, cc = a + (N + 1), d = cc + 1;
        idx.push(a, cc, b, b, cc, d);
      }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    // 若法线朝下则翻转
    const n = geo.attributes.normal;
    if (n.getY(Math.floor(n.count / 2)) < 0) {
      const ix = geo.index.array;
      for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]; ix[i + 1] = ix[i + 2]; ix[i + 2] = t; }
      geo.computeVertexNormals();
    }
    const mat = new THREE.MeshStandardMaterial({ map: T.domePanels(), color: m.roofColor || '#f6f6f2', roughness: 0.38, metalness: 0.05 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.userData.pick = true;
    mesh.userData.bid = B.idx;
    B.top += domeH;
    return mesh;
  }

  function buildShell(B, ring, topAt, opts) {
    const m = B.meta;
    // 轮廓三角剖分 + 两级细分，按高度函数抬升
    const tris = triangulate(ring);
    let T3 = tris.map((t) => [ring[t[0]], ring[t[1]], ring[t[2]]]);
    for (let lvl = 0; lvl < 3; lvl++) {
      const out = [];
      for (const [a, b, c] of T3) {
        const longest = Math.max(Math.hypot(a[0] - b[0], a[1] - b[1]), Math.hypot(b[0] - c[0], b[1] - c[1]), Math.hypot(c[0] - a[0], c[1] - a[1]));
        if (longest < 4) { out.push([a, b, c]); continue; }
        const ab = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], bc = [(b[0] + c[0]) / 2, (b[1] + c[1]) / 2], ca = [(c[0] + a[0]) / 2, (c[1] + a[1]) / 2];
        out.push([a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]);
      }
      T3 = out;
    }
    const vmap = new Map(), pos = [], uv = [], col = [], idx = [];
    const white = new THREE.Color(m.shell && m.shell.color ? m.shell.color : '#f1f0ea'), grey = new THREE.Color('#b9b8b1');
    const greyT = m.shell && m.shell.greyBelow !== undefined ? m.shell.greyBelow : -1;
    const vid = (p) => {
      const key = Math.round(p[0] * 20) + ',' + Math.round(p[1] * 20);
      if (vmap.has(key)) return vmap.get(key);
      const h = topAt(p[0], p[1]);
      const id = pos.length / 3;
      pos.push(p[0], h, -p[1]);
      uv.push(p[0] / 6, p[1] / 6);
      const cc = h - B.base < greyT ? grey : white;
      col.push(cc.r, cc.g, cc.b);
      vmap.set(key, id);
      return id;
    };
    for (const [a, b, c] of T3) {
      const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      const ia = vid(a), ib = vid(b), ic = vid(c);
      if (cross >= 0) idx.push(ia, ib, ic);
      else idx.push(ia, ic, ib);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.15, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.userData.pick = true;
    mesh.userData.bid = B.idx;
    // 屋顶接缝线（装饰）
    return mesh;
  }

  function buildPlanetarium(B, opts) {
    const r = Math.sqrt(B.area / Math.PI) * 0.98;
    const geo = new THREE.SphereGeometry(r, 40, 16, 0, Math.PI * 2, 0, Math.PI / 2);
    const mat = new THREE.MeshStandardMaterial({ color: '#d4d8dc', roughness: 0.22, metalness: 0.9 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(B.c[0], B.top, -B.c[1]);
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.userData.pick = true;
    mesh.userData.bid = B.idx;
    B.top += r;
    return mesh;
  }

  Buildings.fixRoofColor = fixRoofColor;
})();
