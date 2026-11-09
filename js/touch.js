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
      const c = this.canvas;
      const opts = { passive: false };
      c.addEventListener('touchstart', (e) => this._down(e), opts);
      c.addEventListener('touchmove', (e) => this._move(e), opts);
      c.addEventListener('touchend', (e) => this._up(e), opts);
      c.addEventListener('touchcancel', (e) => this._cancel(e), opts);
    }

    _collect(e, out) {
      out.length = 0;
      for (let i = 0; i < e.touches.length; i++) {
        const t = e.touches[i];
        const p = V.toLocal(t.clientX, t.clientY);
        p.id = t.identifier;
        out.push(p);
      }
      return out;
    }

    _down(e) {
      // 触屏设备上完全接管，避免页面滚动/缩放
      if (e.cancelable) e.preventDefault();
      const list = this._collect(e, this._buf || (this._buf = []));
      if (list.length === 1) {
        const p = list[0];
        this.tap = { x: p.x, y: p.y, t: now() };
        this.touchId = p.id;
        this.drag = { lx: p.x, ly: p.y, moved: 0, start: p };
        this.pinch = null;
        if (this.rig.mode === 'transition') return;
        if (this.rig.mode === 'fps') this.rig.unlock();
      } else if (list.length >= 2) {
        const a = list[0], b = list[1];
        this.pinch = { d: dist(a, b), a: angle(a, b), c: mid(a, b), mode: this.rig.mode };
        this.drag = null;
        this.tap = null;
      }
    }

    _move(e) {
      if (e.cancelable) e.preventDefault();
      const list = this._collect(e, this._buf || (this._buf = []));
      const rig = this.rig;
      if (rig.mode === 'transition' || rig.tween) return;

      if (this.pinch && list.length >= 2) {
        const a = list[0], b = list[1];
        const d = dist(a, b), ang = angle(a, b), c = mid(a, b);
        const p = this.pinch;
        const scale = d / (p.d || d);
        const dAng = ang - p.a;
        const dc = { x: c.x - p.c.x, y: c.y - p.c.y };
        p.d = d; p.a = ang; p.c = c;

        if (rig.mode === 'top' || rig.mode === 'orbit') {
          // 双指张开 = 放大（dist 变小）
          if (Math.abs(scale - 1) > 0.0015) rig.zoomAt(c.x, c.y, scale);
          if (rig.mode === 'top') {
            rig.yaw += dAng;
            rig.panBy(dc.x * 0.55, dc.y * 0.55);
          } else {
            rig.yaw += dAng;
            rig.orbitPitch = clamp(rig.orbitPitch + dc.y * 0.005, 0.06, 1.5);
            rig.panBy(dc.x, dc.y);
          }
        }
        return;
      }

      if (this.drag && list.length === 1) {
        const p = list[0];
        const dx = p.x - this.drag.lx, dy = p.y - this.drag.ly;
        this.drag.lx = p.x;
        this.drag.ly = p.y;
        this.drag.moved += Math.abs(dx) + Math.abs(dy);
        if (this.tap && this.drag.moved > TAP_MOVE) this.tap = null;

        if (rig.mode === 'fps') {
          const look = this._lookScale();
          rig.fp.yaw -= dx * 0.0042 * look;
          rig.fp.pitch = clamp(rig.fp.pitch - dy * 0.0042 * look, -1.5, 1.5);
        } else if (rig.mode === 'top') {
          rig.panBy(dx, dy);
        } else if (rig.mode === 'orbit') {
          rig.yaw += dx * 0.007;
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
      // 只认结束的那根手指，避免多指交错时误判
      if (this.tap && e.changedTouches && e.changedTouches.length) {
        let t = e.changedTouches[0];
        for (let i = 0; i < e.changedTouches.length; i++) {
          if (e.changedTouches[i].identifier === this.touchId) t = e.changedTouches[i];
        }
        const p = V.toLocal(t.clientX, t.clientY);
        const dt = now() - this.tap.t;
        if (dt < TAP_TIME && Math.hypot(p.x - this.tap.x, p.y - this.tap.y) < TAP_MOVE) {
          this._onTap(p);
        } else this.lastTap = null;
      }
      if (e.touches.length === 0) {
        this.drag = null;
        this.pinch = null;
        this.tap = null;
      } else if (e.touches.length === 1) {
        // 双指变单指：重置基准，避免跳变
        const t = e.touches[0];
        const p = V.toLocal(t.clientX, t.clientY);
        this.touchId = t.identifier;
        this.drag = { lx: p.x, ly: p.y, moved: 999, start: p };
        this.pinch = null;
        this.tap = null;
      }
      if (rig) rig.emit('touch', e);
    }

    _cancel(e) {
      this.drag = null;
      this.pinch = null;
      this.tap = null;
      this.lastTap = null;
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
