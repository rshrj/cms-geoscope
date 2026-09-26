import * as THREE from 'three';
import { DetIds } from './detids';
import { Detector, type Isolation } from './detector';
import { Inspector } from './inspector';
import { bindInput } from './input';
import { bindLink } from './link';
import { Measure } from './measure';
import { Picker } from './picker';
import { createQuality, isQuality } from './quality';
import { Search } from './search';
import { decode, type ViewState } from './share';
import { createStage } from './stage';
import { PlacementTree } from './tree';
import { buildPanel, progress, showIsolation } from './ui';
import { createFlight } from './views';
import './style.css';

const canvas = document.getElementById('view') as HTMLCanvasElement;
const stage = createStage(canvas);
const { renderer, scene, camera, controls, composer, key } = stage;

const det = new Detector();
scene.add(det.root);

const flight = createFlight(stage);
const quality = createQuality(stage, det);
const picker = new Picker(renderer, det);

// ---------------------------------------------------------------- inspect & isolate
const inspector = new Inspector(det, { isolate, frame: flight.frame });
scene.add(inspector.highlight);
let measureButton: HTMLElement | null = null;
const measure = new Measure(canvas, (on) => {
  measureButton?.classList.toggle('on', on);
  if (on) inspector.select(null);
});
scene.add(measure.group);

let beforeIsolation: [THREE.Vector3, THREE.Vector3] | null = null;
function isolate(iso: Isolation) {
  beforeIsolation ??= [camera.position.clone(), controls.target.clone()];
  det.setIsolation(iso);
  flight.frame(det.bounds.getBoundingSphere(new THREE.Sphere()));
  showIsolation(iso, det.shownItems, exitIsolation);
}
function exitIsolation() {
  det.setIsolation(null);
  showIsolation(null, 0, exitIsolation);
  if (beforeIsolation) flight.flyTo(...beforeIsolation);
  beforeIsolation = null;
}
det.onChange = () => {
  if (det.isolation) showIsolation(det.isolation, det.shownItems, exitIsolation);
};

bindInput({ canvas, camera, det, picker, inspector, measure, fly: (name) => flight.fly(name), exitIsolation });

// ---------------------------------------------------------------- render loop
function render() {
  renderer.info.reset();
  key.position
    .copy(camera.position)
    .add(new THREE.Vector3(-0.4, 0.8, 0.2).multiplyScalar(camera.position.distanceTo(controls.target)));
  key.target.position.copy(controls.target);
  // fit the depth range to what is in view: a fixed 0.05..3000 wastes precision and z-fights
  const d = camera.position.distanceTo(controls.target);
  const near = Math.max(0.02, d * 0.03),
    far = d + 60;
  if (Math.abs(near - camera.near) > 1e-3 * near || far !== camera.far) {
    camera.near = near;
    camera.far = far;
    camera.updateProjectionMatrix();
  }
  quality.applyCulling();
  measure.update(camera);
  if (quality.direct) renderer.render(scene, camera);
  else composer.render();
}

let stats: HTMLElement | null = null,
  frames = 0,
  last = performance.now();
renderer.setAnimationLoop((now) => {
  flight.step(now);
  controls.update();
  render();
  frames++;
  if (stats && now - last > 500) {
    const fps = (1000 * frames) / (now - last);
    stats.textContent = `${fps.toFixed(0)} fps, ${(det.visibleTriangles() / 1e6).toFixed(1)}M tris, ${renderer.info.render.calls} draws`;
    frames = 0;
    last = now;
  }
});

function screenshot() {
  render();
  canvas.toBlob((b) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(b!);
    a.download = `cms-phase2-${det.cut}-${Date.now()}.png`;
    a.click();
  });
}

// handle for poking at the scene from the devtools console
Object.assign(window, { viewer: { ...stage, det, picker, inspector } });

// ---------------------------------------------------------------- start
stage.resize();
flight.fly('Overview', true);
const initial = decode(location.hash);
det.setCut(initial.cut ?? 'quarter');
// start the placement tree and DetIds downloading alongside the geometry
const treeLoad = PlacementTree.load('data'),
  detIdLoad = DetIds.load('data');
await det.load('data', progress);
if (initial.on) det.setVisibleGroups(initial.on);
if (initial.quality && isQuality(initial.quality)) quality.set(initial.quality);

const share = bindLink(
  (): ViewState => ({
    cam: [...camera.position.toArray(), ...controls.target.toArray()],
    cut: det.cut,
    on: det.visibleGroups(),
    iso: det.isolation,
    quality: quality.current,
    measurements: measure.pairs,
  }),
  () => flight.flying,
);

({ stats } = buildPanel(det, {
  onCut: (mode) => {
    det.setCut(mode);
    inspector.syncSide();
  },
  onView: (name) => flight.fly(name),
  onScreenshot: screenshot,
  quality: initial.quality,
  onQuality: (q) => {
    if (isQuality(q)) quality.set(q);
  },
  onShare: (b) => {
    b.onclick = () => share(b);
  },
  onMeasure: (b) => {
    measureButton = b;
    b.onclick = () => measure.setActive(!measure.active);
  },
  onSolo: () => {
    if (det.isolation) exitIsolation();
  },
}));

const search = new Search(document.querySelector('#panel header')!, (name, solid) => {
  const label = `${name} (all copies)`;
  if (solid) return isolate({ kind: 'volume', name, label });
  // an assembly draws nothing itself: show everything placed inside any of its copies
  const tree = det.tree!,
    ranges: [number, number][] = [];
  for (let p = 0; p < tree.count; p++) {
    if (tree.volume(p).name === name) {
      const e = tree.end(p);
      ranges.push([p, e]);
      p = e - 1;
    }
  }
  if (ranges.length) isolate({ kind: 'subtree', from: ranges[0][0], to: ranges[0][1], ranges, label });
});
stage.resize(); // the panel now has its width

const applyCamera = () => {
  if (initial.cam)
    flight.flyTo(new THREE.Vector3(...initial.cam.slice(0, 3)), new THREE.Vector3(...initial.cam.slice(3)), true);
};
applyCamera();
if (initial.measurements) measure.restore(initial.measurements);

detIdLoad
  .then((ids) => {
    inspector.detIds = ids;
    inspector.render();
  })
  .catch(() => {});
treeLoad.then((tree) => {
  det.setTree(tree);
  search.setTree(tree);
  inspector.render();
  // a shared isolation and camera apply once the tree is here (subtrees need it)
  if (initial.iso) isolate(initial.iso);
  applyCamera();
});
