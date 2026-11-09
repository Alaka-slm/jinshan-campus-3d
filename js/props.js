/* 景观与配套：亭子、校门、雕塑、景观天桥、路灯、对岸城市天际线、港湾船只 */
(function () {
  'use strict';
  const JZ = window.JZ;
  const P = JZ.poly;
  const T = JZ.Tex;
  const { clamp, lerp, smoothstep } = JZ.math;
  const Props = (JZ.Props = {});

  // 材质缓存：相同参数共用一个材质，便于合并网格
  const matCache = new Map();
  const mat = (c, o = {}) => {
    const key = c + JSON.stringify(o);
    if (!matCache.has(key)) matCache.set(key, new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: 0.8, metalness: 0 }, o)));
    return matCache.get(key);
  };
  const shadowAll = (g) => g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });

  // ---------- 中式亭子 ----------
  Props.pavilion = function (o) {
    const g = new THREE.Group();
    const n = o.sides || 6, r = o.r || 3;
    const stone = mat('#cfc8b8', { roughness: 0.9 });
    const red = mat(o.colColor || '#a8352b', { roughness: 0.6 });
    const roofM = mat(o.roofColor || '#3f5650', { roughness: 0.55, side: THREE.DoubleSide });
    const base = new THREE.Mesh(new THREE.CylinderGeometry(r + 0.7, r + 0.9, 0.5, n), stone);
    base.position.y = 0.25;
    base.rotation.y = Math.PI / n;
    g.add(base);
    const colH = 2.9;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.15, colH, 10), red);
      c.position.set(Math.cos(a) * r, 0.5 + colH / 2, Math.sin(a) * r);
      g.add(c);
    }
    // 檐下额枋
    const frieze = new THREE.Mesh(new THREE.CylinderGeometry(r + 0.12, r + 0.12, 0.4, n, 1, true), mat('#6f2a22', { side: THREE.DoubleSide }));
    frieze.position.y = 0.5 + colH + 0.05;
    frieze.rotation.y = Math.PI / n;
    g.add(frieze);
    // 坐凳栏杆
    const bench = new THREE.Mesh(new THREE.CylinderGeometry(r + 0.05, r + 0.05, 0.12, n, 1, true), mat('#7a2c24', { side: THREE.DoubleSide }));
    bench.position.y = 0.95;
    bench.rotation.y = Math.PI / n;
    g.add(bench);
    // 曲面屋顶（翼角起翘）
    const ye = 0.5 + colH + 0.3, re = r + 1.25, ya = ye + r * 0.95 + 0.6;
    const per = 6, M = 7, N = n * per;
    const pos = [], idx = [];
    for (let j = 0; j <= M; j++) {
      const t = j / M;
      const rad = re * (1 - t);
      const hh = ye + (ya - ye) * Math.pow(t, 2.1);
      for (let i = 0; i < N; i++) {
        const side = Math.floor(i / per), sfrac = (i % per) / per;
        const a0 = (side / n) * Math.PI * 2, a1 = ((side + 1) / n) * Math.PI * 2;
        const c0 = [Math.cos(a0), Math.sin(a0)], c1 = [Math.cos(a1), Math.sin(a1)];
        const px = lerp(c0[0], c1[0], sfrac), pz = lerp(c0[1], c1[1], sfrac);
        const lift = 0.55 * Math.pow(Math.abs(sfrac - 0.5) * 2, 3) * Math.pow(1 - t, 2.2);
        pos.push(px * rad, hh + lift, pz * rad);
      }
    }
    pos.push(0, ya, 0);
    const apex = (M + 1) * N;
    for (let j = 0; j < M; j++)
      for (let i = 0; i < N; i++) {
        const a = j * N + i, b = j * N + ((i + 1) % N), c = (j + 1) * N + i, d = (j + 1) * N + ((i + 1) % N);
        idx.push(a, c, b, b, c, d);
      }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const roof = new THREE.Mesh(geo, roofM);
    roof.rotation.y = Math.PI / n;
    g.add(roof);
    const fin = new THREE.Mesh(new THREE.ConeGeometry(0.22, 1.0, 8), mat('#b8963c', { metalness: 0.6, roughness: 0.35 }));
    fin.position.y = ya + 0.45;
    g.add(fin);
    shadowAll(g);
    g.position.set(o.x, o.h, -o.y);
    return g;
  };

  // ---------- 校门 ----------
  Props.gate = function (o, terrain) {
    const g = new THREE.Group();
    const span = o.span || 14;
    const granite = mat('#d9d3c7', { roughness: 0.85 });
    const dark = mat('#5d1f1b', { roughness: 0.6 });
    for (const s of [-1, 1]) {
      const pil = new THREE.Mesh(new THREE.BoxGeometry(2.0, 7.2, 1.6), granite);
      pil.position.set(s * (span / 2 + 1.0), 3.6, 0);
      g.add(pil);
    }
    const beam = new THREE.Mesh(new THREE.BoxGeometry(span + 5, 1.7, 1.9), granite);
    beam.position.set(0, 7.6, 0);
    g.add(beam);
    const plaqueTex = T.texture(T.textCanvas(o.text || '汕头市金山中学', { w: 1536, h: 192, bg: '#5d1f1b', color: '#e2c26a', size: 0.66, shadow: 'rgba(0,0,0,0.4)' }), { clamp: true });
    for (const s of [-1, 1]) {
      const pl = new THREE.Mesh(new THREE.PlaneGeometry(span * 0.82, 1.1), new THREE.MeshStandardMaterial({ map: plaqueTex, roughness: 0.5, metalness: 0.2 }));
      pl.position.set(0, 7.6, s * 0.96);
      if (s < 0) pl.rotation.y = Math.PI;
      g.add(pl);
    }
    // 电动伸缩门轨道
    const rail = new THREE.Mesh(new THREE.BoxGeometry(span * 0.45, 1.3, 0.35), mat('#9aa0a6', { metalness: 0.7, roughness: 0.4 }));
    rail.position.set(-span * 0.27, 0.65, 0);
    g.add(rail);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(span + 5.4, 0.25, 2.2), dark);
    cap.position.set(0, 8.55, 0);
    g.add(cap);
    shadowAll(g);
    const h = terrain.height(o.x, o.y);
    g.position.set(o.x, h - 0.1, -o.y);
    g.rotation.y = o.angle || 0;
    return g;
  };

  // ---------- 雕塑与景石 ----------
  Props.sculpture = function (o, terrain) {
    const g = new THREE.Group();
    const h = terrain.height(o.x, o.y);
    const stone = mat('#cfc9bc', { roughness: 0.85 });
    if (o.type === 'sail') {
      const ped = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.5, 0.8, 24), stone);
      ped.position.y = 0.4;
      g.add(ped);
      const geo = new THREE.PlaneGeometry(3.2, 6, 8, 12);
      const p = geo.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const y = p.getY(i) + 3, x = p.getX(i);
        const t = y / 6;
        p.setX(i, x * (1 - t * 0.92) + t * 0.9);
        p.setZ(i, Math.sin(((x + 1.6) / 3.2) * Math.PI) * 0.7 * (1 - t * 0.6));
        p.setY(i, y);
      }
      geo.computeVertexNormals();
      const sail = new THREE.Mesh(geo, mat('#f3f3ef', { roughness: 0.3, metalness: 0.35, side: THREE.DoubleSide }));
      sail.position.y = 0.8;
      g.add(sail);
    } else if (o.type === 'sundial') {
      const ped = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.0, 1.8), stone);
      ped.position.y = 0.5;
      g.add(ped);
      const dial = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.15, 0.14, 40), mat('#9c7b4a', { metalness: 0.6, roughness: 0.4 }));
      dial.position.y = 1.55;
      dial.rotation.x = ((90 - 23.3) * Math.PI) / 180; // 赤道式日晷，盘面与赤道平行
      g.add(dial);
      const gnomon = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.2, 8), mat('#d8c27a', { metalness: 0.8, roughness: 0.3 }));
      gnomon.position.y = 1.55;
      gnomon.rotation.x = dial.rotation.x;
      g.add(gnomon);
      const sup = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.6, 0.3), stone);
      sup.position.y = 1.2;
      g.add(sup);
    } else if (o.type === 'ring') {
      const ped = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.2, 0.7, 24), stone);
      ped.position.y = 0.35;
      g.add(ped);
      const gold = mat('#d6b45a', { metalness: 0.85, roughness: 0.28 });
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.6, 0.14, 12, 48), gold);
      ring.position.y = 2.5;
      g.add(ring);
      const ring2 = new THREE.Mesh(new THREE.TorusGeometry(1.2, 0.08, 10, 40, Math.PI * 1.3), mat('#e9e7df', { metalness: 0.6, roughness: 0.3 }));
      ring2.position.y = 2.5;
      ring2.rotation.y = Math.PI / 2;
      g.add(ring2);
      const sun = new THREE.Mesh(new THREE.SphereGeometry(0.45, 24, 16), gold);
      sun.position.y = 2.5;
      g.add(sun);
    } else if (o.type === 'stone') {
      const geo = new THREE.IcosahedronGeometry(1, 2);
      const rand = JZ.rng(31);
      const p = geo.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const s = 1 + (rand() - 0.5) * 0.18;
        p.setXYZ(i, p.getX(i) * 2.4 * s, p.getY(i) * 1.3 * s, p.getZ(i) * 0.9 * s);
      }
      geo.computeVertexNormals();
      const rock = new THREE.Mesh(geo, mat('#b9b2a3', { roughness: 0.95, flatShading: true }));
      rock.position.y = 1.0;
      g.add(rock);
      const txt = T.texture(T.textCanvas(o.text || '', { w: 512, h: 160, color: '#b3261e', size: 0.7 }), { clamp: true });
      const lbl = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.82), new THREE.MeshStandardMaterial({ map: txt, transparent: true, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2 }));
      lbl.position.set(0, 1.15, 0.86);
      g.add(lbl);
    } else if (o.type === 'flagpole') {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.1, 12, 10), mat('#d7dadd', { metalness: 0.8, roughness: 0.3 }));
      pole.position.y = 6;
      g.add(pole);
    }
    shadowAll(g);
    g.position.set(o.x, h, -o.y);
    g.rotation.y = o.angle || 0;
    return g;
  };

  // ---------- 桥（景观天桥等），并登记可行走桥面 ----------
  Props.bridges = function (data, terrain) {
    const group = new THREE.Group();
    const decks = [];
    const deckMat = mat('#c9c4b8', { roughness: 0.85 });
    const railMat = mat('#e8e8e2', { roughness: 0.5, metalness: 0.4 });
    const pierMat = mat('#bdb8ad', { roughness: 0.9 });
    const glassMat = new THREE.MeshStandardMaterial({ color: '#a9c4cf', transparent: true, opacity: 0.35, roughness: 0.1, metalness: 0.2, depthWrite: false });
    for (const r of data.roads) {
      if (r.bridge !== 'yes' || (r.layer && Number(r.layer) < 0)) continue;
      const pts = P.resampleLine(r.pts, 1.5);
      const L = P.polylineLength(pts);
      if (L < 4) continue;
      const foot = r.hw === 'footway' || r.hw === 'path' || r.hw === 'steps';
      const w = foot ? 3.2 : 5.5;
      // 端点稍向外取地面高
      const h0 = terrain.height(pts[0][0], pts[0][1]), h1 = terrain.height(pts[pts.length - 1][0], pts[pts.length - 1][1]);
      const clear = foot ? 4.8 : 1.0;
      const maxSlope = foot ? 0.58 : 0.12; // 人行天桥两端为约 30° 的台阶，车行桥为缓坡
      let acc = 0;
      const ts = [];
      for (let i = 0; i < pts.length; i++) {
        if (i) acc += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
        ts.push(acc / L);
      }
      let top = Math.max(h0, h1);
      for (let i = 1; i < pts.length - 1; i++) {
        const t = ts[i];
        if (t < 0.2 || t > 0.8) continue;
        top = Math.max(top, terrain.height(pts[i][0], pts[i][1]) + clear);
      }
      const deckH = (t) => Math.min(top, lerp(h0, h1, t) + maxSlope * Math.min(t, 1 - t) * L) + 0.1;
      const deck = { pts, ts, w, L, deckH, name: r.name };
      decks.push(deck);
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1];
        const ha = deckH(ts[i]), hb = deckH(ts[i + 1]);
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
        const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], hm = (ha + hb) / 2;
        const pitch = Math.atan2(hb - ha, len);
        const seg = new THREE.Mesh(new THREE.BoxGeometry(len + 0.05, 0.35, w), deckMat);
        seg.position.set(mid[0], hm - 0.18, -mid[1]);
        seg.rotation.set(0, ang, pitch, 'YZX');
        group.add(seg);
        // 坡段做成踏步
        if (foot && Math.abs(hb - ha) / len > 0.15) {
          const nStep = Math.max(1, Math.round(Math.abs(hb - ha) / 0.16));
          for (let k = 0; k < nStep; k++) {
            const f0 = (k + 0.5) / nStep;
            const sx = lerp(a[0], b[0], f0), sy = lerp(a[1], b[1], f0);
            const sh = lerp(ha, hb, Math.round(f0 * nStep) / nStep);
            const st = new THREE.Mesh(new THREE.BoxGeometry(len / nStep + 0.01, 0.16, w - 0.1), deckMat);
            st.position.set(sx, sh - 0.02, -sy);
            st.rotation.y = ang;
            group.add(st);
          }
        }
        for (const s of [-1, 1]) {
          const ox = -Math.sin(ang) * s * (w / 2 - 0.08), oy = Math.cos(ang) * s * (w / 2 - 0.08);
          const rail = new THREE.Mesh(new THREE.BoxGeometry(len + 0.05, 0.08, 0.08), railMat);
          rail.position.set(mid[0] + ox, hm + 1.1, -(mid[1] + oy));
          rail.rotation.set(0, ang, pitch, 'YZX');
          group.add(rail);
          const glass = new THREE.Mesh(new THREE.BoxGeometry(len + 0.05, 0.9, 0.03), glassMat);
          glass.position.set(mid[0] + ox, hm + 0.6, -(mid[1] + oy));
          glass.rotation.set(0, ang, pitch, 'YZX');
          group.add(glass);
        }
      }
      // 桥墩
      for (const t of [0.33, 0.67]) {
        const i = ts.findIndex((v) => v >= t);
        if (i < 0) continue;
        const p = pts[i], dh = deckH(ts[i]), gh = terrain.height(p[0], p[1]);
        if (dh - gh < 2.5) continue;
        const pier = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.4, dh - gh + 0.5, 12), pierMat);
        pier.position.set(p[0], (dh + gh) / 2 - 0.3, -p[1]);
        group.add(pier);
      }
    }
    shadowAll(group);
    return { group, decks };
  };
  // 桥面高度查询（第一人称行走）
  Props.deckHeight = function (decks, x, y, feet) {
    let best = null;
    for (const d of decks) {
      const pts = d.pts;
      for (let i = 0; i < pts.length - 1; i++) {
        const out = [0, 0];
        const d2 = P.closestOnSeg(x, y, pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], out);
        if (d2 > (d.w / 2) * (d.w / 2)) continue;
        const sl = Math.hypot(pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]) || 1;
        const f = Math.hypot(out[0] - pts[i][0], out[1] - pts[i][1]) / sl;
        const h = d.deckH(lerp(d.ts[i], d.ts[i + 1], f));
        if (h <= feet + 0.9 && (best === null || h > best)) best = h;
      }
    }
    return best;
  };

  // ---------- 台阶（依据 OSM highway=steps，沿地形生成踏步、侧墙与扶手） ----------
  Props.stairs = function (data, terrain) {
    const group = new THREE.Group();
    const stoneMat = mat('#b9b3a6', { roughness: 0.9 });
    const cheekMat = mat('#8f8a80', { roughness: 0.95 });
    const railMat = mat('#c9ccd0', { roughness: 0.4, metalness: 0.7 });
    const box = new THREE.BoxGeometry(1, 1, 1);
    for (const r of data.roads) {
      if (r.hw !== 'steps' || !JZ.roadVisible(r)) continue;
      const pts = r.pts;
      const L = P.polylineLength(pts);
      if (L < 1.5) continue;
      const h0 = terrain.height(pts[0][0], pts[0][1]), h1 = terrain.height(pts[pts.length - 1][0], pts[pts.length - 1][1]);
      const rise = Math.abs(h1 - h0);
      const n = Math.max(2, Math.round(rise / 0.16));
      const w = 2.6, run = L / n;
      for (let i = 0; i < n; i++) {
        const [x, y, ang] = P.pointAlong(pts, (i + 0.5) * run);
        const ht = h0 + ((h1 - h0) * (i + 0.5)) / n;
        const top = Math.max(ht, terrain.height(x, y) + 0.02);
        const tread = new THREE.Mesh(box, stoneMat);
        tread.scale.set(run + 0.02, 1.6, w);
        tread.position.set(x, top - 0.8, -y);
        tread.rotation.y = ang;
        group.add(tread);
        // 两侧挡墙与扶手
        for (const s of [-1, 1]) {
          const ox = -Math.sin(ang) * s * (w / 2 + 0.12), oy = Math.cos(ang) * s * (w / 2 + 0.12);
          const cheek = new THREE.Mesh(box, cheekMat);
          cheek.scale.set(run + 0.02, 2.2, 0.24);
          cheek.position.set(x + ox, top - 0.75, -(y + oy));
          cheek.rotation.y = ang;
          group.add(cheek);
          if (r.handrail === 'yes' || L > 6) {
            const rail = new THREE.Mesh(box, railMat);
            rail.scale.set(run + 0.02, 0.05, 0.05);
            rail.position.set(x + ox, top + 0.95, -(y + oy));
            rail.rotation.y = ang;
            group.add(rail);
            if (i % 4 === 0) {
              const post = new THREE.Mesh(box, railMat);
              post.scale.set(0.05, 0.95, 0.05);
              post.position.set(x + ox, top + 0.47, -(y + oy));
              group.add(post);
            }
          }
        }
      }
    }
    group.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    return group;
  };

  // ---------- 路灯 ----------
  Props.lamps = function (data, terrain, zone, obstacles) {
    const spots = [];
    const rand = JZ.rng(77);
    const grid = new JZ.Grid(data.region[0], data.region[1], data.region[2], data.region[3], 30);
    obstacles.forEach((o) => grid.insert(o, o.bb));
    const buf = [];
    const blockedAt = (x, y) => {
      grid.query(x, y, 2, buf);
      return buf.some((o) => P.contains(o.pts, x, y) || P.distToRing(o.pts, x, y) < 1.0);
    };
    for (const r of data.roads) {
      if (!JZ.roadVisible(r)) continue;
      if (!['service', 'footway', 'pedestrian', 'unclassified', 'tertiary', 'residential', 'path'].includes(r.hw)) continue;
      const st = JZ.ROAD_STYLE[r.hw] || JZ.ROAD_STYLE.footway;
      const L = P.polylineLength(r.pts);
      const gap = r.hw === 'footway' || r.hw === 'path' ? 22 : 28;
      for (let d = gap * (0.3 + rand() * 0.5); d < L; d += gap) {
        const [x, y, ang] = P.pointAlong(r.pts, d);
        if (!zone.contains(x, y)) continue;
        const s = rand() < 0.5 ? 1 : -1;
        const off = st.w / 2 + 0.7;
        const lx = x - Math.sin(ang) * off * s, ly = y + Math.cos(ang) * off * s;
        if (blockedAt(lx, ly) || terrain.waterAt(lx, ly)) continue;
        spots.push({ x: lx, y: ly, h: terrain.height(lx, ly), ang: ang + (s > 0 ? -Math.PI / 2 : Math.PI / 2) });
      }
    }
    const group = new THREE.Group();
    if (!spots.length) return { group, spots, headMat: null };
    const poleGeo = new THREE.CylinderGeometry(0.05, 0.08, 4.6, 8);
    poleGeo.translate(0, 2.3, 0);
    const headGeo = new THREE.BoxGeometry(0.55, 0.16, 0.28);
    headGeo.translate(0.22, 4.55, 0);
    const poles = new THREE.InstancedMesh(poleGeo, mat('#3c4248', { metalness: 0.6, roughness: 0.45 }), spots.length);
    const headMat = new THREE.MeshStandardMaterial({ color: '#e9e6dc', emissive: '#ffd8a0', emissiveIntensity: 0, roughness: 0.4 });
    const heads = new THREE.InstancedMesh(headGeo, headMat, spots.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), one = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
    spots.forEach((s, i) => {
      e.set(0, s.ang, 0);
      m4.compose(p.set(s.x, s.h - 0.05, -s.y), q.setFromEuler(e), one);
      poles.setMatrixAt(i, m4);
      heads.setMatrixAt(i, m4);
    });
    poles.castShadow = true;
    heads.castShadow = false;
    group.add(poles, heads);
    return { group, spots, headMat };
  };

  // ---------- 对岸城市（汕头老市区一带，程序化示意） ----------
  Props.farCity = function (terrain) {
    const fac = T.facade('residential');
    const facO = T.facade('office');
    const acc = new JZ.Acc(), accO = new JZ.Acc(), roofs = new JZ.Acc();
    const rand = JZ.rng(1888);
    const tint = new THREE.Color();
    const roofC = new THREE.Color('#bdb9b0');
    let n = 0;
    for (let y = 1700; y < 4000; y += 34)
      for (let x = -4000; x < 4000; x += 34) {
        const jx = x + rand() * 18, jy = y + rand() * 18;
        const hOrig = terrain.wideBase(jx, jy);
        if (hOrig < 1.5 || hOrig > 40) continue;
        const hg = terrain.farHeight(jx, jy);
        if (hg < 0.5) continue;
        if (rand() > 0.42) continue;
        const dist = Math.hypot(jx, jy);
        const tower = rand() < 0.08;
        const fl = tower ? 18 + Math.floor(rand() * 18) : 4 + Math.floor(rand() * 8);
        const H = fl * 3.1;
        const w = tower ? 18 + rand() * 10 : 12 + rand() * 18, d = tower ? 18 + rand() * 10 : 10 + rand() * 16;
        const ang = (rand() - 0.5) * 0.25 + (jx < 0 ? -0.28 : 0.1);
        const target = tower ? accO : acc;
        tint.setHSL(0.08 + rand() * 0.06, 0.12 + rand() * 0.12, 0.72 + rand() * 0.15, THREE.SRGBColorSpace);
        const cs = Math.cos(ang), sn = Math.sin(ang);
        const c = [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map(([u, v]) => [jx + u * cs - v * sn, jy + u * sn + v * cs]);
        const y0 = hg - 1, y1 = hg + H;
        for (let i = 0; i < 4; i++) {
          const a = c[i], b = c[(i + 1) % 4];
          const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
          const u1 = Math.max(1, Math.round(L / 3.3)) / 4, v1 = H / 3.1 / 4;
          target.quad([a[0], y0, -a[1]], [b[0], y0, -b[1]], [b[0], y1, -b[1]], [a[0], y1, -a[1]], [0, 0], [u1, 0], [u1, v1], [0, v1], tint, 0);
        }
        roofs.quad([c[0][0], y1, -c[0][1]], [c[1][0], y1, -c[1][1]], [c[2][0], y1, -c[2][1]], [c[3][0], y1, -c[3][1]], [0, 0], [1, 0], [1, 1], [0, 1], roofC, 0);
        n++;
        if (dist > 1e9) break;
      }
    const group = new THREE.Group();
    const mk = (a, f) => {
      if (a.empty) return;
      const m = new THREE.MeshStandardMaterial({ map: f.map, roughnessMap: f.orm, metalnessMap: f.orm, emissiveMap: f.emis, emissive: 0xffffff, emissiveIntensity: 0, vertexColors: true, roughness: 1, metalness: 1 });
      m.userData.night = true;
      const mesh = new THREE.Mesh(a.geometry(), m);
      mesh.receiveShadow = false;
      group.add(mesh);
    };
    mk(acc, fac);
    mk(accO, facO);
    if (!roofs.empty) group.add(new THREE.Mesh(roofs.geometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 })));
    group.name = 'far-city';
    return { group, count: n };
  };

  // ---------- 港湾船只（装饰，缓慢移动） ----------
  Props.boats = function () {
    const group = new THREE.Group();
    const boats = [];
    const hullM = mat('#2f3f4f', { roughness: 0.6 }), hullR = mat('#8b2a22', { roughness: 0.6 }), white = mat('#eeeeea', { roughness: 0.5 });
    const defs = [
      { x0: -560, y0: 760, x1: -900, y1: 1900, len: 32, kind: 'ferry', speed: 0.004 },
      { x0: 600, y0: 1100, x1: -2600, y1: 1350, len: 70, kind: 'cargo', speed: 0.0012 },
      { x0: -1800, y0: 1500, x1: 2600, y1: 1250, len: 45, kind: 'cargo', speed: 0.0016 },
      { x0: 200, y0: 1500, x1: 1200, y1: 900, len: 14, kind: 'small', speed: 0.006 },
    ];
    for (const d of defs) {
      const g = new THREE.Group();
      const L = d.len, W = L * (d.kind === 'cargo' ? 0.16 : 0.3);
      const hull = new THREE.Mesh(new THREE.BoxGeometry(L, 2.2, W), d.kind === 'cargo' ? hullR : hullM);
      hull.position.y = 0.6;
      const bow = new THREE.Mesh(new THREE.CylinderGeometry(W / 2, W / 2, 2.2, 3, 1), hull.material);
      bow.rotation.y = Math.PI / 2;
      bow.position.set(L / 2, 0.6, 0);
      bow.scale.set(1, 1, 0.9);
      g.add(hull, bow);
      if (d.kind === 'ferry') {
        const deck = new THREE.Mesh(new THREE.BoxGeometry(L * 0.8, 2.4, W * 0.95), white);
        deck.position.y = 2.9;
        const bridge = new THREE.Mesh(new THREE.BoxGeometry(L * 0.2, 1.6, W * 0.6), white);
        bridge.position.set(0, 4.9, 0);
        g.add(deck, bridge);
      } else if (d.kind === 'cargo') {
        const colors = ['#2f6fa8', '#c0392b', '#e1a32b', '#3a8f5c', '#7d7f84'];
        for (let i = 0; i < 6; i++) {
          const cont = new THREE.Mesh(new THREE.BoxGeometry(L * 0.1, 2.4, W * 0.8), mat(colors[i % colors.length]));
          cont.position.set(-L * 0.3 + i * L * 0.11, 2.9, 0);
          g.add(cont);
        }
        const br = new THREE.Mesh(new THREE.BoxGeometry(L * 0.1, 6, W * 0.9), white);
        br.position.set(-L * 0.42, 4.6, 0);
        g.add(br);
      } else {
        const cab = new THREE.Mesh(new THREE.BoxGeometry(L * 0.35, 1.4, W * 0.7), white);
        cab.position.set(-L * 0.1, 2.2, 0);
        g.add(cab);
      }
      group.add(g);
      boats.push({ g, d, t: Math.random() });
    }
    const update = (dt) => {
      for (const b of boats) {
        b.t += b.d.speed * dt;
        const ph = b.t % 2;
        const f = ph < 1 ? ph : 2 - ph;
        const s = f * f * (3 - 2 * f);
        const x = lerp(b.d.x0, b.d.x1, s), y = lerp(b.d.y0, b.d.y1, s);
        const dir = ph < 1 ? 1 : -1;
        b.g.position.set(x, 0, -y);
        b.g.rotation.y = Math.atan2((b.d.y1 - b.d.y0) * dir, (b.d.x1 - b.d.x0) * dir);
        b.g.position.y = Math.sin(performance.now() * 0.001 + b.d.len) * 0.15;
      }
    };
    return { group, update };
  };
})();
