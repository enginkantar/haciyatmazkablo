/**
 * Neural Glow Background Effect - Vanilla JS
 * haciyatmazkablo.com için WebGL shader arka plan efekti
 * Orijinal: cursify.vercel.app/components/neural-glow (React)
 * Çeviren: Claude - Vanilla JS uyumlu
 * 
 * KULLANIM:
 * 1) Bu dosyayı assets/js/neural-glow-bg.js olarak kaydet
 * 2) HTML'de </body> öncesine ekle:
 *    <script src="assets/js/neural-glow-bg.js"></script>
 * 3) Arka plan istediğin section'a class="neural-glow-section" ekle
 *    veya tüm sayfa için <body> sonrasına <div id="neural-glow-bg"></div> ekle
 */

(function () {
  'use strict';

  // ===== RENK AYARLARI =====
  // Değiştirmek istersen burayı düzenle (RGB 0-1 arası)
  //const BASE_COLOR = [0.1, 0.2, 0.8];       // Ana renk: Koyu mavi
  // const ACCENT_COLOR = [0.0, 0.1, 0.4];     // Vurgu renk: İndigo
  // Altın/sarı tema istersen:
   const BASE_COLOR = [0.8, 0.6, 0.0];    // Altın
   const ACCENT_COLOR = [0.4, 0.2, 0.0];  // Koyu altın

  // ===== CANVAS OLUŞTUR =====
  const canvas = document.createElement('canvas');
  canvas.id = 'neural-glow-canvas';
  canvas.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: -1;
    opacity: 0.95;
    background-color: #000000;
  `;

  // Sayfa yüklendiğinde body'nin ilk çocuğu olarak ekle
  if (document.body) {
    document.body.insertBefore(canvas, document.body.firstChild);
  } else {
    document.addEventListener('DOMContentLoaded', function () {
      document.body.insertBefore(canvas, document.body.firstChild);
    });
  }

  // ===== POINTER TAKİBİ =====
  const pointer = { x: 0, y: 0, tX: 0, tY: 0 };

  // ===== SHADER KAYNAK KODLARI =====
  const vertexShaderSource = `
    precision mediump float;
    varying vec2 vUv;
    attribute vec2 a_position;
    void main() {
      vUv = .5 * (a_position + 1.);
      gl_Position = vec4(a_position, 0.0, 1.0);
    }
  `;

  const fragmentShaderSource = `
    precision mediump float;
    varying vec2 vUv;
    uniform float u_time;
    uniform float u_ratio;
    uniform vec2 u_pointer_position;
    uniform float u_scroll_progress;

    vec2 rotate(vec2 uv, float th) {
      return mat2(cos(th), sin(th), -sin(th), cos(th)) * uv;
    }

    float neuro_shape(vec2 uv, float t, float p) {
      vec2 sine_acc = vec2(0.);
      vec2 res = vec2(0.);
      float scale = 8.;
      for (int j = 0; j < 15; j++) {
        uv = rotate(uv, 1.);
        sine_acc = rotate(sine_acc, 1.);
        vec2 layer = uv * scale + float(j) + sine_acc - t;
        sine_acc += sin(layer) + 2.4 * p;
        res += (.5 + .5 * cos(layer)) / scale;
        scale *= 1.2;
      }
      return res.x + res.y;
    }

    void main() {
      vec2 uv = .5 * vUv;
      uv.x *= u_ratio;

      vec2 ptr = vUv - u_pointer_position;
      ptr.x *= u_ratio;
      float p = clamp(length(ptr), 0., 1.);
      p = .5 * pow(1. - p, 2.);

      float t = .001 * u_time;
      vec3 color = vec3(0.);

      float noise = neuro_shape(uv, t, p);
      noise = 1.2 * pow(noise, 3.);
      noise += pow(noise, 10.);
      noise = max(.0, noise - .5);
      noise *= (1. - length(vUv - .5));

      color = vec3(${BASE_COLOR[0]}, ${BASE_COLOR[1]}, ${BASE_COLOR[2]});
      color += vec3(${ACCENT_COLOR[0]}, ${ACCENT_COLOR[1]}, ${ACCENT_COLOR[2]}) * sin(3.0 * u_scroll_progress + 1.5);
      color = color * noise;

      gl_FragColor = vec4(color, noise);
    }
  `;

  // ===== WebGL SETUP =====
  let gl, uniforms, animationId;

  function createShader(gl, source, type) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error('Shader derleme hatası:', gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  function initShader() {
    gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (!gl) {
      console.warn('WebGL desteklenmiyor — neural glow devre dışı.');
      canvas.style.display = 'none';
      return false;
    }

    const vs = createShader(gl, vertexShaderSource, gl.VERTEX_SHADER);
    const fs = createShader(gl, fragmentShaderSource, gl.FRAGMENT_SHADER);
    if (!vs || !fs) return false;

    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      console.error('Shader program link hatası:', gl.getProgramInfoLog(program));
      return false;
    }

    // Uniform'ları topla
    uniforms = {};
    const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < count; i++) {
      const name = gl.getActiveUniform(program, i).name;
      uniforms[name] = gl.getUniformLocation(program, name);
    }

    // Tam ekran quad vertex'leri
    const vertices = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

    gl.useProgram(program);

    const pos = gl.getAttribLocation(program, 'a_position');
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);

    return true;
  }

  function resize() {
    if (!gl) return;
    const dpr = Math.min(window.devicePixelRatio, 2);
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    gl.uniform1f(uniforms.u_ratio, canvas.width / canvas.height);
    gl.viewport(0, 0, canvas.width, canvas.height);
  }

  function render() {
    if (!gl || !uniforms) return;

    pointer.x += (pointer.tX - pointer.x) * 0.2;
    pointer.y += (pointer.tY - pointer.y) * 0.2;

    gl.uniform1f(uniforms.u_time, performance.now());
    gl.uniform2f(
      uniforms.u_pointer_position,
      pointer.x / window.innerWidth,
      1 - pointer.y / window.innerHeight
    );
    gl.uniform1f(
      uniforms.u_scroll_progress,
      window.pageYOffset / (2 * window.innerHeight)
    );

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    animationId = requestAnimationFrame(render);
  }

  // ===== EVENT LISTENERS =====
  function onPointerMove(e) {
    pointer.tX = e.clientX;
    pointer.tY = e.clientY;
  }
  function onTouchMove(e) {
    pointer.tX = e.touches[0].clientX;
    pointer.tY = e.touches[0].clientY;
  }

  // ===== BAŞLAT =====
  function start() {
    if (!initShader()) return;
    resize();
    render();
    window.addEventListener('resize', resize);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('touchmove', onTouchMove);
  }

  // DOM hazır olduğunda başlat
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();