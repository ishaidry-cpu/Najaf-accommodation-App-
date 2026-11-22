import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Room } from '../../types';
import {
  INITIAL_ROOMS,
  buildRoomAmenities,
  getRoomBedCount,
  getRoomCustomFeatures,
  mergeRoomsIntoInventory,
} from '../storage';

const custom = (over: Partial<Room>): Room => ({
  id: 'rm-badri-301', building: 'Badri', roomNumber: '301', floor: 3, floorLabel: 'Floor 3',
  capacity: 5, pax: 5, buffer: 1, beds: 4, bedType: 'Both Single Bed & double Bed', toiletType: 'WESTERN',
  category: 'Category A (Nizaam)', status: 'available', amenities: [], ...over,
});

test('a custom Badri room is kept (not pruned to the six official rooms)', () => {
  const merged = mergeRoomsIntoInventory(INITIAL_ROOMS, [custom({})]);
  assert.equal(merged.length, INITIAL_ROOMS.length + 1);
  const room = merged.find((r) => r.building === 'Badri' && r.roomNumber === '301');
  assert.equal(room?.beds, 4);
  assert.equal(room?.capacity, 5);
});

test('editing an official room keeps the new specs and its id', () => {
  const official = INITIAL_ROOMS.find((r) => r.building === 'Burhani' && r.roomNumber === 'G1')!;
  const merged = mergeRoomsIntoInventory(INITIAL_ROOMS, [{ ...official, id: 'other-id', capacity: 4, pax: 4, beds: 2 }]);
  const room = merged.find((r) => r.building === 'Burhani' && r.roomNumber === 'G1')!;
  assert.equal(merged.length, INITIAL_ROOMS.length);
  assert.equal(room.id, official.id);
  assert.equal(room.capacity, 4);
  assert.equal(room.beds, 2);
});

test('rooms saved before bed counts fall back to their capacity', () => {
  assert.equal(getRoomBedCount(custom({ beds: undefined, capacity: 3 })), 3);
});

test('custom features round-trip through the amenity list', () => {
  const amenities = buildRoomAmenities({ toiletType: 'WESTERN', bedType: 'Single Beds', buffer: 1 }, ['Balcony', 'Near lift']);
  assert.deepEqual(getRoomCustomFeatures(custom({ bedType: 'Single Beds', amenities })), ['Balcony', 'Near lift']);
});
