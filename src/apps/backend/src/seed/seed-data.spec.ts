import { describe, expect, it } from 'vitest';
import { buildWorkshops, demoRegistrationPlans, rooms, speakers, students } from './seed-data';

describe('professional demo seed dataset', () => {
  it('contains enough realistic records to make the demo UI feel populated', () => {
    const workshops = buildWorkshops(new Date('2026-05-15T00:00:00.000Z'));

    expect(students).toHaveLength(32);
    expect(rooms.length).toBeGreaterThanOrEqual(6);
    expect(speakers.length).toBeGreaterThanOrEqual(8);
    expect(workshops.length).toBeGreaterThanOrEqual(14);
    expect(workshops.filter((w) => w.status === 'PUBLISHED').length).toBeGreaterThanOrEqual(10);
    expect(workshops.some((w) => w.status === 'DRAFT')).toBe(true);
    expect(workshops.some((w) => w.feeAmount === 0)).toBe(true);
    expect(workshops.some((w) => w.feeAmount > 0)).toBe(true);
  });

  it('keeps workshop capacity within the assigned room capacity', () => {
    const roomCapacity = new Map(rooms.map((room) => [room.code, room.capacity]));
    const workshops = buildWorkshops(new Date('2026-05-15T00:00:00.000Z'));

    for (const workshop of workshops) {
      const capacity = roomCapacity.get(workshop.roomCode);
      expect(capacity).toBeDefined();
      expect(workshop.capacity).toBeLessThanOrEqual(capacity!);
    }
  });

  it('provides full and nearly-full scenarios while leaving room for live registration demos', () => {
    const workshops = buildWorkshops(new Date('2026-05-15T00:00:00.000Z'));
    const workshopCapacity = new Map(workshops.map((workshop) => [workshop.title, workshop.capacity]));

    const reservedSeats = new Map<string, number>();
    for (const plan of demoRegistrationPlans) {
      if (plan.status === 'CONFIRMED' || plan.status === 'PENDING_PAYMENT') {
        reservedSeats.set(plan.workshopTitle, (reservedSeats.get(plan.workshopTitle) ?? 0) + 1);
      }
    }

    const fullWorkshop = 'CV & LinkedIn Clinic: Sua ho so trong 30 phut';
    const nearlyFullWorkshop = 'Cybersecurity 101: Tu JWT den phong chong tan cong API';
    const liveDemoWorkshop = 'AI Career Kickstart: Tu Python den Portfolio ML dau tien';

    expect(reservedSeats.get(fullWorkshop)).toBe(workshopCapacity.get(fullWorkshop));
    expect((workshopCapacity.get(nearlyFullWorkshop) ?? 0) - (reservedSeats.get(nearlyFullWorkshop) ?? 0)).toBe(3);
    expect((reservedSeats.get(liveDemoWorkshop) ?? 0)).toBeLessThan(workshopCapacity.get(liveDemoWorkshop)! / 2);
  });
});
