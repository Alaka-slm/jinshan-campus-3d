/* 环境：天空、太阳（按当前日期与时刻计算方位）、半球光、雾、环境反射、星空、夜景 */
(function () {
  'use strict';
  const JZ = window.JZ;
  const { clamp, lerp, smoothstep } = JZ.math;
  const LAT = 23.3365, LON = 116.6774;

  const SKY_VS = `
    varying vec3 vDir;
    void main() {
      vDir = normalize(position);
      vec4 p = modelViewMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * p;
      gl_Position.z = gl_Position.w; // 永远在最远处
    }`;
  const SKY_FS = `
    uniform vec3 zenith, horizon, ground, sunColor, sunDir;
    uniform float sunSize, glow;
    varying vec3 vDir;
    void main() {
      vec3 d = normalize(vDir);
      float h = d.y;
      vec3 col = mix(horizon, zenith, pow(clamp(h, 0.0, 1.0), 0.42));
      col = mix(col, ground, smoothstep(0.0, -0.06, h));
      float s = max(dot(d, normalize(sunDir)), 0.0);
      col += sunColor * glow * pow(s, 8.0) * 0.35;
      col += sunColor * glow * pow(s, 60.0) * 0.6;
      col += sunColor * smoothstep(sunSize, sunSize + 0.0008, s) * 8.0 * step(0.0, h + 0.02);
      gl_FragColor = vec4(col, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`;

  function skyMaterial(uniforms) {
    return new THREE.ShaderMaterial({ uniforms, vertexShader: SKY_VS, fragmentShader: SKY_FS, side: THREE.BackSide, depthWrite: false, fog: false });
  }

  // 太阳位置（视太阳时近似 + 时差修正），返回 {alt, az}（弧度，方位角自北顺时针）
  function sunPosition(date, hours) {
    const start = new Date(date.getFullYear(), 0, 0);
    const doy = Math.floor((date - start) / 86400000);
    const B = (2 * Math.PI * (doy - 81)) / 365;
    const eot = 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B);
    const decl = (23.44 * Math.PI) / 180 * Math.sin((2 * Math.PI * (284 + doy)) / 365);
    const tc = 4 * (LON - 120) + eot;
    const lst = hours + tc / 60;
    const H = ((lst - 12) * 15 * Math.PI) / 180;
    const phi = (LAT * Math.PI) / 180;
    const sinAlt = Math.sin(phi) * Math.sin(decl) + Math.cos(phi) * Math.cos(decl) * Math.cos(H);
    const alt = Math.asin(clamp(sinAlt, -1, 1));
    const az = Math.atan2(-Math.sin(H), Math.tan(decl) * Math.cos(phi) - Math.sin(phi) * Math.cos(H));
    return { alt, az: (az + 2 * Math.PI) % (2 * Math.PI), decl };
  }
  JZ.sunPosition = sunPosition;

  class Env {
    constructor(renderer, scene) {
      this.renderer = renderer;
      this.scene = scene;
      this.u = {
        zenith: { value: new THREE.Color() }, horizon: { value: new THREE.Color() }, ground: { value: new THREE.Color() },
        sunColor: { value: new THREE.Color() }, sunDir: { value: new THREE.Vector3(0, 1, 0) },
        sunSize: { value: 0.99995 }, glow: { value: 1 },
      };
      this.sky = new THREE.Mesh(new THREE.SphereGeometry(1000, 48, 24), skyMaterial(this.u));
      this.sky.frustumCulled = false;
      this.sky.renderOrder = -10;
      scene.add(this.sky);
      // 星空
      const n = 2200, pos = new Float32Array(n * 3), rand = JZ.rng(8);
      // 星星放在远处（城市与山体之后），且只分布在地平线以上
      for (let i = 0; i < n; i++) {
        const u = 0.06 + rand() * 0.94, a = rand() * Math.PI * 2, r = Math.sqrt(1 - u * u);
        pos[i * 3] = r * Math.cos(a) * 30000;
        pos[i * 3 + 1] = u * 30000;
        pos[i * 3 + 2] = r * Math.sin(a) * 30000;
      }
      const sg = new THREE.BufferGeometry();
      sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      this.starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, fog: false });
      this.stars = new THREE.Points(sg, this.starMat);
      this.stars.frustumCulled = false;
      this.stars.renderOrder = -9;
      scene.add(this.stars);
      // 灯光
      this.sun = new THREE.DirectionalLight(0xffffff, 3);
      this.sun.castShadow = true;
      this.sun.shadow.mapSize.set(4096, 4096);
      this.sun.shadow.bias = -0.0004;
      this.sun.shadow.camera.near = 1;
      this.sun.shadow.camera.far = 4000;
      scene.add(this.sun, this.sun.target);
      this.hemi = new THREE.HemisphereLight(0xbfd8f0, 0x5a5646, 1.2);
      scene.add(this.hemi);
      scene.fog = new THREE.Fog(0xcfe0ee, 600, 9000);
      // 环境反射
      this.pmrem = new THREE.PMREMGenerator(renderer);
      this.envScene = new THREE.Scene();
      this.envSky = new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), skyMaterial(this.u));
      this.envScene.add(this.envSky);
      this.envRT = null;
      this.date = new Date();
      this.hours = 10.5;
      this.night = 0;
      this.nightTargets = [];
    }
    setTime(hours) {
      this.hours = hours;
      const { alt, az } = sunPosition(this.date, hours);
      this.alt = alt;
      this.az = az;
      const ce = Math.cos(alt);
      // 世界坐标：x 东，z 南（-北）
      const dir = new THREE.Vector3(Math.sin(az) * ce, Math.sin(alt), -Math.cos(az) * ce);
      this.sunDir = dir;
      const aDeg = (alt * 180) / Math.PI;
      const day = smoothstep(-4, 8, aDeg); // 0 夜 1 昼
      const golden = 1 - smoothstep(4, 22, aDeg);
      this.night = 1 - smoothstep(-6, 3, aDeg);
      const sRGB = (hex) => new THREE.Color(hex);
      const mix3 = (a, b, t) => sRGB(a).lerp(sRGB(b), t);
      // 天空颜色
      const zenDay = mix3('#2f6fb8', '#3a6aa8', golden * 0.6), horDay = mix3('#cddff0', '#f1c08e', golden * 0.85);
      this.u.zenith.value.copy(mix3('#060b1a', '#000000', 0).lerp(zenDay, day));
      this.u.horizon.value.copy(sRGB('#141d33').lerp(horDay, day));
      this.u.ground.value.copy(sRGB('#0b0f17').lerp(mix3('#8c949b', '#9a8d80', golden), day));
      const sunCol = mix3('#fffaf0', '#ffb070', golden);
      this.u.sunColor.value.copy(sunCol).multiplyScalar(day);
      this.u.sunDir.value.copy(dir);
      this.u.glow.value = 0.6 + golden * 1.4;
      this.starMat.opacity = this.night * 0.9;
      // 灯光
      this.sun.color.copy(sunCol);
      this.sun.intensity = 2.7 * smoothstep(-2, 10, aDeg);
      this.hemi.color.copy(mix3('#25324d', '#c3dbf2', day));
      this.hemi.groundColor.copy(mix3('#0e1014', '#5d5848', day));
      this.hemi.intensity = lerp(0.35, 1.0, day);
      // 夜晚月光
      if (aDeg < -2) {
        this.sun.color.set('#9fb4e0');
        this.sun.intensity = 0.35;
        dir.set(-0.4, 0.75, 0.5).normalize();
        this.sunDir = dir;
      }
      this.scene.fog.color.copy(this.u.horizon.value).lerp(sRGB('#9fb0c0'), 0.15 * day);
      this.renderer.toneMappingExposure = lerp(0.85, 1.0, day);
      for (const t of this.nightTargets) t(this.night);
      this._envDirty = true;
      this.shadowDirty = true;
    }
    updateEnvMap() {
      if (!this._envDirty) return;
      this._envDirty = false;
      if (this.envRT) this.envRT.dispose();
      this.envRT = this.pmrem.fromScene(this.envScene, 0.02, 0.1, 200);
      this.scene.environment = this.envRT.texture;
    }
    // 阴影相机跟随视点
    update(camera, focus, radius) {
      this.sky.position.copy(camera.position);
      this.stars.position.copy(camera.position);
      const r = clamp(radius, 60, 1100);
      const s = this.sun.shadow.camera;
      if (s.right !== r) {
        s.left = -r; s.right = r; s.top = r; s.bottom = -r;
        s.updateProjectionMatrix();
        this.sun.shadow.normalBias = (r / 4096) * 2.2;
      }
      // 将焦点对齐到阴影纹素，减少移动时的闪烁
      const texel = (2 * r) / 4096;
      const fx = Math.round(focus.x / texel) * texel, fz = Math.round(focus.z / texel) * texel;
      this.sun.target.position.set(fx, focus.y, fz);
      this.sun.position.set(fx + this.sunDir.x * 1800, focus.y + this.sunDir.y * 1800, fz + this.sunDir.z * 1800);
      this.sun.target.updateMatrixWorld();
    }
  }
  JZ.Env = Env;
})();
