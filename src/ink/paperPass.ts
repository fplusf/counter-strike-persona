import * as THREE from 'three';

/**
 * The look. One extra scene pass plus a fullscreen composite:
 *
 *   scene ──┬─ colour + depth ─┐
 *           └─ normals ────────┤
 *                              ├─ sobel(depth,normal) ─→ ink lines
 *   luminance ─────────────────┴─ tonal hatching ──────→ pencil shading
 *                                 procedural paper ────→ fibre + rule
 *
 * Cut-out drawings live on LAYER_PAPER and are skipped by the normal pass, so
 * they keep their own hand-drawn lines instead of being outlined twice.
 */
export const LAYER_WORLD = 0;
export const LAYER_PAPER = 1;

const VERT = /* glsl */ `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const FRAG = /* glsl */ `
precision highp float;
#include <packing>

uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform sampler2D tNormal;
uniform sampler2D tPaper;
uniform vec2  uResolution;
uniform float uNear;
uniform float uFar;
uniform float uTime;
uniform float uBoil;
uniform vec3  uInk;
uniform vec3  uPaper;
uniform float uHatch;
uniform float uDamage;
varying vec2 vUv;

float linearDepth(vec2 uv){
  float d = texture2D(tDepth, uv).x;
  float viewZ = perspectiveDepthToViewZ(d, uNear, uFar);
  return viewZToOrthographicDepth(viewZ, uNear, uFar);
}

float saturation(vec3 c){
  float mx = max(c.r, max(c.g, c.b));
  float mn = min(c.r, min(c.g, c.b));
  return (mx - mn) / max(0.05, mx);
}

float hash(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }

float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1,0)), f.x),
             mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y);
}

/* One family of pen strokes at a given angle and pitch. */
float strokes(vec2 p, float angle, float pitch, float wobble){
  float c = cos(angle), s = sin(angle);
  vec2 r = vec2(p.x * c - p.y * s, p.x * s + p.y * c);
  r.y += noise(r * 0.06) * wobble;
  float line = abs(fract(r.y / pitch) - 0.5) * 2.0;
  // Breaks along the stroke so it reads as a pen, not a printed rule.
  float breaks = smoothstep(0.28, 0.62, noise(vec2(r.x * 0.09, r.y * 0.7)));
  return (1.0 - smoothstep(0.10, 0.55, line)) * breaks;
}

