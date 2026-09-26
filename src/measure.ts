import * as THREE from 'three';

// Click two surface points to measure between them. Distances are in metres in the
// scene; labels switch to mm below 1 m. Measurements stay until cleared.

const COLOR = 0xffd166;

interface Measurement {
  a: THREE.Vector3;
  b: THREE.Vector3;
  label: HTMLElement;
}

const len = (m: number) => (m < 1 ? `${(m * 1000).toFixed(m < 0.1 ? 1 : 0)} mm` : `${m.toFixed(3)} m`);

export class Measure {
  readonly group = new THREE.Group();
  active = false;
  private done: Measurement[] = [];
  private pending: THREE.Vector3 | null = null;
  private pendingMark: THREE.Points;
  private lines = new THREE.LineSegments(
    new THREE.BufferGeometry(),
    new THREE.LineBasicMaterial({ color: COLOR, depthTest: false, transparent: true }),
  );
  private marks = new THREE.Points(
    new THREE.BufferGeometry(),
    new THREE.PointsMaterial({ color: COLOR, size: 9, sizeAttenuation: false, depthTest: false, transparent: true }),
  );
  private host = document.createElement('div');
  private v = new THREE.Vector3();

  constructor(
    private canvas: HTMLCanvasElement,
    private onToggle: (on: boolean) => void,
  ) {
    this.host.id = 'measurements';
    document.body.append(this.host);
    this.lines.renderOrder = this.marks.renderOrder = 20;
    this.lines.frustumCulled = this.marks.frustumCulled = false;
    this.pendingMark = this.marks;
    this.group.add(this.lines, this.marks);
    this.group.visible = false;
  }

  setActive(on: boolean) {
    this.active = on;
    this.canvas.style.cursor = on ? 'crosshair' : '';
    this.group.visible = on || this.done.length > 0;
    this.host.style.display = this.group.visible ? '' : 'none';
    this.onToggle(on);
  }

  /** add a point; the second one of a pair completes a measurement */
  add(p: THREE.Vector3) {
    if (!this.pending) this.pending = p.clone();
    else {
      const a = this.pending,
        b = p.clone(),
        d = b.clone().sub(a);
      const label = document.createElement('div');
      label.className = 'measure-label';
      const strong = document.createElement('b');
      strong.textContent = len(d.length());
      const small = document.createElement('span');
      small.textContent = `Δx ${len(Math.abs(d.x))}, Δy ${len(Math.abs(d.y))}, Δz ${len(Math.abs(d.z))}, Δr ${len(Math.abs(Math.hypot(b.x, b.y) - Math.hypot(a.x, a.y)))}`;
      label.append(strong, small);
      this.host.append(label);
      this.done.push({ a, b, label });
      this.pending = null;
    }
    this.rebuild();
  }

  clear() {
    for (const m of this.done) m.label.remove();
    this.done = [];
    this.pending = null;
    this.rebuild();
  }

  /** finished measurements as flat [ax, ay, az, bx, by, bz] */
  get pairs() {
    return this.done.map((m) => [...m.a.toArray(), ...m.b.toArray()]);
  }

  restore(pairs: number[][]) {
    this.clear();
    for (const [ax, ay, az, bx, by, bz] of pairs) {
      this.add(new THREE.Vector3(ax, ay, az));
      this.add(new THREE.Vector3(bx, by, bz));
    }
  }

  get count() {
    return this.done.length + (this.pending ? 1 : 0);
  }

  private rebuild() {
    const pts: number[] = [],
      seg: number[] = [];
    for (const m of this.done) {
      pts.push(...m.a.toArray(), ...m.b.toArray());
      seg.push(...m.a.toArray(), ...m.b.toArray());
    }
    if (this.pending) pts.push(...this.pending.toArray());
    this.marks.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    this.lines.geometry.setAttribute('position', new THREE.Float32BufferAttribute(seg, 3));
    this.group.visible = this.active || this.done.length > 0;
    this.host.style.display = this.group.visible ? '' : 'none';
  }

  /** keep the HTML labels over the midpoints; call every frame */
  update(camera: THREE.Camera) {
    const w = this.canvas.clientWidth,
      h = this.canvas.clientHeight;
    for (const m of this.done) {
      this.v.copy(m.a).add(m.b).multiplyScalar(0.5).project(camera);
      const on = this.v.z < 1 && Math.abs(this.v.x) < 1.1 && Math.abs(this.v.y) < 1.1;
      m.label.style.display = on ? '' : 'none';
      const x = ((this.v.x + 1) / 2) * w;
      m.label.style.transform = `translate(${x}px, ${((1 - this.v.y) / 2) * h}px) translate(-50%, -120%)`;
    }
  }
}
