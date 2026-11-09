/* 运动设施：大操场（环形跑道+足球场）、篮球场、排球场及篮架/球门 */
(function () {
  'use strict';
  const JZ = window.JZ;
  const P = JZ.poly;
  const T = JZ.Tex;
  const { clamp, lerp } = JZ.math;

  const Sports = (JZ.Sports = {});

  Sports.prepare = function (data, terrain) {
    const res = { stadium: null, courts: [] };
    const track = data.areas.find((a) => a.kind === 'track' && P.contains(a.pts, -70, -210)) || data.areas.find((a) => a.kind === 'track');
    if (track) {
      const ob = P.obb(track.pts);
      const h = terrain.avgBase(track.pts);
      terrain.pad(track.pts, h, 5, 16, 'stadium');
      res.stadium = { area: track, ob, h };
    }
    for (const a of data.areas) {
      if (a.kind !== 'pitch') continue;
      if (track && P.contains(track.pts, ...P.centroid(a.pts))) continue; // 操场内的 pitch 由操场负责
      const ob = P.obb(a.pts);
      if (!ob || ob.hl < 5) continue;
      const h = terrain.avgBase(a.pts);
      terrain.pad(a.pts, h, 2.0, 4, 'court');
      res.courts.push({ area: a, ob, h, sport: a.sport || 'soccer' });
    }
    return res;
  };

  // ---------- 画布工具 ----------
  function stadiumPath(g, cx, cy, S, R) {
    g.beginPath();
    g.moveTo(cx - S / 2, cy - R);
    g.lineTo(cx + S / 2, cy - R);
    g.arc(cx + S / 2, cy, R, -Math.PI / 2, Math.PI / 2);
    g.lineTo(cx - S / 2, cy + R);
    g.arc(cx - S / 2, cy, R, Math.PI / 2, (3 * Math.PI) / 2);
    g.closePath();
  }

  function drawBasketball(g, x, y, L, Wd, s, rot) {
    // x,y 为中心（像素），L 长 Wd 宽（米），s 像素/米
    g.save();
    g.translate(x, y);
    if (rot) g.rotate(rot);
    g.fillStyle = '#3f8a5c';
    g.fillRect((-L / 2) * s, (-Wd / 2) * s, L * s, Wd * s);
    g.strokeStyle = '#f4f4ee';
    g.lineWidth = Math.max(1.5, 0.06 * s);
    g.strokeRect((-L / 2) * s, (-Wd / 2) * s, L * s, Wd * s);
    g.beginPath(); g.moveTo(0, (-Wd / 2) * s); g.lineTo(0, (Wd / 2) * s); g.stroke();
    g.beginPath(); g.arc(0, 0, 1.8 * s, 0, Math.PI * 2); g.stroke();
    for (const side of [-1, 1]) {
      const bx = side * (L / 2) * s;
      // 三秒区
      g.fillStyle = '#b4563f';
      g.fillRect(side < 0 ? bx : bx - 5.8 * s, -2.45 * s, 5.8 * s, 4.9 * s);
      g.strokeRect(side < 0 ? bx : bx - 5.8 * s, -2.45 * s, 5.8 * s, 4.9 * s);
      g.beginPath();
      g.arc(bx - side * 5.8 * s, 0, 1.8 * s, side < 0 ? -Math.PI / 2 : Math.PI / 2, side < 0 ? Math.PI / 2 : (3 * Math.PI) / 2);
      g.stroke();
      // 三分线
      const R3 = 6.75, s3 = Math.min(6.6, Wd / 2 - 0.4);
      const phi = Math.asin(clamp(s3 / R3, -1, 1));
      const hx = bx - side * 1.575 * s;
      g.beginPath();
      if (side < 0) g.arc(hx, 0, R3 * s, -phi, phi);
      else g.arc(hx, 0, R3 * s, Math.PI - phi, Math.PI + phi);
      g.stroke();
      const ex = hx - side * R3 * Math.cos(phi) * s;
      g.beginPath();
      g.moveTo(bx, -s3 * s); g.lineTo(ex, -s3 * s);
      g.moveTo(bx, s3 * s); g.lineTo(ex, s3 * s);
      g.stroke();
    }
    g.restore();
  }
  function drawVolleyball(g, x, y, L, Wd, s) {
    g.save();
    g.translate(x, y);
    g.fillStyle = '#3d7fa0';
    g.fillRect((-L / 2) * s, (-Wd / 2) * s, L * s, Wd * s);
    g.fillStyle = '#d0763f';
    g.fillRect((-L / 2) * s + 3, (-Wd / 2) * s + 3, L * s - 6, Wd * s - 6);
    g.strokeStyle = '#f4f4ee';
    g.lineWidth = Math.max(1.5, 0.05 * s);
    g.strokeRect((-L / 2) * s, (-Wd / 2) * s, L * s, Wd * s);
    g.beginPath(); g.moveTo(0, (-Wd / 2) * s); g.lineTo(0, (Wd / 2) * s); g.stroke();
    g.beginPath(); g.moveTo(-3 * s, (-Wd / 2) * s); g.lineTo(-3 * s, (Wd / 2) * s); g.moveTo(3 * s, (-Wd / 2) * s); g.lineTo(3 * s, (Wd / 2) * s); g.stroke();
    g.restore();
  }

  // 平铺在地面上的贴图平面（本地 obb 坐标系）
  function groundPlane(ob, h, canvas, lift) {
    const geo = new THREE.PlaneGeometry(ob.hl * 2, ob.hw * 2);
    geo.rotateX(-Math.PI / 2);
    const tex = T.texture(canvas, { clamp: true });
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.92, metalness: 0, alphaTest: 0.5, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(ob.cx, h + (lift || 0.04), -ob.cy);
    mesh.rotation.y = ob.angle; // 本地 x 轴（u 方向）对齐 obb 长轴
    mesh.receiveShadow = true;
    return mesh;
  }

  // 篮架
  function hoop(group, x, y, h, dirAng, mats) {
    // dirAng：篮筐朝向（本地坐标系角度，指向球场内）
    const g = new THREE.Group();
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 3.5, 10), mats.metal);
    post.position.set(-1.25, 1.75, 0);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.12, 0.12), mats.metal);
    arm.position.set(-0.62, 3.3, 0);
    const board = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.05, 1.8), mats.board);
    board.position.set(0, 3.35, 0);
    const rim = new THREE.Mesh(new THREE.TorusGeometry(0.23, 0.018, 6, 20), mats.rim);
    rim.rotation.x = Math.PI / 2;
    rim.position.set(0.28, 3.05, 0);
    g.add(post, arm, board, rim);
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
    g.position.set(x, h, -y);
    g.rotation.y = dirAng;
    group.add(g);
  }

  function goal(group, x, y, h, ang, w, gh, mat) {
    const g = new THREE.Group();
    const r = 0.06;
    const postL = new THREE.Mesh(new THREE.CylinderGeometry(r, r, gh, 8), mat);
    postL.position.set(0, gh / 2, -w / 2);
    const postR = postL.clone();
    postR.position.z = w / 2;
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 8), mat);
    bar.rotation.x = Math.PI / 2;
    bar.position.set(0, gh, 0);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, w), mat);
    back.position.set(-1.2, 0.05, 0);
    const netMat = new THREE.MeshStandardMaterial({ color: '#ffffff', transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false });
    const netBack = new THREE.Mesh(new THREE.PlaneGeometry(w, gh), netMat);
    netBack.position.set(-1.2, gh / 2, 0);
    netBack.rotation.y = Math.PI / 2;
    g.add(postL, postR, bar, back, netBack);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    g.position.set(x, h, -y);
    g.rotation.y = ang;
    group.add(g);
  }

  Sports.build = function (prep, terrain) {
    const group = new THREE.Group();
    group.name = 'sports';
    const labels = [];
    const mats = {
      metal: new THREE.MeshStandardMaterial({ color: '#8d9399', roughness: 0.4, metalness: 0.7 }),
      board: new THREE.MeshStandardMaterial({ color: '#f2f4f4', roughness: 0.3, metalness: 0.0 }),
      rim: new THREE.MeshStandardMaterial({ color: '#e0562a', roughness: 0.5, metalness: 0.4 }),
      white: new THREE.MeshStandardMaterial({ color: '#f6f6f2', roughness: 0.5 }),
    };

    // ---- 大操场 ----
    const st = prep.stadium;
    if (st) {
      const ob = st.ob;
      const L = ob.hl * 2, Wd = ob.hw * 2;
      const Ro = ob.hw - 0.5, S = Math.max(0, L - 1 - 2 * Ro);
      const lanes = 6, lw = 1.22;
      const Ri = Ro - lanes * lw - 0.4;
      const px = 2048, sc = px / L;
      const cw = px, ch = Math.round(Wd * sc);
      const c = T.canvas(cw, ch), g = c.getContext('2d');
      const cx = cw / 2, cy = ch / 2;
      g.clearRect(0, 0, cw, ch);
      // 外圈（混凝土路缘）
      stadiumPath(g, cx, cy, S * sc, (Ro + 0.5) * sc);
      g.fillStyle = '#a7a39a';
      g.fill();
      // 塑胶跑道
      stadiumPath(g, cx, cy, S * sc, Ro * sc);
      g.fillStyle = '#b6513b';
      g.fill();
      // 跑道纹理噪点
      const rand = JZ.rng(99);
      for (let i = 0; i < 9000; i++) {
        g.fillStyle = rand() < 0.5 ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.04)';
        g.fillRect(rand() * cw, rand() * ch, 2, 2);
      }
      // 分道线
      g.strokeStyle = 'rgba(250,250,245,0.92)';
      g.lineWidth = Math.max(1.4, 0.05 * sc);
      for (let k = 0; k <= lanes; k++) {
        stadiumPath(g, cx, cy, S * sc, (Ri + 0.3 + k * lw) * sc);
        g.stroke();
      }
      // 起终点线
      g.lineWidth = Math.max(2, 0.08 * sc);
      for (const side of [-1, 1]) {
        g.beginPath();
        g.moveTo(cx + (side * S * sc) / 2 - side * 2, cy - (Ri + 0.3) * sc);
        g.lineTo(cx + (side * S * sc) / 2 - side * 2, cy - Ro * sc);
        g.stroke();
      }
      // 内场草坪（修剪条纹）
      g.save();
      stadiumPath(g, cx, cy, S * sc, Ri * sc);
      g.clip();
      for (let x = 0, k = 0; x < cw; x += 5 * sc, k++) {
        g.fillStyle = k % 2 ? '#4f9140' : '#5a9c48';
        g.fillRect(x, 0, 5 * sc + 1, ch);
      }
      g.restore();
      g.strokeStyle = '#f4f4ee';
      g.lineWidth = Math.max(1.4, 0.05 * sc);
      stadiumPath(g, cx, cy, S * sc, Ri * sc);
      g.stroke();
      // 足球场
      const Lp = Math.min(S + 8, 100), Wp = Math.min(2 * Ri - 8, Lp * 0.66);
      g.lineWidth = Math.max(2, 0.12 * sc);
      g.strokeRect(cx - (Lp / 2) * sc, cy - (Wp / 2) * sc, Lp * sc, Wp * sc);
      g.beginPath(); g.moveTo(cx, cy - (Wp / 2) * sc); g.lineTo(cx, cy + (Wp / 2) * sc); g.stroke();
      g.beginPath(); g.arc(cx, cy, 7 * sc, 0, Math.PI * 2); g.stroke();
      g.fillStyle = '#f4f4ee';
      g.beginPath(); g.arc(cx, cy, 0.25 * sc, 0, Math.PI * 2); g.fill();
      const pa = Math.min(13, Lp * 0.16), pw = Math.min(32, Wp * 0.62), ga = Math.min(4.5, Lp * 0.06), gw = Math.min(14, Wp * 0.3);
      for (const side of [-1, 1]) {
        const ex = cx + (side * Lp * sc) / 2;
        g.strokeRect(side < 0 ? ex : ex - pa * sc, cy - (pw / 2) * sc, pa * sc, pw * sc);
        g.strokeRect(side < 0 ? ex : ex - ga * sc, cy - (gw / 2) * sc, ga * sc, gw * sc);
        g.beginPath(); g.arc(ex - side * pa * 0.7 * sc, cy, 0.25 * sc, 0, Math.PI * 2); g.fill();
      }
      // D 区：一端篮球场（卫星图可见），另一端两块小场地
      const endA = [ob.cx + ob.ux * (S / 2 + Ri * 0.45), ob.cy + ob.uy * (S / 2 + Ri * 0.45)];
      const endB = [ob.cx - ob.ux * (S / 2 + Ri * 0.45), ob.cy - ob.uy * (S / 2 + Ri * 0.45)];
      const courtAtPlus = endA[1] - endA[0] > endB[1] - endB[0]; // 西北端
      const dx = (S / 2 + Ri * 0.47) * sc;
      const courtX = courtAtPlus ? cx + dx : cx - dx;
      const otherX = courtAtPlus ? cx - dx : cx + dx;
      drawBasketball(g, courtX, cy, Math.min(26, 2 * Ri - 12), 14, sc, Math.PI / 2);
      g.fillStyle = '#3f8a5c';
      g.strokeStyle = '#f4f4ee';
      g.lineWidth = Math.max(1.4, 0.05 * sc);
      for (const off of [-1, 1]) {
        g.fillRect(otherX - 4.5 * sc, cy + off * 8 * sc - 4 * sc, 9 * sc, 8 * sc);
        g.strokeRect(otherX - 4.5 * sc, cy + off * 8 * sc - 4 * sc, 9 * sc, 8 * sc);
      }
      const plane = groundPlane(ob, st.h, c, 0.05);
      plane.name = 'stadium';
      group.add(plane);
      // 球门
      for (const side of [-1, 1]) {
        const u = side * (Lp / 2 + 0.05);
        const gx = ob.cx + ob.ux * u, gy = ob.cy + ob.uy * u;
        goal(group, gx, gy, st.h + 0.05, ob.angle + (side > 0 ? Math.PI : 0), Math.min(7.32, gw * 0.55), 2.2, mats.white);
      }
      // D 区篮架
      const hcU = (courtAtPlus ? 1 : -1) * (S / 2 + Ri * 0.47);
      const hl = Math.min(26, 2 * Ri - 12) / 2;
      for (const side of [-1, 1]) {
        const v = side * (hl - 1.2);
        const hx = ob.cx + ob.ux * hcU + ob.vx * v, hy = ob.cy + ob.uy * hcU + ob.vy * v;
        const ang = Math.atan2(-side * ob.vy, -side * ob.vx);
        hoop(group, hx, hy, st.h + 0.05, ang, mats);
      }
      const lap = 2 * S + 2 * Math.PI * (Ri + 0.3 + 0.3);
      labels.push({
        name: '运动场（大操场）', x: ob.cx, y: ob.cy, h: st.h + 6, kind: 'landmark', cat: 'sport',
        desc: `环形塑胶跑道与足球场，位于谷地，经景观天桥与校园相连。按 OSM 轮廓与卫星影像建模：外缘约 ${L.toFixed(0)}×${Wd.toFixed(0)} m，第一道一圈约 ${Math.round(lap / 10) * 10} m（估算）。西北端弯道区为篮球场。`,
      });
      st.L = L; st.Wd = Wd;
    }

    // ---- 球场 ----
    for (const ct of prep.courts) {
      let ob = ct.ob;
      const sport = ct.sport;
      const L = ob.hl * 2, Wd = ob.hw * 2;
      const px = 1024, sc = px / L;
      const c = T.canvas(px, Math.max(64, Math.round(Wd * sc))), g = c.getContext('2d');
      g.fillStyle = sport === 'basketball' || sport === 'volleyball' ? '#a8533f' : '#4c8a3e';
      g.fillRect(0, 0, c.width, c.height);
      const hoops = [];
      if (sport === 'basketball') {
        const n = clamp(Math.floor((Wd + 2) / 17), 1, 3);
        const cl = Math.min(28, L - 3), cwid = Math.min(15, (Wd - (n + 1) * 1.8) / n);
        for (let k = 0; k < n; k++) {
          const v = -Wd / 2 + 1.8 + cwid / 2 + k * (cwid + 1.8);
          drawBasketball(g, c.width / 2, c.height / 2 - v * sc, cl, cwid, sc, 0);
          for (const side of [-1, 1]) hoops.push({ u: side * (cl / 2 - 1.2), v, side });
        }
      } else if (sport === 'volleyball') {
        drawVolleyball(g, c.width / 2, c.height / 2, Math.min(18, L - 3), Math.min(9, Wd - 3), sc);
      } else {
        g.strokeStyle = '#f4f4ee';
        g.lineWidth = 2;
        g.strokeRect(6, 6, c.width - 12, c.height - 12);
      }
      const plane = groundPlane(ob, ct.h, c, 0.04);
      group.add(plane);
      for (const hp of hoops) {
        const hx = ob.cx + ob.ux * hp.u + ob.vx * hp.v, hy = ob.cy + ob.uy * hp.u + ob.vy * hp.v;
        const ang = Math.atan2(-hp.side * ob.uy, -hp.side * ob.ux);
        hoop(group, hx, hy, ct.h + 0.04, ang, mats);
      }
      if (sport === 'volleyball') {
        const netMat = new THREE.MeshStandardMaterial({ color: '#f0f0ea', transparent: true, opacity: 0.55, side: THREE.DoubleSide });
        for (const side of [-1, 1]) {
          const v = side * Math.min(9, Wd - 3) * 0.6;
          const pxw = ob.cx + ob.vx * v, pyw = ob.cy + ob.vy * v;
          const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 2.55, 8), mats.metal);
          post.position.set(pxw, ct.h + 1.27, -pyw);
          post.castShadow = true;
          group.add(post);
        }
        const net = new THREE.Mesh(new THREE.PlaneGeometry(Math.min(9, Wd - 3) * 1.2, 0.9), netMat);
        net.position.set(ob.cx, ct.h + 2.0, -ob.cy);
        net.rotation.y = ob.angle + Math.PI / 2;
        group.add(net);
      }
    }
    return { group, labels };
  };
})();
