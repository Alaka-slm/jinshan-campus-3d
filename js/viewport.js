/* 视口与屏幕方向：统一的逻辑尺寸、坐标映射、设备能力探测
 *
 * - 逻辑尺寸 (W,H)：旋转后的可视尺寸，所有渲染/布局都用它，而不是 innerWidth/innerHeight。
 * - 强制横屏：微信等 WebView 往往不会随设备旋转重排，物理竖屏时把整个 #app 顺时针旋转 90°，
 *   逻辑上就得到了横屏布局，用户把手机横过来看即是正常方向。
 * - 所有屏幕坐标 → 逻辑坐标的换算都走 toLocal()/delta()，让射线拾取、拖动、缩放在旋转后依然正确。
 */
(function () {
  'use strict';
  const JZ = window.JZ;
  const UA = navigator.userAgent || '';
  const de = document.documentElement;
  const mq = (q) => {
    try { return matchMedia(q).matches; } catch (e) { return false; }
  };
  const isIPad = navigator.platform === 'MacIntel' && (navigator.maxTouchPoints || 0) > 1;
  const mobileUA = /Android|iPhone|iPad|iPod|Mobile|Windows Phone|HarmonyOS|OpenHarmony|BlackBerry/i.test(UA);

  const v = (JZ.view = {
    stage: null,          // #app
    W: 0, H: 0,           // 逻辑尺寸（旋转后）
    vw: 0, vh: 0,         // 物理视口
    rot: 0,               // 0 | 90（顺时针）
    portrait: false,      // 逻辑方向
    physicalPortrait: false,
    isTouch: (mq('(pointer: coarse)') && mq('(hover: none)')) || mobileUA || isIPad,
    isWeChat: /MicroMessenger/i.test(UA),
    isIOS: /iP(hone|ad|od)/i.test(UA) || isIPad,
    isAndroid: /Android/i.test(UA),
    narrow: false,        // 逻辑宽度 < 760（顶栏收纳为菜单）
    mid: false,           // 逻辑宽度 < 1180（压缩顶栏）
    short: false,         // 逻辑高度 < 470
    wantLandscape: false, // 用户意愿：物理竖屏时是否强制转成横屏显示
    _fns: [],
    on(fn) {
      this._fns.push(fn);
      return () => { this._fns = this._fns.filter((f) => f !== fn); };
    },
    emit() {
      const list = this._fns.slice();
      for (const f of list) { try { f(v); } catch (e) { console.error(e); } }
    },
  });

  function storedPref() {
    try { return localStorage.getItem('jz-orient'); } catch (e) { return null; }
  }
  function savePref(on) {
    try { localStorage.setItem('jz-orient', on ? 'landscape' : 'auto'); } catch (e) { /* 忽略 */ }
  }

  // 微信里 WebView 常被锁定为竖屏（无法靠系统旋转重排），因此默认开启强制横屏；
  // 其余环境尊重物理方向，竖屏也能用（竖屏 UI 单独打磨过）。
  v.wantLandscape = (function () {
    const p = storedPref();
    if (p === 'landscape') return true;
    if (p === 'auto' || p === 'portrait') return false;
    return v.isWeChat && v.isTouch;
  })();

  function applyDom() {
    const st = v.stage || (v.stage = document.getElementById('app'));
    if (!st) return;
    st.style.width = v.W + 'px';
    st.style.height = v.H + 'px';
    if (v.rot) {
      st.style.left = '50%';
      st.style.top = '50%';
      st.style.transform = 'translate(-50%, -50%) rotate(90deg)';
    } else {
      st.style.left = '0';
      st.style.top = '0';
      st.style.transform = 'none';
    }
    st.style.setProperty('--w', v.W + 'px');
    st.style.setProperty('--h', v.H + 'px');
    st.style.setProperty('--vw', v.vw + 'px');
    st.style.setProperty('--vh', v.vh + 'px');
    if (v.narrow) st.style.setProperty('--mm', Math.round(Math.min(140, Math.max(96, v.W * 0.26))) + 'px');
    else st.style.setProperty('--mm', v.short ? '128px' : '184px');

    const b = document.body;
    if (!b) return;
    b.classList.toggle('rotated', !!v.rot);
    b.classList.toggle('pos-portrait', v.portrait);
    b.classList.toggle('pos-landscape', !v.portrait);
    b.classList.toggle('w-narrow', v.narrow);
    b.classList.toggle('w-mid', v.mid);
    b.classList.toggle('h-short', v.short);
    b.classList.toggle('is-touch', v.isTouch);
    b.classList.toggle('is-wechat', v.isWeChat);
    b.classList.toggle('is-ios', v.isIOS);
  }

  v.measure = function () {
    const w = Math.round(window.innerWidth || de.clientWidth || 360);
    const h = Math.round(window.innerHeight || de.clientHeight || 640);
    v.vw = w;
    v.vh = h;
    v.physicalPortrait = h > w;
    v.rot = v.wantLandscape && v.isTouch && v.physicalPortrait ? 90 : 0;
    v.W = v.rot ? h : w;
    v.H = v.rot ? w : h;
    v.portrait = v.H > v.W;
    v.narrow = v.W < 640 || (v.H > v.W && v.W < 900);
    v.mid = v.W < 1180;
    v.short = v.H < 470;
    applyDom();
    v.emit();
    return v;
  };

  /* 屏幕坐标 → #app 逻辑坐标（处理 90° 旋转） */
  v.toLocal = function (clientX, clientY) {
    const st = v.stage || (v.stage = document.getElementById('app'));
    if (!st) return { x: clientX, y: clientY };
    const r = st.getBoundingClientRect();
    if (!v.rot) return { x: clientX - r.left, y: clientY - r.top };
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    return { x: v.W / 2 + (clientY - cy), y: v.H / 2 - (clientX - cx) };
  };

  /* 屏幕位移 → 逻辑位移（处理 90° 旋转） */
  v.delta = function (dx, dy) {
    return v.rot ? { x: dy, y: -dx } : { x: dx, y: dy };
  };

  /* 屏幕坐标是否落在逻辑矩形内 */
  v.inRect = function (clientX, clientY, x0, y0, x1, y1) {
    const p = v.toLocal(clientX, clientY);
    return p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1;
  };

  v.aspect = function () { return v.H > 0 ? v.W / v.H : 1; };

  /* 设定/切换「强制横屏」 */
  v.setLandscape = function (on) {
    on = !!on;
    if (v.wantLandscape === on) { v.measure(); return v; }
    v.wantLandscape = on;
    savePref(on);
    v.measure();
    return v;
  };
  v.toggleLandscape = function () { return v.setLandscape(!v.wantLandscape); };

  // 尝试用系统接口真正锁定方向（支持的浏览器会因此不再需要旋转；失败就算了）
  v.tryNativeLock = function (mode) {
    try {
      const so = screen.orientation;
      if (so && so.lock && document.fullscreenElement) so.lock(mode || 'landscape').catch(() => {});
    } catch (e) { /* 忽略 */ }
  };
  v.nativeLockable = function () {
    try { return !!(screen.orientation && screen.orientation.lock); } catch (e) { return false; }
  };

  let timer = 0;
  const kick = (ms) => {
    clearTimeout(timer);
    timer = setTimeout(() => v.measure(), ms || 90);
  };
  window.addEventListener('resize', () => kick(60), { passive: true });
  window.addEventListener('orientationchange', () => { kick(60); setTimeout(() => v.measure(), 280); setTimeout(() => v.measure(), 700); });
  if (window.visualViewport) window.visualViewport.addEventListener('resize', () => kick(120), { passive: true });

  v.measure();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => v.measure());
  }
})();



