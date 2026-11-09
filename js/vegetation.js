/* 植被：依据卫星影像植被分布放置乔木/棕榈/松树/灌木（实例化 + 分块视锥剔除 + 远近两级细节），并点缀礐石花岗岩巨石 */
(function () {
  'use strict';
  const JZ = window.JZ;
  const P = JZ.poly;
  const T = JZ.Tex;
  const { smoothstep } = JZ.math;

  function jitterGeo(geo, amt, seed) {
    const rand = JZ.rng(seed);
    const p = geo.attributes.position;
    const map = new Map();
    for (let i = 0; i < p.count; i++) {
      const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
      if (!map.has(key)) map.set(key, 1 + (rand() - 0.5) * amt);
      const s = map.get(key);
      p.setXYZ(i, p.getX(i) * s, p.getY(i) * s, p.getZ(i) * s);
    }
    geo.computeVertexNormals();
    return geo;
  }
  function merge(geos) {
    const parts = geos.map((g) => (g.index ? g.toNonIndexed() : g));
    let n = 0;
    parts.forEach((g) => (n += g.attributes.position.count));
    const pos = new Float32Array(n * 3), nrm = new Float32Array(n * 3), uv = new Float32Array(n * 2);
    let o = 0;
    for (const g of parts) {
      pos.set(g.attributes.position.array, o * 3);
      nrm.set(g.attributes.normal.array, o * 3);
      if (g.attributes.uv) uv.set(g.attributes.uv.array, o * 2);
      o += g.attributes.position.count;
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    return out;
  }
  JZ.mergeGeos = merge;

  // 将一组静态物体按材质合并，大幅减少绘制调用
  JZ.batchGroup = function (root) {
    root.updateMatrixWorld(true);
    const byMat = new Map();
    root.traverse((o) => {
      if (!o.isMesh || o.isInstancedMesh) return;
      const g = o.geometry.clone().applyMatrix4(o.matrixWorld);
      if (!g.attributes.normal) g.computeVertexNormals();
      let e = byMat.get(o.material);
      if (!e) byMat.set(o.material, (e = { geos: [], cast: false, recv: false }));
      e.geos.push(g);
      e.cast = e.cast || o.castShadow;
      e.recv = e.recv || o.receiveShadow;
    });
    const out = new THREE.Group();
    out.name = (root.name || 'group') + '-batched';
    for (const [mat, e] of byMat) {
      const mesh = new THREE.Mesh(merge(e.geos), mat);
      mesh.castShadow = e.cast;
      mesh.receiveShadow = e.recv;
      out.add(mesh);
    }
    return out;
  };

  // 树冠：主团 + 若干小团（detail 控制精细度）
  function crownGeo(details, seed) {
    const rand = JZ.rng(seed);
    const gs = [];
    details.forEach((det, i) => {
      const g = jitterGeo(new THREE.IcosahedronGeometry(1, det), det === 0 ? 0.42 : 0.32, seed + i);
      const s = i === 0 ? 1 : 0.55 + rand() * 0.3;
      g.scale(s, s * 0.85, s);
      const a = rand() * Math.PI * 2, r = i === 0 ? 0 : 0.45 + rand() * 0.25;
      g.translate(Math.cos(a) * r, i === 0 ? 0 : (rand() - 0.3) * 0.5, Math.sin(a) * r);
      gs.push(g);
    });
    const m = merge(gs);
    m.translate(0, 0.85, 0);
    return m;
  }
  function palmGeo() {
    const leaves = [];
    for (let i = 0; i < 8; i++) {
      const g = new THREE.PlaneGeometry(0.7, 4.2, 1, 4);
      const p = g.attributes.position;
      for (let k = 0; k < p.count; k++) {
        const y = p.getY(k) + 2.1;
        const t = y / 4.2;
        p.setX(k, p.getX(k) * (1 - t * 0.8));
        p.setZ(k, -t * t * 2.2);
        p.setY(k, y);
      }
      g.rotateX(-Math.PI / 2.6);
      g.rotateY((i / 8) * Math.PI * 2 + i * 0.3);
      g.computeVertexNormals();
      leaves.push(g);
    }
    return merge(leaves);
  }
  function pineGeo() {
    const gs = [];
    for (let i = 0; i < 3; i++) {
      const r = 1 - i * 0.25, h = 1.1 - i * 0.15;
      const g = new THREE.ConeGeometry(r, h, 6, 1, true);
      g.translate(0, 0.45 + i * 0.5 + h / 2, 0);
      gs.push(jitterGeo(g, 0.15, 30 + i));
    }
    return merge(gs);
  }
  function leafTexture() {
    const S = 256, c = T.canvas(S), g = c.getContext('2d');
    g.fillStyle = '#d8d8d8';
    g.fillRect(0, 0, S, S);
    const rand = JZ.rng(12);
    for (let i = 0; i < 2600; i++) {
      const v = 120 + rand() * 135;
      g.fillStyle = `rgba(${v},${v},${v},0.9)`;
      const x = rand() * S, y = rand() * S, r = 2 + rand() * 5;
      g.beginPath();
      g.ellipse(x, y, r, r * 0.6, rand() * Math.PI, 0, Math.PI * 2);
      g.fill();
    }
    return T.texture(c);
  }
  function rockGeo(seed) {
    const g = jitterGeo(new THREE.IcosahedronGeometry(1, 1), 0.55, seed);
    g.scale(1, 0.62, 0.85);
    g.computeVertexNormals();
    return g;
  }

  const Veg = (JZ.Vegetation = {});

  Veg.build = function (ctx) {
    const { data, terrain, lc, blocked, campusZone } = ctx;
    const [rx0, ry0, rx1, ry1] = data.region;
    const rand = JZ.rng(2024);
    const leafTex = leafTexture();
    // 植被数量大，使用开销较低的 Lambert 光照
    const crownMat = new THREE.MeshLambertMaterial({ map: leafTex });
    const trunkMat = new THREE.MeshLambertMaterial({ color: '#5b4a3c' });
    const palmLeafMat = new THREE.MeshLambertMaterial({ color: '#ffffff', side: THREE.DoubleSide });
    const palmTrunkMat = new THREE.MeshLambertMaterial({ color: '#8a7b68' });
    const rockMat = new THREE.MeshLambertMaterial({ color: '#b3ab9c', flatShading: true });
    const geos = {
      crownNear: crownGeo([1, 0, 0], 7),
      crownFar: crownGeo([0, 0], 17),
      crownHill: crownGeo([0], 27),
      trunk: (() => { const g = new THREE.CylinderGeometry(0.55, 1, 1, 6, 1, true); g.translate(0, 0.5, 0); return g; })(),
      palmLeaves: palmGeo(),
      palmTrunk: (() => { const g = new THREE.CylinderGeometry(0.7, 1, 1, 6, 3, true); g.translate(0, 0.5, 0); return g; })(),
      pine: pineGeo(),
      shrub: (() => { const g = jitterGeo(new THREE.IcosahedronGeometry(1, 1), 0.3, 55); g.scale(1, 0.7, 1); g.translate(0, 0.55, 0); return g; })(),
      rocks: [rockGeo(91), rockGeo(92), rockGeo(93)],
    };

    // 道路距离查询（用于行道树/棕榈）
    const roadGrid = new JZ.Grid(rx0, ry0, rx1, ry1, 25);
    for (const r of data.roads) {
      if (!JZ.roadVisible(r)) continue;
      for (let i = 0; i < r.pts.length - 1; i++) {
        const a = r.pts[i], b = r.pts[i + 1];
        roadGrid.insert({ a, b, w: (JZ.ROAD_STYLE[r.hw] || JZ.ROAD_STYLE.footway).w }, [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])]);
      }
    }
    const qbuf = [];
    const nearRoad = (x, y, d) => {
      roadGrid.query(x, y, d + 8, qbuf);
      let best = Infinity;
      for (const s of qbuf) {
        const dd = Math.sqrt(P.closestOnSeg(x, y, s.a[0], s.a[1], s.b[0], s.b[1])) - s.w / 2;
        if (dd < best) best = dd;
      }
      return best;
    };

    // 分块：校园区块小（便于近/远细节切换），山林区块大
    const chunks = new Map();
    const chunk = (x, y, fine) => {
      const CH = fine ? 190 : 380;
      const i = Math.floor((x - rx0) / CH), j = Math.floor((y - ry0) / CH);
      const k = (fine ? 'f' : 'c') + i + ',' + j;
      if (!chunks.has(k)) chunks.set(k, { fine, cx: rx0 + (i + 0.5) * CH, cy: ry0 + (j + 0.5) * CH, hi: [], lo: [], palm: [], pine: [], shrub: [] });
      return chunks.get(k);
    };
    const rocks = [];
    const trunks = [];
    const gardenAreas = data.areas.filter((a) => ['garden', 'park', 'grass'].includes(a.kind));

    const tryPlace = (x, y, inCampus) => {
      if (blocked.at(x, y)) return;
      const h = terrain.height(x, y);
      if (h < 1.2) return;
      if (terrain.waterAt(x, y)) return;
      const veg = lc.get(x, y, 0);
      const dark = lc.get(x, y, 2);
      const pv = inCampus ? smoothstep(0.28, 0.72, veg + dark * 0.25) : smoothstep(0.12, 0.5, veg + dark * 0.3);
      if (rand() > pv) return;
      const ck = chunk(x, y, inCampus);
      if (inCampus) {
        const dr = nearRoad(x, y, 6);
        if (dr < 4.5 && rand() < 0.22) {
          ck.palm.push({ x, y, h, s: 8 + rand() * 6, rot: rand() * 6.28 });
          trunks.push({ x, y, r: 0.3 });
          return;
        }
        const cr = 2.2 + rand() * 2.8;
        ck.hi.push({ x, y, h, cr, ch: cr * (0.75 + rand() * 0.25), tr: 2.2 + rand() * 1.8, rot: rand() * 6.28, hue: rand() });
        trunks.push({ x, y, r: 0.35 + cr * 0.04 });
      } else if (rand() < 0.2) {
        ck.pine.push({ x, y, h, s: 7 + rand() * 7, rot: rand() * 6.28, hue: rand() });
      } else {
        const cr = 3.8 + rand() * 3.0;
        ck.lo.push({ x, y, h, cr, ch: cr * (0.7 + rand() * 0.3), tr: 1.4 + rand() * 1.4, rot: rand() * 6.28, hue: rand() });
      }
    };

    const cz = campusZone;
    for (let y = cz.bb[1]; y < cz.bb[3]; y += 4.8)
      for (let x = cz.bb[0]; x < cz.bb[2]; x += 4.8) {
        const jx = x + (rand() - 0.5) * 3.8, jy = y + (rand() - 0.5) * 3.8;
        if (!cz.contains(jx, jy)) continue;
        tryPlace(jx, jy, true);
      }
    for (let y = ry0 + 3; y < ry1; y += 8.6)
      for (let x = rx0 + 3; x < rx1; x += 8.6) {
        const jx = x + (rand() - 0.5) * 7, jy = y + (rand() - 0.5) * 7;
        if (cz.contains(jx, jy)) continue;
        tryPlace(jx, jy, false);
      }
    for (const a of gardenAreas) {
      if (!cz.contains(...P.centroid(a.pts))) continue;
      const bb = P.bbox(a.pts);
      for (let y = bb[1]; y < bb[3]; y += 3.2)
        for (let x = bb[0]; x < bb[2]; x += 3.2) {
          const jx = x + rand() * 2, jy = y + rand() * 2;
          if (!P.contains(a.pts, jx, jy) || rand() < 0.55) continue;
          if (blocked.at(jx, jy)) continue;
          chunk(jx, jy, true).shrub.push({ x: jx, y: jy, h: terrain.height(jx, jy), s: 0.7 + rand() * 0.8, rot: rand() * 6.28, hue: rand() });
        }
    }
    // 花岗岩巨石：卫星影像中山坡上的裸露亮斑（礐石以“石”得名）
    for (let y = ry0; y < ry1 && rocks.length < 650; y += 6)
      for (let x = rx0; x < rx1; x += 6) {
        const jx = x + rand() * 5, jy = y + rand() * 5;
        const rk = lc.get(jx, jy, 1);
        if (rk < 0.35 || cz.contains(jx, jy) || blocked.at(jx, jy)) continue;
        const h = terrain.height(jx, jy);
        if (h < 25 || rand() > rk) continue;
        rocks.push({ x: jx, y: jy, h, s: 1 + rand() * 2.8, rot: rand() * 6.28, v: Math.floor(rand() * 3) });
      }

    // ---- 实例网格 ----
    const group = new THREE.Group();
    group.name = 'vegetation';
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const col = new THREE.Color();
    const leafColor = (hue, hills) => {
      const hh = hills ? 0.25 + hue * 0.07 : 0.22 + hue * 0.1;
      const ss = hills ? 0.38 : 0.42 + hue * 0.1;
      const ll = hills ? 0.2 + hue * 0.07 : 0.24 + hue * 0.1;
      return col.setHSL(hh, ss, ll, THREE.SRGBColorSpace);
    };
    const inst = (geo, mat, list, setup, castShadow, colorFn, parent) => {
      if (!list.length) return null;
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((it, i) => {
        setup(it, i);
        im.setMatrixAt(i, m4);
        if (colorFn) im.setColorAt(i, colorFn(it, i));
      });
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.castShadow = castShadow;
      im.receiveShadow = true;
      im.computeBoundingSphere();
      (parent || group).add(im);
      return im;
    };
    const crownSetup = (t) => {
      e.set(0, t.rot, 0);
      m4.compose(p.set(t.x, t.h + t.tr, -t.y), q.setFromEuler(e), s.set(t.cr, t.ch, t.cr));
    };
    const lods = [];
    let count = 0;
    for (const ck of chunks.values()) {
      count += ck.hi.length + ck.lo.length + ck.palm.length + ck.pine.length;
      const near = new THREE.Group(), far = new THREE.Group();
      group.add(near, far);
      // 校园乔木：近处精细树冠+树干，远处简化树冠
      inst(geos.trunk, trunkMat, ck.hi, (t) => {
        m4.compose(p.set(t.x, t.h - 0.2, -t.y), q.identity(), s.set(0.22 + t.cr * 0.03, t.tr + t.ch * 0.4, 0.22 + t.cr * 0.03));
      }, true, null, near);
      inst(geos.crownNear, crownMat, ck.hi, crownSetup, true, (t) => leafColor(t.hue, false), near);
      inst(geos.crownFar, crownMat, ck.hi, crownSetup, true, (t) => leafColor(t.hue, false), far);
      // 山林阔叶林（树干几乎被遮挡，仅近处显示）
      inst(geos.trunk, trunkMat, ck.lo, (t) => {
        m4.compose(p.set(t.x, t.h - 0.2, -t.y), q.identity(), s.set(0.25, t.tr + t.ch * 0.3, 0.25));
      }, false, null, near);
      inst(geos.crownFar, crownMat, ck.lo, crownSetup, true, (t) => leafColor(t.hue, true), near);
      inst(geos.crownHill, crownMat, ck.lo, crownSetup, true, (t) => leafColor(t.hue, true), far);
      inst(geos.pine, crownMat, ck.pine, (t) => {
        e.set(0, t.rot, 0);
        m4.compose(p.set(t.x, t.h - 0.2, -t.y), q.setFromEuler(e), s.set(t.s * 0.33, t.s * 0.75, t.s * 0.33));
      }, true, (t) => col.setHSL(0.3 + t.hue * 0.05, 0.35, 0.17 + t.hue * 0.05, THREE.SRGBColorSpace));
      // 棕榈
      inst(geos.palmTrunk, palmTrunkMat, ck.palm, (t) => {
        m4.compose(p.set(t.x, t.h - 0.2, -t.y), q.identity(), s.set(0.22, t.s, 0.22));
      }, true);
      inst(geos.palmLeaves, palmLeafMat, ck.palm, (t) => {
        e.set(0, t.rot, 0);
        m4.compose(p.set(t.x, t.h + t.s - 0.3, -t.y), q.setFromEuler(e), s.set(1, 1, 1));
      }, true, (t, i) => col.setHSL(0.26 + (i % 5) * 0.012, 0.45, 0.28, THREE.SRGBColorSpace));
      // 灌木
      inst(geos.shrub, crownMat, ck.shrub, (t) => {
        e.set(0, t.rot, 0);
        m4.compose(p.set(t.x, t.h - 0.1, -t.y), q.setFromEuler(e), s.set(t.s, t.s, t.s));
      }, false, (t) => leafColor(t.hue * 0.6 + 0.3, false), near);
      lods.push({ cx: ck.cx, cy: ck.cy, near, far, isNear: null, fine: ck.fine });
    }
    for (let v = 0; v < 3; v++) {
      inst(geos.rocks[v], rockMat, rocks.filter((r) => r.v === v), (t) => {
        e.set(0, t.rot, 0);
        m4.compose(p.set(t.x, t.h + t.s * 0.15, -t.y), q.setFromEuler(e), s.set(t.s, t.s, t.s));
      }, true);
    }
    // 依据相机距离切换细节；返回是否有变化（用于刷新阴影）
    const updateLOD = (camPos) => {
      let changed = false;
      for (const l of lods) {
        const d = Math.hypot(l.cx - camPos.x, l.cy + camPos.z, (camPos.y - 40) * 0.7);
        const isNear = d < (l.fine ? 260 : 330);
        if (isNear !== l.isNear) {
          l.isNear = isNear;
          l.near.visible = isNear;
          l.far.visible = !isNear;
          changed = true;
        }
      }
      return changed;
    };
    return { group, trunks, count, rocks: rocks.length, updateLOD };
  };
})();
