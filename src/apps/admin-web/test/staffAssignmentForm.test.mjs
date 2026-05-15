import assert from 'node:assert/strict';
import {
  buildAssignmentDraftFromWorkshop,
  validateAssignmentDraft,
} from '../src/lib/staffAssignmentForm.ts';

const workshop = {
  id: 'workshop-1',
  title: 'UX demo workshop',
  roomId: 'room-1',
  startAt: '2026-05-16T02:00:00.000Z',
  endAt: '2026-05-16T04:00:00.000Z',
};

const draft = buildAssignmentDraftFromWorkshop(workshop);

assert.equal(draft.workshopId, 'workshop-1');
assert.equal(draft.roomId, 'room-1');
assert.match(draft.startsAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
assert.match(draft.endsAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);

assert.equal(
  validateAssignmentDraft({
    staffId: 'staff-1',
    roomId: 'room-1',
    workshopId: 'workshop-1',
    startsAt: '2026-05-16T22:00',
    endsAt: '2026-05-16T23:00',
  }),
  null,
);

assert.equal(
  validateAssignmentDraft({
    staffId: 'staff-1',
    roomId: 'room-1',
    workshopId: 'workshop-1',
    startsAt: '2026-05-16T22:00',
    endsAt: '2026-05-16T21:00',
  }),
  'Thời gian kết thúc phải sau thời gian bắt đầu.',
);

assert.equal(
  validateAssignmentDraft({
    staffId: 'staff-1',
    roomId: 'room-1',
    workshopId: 'workshop-1',
    startsAt: '2026-05-16T24:00',
    endsAt: '2026-05-16T25:00',
  }),
  'Vui lòng nhập đầy đủ ngày và giờ theo định dạng 24h HH:mm.',
);

console.log('staff assignment form tests passed');
