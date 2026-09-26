import * as THREE from 'three';

// Subsystem palette: the familiar colour-coded CMS look, with the material class of
// each volume (tools/convert.mjs) adding surface character within a subsystem.

export interface GroupStyle {
  color: string;
  category: string;
  metalness?: number; // override the material class, e.g. painted yoke steel
  roughness?: number;
  hidden?: boolean; // off by default
}

export const CATEGORIES = ['Tracking', 'Timing', 'Calorimetry', 'Magnet', 'Muon', 'Forward'];

export const GROUP_STYLES: Record<string, GroupStyle> = {
  beampipe: { color: '#c3c8d0', category: 'Tracking', metalness: 0.7, roughness: 0.25 },
  it: { color: '#f4c44f', category: 'Tracking' },
  ot: { color: '#80b4ec', category: 'Tracking' },
  btl: { color: '#ec6aa9', category: 'Timing' },
  etl: { color: '#ec6aa9', category: 'Timing' },
  ecal: { color: '#38c2a4', category: 'Calorimetry' },
  hgcal: { color: '#9b76d8', category: 'Calorimetry' },
  hcal: { color: '#e38a3a', category: 'Calorimetry' },
  magnet: { color: '#cdd2da', category: 'Magnet', metalness: 0.65, roughness: 0.32 },
  yoke: { color: '#9a1b23', category: 'Magnet', metalness: 0.35, roughness: 0.42 },
  dt: { color: '#d9dce1', category: 'Muon' },
  rpc: { color: '#7cc46d', category: 'Muon' },
  csc: { color: '#4270cf', category: 'Muon' },
  gem: { color: '#f2a53c', category: 'Muon' },
  mshield: { color: '#5c6068', category: 'Muon' },
  hf: { color: '#d69b58', category: 'Forward' },
  fshield: { color: '#6b6f77', category: 'Forward', hidden: true },
  zdc: { color: '#8b9097', category: 'Forward', hidden: true },
  cavern: { color: '#7b7e82', category: 'Forward', hidden: true },
  other: { color: '#9aa0a6', category: 'Forward', hidden: true },
};

// tint scales the subsystem colour; metal/rough describe the surface.
const CLASS_LOOKS: Record<string, { tint: number; metalness: number; roughness: number }> = {
  steel: { tint: 1.0, metalness: 0.55, roughness: 0.4 },
  aluminium: { tint: 1.05, metalness: 0.6, roughness: 0.35 },
  copper: { tint: 1.0, metalness: 0.65, roughness: 0.32 },
  lead: { tint: 0.72, metalness: 0.4, roughness: 0.55 },
  crystal: { tint: 1.1, metalness: 0.05, roughness: 0.14 },
  silicon: { tint: 0.85, metalness: 0.45, roughness: 0.2 },
  scintillator: { tint: 1.0, metalness: 0.0, roughness: 0.45 },
  electronics: { tint: 0.72, metalness: 0.3, roughness: 0.5 },
  cable: { tint: 0.62, metalness: 0.2, roughness: 0.65 },
  composite: { tint: 0.7, metalness: 0.1, roughness: 0.55 },
  plastic: { tint: 0.8, metalness: 0.0, roughness: 0.6 },
};

export const groupStyle = (id: string) => GROUP_STYLES[id] ?? GROUP_STYLES.other;

// Solid volumes are drawn double-sided while the detector is cut open: a back face seen
// through the cut is shaded as a flat cap facing the nearest clipping plane, which makes
// the cut volume read as solid material.
function addCaps(m: THREE.MeshStandardMaterial, capColor: THREE.Color) {
  m.onBeforeCompile = (shader) => {
    shader.uniforms.capColor = { value: capColor };
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 capColor;')
      .replace(
        '#include <lights_physical_fragment>',
        /* glsl */ `
#if NUM_CLIPPING_PLANES > 0
  if (!gl_FrontFacing) {
    float best = 1e20;
    vec3 cn = vec3(0.0, 0.0, 1.0);
    for (int i = 0; i < NUM_CLIPPING_PLANES; i++) {
      vec4 pl = clippingPlanes[i];
      float d = abs(dot(vClipPosition, pl.xyz) - pl.w);
      if (d < best) { best = d; cn = pl.xyz; }
    }
    normal = dot(cn, vViewPosition) > 0.0 ? cn : -cn;
    diffuseColor.rgb = capColor;
    metalnessFactor = 0.0;
    roughnessFactor = 0.85;
  }
#endif
#include <lights_physical_fragment>`,
      );
  };
  m.customProgramCacheKey = () => 'cap';
}

export class Looks {
  private cache = new Map<string, THREE.MeshStandardMaterial>();
  readonly all: { material: THREE.MeshStandardMaterial; cap: boolean }[] = [];

  constructor(private planes: THREE.Plane[]) {}

  get(group: string, cls: string, cap: boolean, nested: boolean) {
    const key = `${group}|${cls}|${+cap}|${+nested}`;
    let m = this.cache.get(key);
    if (m) return m;
    const gs = groupStyle(group),
      cl = CLASS_LOOKS[cls] ?? CLASS_LOOKS.plastic;
    const color = new THREE.Color(gs.color).multiplyScalar(cl.tint);
    m = new THREE.MeshStandardMaterial({
      color,
      metalness: gs.metalness ?? cl.metalness,
      roughness: gs.roughness ?? cl.roughness,
      clippingPlanes: this.planes,
      clipIntersection: true,
      // nested volumes often share faces with the solid enclosing them; let them win
      polygonOffset: true,
      polygonOffsetFactor: nested ? -2 : 1,
      polygonOffsetUnits: nested ? -2 : 1,
    });
    if (cap) addCaps(m, new THREE.Color(gs.color).multiplyScalar(0.7 * cl.tint));
    this.cache.set(key, m);
    this.all.push({ material: m, cap });
    return m;
  }

  setCut(on: boolean) {
    for (const { material, cap } of this.all) {
      const side = cap && on ? THREE.DoubleSide : THREE.FrontSide;
      if (material.side !== side) {
        material.side = side;
        material.needsUpdate = true;
      }
    }
  }
}
