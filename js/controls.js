/* 相机控制：俯视（地图式平移/缩放/旋转）、鸟瞰（环绕）、第一人称（指针锁定 + WASD + 碰撞 + 重力） */
(function () {
  'use strict';
  const JZ = window.JZ;
  const P = JZ.poly;
  const { clamp, lerp } = JZ.math;

  const EYE = 1.65, RADIUS = 0.35;
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  class Rig {
    constructor(camera, dom, world) {
      this.cam = camera;
      this.dom = dom;
      this.world = world; // { terrain, obstacleGrid, decks, bounds }
      this.mode = 'top';
      this.target = new THREE.Vector3(-40, 40, 20);
      this.dist = 950;
      this.yaw = 0;
      this.orbitPitch = 0.62;
      this.fp = { x: 0, y: 0, feet: 0, vz: 0, yaw: 0, pitch: 0, vx: 0, vy: 0, onGround: false, camY: 0, bob: 0 };
      this.fly = false;
      this.stick = { x: 0, y: 0, mag: 0, active: false }; // 触屏摇杆（-1..1）
      this.runHeld = false;   // 触屏「跑」按钮
      this.flyHold = 0;       // 触屏飞行升降：+1 / -1
      this.keys = {};
      this.locked = false;
      this.tween = null;
      this.listeners = {};
      this.drag = null;
      this.buf = [];
      this.cp = [0, 0];
      this._bind();
    }
    on(ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); }
    emit(ev, ...a) { (this.listeners[ev] || []).forEach((f) => f(...a)); }
    // 事件 → #app 逻辑坐标
    _lp(e) { const p = JZ.view.toLocal(e.clientX, e.clientY); return [p.x, p.y]; }

    _bind() {
      const d = this.dom;
      const V = JZ.view || {};
      d.addEventListener('contextmenu', (e) => e.preventDefault());
      // 触屏设备上指针/滚轮/指针锁定全部交给 js/touch.js，避免鼠标逻辑与手势打架
      if (!V.isTouch) {
        d.addEventListener('pointerdown', (e) => {
          if (this.tween) return;
          if (this.mode === 'fps') {
            if (!this.locked) this.lock();
            return;
          }
          d.setPointerCapture(e.pointerId);
          this.drag = { b: e.button, x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, shift: e.shiftKey, moved: 0 };
        });
        d.addEventListener('pointermove', (e) => {
          if (this.mode === 'fps') return;
          const dr = this.drag;
          if (!dr) return;
          const dx = e.clientX - dr.x, dy = e.clientY - dr.y;
          dr.x = e.clientX;
          dr.y = e.clientY;
          dr.moved += Math.abs(dx) + Math.abs(dy);
          const pan = this.mode === 'top' ? dr.b === 0 && !dr.shift : dr.b === 2 || dr.b === 1 || dr.shift;
          if (pan) this._pan(dx, dy);
          else if (this.mode === 'top') this.yaw += dx * 0.006;
          else {
            // 鸟瞰环绕与 OrbitControls 同向：向右拖，相机向左环绕
            this.yaw -= dx * 0.006;
            this.orbitPitch = clamp(this.orbitPitch + dy * 0.005, 0.06, 1.5);
          }
        });
        d.addEventListener('pointerup', (e) => {
          const dr = this.drag;
          this.drag = null;
          if (dr && dr.moved < 5 && dr.b === 0) this.emit('click', e);
        });
        d.addEventListener('dblclick', (e) => {
          if (this.mode === 'fps') return;
          const p = this.pickGround(...this._lp(e));
          if (p) this.emit('dblground', p);
        });
        d.addEventListener('wheel', (e) => {
          e.preventDefault();
          if (this.mode === 'fps' || this.tween) return;
          const f = Math.pow(1.0015, e.deltaY * (e.deltaMode === 1 ? 30 : 1));
          this.zoomAt(...this._lp(e), 1 / f);
        }, { passive: false });
        document.addEventListener('pointerlockchange', () => {
          this.locked = document.pointerLockElement === this.dom;
          this.emit('lock', this.locked);
        });
        document.addEventListener('mousemove', (e) => {
          if (this.mode !== 'fps' || !this.locked) return;
          this.fp.yaw -= e.movementX * 0.0022;
          this.fp.pitch = clamp(this.fp.pitch - e.movementY * 0.0022, -1.5, 1.5);
        });
      }
      window.addEventListener('keydown', (e) => {
        if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
        this.keys[e.code] = true;
        if (this.mode === 'fps' && e.code === 'Space') e.preventDefault();
        if (this.mode === 'fps' && e.code === 'Space' && this.fp.onGround && !this.fly) {
          this.fp.vz = 5.2;
          this.fp.onGround = false;
        }
      });
      window.addEventListener('keyup', (e) => { this.keys[e.code] = false; });
      window.addEventListener('blur', () => { this.keys = {}; });
    }
    // 屏幕坐标缩放（滚轮 / 双指捏合共用）；入参为 #app 逻辑坐标，factor>1 表示放大
    zoomAt(lx, ly, factor) {
      if (this.mode === 'fps' || this.tween) return;
      const nd = clamp(this.dist / factor, 25, 3200);
      const g = this.pickGround(lx, ly);
      if (g) {
        const k = 1 - nd / this.dist;
        this.target.x += (g.wx - this.target.x) * k;
        this.target.z += (g.wz - this.target.z) * k;
      }
      this.dist = nd;
    }
    // 按屏幕位移平移（逻辑像素，已按当前视角换算）
    panBy(dx, dy) { if (this.mode !== 'fps') this._pan(dx, dy); }

    // ---------- 触屏输入（由 js/touch.js 调用） ----------
    applyStick(x, y) {
      this.stick.x = x;
      this.stick.y = y;
      this.stick.mag = Math.min(1, Math.hypot(x, y));
      this.stick.active = this.stick.mag > 0.14;
    }
    jump() {
      if (this.fly) return;
      if (this.fp.onGround) { this.fp.vz = 5.2; this.fp.onGround = false; }
    }
    flyStep(dir) { this.flyHold = dir; }
    lock() {
      if (this.dom.requestPointerLock) {
        try {
          const r = this.dom.requestPointerLock();
          if (r && r.catch) r.catch(() => {});
        } catch (e) { /* 忽略 */ }
      }
    }
    unlock() { if (document.pointerLockElement) document.exitPointerLock(); }

    _pan(dx, dy) {
      const h = (JZ.view && JZ.view.H) || this.dom.clientHeight || 800;
      const k = (2 * this.dist * Math.tan((this.cam.fov * Math.PI) / 360)) / h;
      const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
      // right = (cos, 0, -sin); forward(水平) = (-sin, 0, -cos)
      const m = this.mode === 'top' ? 1 : 1 / Math.max(0.35, Math.sin(this.orbitPitch));
      this.target.x += (-c * dx + -s * dy * m) * k;
      this.target.z += (s * dx + -c * dy * m) * k;
    }
    // 射线与地形求交（步进 + 二分）。入参为 #app 逻辑坐标（屏幕坐标先过 JZ.view.toLocal），
    // 这样「强制横屏」整体旋转后拾取依然准确。
    pickGround(lx, ly) {
      const V = JZ.view;
      const W = (V && V.W) || this.dom.clientWidth || 800;
      const H = (V && V.H) || this.dom.clientHeight || 600;
      const ndc = new THREE.Vector2((lx / W) * 2 - 1, -(ly / H) * 2 + 1);
      const rc = new THREE.Raycaster();
      rc.setFromCamera(ndc, this.cam);
      const o = rc.ray.origin, d = rc.ray.direction;
      const T = this.world.terrain;
      let prev = 0, t = 0;
      const step = Math.max(1, this.dist / 300);
      const above = (tt) => o.y + d.y * tt - T.height(o.x + d.x * tt, -(o.z + d.z * tt));
      if (above(0) < 0) return null;
      for (let i = 0; i < 6000; i++) {
        t += step * (1 + i * 0.01);
        if (above(t) < 0) {
          let a = prev, b = t;
          for (let k = 0; k < 24; k++) {
            const m = (a + b) / 2;
            if (above(m) > 0) a = m;
            else b = m;
          }
          const wx = o.x + d.x * b, wz = o.z + d.z * b;
          return { wx, wz, x: wx, y: -wz, h: o.y + d.y * b };
        }
        prev = t;
        if (t > 20000) break;
      }
      return null;
    }

    // ---------- 模式切换 ----------
    setMode(mode, opts = {}) {
      const from = this.mode;
      if (mode === from && !opts.force) return;
      const T = this.world.terrain;
      if (from === 'fps') this.unlock();
      if (mode === 'fps') {
        let x, y, yaw;
        if (opts.at) { x = opts.at.x; y = opts.at.y; yaw = opts.yaw !== undefined ? opts.yaw : this.yaw; }
        else if (from === 'fps') { x = this.fp.x; y = this.fp.y; yaw = this.fp.yaw; }
        else { x = this.target.x; y = -this.target.z; yaw = this.yaw; }
        const free = this.findFree(x, y);
        this.fp.x = free[0];
        this.fp.y = free[1];
        this.fp.feet = this.groundAt(this.fp.x, this.fp.y, 1e9);
        this.fp.vz = 0;
        this.fp.vx = this.fp.vy = 0;
        this.fp.yaw = yaw;
        this.fp.pitch = opts.pitch !== undefined ? opts.pitch : -0.05;
        this.fp.camY = this.fp.feet + EYE;
        const toPos = new THREE.Vector3(this.fp.x, this.fp.camY, -this.fp.y);
        const toQ = new THREE.Quaternion().setFromEuler(new THREE.Euler(this.fp.pitch, this.fp.yaw, 0, 'YXZ'));
        this.mode = 'transition';
        this._pendingMode = 'fps';
        this.emit('mode', 'transition');
        this._tweenTo(toPos, toQ, opts.instant ? 0 : 1.5, () => { this.mode = 'fps'; this.emit('mode', 'fps'); if (!opts.noLock) this.lock(); });
        return;
      }
      // 俯视 / 鸟瞰
      if (from === 'fps' || from === 'transition') {
        this.target.set(this.fp.x, T.height(this.fp.x, this.fp.y), -this.fp.y);
        this.yaw = this.fp.yaw;
        this.dist = mode === 'top' ? 260 : 180;
      }
      if (opts.target) this.target.copy(opts.target);
      if (opts.dist) this.dist = opts.dist;
      if (opts.yaw !== undefined) this.yaw = opts.yaw;
      if (opts.pitch !== undefined) this.orbitPitch = opts.pitch;
      const pose = this._mapPose(mode);
      this.mode = 'transition';
      this._pendingMode = mode;
      this.emit('mode', 'transition');
      this._tweenTo(pose.pos, pose.q, opts.instant ? 0 : 1.1, () => { this.mode = mode; this.emit('mode', mode); });
    }
    _mapPose(mode) {
      const p = mode === 'top' ? Math.PI / 2 - 1e-4 : this.orbitPitch;
      const t = this.target;
      const pos = new THREE.Vector3(
        t.x + Math.sin(this.yaw) * Math.cos(p) * this.dist,
        t.y + Math.sin(p) * this.dist,
        t.z + Math.cos(this.yaw) * Math.cos(p) * this.dist
      );
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-p, this.yaw, 0, 'YXZ'));
      return { pos, q };
    }
    _tweenTo(pos, q, dur, done) {
      if (!dur) {
        this.cam.position.copy(pos);
        this.cam.quaternion.copy(q);
        this.tween = null;
        done && done();
        return;
      }
      // 抬高中间路径，避免穿过地形
      const p0 = this.cam.position.clone(), q0 = this.cam.quaternion.clone();
      const lift = Math.min(250, p0.distanceTo(pos) * 0.25);
      this.tween = { p0, q0, p1: pos.clone(), q1: q.clone(), t: 0, dur, done, lift };
    }
    flyTo(x, y, dist, yaw) {
      if (this.mode === 'fps' || this.mode === 'transition') return;
      const m = this.mode;
      this.target.set(x, this.world.terrain.height(x, y), -y);
      if (dist) this.dist = dist;
      if (yaw !== undefined) this.yaw = yaw;
      const pose = this._mapPose(m);
      this.mode = 'transition';
      this._pendingMode = m;
      this._tweenTo(pose.pos, pose.q, 1.2, () => { this.mode = m; this.emit('mode', m); });
    }

    // ---------- 第一人称物理 ----------
    groundAt(x, y, feet) {
      let g = this.world.terrain.height(x, y);
      if (this.world.decks && this.world.decks.length) {
        const dh = JZ.Props.deckHeight(this.world.decks, x, y, feet);
        if (dh !== null && dh > g) g = dh;
      }
      return g;
    }
    blocked(x, y) {
      const T = this.world.terrain;
      const b = this.world.bounds;
      if (x < b[0] + 5 || x > b[2] - 5 || y < b[1] + 5 || y > b[3] - 5) return true;
      if (T.waterAt(x, y)) return !this._onDeck(x, y);
      if (T.height(x, y) < 0.4) return !this._onDeck(x, y);
      return false;
    }
    _onDeck(x, y) {
      return this.world.decks && JZ.Props.deckHeight(this.world.decks, x, y, this.fp.feet) !== null;
    }
    resolve(x, y, feet) {
      const grid = this.world.obstacleGrid;
      if (!grid) return [x, y];
      const r = RADIUS, cp = this.cp;
      for (let it = 0; it < 4; it++) {
        const items = grid.query(x, y, r + 1, this.buf);
        let moved = false;
        for (const o of items) {
          if (o.circle) {
            const dx = x - o.x, dy = y - o.y, dd = Math.hypot(dx, dy), m = r + o.r;
            if (dd < m && dd > 1e-6) { x = o.x + (dx / dd) * m; y = o.y + (dy / dd) * m; moved = true; }
            continue;
          }
          if (o.top !== undefined && feet > o.top - 0.2) continue; // 已在其上方（如低矮构筑物）
          if (x < o.bb[0] - r || x > o.bb[2] + r || y < o.bb[1] - r || y > o.bb[3] + r) continue;
          const inside = P.contains(o.pts, x, y);
          const dd = P.distToRing(o.pts, x, y, cp);
          if (inside) {
            const dx = cp[0] - x, dy = cp[1] - y, l = Math.hypot(dx, dy) || 1;
            x = cp[0] + (dx / l) * r;
            y = cp[1] + (dy / l) * r;
            moved = true;
          } else if (dd < r) {
            const dx = x - cp[0], dy = y - cp[1], l = dd || 1;
            x = cp[0] + (dx / l) * r;
            y = cp[1] + (dy / l) * r;
            moved = true;
          }
        }
        if (!moved) break;
      }
      return [x, y];
    }
    findFree(x, y) {
      for (let r = 0; r < 120; r += 1.5) {
        const n = Math.max(1, Math.round(r * 1.2));
        for (let k = 0; k < n; k++) {
          const a = (k / n) * Math.PI * 2;
          const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
          if (this.blocked(px, py)) continue;
          const [qx, qy] = this.resolve(px, py, -1e9);
          if (Math.hypot(qx - px, qy - py) < 0.01) return [px, py];
        }
      }
      return [x, y];
    }
    updateFPS(dt) {
      const k = this.keys, f = this.fp;
      const run = k.ShiftLeft || k.ShiftRight || this.runHeld;
      const speed = this.fly ? (run ? 45 : 15) : run ? 8.5 : 4.3;
      let mf = 0, ms = 0;
      if (k.KeyW || k.ArrowUp) mf += 1;
      if (k.KeyS || k.ArrowDown) mf -= 1;
      if (k.KeyA || k.ArrowLeft) ms -= 1;
      if (k.KeyD || k.ArrowRight) ms += 1;
      // 触屏摇杆：屏幕右为 +x、下为 +y；前进对应摇杆向上（y<0）
      const st = this.stick;
      if (st.active) {
        const m = st.mag;
        mf += -st.y * m;
        ms += st.x * m;
      }
      const sy = Math.sin(f.yaw), cy = Math.cos(f.yaw);
      // 本地平面：前 = (-sin, cos)，右 = (cos, sin)
      let dx = -sy * mf + cy * ms, dy = cy * mf + sy * ms;
      const l = Math.hypot(dx, dy);
      // 摇杆推得越轻走得越慢
      const gain = st.active ? clamp(st.mag * 1.15, 0, 1) : 1;
      if (l > 0) { dx = (dx / l) * speed * gain; dy = (dy / l) * speed * gain; }
      const a = 1 - Math.exp(-dt * (this.fly ? 4 : 11));
      f.vx = lerp(f.vx, dx, a);
      f.vy = lerp(f.vy, dy, a);
      let nx = f.x + f.vx * dt, ny = f.y + f.vy * dt;
      if (this.fly) {
        let vz = 0;
        if (k.Space || k.KeyE) vz += speed;
        if (k.KeyC || k.KeyQ || k.ControlLeft) vz -= speed;
        if (this.flyHold > 0) vz += speed;
        else if (this.flyHold < 0) vz -= speed;
        f.feet += vz * dt;
        const b = this.world.bounds;
        f.x = clamp(nx, b[0], b[2]);
        f.y = clamp(ny, b[1], b[3]);
        const g = this.world.terrain.height(f.x, f.y);
        if (f.feet < g) f.feet = g;
        f.feet = Math.min(f.feet, 1500);
        f.camY = f.feet + EYE;
      } else {
        [nx, ny] = this.resolve(nx, ny, f.feet);
        if (this.blocked(nx, ny)) {
          // 沿轴滑动
          if (!this.blocked(nx, f.y)) ny = f.y;
          else if (!this.blocked(f.x, ny)) nx = f.x;
          else { nx = f.x; ny = f.y; }
          [nx, ny] = this.resolve(nx, ny, f.feet);
        }
        const g = this.groundAt(nx, ny, f.feet);
        // 过陡（> 约 1.2m 的台阶）则阻挡
        if (g - f.feet > 1.25 && f.onGround) { nx = f.x; ny = f.y; }
        f.x = nx;
        f.y = ny;
        const ground = this.groundAt(f.x, f.y, f.feet);
        f.vz -= 17 * dt;
        f.feet += f.vz * dt;
        if (f.feet <= ground || (f.onGround && f.vz <= 0 && f.feet - ground < 0.7)) {
          f.feet = ground;
          f.vz = 0;
          f.onGround = true;
        } else f.onGround = false;
        const moving = Math.hypot(f.vx, f.vy);
        if (f.onGround && moving > 0.5) f.bob += dt * moving * 1.9;
        const bob = f.onGround ? Math.sin(f.bob) * 0.035 * Math.min(1, moving / 4) : 0;
        f.camY = lerp(f.camY, f.feet + EYE + bob, 1 - Math.exp(-dt * 18));
      }
      this.cam.position.set(f.x, f.camY, -f.y);
      this.cam.rotation.set(f.pitch, f.yaw, 0, 'YXZ');
    }

    update(dt) {
      if (this.tween) {
        const tw = this.tween;
        tw.t += dt / tw.dur;
        const t = Math.min(1, tw.t), e = ease(t);
        this.cam.position.lerpVectors(tw.p0, tw.p1, e);
        this.cam.position.y += Math.sin(Math.PI * e) * tw.lift;
        this.cam.quaternion.slerpQuaternions(tw.q0, tw.q1, e);
        if (t >= 1) {
          this.tween = null;
          tw.done && tw.done();
        }
        return;
      }
      if (this.mode === 'fps') {
        this.updateFPS(Math.min(dt, 0.05));
        return;
      }
      if (this.mode !== 'top' && this.mode !== 'orbit') return;
      // 键盘平移/旋转
      const k = this.keys;
      const pan = 600 * dt;
      if (k.KeyW || k.ArrowUp) this._pan(0, pan);
      if (k.KeyS || k.ArrowDown) this._pan(0, -pan);
      if (k.KeyA || k.ArrowLeft) this._pan(pan, 0);
      if (k.KeyD || k.ArrowRight) this._pan(-pan, 0);
      if (k.KeyQ) this.yaw += dt * 1.2;
      if (k.KeyE) this.yaw -= dt * 1.2;
      if (k.Equal || k.NumpadAdd) this.dist = Math.max(25, this.dist * (1 - dt * 1.5));
      if (k.Minus || k.NumpadSubtract) this.dist = Math.min(3200, this.dist * (1 + dt * 1.5));
      const b = this.world.bounds;
      this.target.x = clamp(this.target.x, b[0] - 300, b[2] + 300);
      this.target.z = clamp(this.target.z, -b[3] - 300, -b[1] + 300);
      this.target.y = lerp(this.target.y, this.world.terrain.height(this.target.x, -this.target.z), 0.2);
      const pose = this._mapPose(this.mode);
      // 鸟瞰时避免相机钻入地形/楼顶以下
      const gh = this.world.terrain.height(pose.pos.x, -pose.pos.z);
      if (pose.pos.y < gh + 8) pose.pos.y = gh + 8;
      this.cam.position.copy(pose.pos);
      this.cam.quaternion.copy(pose.q);
    }
    // 小地图/指南针使用的朝向
    heading() {
      if (this.mode === 'fps') return this.fp.yaw;
      if (this.mode === 'transition') {
        const e = new THREE.Euler().setFromQuaternion(this.cam.quaternion, 'YXZ');
        return e.y;
      }
      return this.yaw;
    }
    focus() {
      if (this.mode === 'fps') return { x: this.fp.x, y: this.fp.y };
      if (this.mode === 'transition') return { x: this.cam.position.x, y: -this.cam.position.z };
      return { x: this.target.x, y: -this.target.z };
    }
  }
  JZ.Rig = Rig;
})();
