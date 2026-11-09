/* 主程序：加载数据 → 地形 → 地表 → 建筑/运动场/景观/植被 → 环境 → 交互 */
(function () {
  'use strict';
  const JZ = window.JZ;
  const P = JZ.poly;
  const { clamp, lerp } = JZ.math;
  const LAT0 = 23.336468, LON0 = 116.677428, MLAT = 110748.6, MLON = 102263.6;

  const app = (JZ.app = {});
  const ui = (app.ui = new JZ.UI(app));
  const step = async (t, f) => { ui.progress(t, f); await JZ.nextFrame(); await JZ.nextFrame(); };

  async function init() {
    const data = window.CAMPUS_DATA, info = window.CAMPUS_INFO || { buildings: {}, landmarks: [] };
    if (!window.THREE || !data) { ui.error('three.js 或校园数据未能加载，请确认 lib/ 与 data/ 文件夹完整。'); return; }
    await step('初始化渲染器…', 0.03);
    const canvas = document.getElementById('scene');
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    } catch (e) {
      ui.error('无法创建 WebGL 渲染器，请使用新版 Chrome / Edge / Firefox 打开。');
      return;
    }
    // 依据显卡自动选择默认画质（集显默认“中”）
    let gpu = '';
    try {
      const gl = renderer.getContext();
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      gpu = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : '';
    } catch (e) { /* 忽略 */ }
    const weakGPU = /Intel|SwiftShader|llvmpipe|Mali|Adreno|PowerVR|Microsoft Basic/i.test(gpu);
    app.gpu = gpu;
    app.quality = localStorage.getItem('jz-quality') || (weakGPU ? 'medium' : 'high');
    const applyQuality = () => {
      const q = app.quality;
      renderer.setPixelRatio(Math.min(devicePixelRatio || 1, q === 'high' ? 2 : q === 'medium' ? 1 : 0.8));
      renderer.setSize(innerWidth, innerHeight, false);
      if (app.env) {
        const s = q === 'high' ? 4096 : q === 'medium' ? 2048 : 1024;
        if (app.env.sun.shadow.mapSize.x !== s) {
          app.env.sun.shadow.mapSize.set(s, s);
          if (app.env.sun.shadow.map) { app.env.sun.shadow.map.dispose(); app.env.sun.shadow.map = null; }
          app.env.shadowDirty = true;
        }
      }
      document.getElementById('btnQuality').textContent = '画质：' + { high: '高', medium: '中', low: '低' }[q];
    };
    applyQuality();
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = app.quality === 'high' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    renderer.shadowMap.autoUpdate = false; // 阴影仅在视点明显移动/时间变化时重绘
    JZ.maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.3, 40000);
    app.renderer = renderer; app.scene = scene; app.camera = camera; app.data = data;

    // ---- 地形与修整 ----
    await step('计算地形（SRTM 高程）…', 0.08);
    const terrain = (app.terrain = new JZ.Terrain(data));
    const blds = JZ.Buildings.prepare(data, info, terrain);
    for (const a of data.areas) {
      if (a.kind === 'plaza' || a.kind === 'parking') terrain.pad(a.pts, terrain.avgBase(a.pts), 1, 3.5, a.kind);
    }
    const sportsPrep = JZ.Sports.prepare(data, terrain);
    for (const a of data.areas) {
      if (a.kind === 'water' || a.kind === 'basin' || a.kind === 'pool') {
        const area = Math.abs(P.area(a.pts));
        terrain.addWater(a, a.kind === 'water' && area > 400 ? 'lake' : 'pool');
      }
    }
    terrain.bake();

    // ---- 地表纹理 ----
    await step('绘制地表（植被分布 / 道路 / 广场）…', 0.2);
    const lc = await JZ.Ground.loadLandcover(data);
    const built = JZ.Ground.builtMask(data, lc);
    const base = JZ.Ground.baseCanvas(data, lc, built);
    const coreRect = [-470, -370, 270, 370];
    const core = new JZ.Raster(coreRect, 4096);
    JZ.Ground.paint(core, data, base, { detail: true });
    await step('绘制地表（外围）…', 0.32);
    const wide = new JZ.Raster(data.region, 2048);
    JZ.Ground.paint(wide, data, base, { detail: false });
    const detailTex = JZ.Tex.detail();
    const coreTex = JZ.Tex.texture(core.c, { flipY: false, clamp: true });
    const wideTex = JZ.Tex.texture(wide.c, { flipY: false, clamp: true });
    const schoolArea = data.areas.find((a) => a.kind === 'school' && a.name === '汕头市金山中学');
    const sp = schoolArea ? schoolArea.pts : [[-300, -300], [130, -300], [130, 310], [-300, 310]];
    const sbb = P.bbox(sp);
    const groundMat = JZ.makeGroundMaterial(coreTex, coreRect, wideTex, data.region, detailTex, [sbb[0] - 30, sbb[1] - 30, sbb[2] + 30, sbb[3] + 30]);
    scene.add(terrain.buildFineMesh(groundMat));
    scene.add(terrain.buildWideMesh(JZ.makeFarMaterial(detailTex)));

    // ---- 水 ----
    const waterN = JZ.Tex.waterNormal();
    const seaN = waterN.clone();
    seaN.needsUpdate = true;
    seaN.repeat.set(900, 900);
    const seaMat = new THREE.MeshStandardMaterial({ color: '#3a5c60', roughness: 0.14, metalness: 0.05, normalMap: seaN, normalScale: new THREE.Vector2(0.55, 0.55) });
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(60000, 60000), seaMat);
    sea.rotation.x = -Math.PI / 2;
    sea.position.y = 0;
    sea.receiveShadow = true;
    scene.add(sea);
    const lakeMat = new THREE.MeshStandardMaterial({ color: '#2f4c40', roughness: 0.1, metalness: 0.05, normalMap: waterN, normalScale: new THREE.Vector2(0.25, 0.25) });
    const poolMat = new THREE.MeshStandardMaterial({ color: '#4aa3c2', roughness: 0.06, metalness: 0.05, normalMap: waterN, normalScale: new THREE.Vector2(0.15, 0.15) });
    scene.add(terrain.buildWaterMeshes(lakeMat, poolMat));

    // ---- 建筑 ----
    await step('生成建筑…', 0.45);
    const B = JZ.Buildings.build(blds, terrain, {});
    scene.add(B.group);
    app.buildings = blds;

    // ---- 运动场 ----
    await step('生成运动场与球场…', 0.52);
    const S = JZ.Sports.build(sportsPrep, terrain);
    scene.add(JZ.batchGroup(S.group));

    // ---- 校园范围 ----
    const zone = {
      bb: [sbb[0] - 70, sbb[1] - 70, sbb[2] + 70, sbb[3] + 70],
      contains(x, y) {
        if (x < this.bb[0] || x > this.bb[2] || y < this.bb[1] || y > this.bb[3]) return false;
        return P.contains(sp, x, y) || P.distToRing(sp, x, y) < 70;
      },
    };

    // ---- 景观 ----
    await step('布置景观小品与天桥…', 0.58);
    const labelItems = [];
    const landmarkGroup = new THREE.Group();
    const extraObstacles = [];
    for (const lm of info.landmarks || []) {
      const h = terrain.height(lm.x, lm.y);
      if (lm.type === 'gate') landmarkGroup.add(JZ.Props.gate(lm, terrain));
      else if (lm.type === 'pavilion') {
        landmarkGroup.add(JZ.Props.pavilion({ x: lm.x, y: lm.y, r: lm.r, sides: lm.sides, h, roofColor: lm.roofColor }));
      } else if (lm.type !== 'label') landmarkGroup.add(JZ.Props.sculpture(lm, terrain));
      if (lm.type === 'gate') {
        const cs = Math.cos(lm.angle || 0), sn = Math.sin(lm.angle || 0);
        for (const s of [-1, 1]) {
          const px = lm.x + cs * s * ((lm.span || 14) / 2 + 1), py = lm.y + sn * s * ((lm.span || 14) / 2 + 1);
          extraObstacles.push({ circle: true, x: px, y: py, r: 1.3 });
        }
      } else if (lm.type !== 'label' && lm.type !== 'pavilion') extraObstacles.push({ circle: true, x: lm.x, y: lm.y, r: lm.type === 'stone' ? 2.2 : 1.4 });
      if (lm.name) labelItems.push({ name: lm.name, x: lm.x, y: lm.y, h: h + (lm.type === 'label' ? 4 : lm.type === 'pavilion' ? 9 : 7), kind: 'landmark', cat: lm.cat, desc: lm.desc, pri: 2 });
    }
    const BR = JZ.Props.bridges(data, terrain);
    landmarkGroup.add(BR.group);
    landmarkGroup.add(JZ.Props.stairs(data, terrain));
    scene.add(JZ.batchGroup(landmarkGroup));

    // ---- 植被 ----
    await step('种植树木（依据卫星影像植被分布）…', 0.66);
    const extraBlock = [];
    if (sportsPrep.stadium) extraBlock.push(sportsPrep.stadium.area.pts);
    const blocked = JZ.Ground.blockedMask(data, extraBlock);
    const V = JZ.Vegetation.build({ data, terrain, lc, blocked, campusZone: zone });
    scene.add(V.group);
    console.info('[金中3D] 建筑', blds.length, '树木', V.count, '巨石', V.rocks);

    // ---- 路灯、对岸城市、船 ----
    await step('路灯、对岸天际线与港湾…', 0.78);
    const LM = JZ.Props.lamps(data, terrain, zone, B.obstacles);
    scene.add(LM.group);
    const FC = JZ.Props.farCity(terrain);
    scene.add(FC.group);
    const BO = JZ.Props.boats();
    scene.add(BO.group);

    // ---- 碰撞索引 ----
    const [rx0, ry0, rx1, ry1] = data.region;
    const grid = new JZ.Grid(rx0, ry0, rx1, ry1, 20);
    for (const o of B.obstacles) grid.insert(o, o.bb);
    for (const t of V.trunks) { const o = { circle: true, x: t.x, y: t.y, r: t.r }; grid.insert(o, [t.x - t.r, t.y - t.r, t.x + t.r, t.y + t.r]); }
    for (const o of extraObstacles) grid.insert(o, [o.x - o.r, o.y - o.r, o.x + o.r, o.y + o.r]);
    for (const s of LM.spots) { const o = { circle: true, x: s.x, y: s.y, r: 0.12 }; grid.insert(o, [s.x - 0.2, s.y - 0.2, s.x + 0.2, s.y + 0.2]); }
    app.grid = grid;

    // ---- 环境 ----
    await step('天空与光照…', 0.86);
    const env = (app.env = new JZ.Env(renderer, scene));
    applyQuality();
    const nightMats = [];
    scene.traverse((o) => { if (o.material && o.material.userData && o.material.userData.night) nightMats.push(o.material); });
    env.nightTargets.push((n) => {
      for (const m of nightMats) m.emissiveIntensity = n * 0.9;
      if (LM.headMat) LM.headMat.emissiveIntensity = n * 4;
    });
    const startHours = 10.5;
    env.setTime(startHours);
    env.updateEnvMap();

    // ---- 标注 ----
    const annB = info.buildings || {};
    const campusCats = new Set(['teach', 'life', 'sport', 'scene', 'west']);
    for (const L of B.labels) {
      const Bd = blds[L.bid];
      const a = annB[Bd.id] || {};
      const cat = a.cat || (zone.contains(Bd.c[0], Bd.c[1]) && P.contains(sp, Bd.c[0], Bd.c[1]) ? 'life' : 'around');
      labelItems.push({ name: L.name, x: L.x, y: L.y, h: L.h, kind: L.kind, bid: L.bid, cat, desc: a.desc, pri: campusCats.has(cat) ? 2 : 1 });
    }
    for (const L of S.labels) labelItems.push(Object.assign({ pri: 2 }, L));
    const lmNames = labelItems.map((l) => l.name);
    for (const p of data.pois) {
      if (!p.name || lmNames.some((n) => n.startsWith(p.name))) continue;
      const h = terrain.height(p.x, p.y);
      labelItems.push({ name: p.name + (p.ele ? `（${p.ele} m）` : ''), x: p.x, y: p.y, h: h + 10, kind: 'poi', cat: 'around', pri: 1, desc: p['name:en'] || '' });
    }
    for (const a of data.areas) {
      if (!a.name || a === schoolArea) continue;
      if (!['school', 'hospital', 'park', 'military'].includes(a.kind)) continue;
      const ar = Math.abs(P.area(a.pts));
      if (ar > 200000 || ar < 1500) continue;
      const c = P.centroid(a.pts);
      if (c[0] < rx0 || c[0] > rx1 || c[1] < ry0 || c[1] > ry1) continue;
      labelItems.push({ name: a.name, x: c[0], y: c[1], h: terrain.height(c[0], c[1]) + 12, kind: 'poi', cat: 'around', pri: 1 });
    }
    app.labelItems = labelItems;
    ui.initLabels(labelItems);
    ui.initPlaces(labelItems);
    if (innerWidth < 900) document.getElementById('places').classList.add('collapsed');
    ui.initMinimap(wide.c, data.region, blds, { school: sp });

    // ---- 相机控制 ----
    const rig = (app.rig = new JZ.Rig(camera, canvas, { terrain, obstacleGrid: grid, decks: BR.decks, bounds: data.region }));
    rig.target.set(-60, terrain.height(-60, 0), 0);
    rig.dist = 900;
    rig.setMode('top', { instant: true, force: true });
    rig.on('mode', (m) => {
      ui.setModeButtons(m === 'transition' ? rig._pendingMode || 'fps' : m);
      ui.fpsOverlay(m === 'fps' && !rig.locked);
      document.getElementById('crosshair').style.display = m === 'fps' ? 'block' : 'none';
    });
    rig.on('lock', (l) => ui.fpsOverlay(rig.mode === 'fps' && !l));
    rig.on('dblground', (p) => {
      if (rig.blocked(p.x, p.y)) { ui.toast('这里是水面，换个地方吧'); return; }
      rig.setMode('fps', { at: { x: p.x, y: p.y }, yaw: rig.yaw });
    });
    const raycaster = new THREE.Raycaster();
    const pickables = [];
    scene.traverse((o) => { if (o.isMesh && o.userData.pick) pickables.push(o); });
    rig.on('click', (e) => {
      const r = canvas.getBoundingClientRect();
      raycaster.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
      const hit = raycaster.intersectObjects(pickables, false)[0];
      if (!hit) { ui.showInfo(null); return; }
      let bid = hit.object.userData.bid;
      if (bid === undefined && hit.object.geometry.userData.faceBid) bid = hit.object.geometry.userData.faceBid[hit.faceIndex];
      if (bid === undefined) return;
      const Bd = blds[bid];
      let it = labelItems.find((l) => l.bid === bid);
      if (!it) {
        const typeName = { dormitory: '宿舍', school: '校舍', house: '住宅', residential: '住宅', apartments: '住宅楼', hospital: '医院建筑', industrial: '厂房' }[Bd.osm.building] || '建筑';
        it = { name: Bd.name || typeName + '（未命名）', x: Bd.c[0], y: Bd.c[1], h: Bd.top + 3, bid, cat: Bd.meta.cat };
      }
      ui.showInfo(it);
    });

    app.select = (it, focus) => {
      ui.showInfo(it);
      if (focus && rig.mode !== 'fps' && rig.mode !== 'transition') {
        const Bd = it.bid !== undefined ? blds[it.bid] : null;
        const size = Bd ? Math.sqrt(Bd.area) : 30;
        rig.flyTo(it.x, it.y, clamp(size * 4.5, 140, 420));
      }
    };
    app.viewpoint = (it) => {
      const Bd = it.bid !== undefined ? blds[it.bid] : null;
      let R = 7;
      const cx = it.x, cy = it.y;
      if (Bd) for (const p of Bd.pts) R = Math.max(R, Math.hypot(p[0] - cx, p[1] - cy) + 9);
      let best = null;
      const ref = Bd ? Bd.base : terrain.height(cx, cy);
      const buf = [];
      // 视线上的树干越多扣分越多；站在树荫/绿地里也略扣分
      const losPenalty = (x, y) => {
        let pen = 0;
        for (let s = 1; s <= 8; s++) {
          const px = lerp(x, cx, (s / 8) * 0.75), py = lerp(y, cy, (s / 8) * 0.75);
          grid.query(px, py, 3, buf);
          for (const o of buf) if (o.circle && Math.hypot(o.x - px, o.y - py) < 3 + o.r) pen++;
        }
        return pen + lc.get(x, y, 0) * 4;
      };
      for (let k = 0; k < 32; k++) {
        const a = (k / 32) * Math.PI * 2;
        for (const rr of [R, R + 6, R + 14]) {
          const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
          if (rig.blocked(x, y)) continue;
          const [qx, qy] = rig.resolve(x, y, -1e9);
          if (Math.hypot(qx - x, qy - y) > 0.01) continue;
          const score = Math.abs(terrain.height(x, y) - ref) * 0.8 + rr * 0.15 + losPenalty(x, y) * 1.5;
          if (!best || score < best.score) best = { x, y, score };
        }
      }
      if (!best) best = { x: cx, y: cy - R };
      const yaw = Math.atan2(-(cx - best.x), cy - best.y);
      return { x: best.x, y: best.y, yaw };
    };
    app.goTo = (it, how) => {
      if (how === 'walk') {
        const vp = app.viewpoint(it);
        rig.setMode('fps', { at: vp, yaw: vp.yaw, pitch: it.bid !== undefined ? 0.12 : -0.05, force: true });
      } else {
        const Bd = it.bid !== undefined ? blds[it.bid] : null;
        const size = Bd ? Math.sqrt(Bd.area) : 30;
        if (rig.mode === 'fps' || rig.mode === 'transition') rig.setMode('orbit', { target: new THREE.Vector3(it.x, terrain.height(it.x, it.y), -it.y), dist: clamp(size * 4, 120, 400), pitch: 0.55 });
        else rig.flyTo(it.x, it.y, clamp(size * 4.5, 140, 420));
      }
    };
    app.jumpTo = (x, y) => {
      if (rig.mode === 'fps') {
        const [fx, fy] = rig.findFree(x, y);
        rig.fp.x = fx; rig.fp.y = fy;
        rig.fp.feet = rig.groundAt(fx, fy, 1e9);
        rig.fp.camY = rig.fp.feet + 1.65;
        rig.fp.vz = 0;
      } else rig.flyTo(x, y);
    };
    const occBuf = [];
    app.occluded = (camPos, it) => {
      const cx = camPos.x, cy = -camPos.z, ch = camPos.y;
      const L = Math.hypot(it.x - cx, it.y - cy);
      const n = Math.ceil(L / 3);
      for (let i = 1; i < n; i++) {
        const t = i / n;
        if (L * (1 - t) < 7) break;
        const x = lerp(cx, it.x, t), y = lerp(cy, it.y, t), z = lerp(ch, it.h - 1, t);
        if (terrain.height(x, y) > z + 0.3) return true;
        grid.query(x, y, 0.1, occBuf);
        for (const o of occBuf) {
          if (o.circle || o.bid === undefined || o.bid === it.bid) continue;
          const Bd = blds[o.bid];
          if (z < Bd.top && P.contains(o.pts, x, y)) return true;
        }
      }
      return false;
    };

    // ---- 界面事件 ----
    document.querySelectorAll('#modes button').forEach((b) => b.addEventListener('click', () => switchMode(b.dataset.mode)));
    const switchMode = (m) => {
      if (rig.mode === 'transition') return;
      if (m === 'fps' && rig.mode !== 'fps') {
        if (rig.mode === 'top' && rig.dist > 1200 && info.spawn) rig.setMode('fps', { at: info.spawn, yaw: info.spawn.yaw });
        else rig.setMode('fps', {});
      } else rig.setMode(m);
    };
    const timeEl = document.getElementById('time'), timeText = document.getElementById('timeText');
    const fmtT = (h) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`;
    timeEl.value = startHours;
    timeText.textContent = fmtT(startHours);
    let envT = 0;
    timeEl.addEventListener('input', () => { const h = parseFloat(timeEl.value); env.setTime(h); timeText.textContent = fmtT(h); });
    const btnLabels = document.getElementById('btnLabels');
    const toggleLabels = () => { ui.labelsOn = !ui.labelsOn; btnLabels.classList.toggle('on', ui.labelsOn); };
    btnLabels.addEventListener('click', toggleLabels);
    const btnSh = document.getElementById('btnShadows');
    btnSh.addEventListener('click', () => {
      env.sun.castShadow = !env.sun.castShadow;
      env.shadowDirty = true;
      btnSh.classList.toggle('on', env.sun.castShadow);
    });
    document.getElementById('btnQuality').addEventListener('click', () => {
      app.quality = { high: 'medium', medium: 'low', low: 'high' }[app.quality];
      localStorage.setItem('jz-quality', app.quality);
      applyQuality();
    });
    const help = document.getElementById('help');
    const toggleHelp = (v) => {
      const show = v === undefined ? help.classList.contains('hidden') : v;
      help.classList.toggle('hidden', !show);
    };
    document.getElementById('btnHelp').addEventListener('click', () => { rig.unlock(); toggleHelp(); });
    help.addEventListener('click', (e) => { if (e.target === help || e.target.classList.contains('close')) toggleHelp(false); });
    document.getElementById('compass').addEventListener('click', () => {
      if (rig.mode === 'top' || rig.mode === 'orbit') { rig.yaw = 0; }
    });
    document.getElementById('placesToggle').addEventListener('click', () => document.getElementById('places').classList.toggle('collapsed'));
    document.getElementById('fpsOverlay').addEventListener('click', () => rig.lock());
    window.addEventListener('keydown', (e) => {
      if (e.target && (e.target.tagName === 'INPUT')) return;
      if (e.code === 'Digit1') switchMode('top');
      else if (e.code === 'Digit2') switchMode('orbit');
      else if (e.code === 'Digit3') switchMode('fps');
      else if (e.code === 'KeyL') toggleLabels();
      else if (e.code === 'KeyH') { rig.unlock(); toggleHelp(); }
      else if (e.code === 'KeyF' && rig.mode === 'fps') {
        rig.fly = !rig.fly;
        ui.toast(rig.fly ? '飞行模式：空格/E 上升，C/Q 下降' : '步行模式');
      } else if (e.code === 'Escape') { toggleHelp(false); }
    });
    window.addEventListener('resize', () => {
      camera.aspect = innerWidth / innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(innerWidth, innerHeight, false);
    });

    // ---- 渲染循环 ----
    await step('准备完成', 1);
    ui.hideLoading();
    ui.setModeButtons('top');
    let last = performance.now(), statT = 0, frames = 0, fpsT = 0, fps = 60, lodT = 0;
    const focusV = new THREE.Vector3();
    let lastSF = null;
    const frame = (now) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      rig.update(dt);
      // 动态近裁剪面
      const mode = rig.mode;
      const near = mode === 'fps' ? 0.25 : clamp((camera.position.y - terrain.height(camera.position.x, -camera.position.z)) * 0.01, 0.3, 15);
      if (Math.abs(near - camera.near) > 0.02) { camera.near = near; camera.updateProjectionMatrix(); }
      if (mode === 'fps') focusV.copy(camera.position);
      else if (mode === 'transition') focusV.set(camera.position.x, terrain.height(camera.position.x, -camera.position.z), camera.position.z);
      else focusV.copy(rig.target);
      const rad = mode === 'fps' ? 120 : mode === 'transition' ? 300 : clamp(rig.dist * 0.8, 120, 1100);
      env.update(camera, focusV, rad);
      lodT -= dt;
      if (lodT <= 0) {
        lodT = 0.25;
        if (V.updateLOD(camera.position)) env.shadowDirty = true;
      }
      // 仅在视点移动较多、范围变化或时间变化时重绘阴影贴图
      if (!lastSF || env.shadowDirty || Math.hypot(focusV.x - lastSF.x, focusV.z - lastSF.z) > rad * 0.1 || Math.abs(rad - lastSF.r) > lastSF.r * 0.18) {
        renderer.shadowMap.needsUpdate = true;
        lastSF = { x: focusV.x, z: focusV.z, r: rad };
        env.shadowDirty = false;
      }
      envT -= dt;
      if (envT <= 0) { env.updateEnvMap(); envT = 0.4; }
      seaN.offset.x += dt * 0.004;
      seaN.offset.y += dt * 0.0025;
      waterN.offset.x -= dt * 0.01;
      BO.update(dt);
      ui.updateLabels(camera, rig, dt);
      ui.drawMinimap(rig);
      frames++;
      fpsT += dt;
      if (fpsT > 1) { fps = Math.round(frames / fpsT); frames = 0; fpsT = 0; }
      statT -= dt;
      if (statT <= 0) {
        statT = 0.25;
        const f = rig.focus();
        const lat = LAT0 + f.y / MLAT, lon = LON0 + f.x / MLON;
        const h = mode === 'fps' ? rig.fp.feet : terrain.height(f.x, f.y);
        const modeName = { top: '俯视', orbit: '鸟瞰', fps: rig.fly ? '第一人称 · 飞行' : '第一人称 · 步行', transition: '切换中' }[mode];
        ui.status(`${modeName}　北纬 ${lat.toFixed(5)}°　东经 ${lon.toFixed(5)}°　海拔 ${h.toFixed(1)} m　${fps} FPS`);
      }
      renderer.render(scene, camera);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  window.addEventListener('DOMContentLoaded', () => {
    init().catch((e) => {
      console.error(e);
      ui.error('加载失败：' + (e && e.message ? e.message : e));
    });
  });
})();
