import { describe, expect, it } from 'vitest';
import { aliases, score } from '../src/search';

describe('fuzzy score', () => {
  it('rejects a name that lacks the letters', () => {
    expect(score('pixel:itlayer1', 'zzz')).toBeLessThan(0);
  });

  it('ranks a substring above a scattered match', () => {
    expect(score('pixel:itlayer1', 'layer')).toBeGreaterThan(score('pixel:itlayer1', 'plyr'));
  });

  it('prefers a match at a word boundary and shorter names', () => {
    expect(score('pixel:itlayer1', 'itlayer')).toBeGreaterThan(score('pixel:xitlayer1', 'itlayer'));
    expect(score('ecal:eb', 'eb')).toBeGreaterThan(score('ecal:ebcrystalholder', 'eb'));
  });

  it('accepts skipped letters', () => {
    expect(score('phase2pixelbarrel', 'p2pxl')).toBeGreaterThanOrEqual(0);
  });
});

describe('reco name aliases', () => {
  it('maps the Phase-2 pixel barrel and layers to TBPX', () => {
    expect(aliases('pixbar:Phase2PixelBarrel')).toContain('tbpx');
    expect(aliases('pixel:ITLayer3')).toContain('tbpx');
  });

  it('splits inner-tracker discs between TFPX (1-8) and TEPX (9-12)', () => {
    expect(aliases('pixel:ITDisc8')).toContain('tfpx');
    expect(aliases('pixel:ITDisc9Ring2')).toContain('tepx');
  });

  it('gives unrelated volumes no alias', () => {
    expect(aliases('cms:CMSE')).toBe('');
  });
});
