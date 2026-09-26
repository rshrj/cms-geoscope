import { describe, expect, it } from 'vitest';
import { decode, encode } from '../src/share';

describe('view links', () => {
  it('round-trips camera, cut, visibility, quality and measurements', () => {
    const state = {
      cam: [1.234, 2, 3, 0, 0.5, -1],
      cut: 'half' as const,
      on: ['ecal', 'hgcal'],
      quality: 'fast',
      measurements: [[0, 0, 0, 1, 2, 3]],
    };
    const back = decode(`#${encode(state)}`);
    expect(back.cam).toEqual(state.cam);
    expect(back.cut).toBe('half');
    expect(back.on).toEqual(['ecal', 'hgcal']);
    expect(back.quality).toBe('fast');
    expect(back.measurements).toEqual(state.measurements);
  });

  it('round-trips each kind of isolation', () => {
    const group = decode(`#${encode({ iso: { kind: 'group', group: 'ecal', label: 'x' } })}`).iso;
    expect(group).toMatchObject({ kind: 'group', group: 'ecal' });

    const volume = decode(`#${encode({ iso: { kind: 'volume', name: 'pixel:ITLayer1', label: 'x' } })}`).iso;
    expect(volume).toMatchObject({ kind: 'volume', name: 'pixel:ITLayer1' });

    const subtree = decode(
      `#${encode({
        iso: {
          kind: 'subtree',
          from: 5,
          to: 9,
          ranges: [
            [5, 9],
            [20, 30],
          ],
          label: 'Barrel',
        },
      })}`,
    ).iso;
    expect(subtree).toMatchObject({
      kind: 'subtree',
      from: 5,
      to: 9,
      ranges: [
        [5, 9],
        [20, 30],
      ],
      label: 'Barrel',
    });
  });

  it('omits the default detail level', () => {
    expect(encode({ quality: 'high' })).toBe('');
  });

  it('ignores malformed input instead of throwing', () => {
    const s = decode('#cam=1,2,three&cut=sideways&m=1,2;a,b,c,d,e,f&iso=s:x-y');
    expect(s.cam).toBeUndefined();
    expect(s.cut).toBeUndefined();
    expect(s.measurements).toEqual([]);
    expect(s.iso).toBeUndefined();
  });

  it('keeps an empty subsystem list distinct from no list', () => {
    expect(decode('#on=').on).toEqual([]);
    expect(decode('#').on).toBeUndefined();
  });
});
