/* 触屏交互：单指/双指手势（平移、环绕、捏合缩放、旋转）+ 第一人称行走摇杆 + 动作键
 *
 * 坐标一律使用 #app 的逻辑坐标（JZ.view.toLocal / delta），因此「强制横屏」把界面旋转 90° 后依然正确。
 * 用 touch 事件而不是 pointer 事件：微信 X5 / 老版 WKWebView 上的兼容性更稳。
 */
(function () {
  'use strict';
  const JZ = window.JZ;
  const V = JZ.view;
  const { clamp } = JZ.math;
  const now = () => performance.now();

  const TAP_MOVE = 12;      // 触摸位移小于此值算点击
  const TAP_TIME = 400;     // ms
  const DBL_TIME = 320;     // 双击窗口
  const DBL_DIST = 40;

  function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function angle(a, b) { return Math.atan2(b.y - a.y, b.x - a.x); }
  function mid(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }

  class TouchInput {
    constructor(rig, app) {
      this.rig = rig;
      this.app = app;
      this.canvas = document.getElementById('scene');
      this.pts = new Map();
      this.drag = null;
      this.pinch = null;
      this.tap = null;
      this.lastTap = null;
      this.stickId = null;
      this.stick = { x: 0, y: 0, mag: 0 };
      this.runHeld = false;
      this._bindGestures();
      this._bindStick();
      this._bindActions();
      this._killBrowserGestures();
    }

    get enabled() { return V.isTouch; }

    // ---------- 画布手势 ----------
    _bindGestures() {
      if (!this.enabled) return; // 非触屏：交给 Rig 的鼠标/指针逻辑
      // 监听根容器而不是画布：手指落在标注上也要能参与手势。
      // 只处理「起点在画布或标注层」的触点（按手指 id 自己跟踪），
      // 摇杆 / 按钮 / 面板上的手指不会被算进来，也就不会把单指环顾误判成双指。
      const root = document.getElementById('app') || document;
      const opts = { passive: false };
      root.addEventListener('touchstart', (e) => this._down(e), opts);
      root.addEventListener('touchmove', (e) => this._move(e), opts);
      root.addEventListener('touchend', (e) => this._up(e), opts);
      root.addEventListener('touchcancel', (e) => this._cancel(e), opts);
    }

    _owns(el) {
      if (!el || !el.closest) return false;
      return el === this.canvas || !!el.closest('#labels');
    }

    _own(e) {
      const out = [];
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (this.pts.has(t.identifier)) out.push(t);
      }
      return out;
    }

    // 按当前画布触点重建手势状态（fresh=true：全新的一次触摸，允许判定为点击）
    _rebase(fresh) {
      const ids = Array.from(this.pts.keys());
      this.pinch = null;
      this.drag = null;
      this.tap = null;
      if (!ids.length) return;
      const rig = this.rig;
      const first = this.pts.get(ids[0]);
      if (ids.length >= 2 && rig.mode !== 'fps') {
        const a = this.pts.get(ids[0]), b = this.pts.get(ids[1]);
        this.pinch = { d: dist(a, b), a: angle(a, b), c: mid(a, b), mode: rig.mode };
        return;
      }
      // 单指，或第一人称下（环顾只跟第一根手指，多余的手指忽略）
      this.drag = { id: ids[0], lx: first.x, ly: first.y, moved: fresh ? 0 : 999 };
      if (fresh && ids.length === 1) this.tap = { id: ids[0], x: first.x, y: first.y, t: now() };
    }

    // 同步触点：位置取自 e.touches，丢失 touchend 的幽灵触点在这里清掉。返回是否有触点被移除
    _sync(e) {
      const alive = {};
      for (let i = 0; i < e.touches.length; i++) {
        const t = e.touches[i];
        alive[t.identifier] = t;
      }
      let removed = false;
      this.pts.forEach((p, id) => {
        const t = alive[id];
        if (!t) { this.pts.delete(id); removed = true; return; }
        const q = V.toLocal(t.clientX, t.clientY);
        p.x = q.x; p.y = q.y;
      });
      return removed;
    }

    _down(e) {
      let added = false, onlyLbl = true;
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (!this._owns(t.target)) continue; // 摇杆/按钮/面板上的手指：不归画布手势管
        const p = V.toLocal(t.clientX, t.clientY);
        p.lbl = !!(t.target.closest && t.target.closest('#labels'));
        this.pts.set(t.identifier, p);
        added = true;
        if (!p.lbl) onlyLbl = false;
      }
      if (!added) return;
      this._sync(e);
      // 只有标注上的触点不拦截，保留浏览器对标注的 click
      if (!onlyLbl && e.cancelable) e.preventDefault();
      if (this.rig.mode === 'transition') { this._rebase(false); return; }
      if (this.rig.mode === 'fps' && this.pts.size === 1) this.rig.unlock();
      this._rebase(this.pts.size === 1);
    }

    _move(e) {
      if (!this.pts.size) return;
      if (this._sync(e)) this._rebase(false);
      if (!this.pts.size) return;
      if (e.cancelable) e.preventDefault();
      const rig = this.rig;
      if (rig.mode === 'transition' || rig.tween) return;
      if (this.pinch && this.pinch.mode !== rig.mode) this._rebase(false);
      const ids = Array.from(this.pts.keys());

      if (this.pinch && ids.length >= 2) {
        const a = this.pts.get(ids[0]), b = this.pts.get(ids[1]);
        const d = dist(a, b), ang = angle(a, b), c = mid(a, b);
        const p = this.pinch;
        const scale = d / (p.d || d);
        const dAng = ang - p.a;
        const dc = { x: c.x - p.c.x, y: c.y - p.c.y };
        p.d = d; p.a = ang; p.c = c;

        if (rig.mode === 'top' || rig.mode === 'orbit') {
          // 双指张开 = 放大
          if (Math.abs(scale - 1) > 0.0015) rig.zoomAt(c.x, c.y, scale);
          rig.yaw += dAng;
          if (rig.mode === 'top') {
            rig.panBy(dc.x * 0.55, dc.y * 0.55);
          } else {
            rig.orbitPitch = clamp(rig.orbitPitch + dc.y * 0.005, 0.06, 1.5);
            rig.panBy(dc.x, dc.y);
          }
        }
        return;
      }

      const q = this.drag && this.pts.get(this.drag.id);
      if (q) {
        const dx = q.x - this.drag.lx, dy = q.y - this.drag.ly;
        this.drag.lx = q.x;
        this.drag.ly = q.y;
        this.drag.moved += Math.abs(dx) + Math.abs(dy);
        if (this.tap && this.drag.moved > TAP_MOVE) this.tap = null;

        if (rig.mode === 'fps') {
          const look = this._lookScale();
          rig.fp.yaw -= dx * 0.0042 * look;
          rig.fp.pitch = clamp(rig.fp.pitch - dy * 0.0042 * look, -1.5, 1.5);
        } else if (rig.mode === 'top') {
          rig.panBy(dx, dy);
        } else if (rig.mode === 'orbit') {
          // 与 Three.js OrbitControls 同向：向右滑，相机向左环绕（场景向右转）
          rig.yaw -= dx * 0.007;
          rig.orbitPitch = clamp(rig.orbitPitch + dy * 0.005, 0.06, 1.5);
        }
      }
    }

    _lookScale() {
      // 窄屏上手指行程短，稍微提高灵敏度
      return V.W < 480 ? 1.25 : 1;
    }

    _up(e) {
      const rig = this.rig;
      const ended = this._own(e);
      if (!ended.length) return;
      for (let i = 0; i < ended.length; i++) {
        const t = ended[i];
        if (this.tap && this.tap.id === t.identifier) {
          const p = V.toLocal(t.clientX, t.clientY);
          const dt = now() - this.tap.t;
          if (dt < TAP_TIME && Math.hypot(p.x - this.tap.x, p.y - this.tap.y) < TAP_MOVE) this._onTap(p);
          else this.lastTap = null;
        }
        this.pts.delete(t.identifier);
      }
      this._sync(e);
      // 少了一根手指：以剩下的手指重建基准，避免跳变
      this._rebase(false);
      if (e.cancelable) e.preventDefault();
      if (rig) rig.emit('touch', e);
    }

    _cancel(e) {
      const ended = this._own(e);
      for (let i = 0; i < ended.length; i++) this.pts.delete(ended[i].identifier);
      this._sync(e);
      this.lastTap = null;
      this._rebase(false);
    }

    _onTap(p) {
      const rig = this.rig;
      const lt = this.lastTap;
      const nowT = now();
      const isDouble = !!lt && nowT - lt.t < DBL_TIME && Math.hypot(p.x - lt.x, p.y - lt.y) < DBL_DIST;
      if (isDouble) {
        clearTimeout(this._tapTimer);
        this.lastTap = null;
        const g = rig.pickGround(p.x, p.y);
        if (!g) return;
        if (rig.blocked(g.x, g.y)) { this.app.ui.toast('这里是水面，换个地方吧'); return; }
        if (rig.mode !== 'fps') rig.setMode('fps', { at: { x: g.x, y: g.y }, yaw: rig.yaw });
        return;
      }
      this.lastTap = { x: p.x, y: p.y, t: nowT };
      if (rig.mode === 'fps') return; // 第一人称下单击不拾取，免得边走边误触
      clearTimeout(this._tapTimer);
      this._tapTimer = setTimeout(() => {
        this.lastTap = null;
        this.app.pickAt(p.x, p.y);
      }, DBL_TIME);
    }

    // ---------- 行走摇杆 ----------
    _bindStick() {
      const el = document.getElementById('stick');
      if (!el) return;
      this.stickEl = el;
      this.knob = el.querySelector('.knob');
      const opts = { passive: false };

      const start = (e) => {
        if (!this.enabled || this.rig.mode !== 'fps') return;
        const t = e.changedTouches ? e.changedTouches[0] : e;
        if (this.stickId !== null) return;
        this.stickId = t.identifier !== undefined ? t.identifier : 'x';
        el.classList.add('active');
        this._stickMove(t);
        if (e.cancelable) e.preventDefault();
      };
      const move = (e) => {
        if (this.stickId === null) return;
        if (e.cancelable) e.preventDefault();
        // 只跟随按下摇杆的那根手指（另一根在画布上环顾）
        let t = null;
        if (e.touches) {
          for (let i = 0; i < e.touches.length; i++) if (e.touches[i].identifier === this.stickId) t = e.touches[i];
        } else t = e;
        if (t) this._stickMove(t);
      };
      const end = (e) => {
        if (this.stickId === null) return;
        this.stickId = null;
        this.stick.x = this.stick.y = this.stick.mag = 0;
        this.rig.applyStick(0, 0);
        if (this.knob) this.knob.style.transform = '';
        el.classList.remove('active');
        if (e && e.cancelable) e.preventDefault();
      };

      el.addEventListener('touchstart', start, opts);
      el.addEventListener('touchmove', move, opts);
      el.addEventListener('touchend', end, opts);
      el.addEventListener('touchcancel', end, opts);
      // 鼠标（桌面调试 / 混合设备）
      el.addEventListener('mousedown', (e) => {
        if (!this.enabled || this.rig.mode !== 'fps') return;
        this.stickId = 'x';
        el.classList.add('active');
        this._stickMove(e);
        const mm = (ev) => this._stickMove(ev);
        const mu = () => {
          document.removeEventListener('mousemove', mm);
          document.removeEventListener('mouseup', mu);
          end();
        };
        document.addEventListener('mousemove', mm);
        document.addEventListener('mouseup', mu);
        e.preventDefault();
      });
    }

    _stickMove(t) {
      const el = this.stickEl;
      if (!el) return;
      const V = JZ.view;
      const r = el.getBoundingClientRect();
      // 圆心换算到逻辑坐标（强制横屏时 #app 整体旋转过）
      const c = V.toLocal(r.left + r.width / 2, r.top + r.height / 2);
      const p = V.toLocal(t.clientX, t.clientY);
      let dx = p.x - c.x, dy = p.y - c.y;
      const R = Math.min(r.width, r.height) * 0.34;
      const l = Math.hypot(dx, dy);
      const k = l > R ? R / l : 1;
      dx *= k; dy *= k;
      this.stick.x = dx / R;
      this.stick.y = dy / R;
      this.stick.mag = Math.min(1, l / R);
      this.rig.applyStick(this.stick.x, this.stick.y);
      if (this.knob) this.knob.style.transform = `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px)`;
    }

    // ---------- 动作键 ----------
    _bindActions() {
      const pad = document.getElementById('actionPad');
      if (!pad) return;
      this.padEl = pad;
      this.btns = {};
      pad.querySelectorAll('.abtn').forEach((b) => {
        const act = b.dataset.act;
        this.btns[act] = b;
        b.addEventListener('touchstart', (e) => {
          if (!this.enabled) return;
          e.preventDefault();
          this._act(act, b, true);
        }, { passive: false });
        b.addEventListener('touchend', (e) => { e.preventDefault(); this._act(act, b, false); }, { passive: false });
        b.addEventListener('touchcancel', () => this._act(act, b, false));
        // 鼠标
        b.addEventListener('mousedown', (e) => { if (this.enabled) { e.preventDefault(); this._act(act, b, true); } });
        b.addEventListener('mouseup', (e) => { if (this.enabled) { e.preventDefault(); this._act(act, b, false); } });
        b.addEventListener('mouseleave', () => { if (this.enabled) this._act(act, b, false); });
      });
      this._syncFly();
    }

    _act(act, btn, down) {
      const rig = this.rig;
      this.held = this.held || {};
      this.held[act] = down;
      if (act === 'jump') {
        if (rig.fly) this._syncFlyHold();
        else if (down) rig.jump();
        return;
      }
      if (act === 'run') {
        if (rig.fly) this._syncFlyHold();
        else {
          this.runHeld = down;
          rig.runHeld = down;
          btn.classList.toggle('down', down);
        }
        return;
      }
      if (act === 'fly') {
        if (!down) return;
        rig.fly = !rig.fly;
        this.runHeld = false;
        rig.runHeld = false;
        if (this.btns && this.btns.run) this.btns.run.classList.remove('down');
        this._syncFly();
        this.app.ui.toast(rig.fly ? '飞行模式：摇杆前后移动，「升 / 降」控制高度' : '步行模式');
        return;
      }
    }

    // 飞行模式：跳=升、跑=降，按住持续升降
    _syncFlyHold() {
      const h = this.held || {};
      this.rig.flyHold = h.jump ? 1 : h.run ? -1 : 0;
    }

    _syncFly() {
      const fly = this.rig.fly;
      const jump = this.btns && this.btns.jump;
      const run = this.btns && this.btns.run;
      const f = this.btns && this.btns.fly;
      if (jump) { jump.textContent = fly ? '升' : '跳'; jump.classList.toggle('down', !!(this.held && this.held.jump)); }
      if (run) { run.textContent = fly ? '降' : '跑'; run.classList.toggle('down', !!(this.held && this.held.run)); }
      if (f) f.classList.toggle('on', fly);
      this._syncFlyHold();
    }

    // ---------- 阻止浏览器自身的缩放/下拉刷新 ----------
    _killBrowserGestures() {
      if (!this.enabled) return;
      const stop = (e) => { if (e.cancelable) e.preventDefault(); };
      document.addEventListener('gesturestart', stop, { passive: false });
      document.addEventListener('gesturechange', stop, { passive: false });
      document.addEventListener('gestureend', stop, { passive: false });
      // 双指在任意位置都不要触发页面缩放（单指保持默认，免得影响按钮点击）
      document.addEventListener('touchmove', (e) => {
        if (e.touches && e.touches.length > 1 && e.cancelable) e.preventDefault();
      }, { passive: false });
      // 阻止长按弹出菜单（只针对画布与虚拟控件）
      ['#scene', '#stick', '#actionPad'].forEach((s) => {
        const el = document.querySelector(s);
        if (el) el.addEventListener('contextmenu', (e) => e.preventDefault());
      });
    }

    // 飞行模式下「升/降」按住时持续升降由 Rig.flyHold 处理，这里只保持按钮状态
    update() {
      if (!this.enabled) return;
      const jb = this.btns && this.btns.jump, rb = this.btns && this.btns.run;
      if (jb) jb.classList.toggle('down', !!(this.held && this.held.jump));
      if (rb) rb.classList.toggle('down', !!(this.held && this.held.run));
    }

    syncMode() {
      this._syncFly();
    }
  }
  JZ.TouchInput = TouchInput;
})();
