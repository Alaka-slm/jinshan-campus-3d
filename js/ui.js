/* 界面：加载进度、标注、小地图、导览列表、信息卡、指南针、状态栏、第一人称提示 */
(function () {
  'use strict';
  const JZ = window.JZ;
  const P = JZ.poly;
  const { clamp, lerp } = JZ.math;
  const $ = (s) => document.querySelector(s);
  const CAT = { teach: '教学区', life: '生活区', sport: '运动区', scene: '景观小品', west: '西校区', around: '周边' };
  const CAT_ORDER = ['teach', 'sport', 'life', 'scene', 'west', 'around'];

  class UI {
    constructor(app) {
      this.app = app;
      this.labelsOn = true;
      this.labels = [];
      this.selected = null;
      this.occT = 0;
      this.v = new THREE.Vector3();
    }
    progress(text, f) {
      $('#ltext').textContent = text;
      $('#lbar').style.width = Math.round(clamp(f, 0, 1) * 100) + '%';
    }
    hideLoading() {
      const l = $('#loading');
      l.classList.add('fade');
      setTimeout(() => (l.style.display = 'none'), 700);
    }
    error(msg) {
      $('#ltext').innerHTML = '<span style="color:#ff9b8a">' + msg + '</span>';
    }

    // ---------- 标注 ----------
    initLabels(items) {
      const host = $('#labels');
      host.innerHTML = '';
      this.labels = items.map((it) => {
        const el = document.createElement('div');
        el.className = 'lbl ' + (it.kind || 'building') + (it.pri >= 2 ? ' major' : '');
        el.innerHTML = `<span>${it.name}</span>`;
        el.addEventListener('click', (e) => {
          e.stopPropagation();
          this.app.select(it, true);
        });
        host.appendChild(el);
        return { it, el, w: 0, vis: false, occ: false, x: 0, y: 0 };
      });
      requestAnimationFrame(() => this.labels.forEach((l) => (l.w = l.el.offsetWidth || l.it.name.length * 13 + 16)));
    }
    updateLabels(cam, rig, dt) {
      const W = innerWidth, H = innerHeight;
      const mode = rig.mode === 'transition' ? rig._pendingMode || 'top' : rig.mode;
      const camH = cam.position.y - this.app.terrain.height(cam.position.x, -cam.position.z);
      const cands = [];
      this.occT -= dt;
      const doOcc = mode === 'fps' && this.occT <= 0;
      if (doOcc) this.occT = 0.2;
      for (const L of this.labels) {
        const it = L.it;
        let show = this.labelsOn;
        const d = Math.hypot(it.x - cam.position.x, it.y + cam.position.z, it.h - cam.position.y);
        if (show) {
          if (mode === 'fps') show = d < (it.pri >= 2 ? 300 : 160);
          else if (camH > 1300) show = it.pri >= 2 && it.kind !== 'poi-minor';
          else if (camH > 650) show = it.pri >= 1;
        }
        if (show) {
          this.v.set(it.x, it.h, -it.y).project(cam);
          if (this.v.z > 1 || Math.abs(this.v.x) > 1.05 || Math.abs(this.v.y) > 1.05) show = false;
        }
        if (show && mode === 'fps') {
          if (doOcc) L.occ = this.app.occluded(cam.position, it);
          if (L.occ) show = false;
        }
        if (!show) {
          if (L.vis) { L.el.style.display = 'none'; L.vis = false; }
          continue;
        }
        cands.push({ L, sx: ((this.v.x + 1) / 2) * W, sy: ((1 - this.v.y) / 2) * H, d });
      }
      cands.sort((a, b) => (b.L.it.pri || 0) - (a.L.it.pri || 0) || a.d - b.d);
      const placed = [];
      for (const c of cands) {
        const w = c.L.w || 80, h = 24;
        const r = [c.sx - w / 2, c.sy - h - 6, c.sx + w / 2, c.sy];
        let ok = true;
        for (const p of placed) if (r[0] < p[2] && r[2] > p[0] && r[1] < p[3] && r[3] > p[1]) { ok = false; break; }
        const L = c.L;
        if (!ok && L.it !== this.selected) {
          if (L.vis) { L.el.style.display = 'none'; L.vis = false; }
          continue;
        }
        placed.push(r);
        if (!L.vis) { L.el.style.display = 'block'; L.vis = true; }
        const op = mode === 'fps' ? clamp(1.25 - c.d / 260, 0.35, 1) : 1;
        L.el.style.transform = `translate(${Math.round(c.sx - w / 2)}px, ${Math.round(c.sy - h - 6)}px)`;
        L.el.style.opacity = op;
        L.el.classList.toggle('sel', L.it === this.selected);
      }
    }

    // ---------- 小地图 ----------
    initMinimap(groundCanvas, region, buildings, extras) {
      const [x0, y0, x1, y1] = region;
      const W = Math.round(x1 - x0), H = Math.round(y1 - y0);
      const base = JZ.Tex.canvas(W, H);
      const g = base.getContext('2d');
      g.drawImage(groundCanvas, 0, 0, W, H);
      g.fillStyle = 'rgba(255,255,255,0.08)';
      g.fillRect(0, 0, W, H);
      const X = (x) => x - x0, Y = (y) => y1 - y;
      for (const b of buildings) {
        g.beginPath();
        b.pts.forEach((p, i) => (i ? g.lineTo(X(p[0]), Y(p[1])) : g.moveTo(X(p[0]), Y(p[1]))));
        g.closePath();
        g.fillStyle = b.meta.cat && b.meta.cat !== 'around' ? '#efe2c8' : '#d9d4ca';
        g.fill();
        g.strokeStyle = '#6f675a';
        g.lineWidth = 0.8;
        g.stroke();
      }
      if (extras && extras.school) {
        g.setLineDash([4, 3]);
        g.strokeStyle = 'rgba(200,40,40,0.9)';
        g.lineWidth = 1.6;
        g.beginPath();
        extras.school.forEach((p, i) => (i ? g.lineTo(X(p[0]), Y(p[1])) : g.moveTo(X(p[0]), Y(p[1]))));
        g.closePath();
        g.stroke();
        g.setLineDash([]);
      }
      this.mmBase = base;
      this.mmRegion = region;
      const cv = $('#minimap');
      const dpr = Math.min(2, devicePixelRatio || 1);
      const S = cv.clientWidth || 220;
      cv.width = S * dpr;
      cv.height = S * dpr;
      this.mm = { cv, g: cv.getContext('2d'), S, dpr, scale: 1 };
      cv.addEventListener('click', (e) => {
        const r = cv.getBoundingClientRect();
        const dx = e.clientX - r.left - S / 2, dy = e.clientY - r.top - S / 2;
        const { f, hdg, scale } = this.mm.last || {};
        if (!f) return;
        const c = Math.cos(hdg), s = Math.sin(hdg);
        const xr = dx * c + dy * s, yr = -dx * s + dy * c;
        this.app.jumpTo(f.x + xr / scale, f.y - yr / scale);
      });
    }
    drawMinimap(rig) {
      const m = this.mm;
      if (!m) return;
      const { g, S, dpr } = m;
      const f = rig.focus(), hdg = rig.heading();
      const mode = rig.mode === 'transition' ? rig._pendingMode || 'fps' : rig.mode;
      const scale = mode === 'fps' ? 1.5 : clamp(S / (rig.dist * 1.5), 0.12, 2.2);
      m.last = { f, hdg, scale };
      const [x0, , , y1] = this.mmRegion;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, S, S);
      g.save();
      g.beginPath();
      g.arc(S / 2, S / 2, S / 2 - 1, 0, Math.PI * 2);
      g.clip();
      g.fillStyle = '#4b6a63';
      g.fillRect(0, 0, S, S);
      g.translate(S / 2, S / 2);
      g.rotate(hdg);
      g.scale(scale, scale);
      g.translate(-(f.x - x0), -(y1 - f.y));
      g.imageSmoothingEnabled = true;
      g.drawImage(this.mmBase, 0, 0);
      g.restore();
      // 视野指示
      g.save();
      g.translate(S / 2, S / 2);
      if (mode === 'fps') {
        g.fillStyle = 'rgba(255,220,120,0.22)';
        g.beginPath();
        g.moveTo(0, 0);
        g.arc(0, 0, 60, -Math.PI / 2 - 0.5, -Math.PI / 2 + 0.5);
        g.closePath();
        g.fill();
        g.fillStyle = '#ffcf4a';
        g.strokeStyle = '#3a2a00';
        g.lineWidth = 1.5;
        g.beginPath();
        g.moveTo(0, -9); g.lineTo(6.5, 7); g.lineTo(0, 3.5); g.lineTo(-6.5, 7);
        g.closePath();
        g.fill();
        g.stroke();
      } else {
        g.strokeStyle = 'rgba(255,207,74,0.95)';
        g.lineWidth = 2;
        g.beginPath();
        g.arc(0, 0, 5, 0, Math.PI * 2);
        g.stroke();
      }
      g.restore();
      // 北向标记
      const R = S / 2 - 11;
      const nx = S / 2 + Math.sin(hdg) * R, ny = S / 2 - Math.cos(hdg) * R;
      const nEl = $('#mmN');
      nEl.style.transform = `translate(${nx - 8}px, ${ny - 8}px)`;
      $('#compass .needle').style.transform = `rotate(${hdg}rad)`;
    }

    // ---------- 导览列表 ----------
    initPlaces(items) {
      const host = $('#placesList');
      host.innerHTML = '';
      const groups = {};
      for (const it of items) {
        if (!it.cat || !CAT[it.cat] || !it.name) continue;
        (groups[it.cat] = groups[it.cat] || []).push(it);
      }
      for (const c of CAT_ORDER) {
        if (!groups[c]) continue;
        const sec = document.createElement('div');
        sec.className = 'sec';
        sec.innerHTML = `<div class="sh">${CAT[c]}</div>`;
        const seen = new Set();
        for (const it of groups[c]) {
          if (seen.has(it.name)) continue;
          seen.add(it.name);
          const b = document.createElement('button');
          b.className = 'place';
          b.textContent = it.name;
          b.addEventListener('click', () => this.app.select(it, true));
          sec.appendChild(b);
        }
        host.appendChild(sec);
      }
    }

    // ---------- 信息卡 ----------
    showInfo(it) {
      this.selected = it;
      const el = $('#info');
      if (!it) { el.classList.add('hidden'); return; }
      const B = it.bid !== undefined ? this.app.buildings[it.bid] : null;
      let rows = '';
      if (B && B.meta.shape !== 'pavilion') {
        const h = B.top - B.base;
        if (B.meta.levels && !['dome', 'planetarium'].includes(B.meta.shape)) rows += `<div><i>层数</i>${B.meta.levels} 层${B.osm['building:levels'] ? '' : '（估）'}</div>`;
        rows += `<div><i>高度</i>约 ${h.toFixed(0)} m</div><div><i>占地</i>约 ${B.area.toFixed(0)} m²</div><div><i>地面海拔</i>约 ${B.base.toFixed(0)} m</div>`;
      } else {
        rows += `<div><i>海拔</i>约 ${this.app.terrain.height(it.x, it.y).toFixed(0)} m</div>`;
      }
      el.innerHTML = `
        <button class="x" title="关闭">×</button>
        <div class="cat">${CAT[it.cat] || '地点'}</div>
        <h3>${it.name}</h3>
        <div class="rows">${rows}</div>
        ${it.desc ? `<p>${it.desc}</p>` : ''}
        <div class="acts"><button class="fly">飞过去看看</button><button class="walk primary">在此步行</button></div>`;
      el.classList.remove('hidden');
      el.querySelector('.x').onclick = () => this.showInfo(null);
      el.querySelector('.fly').onclick = () => this.app.goTo(it, 'fly');
      el.querySelector('.walk').onclick = () => this.app.goTo(it, 'walk');
    }

    setModeButtons(mode) {
      document.querySelectorAll('#modes button').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
      document.body.dataset.mode = mode;
    }
    status(text) {
      $('#status').textContent = text;
    }
    fpsOverlay(show) {
      $('#fpsOverlay').classList.toggle('hidden', !show);
    }
    toast(msg, ms = 2200) {
      const t = $('#toast');
      t.textContent = msg;
      t.classList.add('show');
      clearTimeout(this._tt);
      this._tt = setTimeout(() => t.classList.remove('show'), ms);
    }
  }
  JZ.UI = UI;
})();
