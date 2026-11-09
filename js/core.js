/* 金山中学 3D 校园 — 公共工具：随机数、几何、多边形、空间索引
 * 坐标约定：本地坐标 (x=东, y=北, 单位米)；three.js 世界坐标 (X=x, Y=高度, Z=-y)。
 */
(function () {
  'use strict';
  const JZ = (window.JZ = window.JZ || {});

  // ---------- 随机数 ----------
  JZ.rng = function (seed) {
    let a = seed >>> 0 || 1;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  JZ.hashStr = function (s) {
    let h = 2166136261;
    s = String(s);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  };

  // ---------- 数学 ----------
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const smoothstep = (a, b, x) => {
    const t = clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  };
  JZ.math = { clamp, lerp, smoothstep };

  // ---------- 多边形（[[x,y],...]，不闭合） ----------
  const P = (JZ.poly = {});
  P.area = function (p) {
    let a = 0;
    for (let i = 0, n = p.length; i < n; i++) {
      const q = p[i], r = p[(i + 1) % n];
      a += q[0] * r[1] - r[0] * q[1];
    }
    return a / 2;
  };
  P.centroid = function (p) {
    let a = 0, cx = 0, cy = 0;
    for (let i = 0, n = p.length; i < n; i++) {
      const q = p[i], r = p[(i + 1) % n];
      const f = q[0] * r[1] - r[0] * q[1];
      a += f;
      cx += (q[0] + r[0]) * f;
      cy += (q[1] + r[1]) * f;
    }
    if (Math.abs(a) < 1e-6) {
      let sx = 0, sy = 0;
      p.forEach((q) => { sx += q[0]; sy += q[1]; });
      return [sx / p.length, sy / p.length];
    }
    return [cx / (3 * a), cy / (3 * a)];
  };
  P.bbox = function (p) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const q of p) {
      if (q[0] < x0) x0 = q[0];
      if (q[1] < y0) y0 = q[1];
      if (q[0] > x1) x1 = q[0];
      if (q[1] > y1) y1 = q[1];
    }
    return [x0, y0, x1, y1];
  };
  P.contains = function (p, x, y) {
    let inside = false;
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      const xi = p[i][0], yi = p[i][1], xj = p[j][0], yj = p[j][1];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
  P.containsH = function (p, holes, x, y) {
    if (!P.contains(p, x, y)) return false;
    if (holes) for (const h of holes) if (P.contains(h, x, y)) return false;
    return true;
  };
  // 点到线段最近点；返回距离平方，out=[cx,cy]
  P.closestOnSeg = function (px, py, ax, ay, bx, by, out) {
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy;
    let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const cx = ax + dx * t, cy = ay + dy * t;
    if (out) { out[0] = cx; out[1] = cy; }
    return (px - cx) * (px - cx) + (py - cy) * (py - cy);
  };
  const tmp2 = [0, 0];
  P.distToRing = function (p, x, y, out) {
    let best = Infinity;
    for (let i = 0, n = p.length; i < n; i++) {
      const a = p[i], b = p[(i + 1) % n];
      const d = P.closestOnSeg(x, y, a[0], a[1], b[0], b[1], tmp2);
      if (d < best) {
        best = d;
        if (out) { out[0] = tmp2[0]; out[1] = tmp2[1]; }
      }
    }
    return Math.sqrt(best);
  };
  P.distToPolyline = function (p, x, y) {
    let best = Infinity;
    for (let i = 0; i < p.length - 1; i++) {
      const d = P.closestOnSeg(x, y, p[i][0], p[i][1], p[i + 1][0], p[i + 1][1]);
      if (d < best) best = d;
    }
    return Math.sqrt(best);
  };
  P.perimeter = function (p) {
    let s = 0;
    for (let i = 0, n = p.length; i < n; i++) {
      const a = p[i], b = p[(i + 1) % n];
      s += Math.hypot(b[0] - a[0], b[1] - a[1]);
    }
    return s;
  };
  P.polylineLength = function (p) {
    let s = 0;
    for (let i = 0; i < p.length - 1; i++) s += Math.hypot(p[i + 1][0] - p[i][0], p[i + 1][1] - p[i][1]);
    return s;
  };
  P.pointAlong = function (p, d) {
    for (let i = 0; i < p.length - 1; i++) {
      const l = Math.hypot(p[i + 1][0] - p[i][0], p[i + 1][1] - p[i][1]);
      if (d <= l || i === p.length - 2) {
        const t = l > 0 ? clamp(d / l, 0, 1) : 0;
        return [lerp(p[i][0], p[i + 1][0], t), lerp(p[i][1], p[i + 1][1], t), Math.atan2(p[i + 1][1] - p[i][1], p[i + 1][0] - p[i][0])];
      }
      d -= l;
    }
    return [p[0][0], p[0][1], 0];
  };
  P.ccw = function (p) {
    return P.area(p) >= 0 ? p : p.slice().reverse();
  };
  P.convexHull = function (pts) {
    const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    if (p.length < 3) return p;
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], up = [];
    for (const q of p) {
      while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop();
      lo.push(q);
    }
    for (let i = p.length - 1; i >= 0; i--) {
      const q = p[i];
      while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop();
      up.push(q);
    }
    up.pop();
    lo.pop();
    return lo.concat(up);
  };
  // 最小面积外接矩形：u 为长轴方向
  P.obb = function (pts) {
    const h = P.convexHull(pts);
    let best = null;
    for (let i = 0; i < h.length; i++) {
      const a = h[i], b = h[(i + 1) % h.length];
      let ux = b[0] - a[0], uy = b[1] - a[1];
      const l = Math.hypot(ux, uy);
      if (l < 1e-6) continue;
      ux /= l; uy /= l;
      const vx = -uy, vy = ux;
      let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
      for (const q of h) {
        const pu = q[0] * ux + q[1] * uy, pv = q[0] * vx + q[1] * vy;
        if (pu < u0) u0 = pu;
        if (pu > u1) u1 = pu;
        if (pv < v0) v0 = pv;
        if (pv > v1) v1 = pv;
      }
      const area = (u1 - u0) * (v1 - v0);
      if (!best || area < best.area) best = { area, ux, uy, vx, vy, u0, u1, v0, v1 };
    }
    if (!best) return null;
    let { ux, uy, vx, vy, u0, u1, v0, v1 } = best;
    if (v1 - v0 > u1 - u0) {
      // 交换使 u 为长轴
      [ux, uy, vx, vy] = [vx, vy, -ux, -uy];
      [u0, u1, v0, v1] = [v0, v1, -u1, -u0];
    }
    const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2;
    return {
      cx: cu * ux + cv * vx, cy: cu * uy + cv * vy,
      ux, uy, vx, vy, hl: (u1 - u0) / 2, hw: (v1 - v0) / 2,
      angle: Math.atan2(uy, ux), area: best.area,
    };
  };
  // 沿闭合多边形等距重采样
  P.resample = function (p, step) {
    const out = [];
    for (let i = 0, n = p.length; i < n; i++) {
      const a = p[i], b = p[(i + 1) % n];
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const k = Math.max(1, Math.ceil(l / step));
      for (let j = 0; j < k; j++) out.push([lerp(a[0], b[0], j / k), lerp(a[1], b[1], j / k)]);
    }
    return out;
  };
  P.resampleLine = function (p, step) {
    const out = [p[0]];
    for (let i = 0; i < p.length - 1; i++) {
      const a = p[i], b = p[i + 1];
      const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const k = Math.max(1, Math.ceil(l / step));
      for (let j = 1; j <= k; j++) out.push([lerp(a[0], b[0], j / k), lerp(a[1], b[1], j / k)]);
    }
    return out;
  };
  // 多边形内随机/网格采样点
  P.samplePoints = function (p, step) {
    const [x0, y0, x1, y1] = P.bbox(p);
    const out = [];
    for (let y = y0 + step / 2; y < y1; y += step)
      for (let x = x0 + step / 2; x < x1; x += step) if (P.contains(p, x, y)) out.push([x, y]);
    if (!out.length) out.push(P.centroid(p));
    return out;
  };
  // 向内找一个离边界足够远的点（用于屋顶设备等）
  P.interiorPoint = function (p, minDist, rand) {
    const [x0, y0, x1, y1] = P.bbox(p);
    for (let k = 0; k < 40; k++) {
      const x = lerp(x0, x1, rand()), y = lerp(y0, y1, rand());
      if (P.contains(p, x, y) && P.distToRing(p, x, y) >= minDist) return [x, y];
    }
    return null;
  };

  // ---------- 简单空间网格索引 ----------
  JZ.Grid = class {
    constructor(x0, y0, x1, y1, cell) {
      this.x0 = x0; this.y0 = y0; this.cell = cell;
      this.nx = Math.ceil((x1 - x0) / cell) + 1;
      this.ny = Math.ceil((y1 - y0) / cell) + 1;
      this.cells = new Array(this.nx * this.ny);
      this.stamp = 0;
    }
    _range(bx0, by0, bx1, by1) {
      const c = this.cell;
      return [
        clamp(Math.floor((bx0 - this.x0) / c), 0, this.nx - 1), clamp(Math.floor((by0 - this.y0) / c), 0, this.ny - 1),
        clamp(Math.floor((bx1 - this.x0) / c), 0, this.nx - 1), clamp(Math.floor((by1 - this.y0) / c), 0, this.ny - 1),
      ];
    }
    insert(item, bb) {
      item._stamp = 0;
      const [i0, j0, i1, j1] = this._range(bb[0], bb[1], bb[2], bb[3]);
      for (let j = j0; j <= j1; j++)
        for (let i = i0; i <= i1; i++) {
          const k = j * this.nx + i;
          (this.cells[k] || (this.cells[k] = [])).push(item);
        }
    }
    query(x, y, r, out) {
      out = out || [];
      out.length = 0;
      const s = ++this.stamp;
      const [i0, j0, i1, j1] = this._range(x - r, y - r, x + r, y + r);
      for (let j = j0; j <= j1; j++)
        for (let i = i0; i <= i1; i++) {
          const c = this.cells[j * this.nx + i];
          if (!c) continue;
          for (const it of c) if (it._stamp !== s) { it._stamp = s; out.push(it); }
        }
      return out;
    }
  };

  // ---------- 杂项 ----------
  // 页面在后台时 requestAnimationFrame 会暂停，加载流程改用 setTimeout 让出线程
  JZ.nextFrame = () => new Promise((r) => (document.hidden ? setTimeout(r, 0) : requestAnimationFrame(() => r())));
  JZ.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  JZ.color = function (hex) { return new THREE.Color(hex); };
  // sRGB 十六进制 -> 亮度(0..1)
  JZ.luma = function (hex) {
    const c = new THREE.Color(hex);
    return 0.3 * c.r + 0.59 * c.g + 0.11 * c.b;
  };
  JZ.fmt = (v, d = 0) => Number(v).toFixed(d);
})();
