import { toLocalInput } from './format.ts';
import { isValidTime24h } from './timeInput.ts';

export interface AssignmentDraft {
  staffId: string;
  roomId: string;
  workshopId: string;
  startsAt: string;
  endsAt: string;
}

export interface AssignmentWorkshopOption {
  id: string;
  title: string;
  startAt: string;
  endAt: string;
  roomId?: string | null;
}

export function buildAssignmentDraftFromWorkshop(
  workshop: AssignmentWorkshopOption,
): Pick<AssignmentDraft, 'workshopId' | 'roomId' | 'startsAt' | 'endsAt'> {
  return {
    workshopId: workshop.id,
    roomId: workshop.roomId ?? '',
    startsAt: toLocalInput(workshop.startAt),
    endsAt: toLocalInput(workshop.endAt),
  };
}

export function validateAssignmentDraft(draft: AssignmentDraft): string | null {
  if (!draft.staffId || !draft.workshopId || !draft.roomId) {
    return 'Vui lòng chọn đủ staff, workshop và phòng.';
  }
  if (!isCompleteLocalDateTime(draft.startsAt) || !isCompleteLocalDateTime(draft.endsAt)) {
    return 'Vui lòng nhập đầy đủ ngày và giờ theo định dạng 24h HH:mm.';
  }
  if (new Date(draft.startsAt).getTime() >= new Date(draft.endsAt).getTime()) {
    return 'Thời gian kết thúc phải sau thời gian bắt đầu.';
  }
  return null;
}

export function splitLocalDateTime(value: string): { date: string; time: string } {
  const [date = '', time = ''] = value.split('T');
  return { date, time: time.slice(0, 5) };
}

export function joinLocalDateTime(date: string, time: string): string {
  if (!date && !time) return '';
  return `${date}T${time}`;
}

function isCompleteLocalDateTime(value: string): boolean {
  const { date, time } = splitLocalDateTime(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  return isValidTime24h(time);
}
