/* 地形：SRTM 高程（双三次插值）+ 修整（建筑平台、球场、操场、水体）+ 网格与材质 */
(function () {
  'use strict';
  const JZ = window.JZ;
  const { clamp, lerp, smoothstep } = JZ.math;
  const P = JZ.poly;

  function catmull(p0, p1, p2, p3, t) {
    const t2 = t * t, t3 = t2 * t;
    return 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
  }
  function sampleBicubic(g, x, y) {
    const fx = (x - g.x0) / g.dx, fy = (y - g.y0) / g.dx;
    const ix = Math.floor(fx), iy = Math.floor(fy);
    const tx = fx - ix, ty = fy - iy;
    const nx = g.nx, ny = g.ny, h = g.h;
    const H = (i, j) => h[clamp(j, 0, ny - 1) * nx + clamp(i, 0, nx - 1)];
    const r0 = catmull(H(ix - 1, iy - 1), H(ix, iy - 1), H(ix + 1, iy - 1), H(ix + 2, iy - 1), tx);
    const r1 = catmull(H(ix - 1, iy), H(ix, iy), H(ix + 1, iy), H(ix + 2, iy), tx);
    const r2 = catmull(H(ix - 1, iy + 1), H(ix, iy + 1), H(ix + 1, iy + 1), H(ix + 2, iy + 1), tx);
    const r3 = catmull(H(ix - 1, iy + 2), H(ix, iy + 2), H(ix + 1, iy + 2), H(ix + 2, iy + 2), tx);
    return catmull(r0, r1, r2, r3, ty);
  }
  function blur(g, passes) {
    const { nx, ny } = g;
    for (let p = 0; p < passes; p++) {
      const src = g.h.slice();
      for (let j = 0; j < ny; j++)
        for (let i = 0; i < nx; i++) {
          let s = 0, w = 0;
          for (let dj = -1; dj <= 1; dj++)
            for (let di = -1; di <= 1; di++) {
              const ii = clamp(i + di, 0, nx - 1), jj = clamp(j + dj, 0, ny - 1);
              const k = (di ? 1 : 2) * (dj ? 1 : 2);
              s += src[jj * nx + ii] * k;
              w += k;
            }
          // 海面（0 值）保持不被抬高
          g.h[j * nx + i] = src[j * nx + i] <= 0.01 ? 0 : s / w;
        }
    }
  }

  class WaterBody {
    constructor(terrain, area, kind) {
      this.area = area;
      this.kind = kind; // 'lake' | 'pool'
      this.pts = area.pts;
      this.holes = area.holes || [];
      this.bb = P.bbox(this.pts);
      this.areaM2 = Math.abs(P.area(this.pts));
      if (kind === 'pool') {
        const h = terrain.avgBase(this.pts);
        this.flat = h - 0.25;
        terrain.pad(this.pts, h, 1.2, 4, 'pool');
      } else {
        const ring = P.resample(this.pts, 4);
        const hs = ring.map((p) => terrain.base(p[0], p[1]));
        const n = hs.length;
        const lv = hs.map((h, i) => {
          let m = h;
          for (let k = -5; k <= 5; k++) m = Math.min(m, hs[(i + k + n) % n]);
          return m;
        });
        this.samples = ring.map((p, i) => [p[0], p[1], lv[i] - 0.45]);
      }
    }
    level(x, y) {
      if (this.flat !== undefined) return this.flat;
      let sw = 0, sh = 0;
      for (const s of this.samples) {
        const d2 = (s[0] - x) * (s[0] - x) + (s[1] - y) * (s[1] - y) + 1;
        const w = 1 / (d2 * d2);
        sw += w;
        sh += s[2] * w;
      }
      return sh / sw;
    }
    contains(x, y) {
      return x >= this.bb[0] && x <= this.bb[2] && y >= this.bb[1] && y <= this.bb[3] && P.containsH(this.pts, this.holes, x, y);
    }
  }

  class Terrain {
    constructor(data) {
      this.data = data;
      const e = data.elev, w = data.elevWide;
      this.f = { x0: e.x0, y0: e.y0, dx: e.dx, nx: e.nx, ny: e.ny, h: Float32Array.from(e.h) };
      this.w = { x0: w.x0, y0: w.y0, dx: w.dx, nx: w.nx, ny: w.ny, h: Float32Array.from(w.h) };
      blur(this.f, 1);
      // 校园内 SRTM（数字表面模型）含建筑与树冠高度，额外平滑以接近地面高程
      const school = data.areas.find((a) => a.kind === 'school' && a.name === '汕头市金山中学');
      if (school) {
        const heavy = { ...this.f, h: this.f.h.slice() };
        blur(heavy, 4);
        const f = this.f;
        for (let j = 0; j < f.ny; j++)
          for (let i = 0; i < f.nx; i++) {
            const x = f.x0 + i * f.dx, y = f.y0 + j * f.dx;
            const d = P.contains(school.pts, x, y) ? 0 : P.distToRing(school.pts, x, y);
            const w = 1 - smoothstep(30, 140, d);
            const k = j * f.nx + i;
            if (w > 0 && f.h[k] > 0.01) f.h[k] = lerp(f.h[k], heavy.h[k], w);
          }
      }
      const [x0, y0, x1, y1] = data.region;
      this.region = data.region;
      this.res = 5;
      this.x0 = x0;
      this.y0 = y0;
      this.nx = Math.round((x1 - x0) / this.res) + 1;
      this.ny = Math.round((y1 - y0) / this.res) + 1;
      this.mods = [];
      this.waters = [];
      this.H = null;
    }
    // 原始地形（未修整）
    base(x, y) {
      const f = this.f;
      const hw = sampleBicubic(this.w, x, y);
      const fx1 = f.x0 + (f.nx - 1) * f.dx, fy1 = f.y0 + (f.ny - 1) * f.dx;
      const edge = Math.min(x - f.x0, fx1 - x, y - f.y0, fy1 - y);
      if (edge <= 0) return hw;
      return lerp(hw, sampleBicubic(f, x, y), smoothstep(0, 80, edge));
    }
    wideBase(x, y) {
      return sampleBicubic(this.w, x, y);
    }
    avgBase(pts) {
      const pp = P.samplePoints(pts, 2.5);
      let s = 0;
      for (const p of pp) s += this.base(p[0], p[1]);
      return s / pp.length;
    }
    // 平台：多边形内(及外扩 margin)完全整平，blend 范围内平滑过渡
    pad(pts, h, margin, blend, tag) {
      const m = { type: 'pad', pts, bb: P.bbox(pts), h, margin, blend, tag };
      this.mods.push(m);
      return m;
    }
    addWater(area, kind) {
      const wb = new WaterBody(this, area, kind);
      this.waters.push(wb);
      this.mods.push({ type: 'water', wb, bb: wb.bb });
      return wb;
    }
    bake() {
      const { nx, ny, res, x0, y0 } = this;
      const H = (this.H = new Float32Array(nx * ny));
      for (let j = 0; j < ny; j++)
        for (let i = 0; i < nx; i++) H[j * nx + i] = this.base(x0 + i * res, y0 + j * res);
      // 海：海岸线以外下沉，岸边形成护岸
      const sea = this.data.sea, coast = this.data.coast;
      if (sea && sea.length > 2) {
        const sb = P.bbox(sea);
        for (let j = 0; j < ny; j++) {
          const y = y0 + j * res;
          if (y < sb[1] - 15) continue;
          for (let i = 0; i < nx; i++) {
            const x = x0 + i * res, k = j * nx + i;
            const d = coast.length > 1 ? P.distToPolyline(coast, x, y) : 50;
            if (P.contains(sea, x, y)) H[k] = -1.8 - 5 * smoothstep(0, 45, d);
            else if (d < 12) H[k] = Math.max(H[k], lerp(2.2, H[k], smoothstep(4, 12, d)));
          }
        }
      }
      for (const m of this.mods) this._apply(m);
    }
    _range(bb, r) {
      const { res, x0, y0, nx, ny } = this;
      return [
        clamp(Math.floor((bb[0] - r - x0) / res), 0, nx - 1), clamp(Math.floor((bb[1] - r - y0) / res), 0, ny - 1),
        clamp(Math.ceil((bb[2] + r - x0) / res), 0, nx - 1), clamp(Math.ceil((bb[3] + r - y0) / res), 0, ny - 1),
      ];
    }
    _apply(m) {
      const { res, x0, y0, nx, H } = this;
      if (m.type === 'pad') {
        const R = m.margin + m.blend;
        const [i0, j0, i1, j1] = this._range(m.bb, R);
        for (let j = j0; j <= j1; j++)
          for (let i = i0; i <= i1; i++) {
            const x = x0 + i * res, y = y0 + j * res;
            const d = P.contains(m.pts, x, y) ? 0 : P.distToRing(m.pts, x, y);
            if (d >= R) continue;
            const w = d <= m.margin ? 1 : 1 - smoothstep(m.margin, R, d);
            const k = j * nx + i;
            H[k] = lerp(H[k], m.h, w);
          }
      } else if (m.type === 'water') {
        const wb = m.wb;
        const [i0, j0, i1, j1] = this._range(m.bb, 2);
        for (let j = j0; j <= j1; j++)
          for (let i = i0; i <= i1; i++) {
            const x = x0 + i * res, y = y0 + j * res;
            if (!wb.contains(x, y)) continue;
            const d = P.distToRing(wb.pts, x, y);
            const depth = wb.kind === 'pool' ? 1.6 : lerp(0.6, 2.2, smoothstep(0, 6, d));
            const k = j * nx + i;
            H[k] = Math.min(H[k], wb.level(x, y) - depth);
          }
      }
    }
    // 与网格三角剖分完全一致的高度查询
    height(x, y) {
      const { res, x0, y0, nx, ny, H } = this;
      const fx = (x - x0) / res, fy = (y - y0) / res;
      if (fx < 0 || fy < 0 || fx >= nx - 1 || fy >= ny - 1) return this.base(x, y);
      const i = Math.floor(fx), j = Math.floor(fy);
      const tx = fx - i, ty = fy - j;
      const k = j * nx + i;
      const ha = H[k], hb = H[k + 1], hc = H[k + nx], hd = H[k + nx + 1];
      if (tx + ty <= 1) return ha + (hb - ha) * tx + (hc - ha) * ty;
      return hd + (hc - hd) * (1 - tx) + (hb - hd) * (1 - ty);
    }
    waterAt(x, y) {
      for (const w of this.waters) if (w.contains(x, y)) return w;
      return null;
    }
    isSea(x, y) {
      return this.height(x, y) < 0.15;
    }

    // ---------- 网格 ----------
    buildFineMesh(material) {
      const { nx, ny, res, x0, y0, H } = this;
      const nB = 2 * (nx + ny) - 4;
      const pos = new Float32Array((nx * ny + nB) * 3);
      for (let j = 0; j < ny; j++)
        for (let i = 0; i < nx; i++) {
          const k = j * nx + i;
          pos[k * 3] = x0 + i * res;
          pos[k * 3 + 1] = H[k];
          pos[k * 3 + 2] = -(y0 + j * res);
        }
      const idx = [];
      for (let j = 0; j < ny - 1; j++)
        for (let i = 0; i < nx - 1; i++) {
          const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
          idx.push(a, b, c, b, d, c);
        }
      // 裙边（遮挡与远景地形之间的缝）
      const ring = [];
      for (let i = 0; i < nx; i++) ring.push(i);
      for (let j = 1; j < ny; j++) ring.push(j * nx + nx - 1);
      for (let i = nx - 2; i >= 0; i--) ring.push((ny - 1) * nx + i);
      for (let j = ny - 2; j >= 1; j--) ring.push(j * nx);
      let v = nx * ny;
      const skirt = [];
      for (const k of ring) {
        pos[v * 3] = pos[k * 3];
        pos[v * 3 + 1] = pos[k * 3 + 1] - 30;
        pos[v * 3 + 2] = pos[k * 3 + 2];
        skirt.push(v++);
      }
      for (let s = 0; s < ring.length; s++) {
        const a = ring[s], b = ring[(s + 1) % ring.length], c = skirt[s], d = skirt[(s + 1) % ring.length];
        idx.push(a, c, b, b, c, d);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, material);
      mesh.receiveShadow = true;
      mesh.castShadow = true;
      mesh.name = 'terrain';
      return mesh;
    }
    buildWideMesh(material) {
      const S = 50, X0 = -4000, N = 161;
      const [rx0, ry0, rx1, ry1] = this.region;
      const pos = new Float32Array(N * N * 3), col = new Float32Array(N * N * 3);
      const c = new THREE.Color();
      const urban = new THREE.Color('#9a958b'), forest = new THREE.Color('#3e5a2d'), forest2 = new THREE.Color('#566f3a');
      const rand = JZ.rng(42);
      const hgt = new Float32Array(N * N);
      for (let j = 0; j < N; j++)
        for (let i = 0; i < N; i++) {
          const x = X0 + i * S, y = X0 + j * S;
          let h = this.wideBase(x, y);
          const inside = x > rx0 && x < rx1 && y > ry0 && y < ry1;
          const onEdge = !inside && x >= rx0 && x <= rx1 && y >= ry0 && y <= ry1;
          if (inside) h = this.base(x, y) - 4;
          else if (onEdge) h = this.height(x, y);
          else if (h <= 0.8) h = -8;
          else if (y > 1650 && h < 30) h = 2.5 + (h - 2.5) * 0.12; // 对岸市区地面压平
          hgt[j * N + i] = h;
        }
      for (let j = 0; j < N; j++)
        for (let i = 0; i < N; i++) {
          const k = j * N + i, x = X0 + i * S, y = X0 + j * S, h = hgt[k];
          pos[k * 3] = x;
          pos[k * 3 + 1] = h;
          pos[k * 3 + 2] = -y;
          const t = smoothstep(5, 20, h) * (y > 1650 ? 0.6 : 1);
          c.copy(urban).lerp(rand() < 0.5 ? forest : forest2, t);
          if (h < 0) c.set('#5d6f60');
          col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b;
        }
      const idx = [];
      for (let j = 0; j < N - 1; j++)
        for (let i = 0; i < N - 1; i++) {
          const cx = X0 + (i + 0.5) * S, cy = X0 + (j + 0.5) * S;
          if (cx > rx0 && cx < rx1 && cy > ry0 && cy < ry1) continue;
          const a = j * N + i, b = a + 1, cc = a + N, d = cc + 1;
          idx.push(a, b, cc, b, d, cc);
        }
      this.wideH = { X0, S, N, h: hgt };
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, material);
      mesh.receiveShadow = true;
      mesh.name = 'terrain-far';
      return mesh;
    }
    farHeight(x, y) {
      const w = this.wideH;
      if (!w) return this.wideBase(x, y);
      const fx = (x - w.X0) / w.S, fy = (y - w.X0) / w.S;
      const i = clamp(Math.floor(fx), 0, w.N - 2), j = clamp(Math.floor(fy), 0, w.N - 2);
      const tx = fx - i, ty = fy - j, k = j * w.N + i;
      const a = w.h[k], b = w.h[k + 1], c = w.h[k + w.N], d = w.h[k + w.N + 1];
      return lerp(lerp(a, b, tx), lerp(c, d, tx), ty);
    }
    // 水面网格（沿用地形网格，与湖岸自然相交）
    buildWaterMeshes(lakeMat, poolMat) {
      const { nx, ny, res, x0, y0, H } = this;
      const group = new THREE.Group();
      for (const wb of this.waters) {
        const [i0, j0, i1, j1] = this._range(wb.bb, res);
        const vmap = new Map();
        const pos = [], idx = [];
        const vert = (i, j) => {
          const k = j * nx + i;
          if (vmap.has(k)) return vmap.get(k);
          const x = x0 + i * res, y = y0 + j * res;
          let h = wb.level(x, y);
          if (!wb.contains(x, y)) h = Math.min(h, H[k] - 0.35);
          vmap.set(k, pos.length / 3);
          pos.push(x, h, -y);
          return vmap.get(k);
        };
        for (let j = j0; j < j1; j++)
          for (let i = i0; i < i1; i++) {
            const xs = [x0 + i * res, x0 + (i + 1) * res], ys = [y0 + j * res, y0 + (j + 1) * res];
            let any = false;
            for (const xx of xs) for (const yy of ys) if (wb.contains(xx, yy)) any = true;
            if (!any && !wb.contains(xs[0] + res / 2, ys[0] + res / 2)) continue;
            const a = vert(i, j), b = vert(i + 1, j), c = vert(i, j + 1), d = vert(i + 1, j + 1);
            idx.push(a, b, c, b, d, c);
          }
        if (!idx.length) continue;
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        // 平面法线即可
        const nrm = new Float32Array(pos.length);
        const uv = new Float32Array((pos.length / 3) * 2);
        for (let v = 0; v < pos.length / 3; v++) {
          nrm[v * 3 + 1] = 1;
          uv[v * 2] = pos[v * 3] / 9;
          uv[v * 2 + 1] = pos[v * 3 + 2] / 9;
        }
        geo.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
        geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
        geo.setIndex(idx);
        const mesh = new THREE.Mesh(geo, wb.kind === 'pool' ? poolMat : lakeMat);
        mesh.receiveShadow = true;
        mesh.renderOrder = 1;
        group.add(mesh);
      }
      return group;
    }
  }
  JZ.Terrain = Terrain;

  // 地表材质：两级画布纹理（核心区高清 + 全区）+ 细节噪声
  JZ.makeGroundMaterial = function (coreTex, coreRect, wideTex, wideRect, detailTex, wallRect) {
    const m = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.96, metalness: 0 });
    const rectU = (r) => new THREE.Vector4(r[0], -r[3], r[2] - r[0], r[3] - r[1]);
    const wr = wallRect || [0, 0, 0, 0];
    m.userData.uniforms = {
      tCore: { value: coreTex }, tWide: { value: wideTex }, tDetail: { value: detailTex },
      coreRect: { value: rectU(coreRect) }, wideRect: { value: rectU(wideRect) },
      wallRect: { value: new THREE.Vector4(wr[0], -wr[3], wr[2], -wr[1]) },
    };
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, m.userData.uniforms);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNrm;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWNrm = normalize((modelMatrix * vec4(objectNormal, 0.0)).xyz);');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNrm;\nuniform sampler2D tCore, tWide, tDetail;\nuniform vec4 coreRect, wideRect, wallRect;')
        .replace(
          '#include <map_fragment>',
          `vec2 uvW = (vWPos.xz - wideRect.xy) / wideRect.zw;
           vec4 gcol = texture2D(tWide, uvW);
           vec2 uvC = (vWPos.xz - coreRect.xy) / coreRect.zw;
           if (uvC.x > 0.0 && uvC.x < 1.0 && uvC.y > 0.0 && uvC.y < 1.0) {
             float e = min(min(uvC.x, 1.0 - uvC.x), min(uvC.y, 1.0 - uvC.y));
             gcol = mix(gcol, texture2D(tCore, uvC), smoothstep(0.0, 0.015, e));
           }
           vec3 dt = texture2D(tDetail, vWPos.xz / 6.5).rgb;
           float dc = texture2D(tDetail, vWPos.xz / 47.0).g;
           gcol.rgb *= (0.84 + 0.32 * dt.r) * (0.9 + 0.2 * dc);
           // 陡坡：校园内为石砌挡土墙，山上为裸露花岗岩
           bool inCampus = vWPos.x > wallRect.x && vWPos.x < wallRect.z && vWPos.z > wallRect.y && vWPos.z < wallRect.w;
           float sl = 1.0 - vWNrm.y;
           float steep = inCampus ? smoothstep(0.03, 0.085, sl) : smoothstep(0.30, 0.46, sl);
           if (steep > 0.0) {
             float rock = texture2D(tDetail, vec2(vWPos.x + vWPos.z, vWPos.y * 2.0) / 5.0).r;
             float course = inCampus ? smoothstep(0.86, 0.93, fract(vWPos.y / 0.5)) * 0.45 : 0.0;
             vec3 wall = (inCampus ? vec3(0.20, 0.19, 0.165) : vec3(0.26, 0.245, 0.21)) * (0.75 + 0.5 * rock) * (1.0 - course);
             gcol.rgb = mix(gcol.rgb, wall, steep * 0.9);
           }
           diffuseColor *= gcol;`
        );
    };
    m.customProgramCacheKey = () => 'jz-ground';
    return m;
  };
  JZ.makeFarMaterial = function (detailTex) {
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.98, metalness: 0 });
    m.onBeforeCompile = (sh) => {
      sh.uniforms.tDetail = { value: detailTex };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nuniform sampler2D tDetail;')
        .replace(
          '#include <map_fragment>',
          `float dc = texture2D(tDetail, vWPos.xz / 260.0).g;
           float dt = texture2D(tDetail, vWPos.xz / 31.0).r;
           diffuseColor.rgb *= (0.72 + 0.56 * dc) * (0.86 + 0.28 * dt);`
        );
    };
    m.customProgramCacheKey = () => 'jz-far';
    return m;
  };
})();
