import { describe, expect, it } from 'vitest';
import { buildPlan, compassOf, wallsFromRooms } from '../src/index.js';

describe('wallsFromRooms', () => {
  it('names a square room n/e/s/w with area = length x height', () => {
    const s = wallsFromRooms([{ id: 'r', name: 'R', polygon: [[0, 0], [4, 0], [4, 3], [0, 3]] }], 2.5);
    const ids = s.filter((x) => x.kind === 'wall').map((x) => x.id).sort();
    expect(ids).toEqual(['r.wall-e', 'r.wall-n', 'r.wall-s', 'r.wall-w']);
    expect(s.find((x) => x.id === 'r.wall-s')!.areaM2).toBe(10);
    expect(s.find((x) => x.id === 'r.floor')!.areaM2).toBe(12);
  });

  it('gives the same compass sides for clockwise polygons', () => {
    const s = wallsFromRooms([{ id: 'r', name: 'R', polygon: [[0, 0], [0, 3], [4, 3], [4, 0]] }], 2.5);
    expect(s.filter((x) => x.kind === 'wall').map((x) => x.id).sort()).toEqual(['r.wall-e', 'r.wall-n', 'r.wall-s', 'r.wall-w']);
  });

  it('neighbors are the walls sharing a corner', () => {
    const s = wallsFromRooms([{ id: 'r', name: 'R', polygon: [[0, 0], [4, 0], [4, 3], [0, 3]] }], 2.5);
    expect(s.find((x) => x.id === 'r.wall-n')!.neighbors!.sort()).toEqual(['r.wall-e', 'r.wall-w']);
  });

  it('L-shaped rooms get suffixed repeated sides', () => {
    const s = wallsFromRooms([{ id: 'l', name: 'L', polygon: [[0, 0], [4, 0], [4, 2], [2, 2], [2, 4], [0, 4]] }], 2.5);
    const ids = s.filter((x) => x.kind === 'wall').map((x) => x.id);
    expect(ids).toHaveLength(6);
    expect(new Set(ids).size).toBe(6);
    expect(ids.some((i) => i.endsWith('-2'))).toBe(true);
  });

  it('compassOf follows the outward normal', () => {
    expect(compassOf([0, 0], [4, 0], true)).toBe('s');
    expect(compassOf([4, 3], [0, 3], true)).toBe('n');
  });
});

describe('buildPlan', () => {
  it('attaches openings to the nearest wall and subtracts their area', () => {
    const p = buildPlan({
      unitId: 'u', ceilingHeightM: 2.5, metersPerPixel: 0.01, scaleSource: 'assumed',
      rooms: [{ name: 'Room', polygon: [[0, 0], [4, 0], [4, 3], [0, 3]] }],
      openings: [{ id: 'd', kind: 'door', center: [2, 0], widthM: 1 }],
    });
    expect(p.openings[0]!.wallId).toBe('room.wall-s');
    expect(p.openings[0]!.offsetM).toBe(1.5);
    expect(p.surfaces.find((s) => s.id === 'room.wall-s')!.areaM2).toBe(8);
    expect(p.surfaces.find((s) => s.id === 'room.wall-s')!.landmarks).toContain('door');
  });
});
