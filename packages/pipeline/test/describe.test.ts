import { describe, expect, it } from 'vitest';
import { loadPlanFixture } from '@ledger/shared';
import { describeRoom, describeRoomInDetail, describeSurface, openingsOnWall, surfaceFeatures } from '../src/describe.js';

const plan = loadPlanFixture('demo-table');
const s = (id: string) => plan.surfaces.find((x) => x.id === id)!;

describe('describe (option text from the plan)', () => {
  it('walls: width, openings with position, neighbors', () => {
    expect(describeSurface(plan, s('living-room.wall-n'))).toBe(
      'north wall of the Living room: 3.0 m wide, window at the center, between the east and west walls',
    );
    expect(describeSurface(plan, s('living-room.wall-w'))).toContain('plain, no door or window');
  });

  it('finds the door on the other side of a shared wall', () => {
    const ops = openingsOnWall(plan, s('bedroom.wall-w'));
    expect(ops.map((o) => o.opening.id)).toEqual(['door-bedroom']);
    expect(describeSurface(plan, s('bedroom.wall-w'))).toMatch(/door at its (left|right) end/);
    expect(surfaceFeatures(plan, s('bedroom.wall-w'))).toContain('door');
  });

  it('left/right is from the room center facing the wall', () => {
    // living-room east wall runs y 0..2.5, door centered at y=0.8; facing east, south is on the right.
    expect(openingsOnWall(plan, s('living-room.wall-e'))[0]!.position).toBe('right end');
    // seen from the bedroom (facing west) the same door is on the left.
    expect(openingsOnWall(plan, s('bedroom.wall-w'))[0]!.position).toBe('left end');
  });

  it('floors and rooms', () => {
    expect(describeSurface(plan, s('living-room.floor'))).toBe('floor of the Living room: 7.5 m²');
    expect(describeRoom(plan, plan.rooms[0]!)).toBe('Living room: about 3.0 × 2.5 m, 1 window, 2 doors');
    expect(describeRoomInDetail(plan, 'bedroom')).toContain('- bedroom.wall-e: east wall of the Bedroom');
  });
});