void main(){
  // Line boil: the whole frame re-drawn 12 times a second, never twice alike.
  float step12 = floor(uTime * 12.0);
  vec2 boil = vec2(
    noise(vUv * 3.0 + step12 * 7.13) - 0.5,
    noise(vUv * 3.0 + step12 * 3.71 + 19.0) - 0.5
  ) * uBoil / uResolution * 42.0;

  vec2 uv = vUv + boil;
  vec2 px = 1.0 / uResolution;

  vec3 albedo = texture2D(tColor, uv).rgb;
  // Marker fills overshoot their outlines a little — but only the fills. The
  // line decisions below read the sharp buffer, or everything goes soft.
  vec3 spill = texture2D(tColor, uv + vec2(px.x, -px.y) * 2.5).rgb;

  float d0 = linearDepth(uv);
  float dx = abs(linearDepth(uv + vec2(px.x, 0.0)) - d0)
           + abs(linearDepth(uv - vec2(px.x, 0.0)) - d0);
  float dy = abs(linearDepth(uv + vec2(0.0, px.y)) - d0)
           + abs(linearDepth(uv - vec2(0.0, px.y)) - d0);
  // Tolerance grows with distance so far-off walls do not fizz.
  float depthEdge = smoothstep(0.0006 + d0 * 0.02, 0.004 + d0 * 0.05, dx + dy);

  vec3 n0 = texture2D(tNormal, uv).rgb;
  float nd = 0.0;
  nd += distance(n0, texture2D(tNormal, uv + vec2(px.x, 0.0)).rgb);
  nd += distance(n0, texture2D(tNormal, uv + vec2(0.0, px.y)).rgb);
  float normalEdge = smoothstep(0.35, 0.85, nd) * step(d0, 0.999);

  float edge = clamp(max(depthEdge, normalEdge * 0.9), 0.0, 1.0);
  // Near lines are heavier, like pressing harder on the near side of a sketch.
  edge *= mix(1.0, 0.55, smoothstep(0.0, 0.55, d0));

  float lum = dot(albedo, vec3(0.299, 0.587, 0.114));
  float shade = clamp(1.0 - lum, 0.0, 1.0);
  vec2 sp = uv * uResolution + noise(uv * 8.0) * 6.0;

  // Pen shading has three registers, and only the middle one is hatched.
  // Anything already near-black is a drawn stroke: fill it solid, or the
  // hatch pattern eats the line work it is supposed to sit next to.
  float tone = shade * uHatch;
  float hatch = 0.0;
  hatch = max(hatch, strokes(sp, 0.62, 13.0, 3.0) * smoothstep(0.42, 0.58, tone));
  hatch = max(hatch, strokes(sp, -0.55, 10.0, 3.0) * smoothstep(0.58, 0.72, tone));
  hatch = max(hatch, strokes(sp, 1.72, 8.0, 2.0) * smoothstep(0.72, 0.86, tone));

  // Anything strongly coloured is somebody's drawn stroke, not a lit surface.
  // Those stay solid and keep their own colour; the grey world stays blue-black.
  // The test reaches one pixel out, so the outline a stroke earns from the
  // depth pass is drawn in the stroke's colour and not in default blue.
  vec3 hueSrc = albedo;
  float sat = saturation(albedo);
  for (int i = 0; i < 4; i++) {
    vec2 o = vec2(i == 0 ? 1.0 : i == 1 ? -1.0 : 0.0, i == 2 ? 1.0 : i == 3 ? -1.0 : 0.0);
    vec3 n = texture2D(tColor, uv + o * px * 1.5).rgb;
    float ns = saturation(n);
    if (ns > sat) { sat = ns; hueSrc = n; }
  }
  float mx = max(hueSrc.r, max(hueSrc.g, hueSrc.b));
  float drawn = smoothstep(0.34, 0.58, sat) * step(0.22, shade);
  float solid = max(smoothstep(0.88, 0.97, shade), drawn);
  vec3 inkColour = mix(uInk, hueSrc * (0.58 / max(0.12, mx)), drawn);

  float ink = clamp(max(max(edge, solid), hatch * 0.66), 0.0, 1.0);

  vec3 paper = texture2D(tPaper, uv * uResolution / 512.0).rgb * uPaper;
  // Screen-space rule lines, the same notebook the game is drawn in.
  float rule = 1.0 - smoothstep(0.0, 1.3, abs(mod(gl_FragCoord.y, 34.0) - 17.0));
  paper = mix(paper, paper * vec3(0.80, 0.84, 0.97), rule * 0.75);

  // Colour survives as a wash that never fully covers the paper. Where there
  // is no geometry at all, the page is simply the page.
  vec3 wash = mix(paper, spill * 1.12, clamp(length(spill) * 0.55, 0.0, 0.5));
  wash = mix(wash, paper, step(0.999, d0));
  vec3 outCol = mix(wash, inkColour, ink);

  // Taking damage bleeds red ink in from the edges of the page. It stays at
  // the edges: a wash over the whole frame hides the thing you are aiming at.
  float vig = smoothstep(0.52, 1.05, length(vUv - 0.5) * 1.45);
  outCol = mix(outCol, vec3(0.62, 0.06, 0.10), vig * uDamage);

  gl_FragColor = vec4(outCol, 1.0);
  // The composite runs in linear space; hand the canvas sRGB like any
  // three.js material would.
  #include <colorspace_fragment>
}
`;

function makePaperTexture(): THREE.Texture {
  const size = 512;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fdfbf2';
  ctx.fillRect(0, 0, size, size);
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 16;
    d[i] += n; d[i + 1] += n; d[i + 2] += n * 0.7;
  }
  ctx.putImageData(img, 0, 0);
  // Long fibres, so the grain has direction rather than looking like TV static.
  ctx.globalAlpha = 0.05;
  ctx.strokeStyle = '#b3ab90';
  for (let i = 0; i < 700; i++) {
    const x = Math.random() * size, y = Math.random() * size;
    const a = Math.random() * Math.PI, len = 6 + Math.random() * 26;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

export class InkRenderer {
  private colourRT: THREE.WebGLRenderTarget;
  private normalRT: THREE.WebGLRenderTarget;
  private normalMat = new THREE.MeshNormalMaterial();
  private quadScene = new THREE.Scene();
  private quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private material: THREE.ShaderMaterial;
  /** 0..1, drives the red bleed. Game code writes to this each frame. */
  damage = 0;

  constructor(
    private renderer: THREE.WebGLRenderer,
    private camera: THREE.PerspectiveCamera,
  ) {
    const size = renderer.getSize(new THREE.Vector2());
    const dpr = Math.min(renderer.getPixelRatio(), 2);
    const w = Math.max(1, Math.floor(size.x * dpr));
    const h = Math.max(1, Math.floor(size.y * dpr));

    this.colourRT = new THREE.WebGLRenderTarget(w, h, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      type: THREE.HalfFloatType,
    });
    this.colourRT.depthTexture = new THREE.DepthTexture(w, h);
    this.colourRT.depthTexture.type = THREE.UnsignedShortType;
    this.normalRT = new THREE.WebGLRenderTarget(w, h, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
    });

    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        tColor: { value: this.colourRT.texture },
        tDepth: { value: this.colourRT.depthTexture },
        tNormal: { value: this.normalRT.texture },
        tPaper: { value: makePaperTexture() },
        uResolution: { value: new THREE.Vector2(w, h) },
        uNear: { value: camera.near },
        uFar: { value: camera.far },
        uTime: { value: 0 },
        uBoil: { value: 1.0 },
        uHatch: { value: 1.0 },
        uDamage: { value: 0 },
        uInk: { value: new THREE.Color('#1d2a6e') },
        uPaper: { value: new THREE.Color('#ffffff') },
      },
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    quad.frustumCulled = false;
    this.quadScene.add(quad);
  }

  setSize(w: number, h: number) {
    const dpr = Math.min(this.renderer.getPixelRatio(), 2);
    const pw = Math.max(1, Math.floor(w * dpr));
    const ph = Math.max(1, Math.floor(h * dpr));
    this.colourRT.setSize(pw, ph);
    this.normalRT.setSize(pw, ph);
    this.material.uniforms.uResolution.value.set(pw, ph);
  }

  /** Turn the pen effects down on weak hardware. */
  setQuality(boil: number, hatch: number) {
    this.material.uniforms.uBoil.value = boil;
    this.material.uniforms.uHatch.value = hatch;
  }

  render(scene: THREE.Scene, time: number) {
    const cam = this.camera;
    this.material.uniforms.uTime.value = time;
    this.material.uniforms.uDamage.value = this.damage;
    this.material.uniforms.uNear.value = cam.near;
    this.material.uniforms.uFar.value = cam.far;

    this.renderer.setRenderTarget(this.colourRT);
    this.renderer.clear();
    this.renderer.render(scene, cam);

    // Normals from solid geometry only — paper cut-outs are excluded.
    cam.layers.disable(LAYER_PAPER);
    scene.overrideMaterial = this.normalMat;
    this.renderer.setRenderTarget(this.normalRT);
    this.renderer.clear();
    this.renderer.render(scene, cam);
    scene.overrideMaterial = null;
    cam.layers.enable(LAYER_PAPER);

    this.renderer.setRenderTarget(null);
    this.renderer.render(this.quadScene, this.quadCam);
  }

  dispose() {
    this.colourRT.dispose();
    this.normalRT.dispose();
    this.material.dispose();
    this.normalMat.dispose();
  }
}
