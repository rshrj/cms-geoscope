import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { N8AOPass } from 'n8ao';

/** Renderer, scene, camera, controls, lights and the post-processing chain. */
export interface Stage {
  canvas: HTMLCanvasElement;
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  composer: EffectComposer;
  ao: N8AOPass;
  /** stands in for the AO pass, which renders the scene itself, when AO is off */
  plain: RenderPass;
  smaa: SMAAPass;
  key: THREE.DirectionalLight;
  resize(): void;
}

function backdrop() {
  const c = document.createElement('canvas');
  c.width = 16;
  c.height = 512;
  const g = c.getContext('2d')!,
    grad = g.createLinearGradient(0, 0, 0, 512);
  grad.addColorStop(0, '#2a3040');
  grad.addColorStop(0.55, '#141821');
  grad.addColorStop(1, '#0b0d12');
  g.fillStyle = grad;
  g.fillRect(0, 0, 16, 512);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createStage(canvas: HTMLCanvasElement): Stage {
  const renderer = new THREE.WebGLRenderer({ canvas, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.localClippingEnabled = true;
  renderer.info.autoReset = false;

  const scene = new THREE.Scene();
  scene.background = backdrop();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.75;

  const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 3000);
  camera.layers.enable(0);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.12; // less floaty: settles quickly after a drag
  controls.rotateSpeed = 1.3;
  controls.zoomSpeed = 1.4;
  controls.panSpeed = 1.3;
  controls.zoomToCursor = true;
  controls.minDistance = 0.1;
  controls.maxDistance = 400;

  // Key light rides along with the camera (up and to the left) so every view is lit;
  // the environment map supplies soft fill and reflections.
  const key = new THREE.DirectionalLight(0xfff4e6, 3.2);
  scene.add(key, key.target, new THREE.HemisphereLight(0xbfd4ff, 0x20242c, 0.35));

  const composer = new EffectComposer(renderer);
  const ao = new N8AOPass(scene, camera, 1, 1);
  Object.assign(ao.configuration, {
    screenSpaceRadius: true,
    aoRadius: 36,
    distanceFalloff: 0.25,
    intensity: 2.2,
    halfRes: false,
    gammaCorrection: false,
  });
  // the selection x-ray is transparent; keep AO from switching to its costlier mode
  (ao as unknown as { autoDetectTransparency: boolean }).autoDetectTransparency = false;
  const plain = new RenderPass(scene, camera);
  plain.enabled = false;
  // N8AO re-seeds its sample noise from the clock every frame, which shimmers on fine
  // detail even with a still camera; pin the seed so the pattern is stable
  for (const q of [ao.effectShaderQuad, ao.poissonBlurQuad]) {
    const u = (q as unknown as { material: { uniforms: Record<string, { value: number }> } }).material.uniforms.time;
    if (u) Object.defineProperty(u, 'value', { get: () => 0, set: () => {} });
  }
  composer.addPass(plain);
  composer.addPass(ao);
  composer.addPass(new OutputPass());
  const smaa = new SMAAPass();
  composer.addPass(smaa);

  function resize() {
    const w = canvas.clientWidth,
      h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    composer.setSize(w, h);
    camera.aspect = w / h;
    // centre the detector in the space right of the side panel
    const panel = document.getElementById('panel')!,
      shift = w > 700 ? (panel.offsetLeft + panel.offsetWidth) / 2 : 0;
    camera.setViewOffset(w, h, -shift, 0, w, h);
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(canvas);

  return { canvas, renderer, scene, camera, controls, composer, ao, plain, smaa, key, resize };
}
