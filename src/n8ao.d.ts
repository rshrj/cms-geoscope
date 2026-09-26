declare module 'n8ao' {
  import type { Camera, Scene } from 'three';
  import type { Pass } from 'three/addons/postprocessing/Pass.js';
  export class N8AOPass extends Pass {
    constructor(scene: Scene, camera: Camera, width?: number, height?: number);
    configuration: Record<string, unknown>;
    effectShaderQuad: unknown;
    poissonBlurQuad: unknown;
    setQualityMode(mode: string): void;
  }
}
