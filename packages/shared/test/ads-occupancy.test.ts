import { describe, expect, it } from 'vitest';
import { type AdBooking, bookingConflicts, bookingDays, dayRanges, occupancy, placeFit } from '../src/ads';

const booking = (over: Partial<AdBooking>): AdBooking => ({
  campaignId: '00000000-0000-4000-8000-000000000001',
  name: 'קמפיין',
  advertiserName: 'מפרסם',
  status: 'active',
  share: 1,
  slots: ['sidebar'],
  categories: [],
  devices: 'all',
  from: '2026-10-20',
  to: '2026-10-25',
  ...over,
});
const id = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

describe('the occupancy of a place', () => {
  it('counts running and paused campaigns as taken and drafts as waiting, on the days they run', () => {
    const list = [booking({ campaignId: id(1), share: 2 }), booking({ campaignId: id(2), status: 'paused' }), booking({ campaignId: id(3), status: 'draft', share: 3 })];
    expect(occupancy(list, 'sidebar', '2026-10-22', 4)).toMatchObject({ booked: 3, waiting: 3, free: 1 });
    expect(occupancy(list, 'sidebar', '2026-10-26', 4)).toMatchObject({ booked: 0, free: 4 });
    expect(occupancy(list, 'home_top', '2026-10-22', 4).booked).toBe(0);
  });

  it('counts a campaign for sections only where it shows: never on the home page, never in another section', () => {
    const list = [booking({ campaignId: id(1), share: 4, categories: ['real-estate'] }), booking({ campaignId: id(2), share: 4, categories: ['insurance'] })];
    // Each section is full, but by a different campaign: neither blocks the other.
    expect(occupancy(list, 'sidebar', '2026-10-22', 4).booked).toBe(4);
    expect(placeFit(list, { share: 1, categories: [], devices: 'all', from: '2026-10-22', to: '2026-10-22' }, 'home_top', 4, '2026-10-20').fullDays).toEqual([]);
    expect(placeFit(list, { share: 1, categories: ['health'], devices: 'all', from: '2026-10-22', to: '2026-10-22' }, 'sidebar', 4, '2026-10-20').fullDays).toEqual([]);
    // A campaign everywhere meets the full sections.
    expect(placeFit(list, { share: 1, categories: [], devices: 'all', from: '2026-10-22', to: '2026-10-22' }, 'sidebar', 4, '2026-10-20').fullDays).toEqual(['2026-10-22']);
  });

  it('lets a phone-only and a computer-only campaign share a place', () => {
    const list = [booking({ campaignId: id(1), share: 4, devices: 'mobile' })];
    expect(placeFit(list, { share: 4, categories: [], devices: 'desktop', from: '2026-10-20', to: '2026-10-25' }, 'sidebar', 4, '2026-10-20').fullDays).toEqual([]);
    expect(placeFit(list, { share: 1, categories: [], devices: 'all', from: '2026-10-20', to: '2026-10-25' }, 'sidebar', 4, '2026-10-20').free).toBe(0);
  });

  it('says where and when a campaign does not fit, and never counts the campaign against itself', () => {
    const list = [booking({ campaignId: id(1), share: 3, to: '2026-10-23' }), booking({ campaignId: id(2), share: 2, slots: ['sidebar', 'home_top'] })];
    const plan = { campaignId: id(2), share: 2, slots: ['sidebar', 'home_top'] as AdBooking['slots'], categories: [], devices: 'all' as const, from: '2026-10-20', to: '2026-10-25' };
    expect(bookingConflicts(list, plan, () => 4, '2026-10-20')).toEqual([{ slot: 'sidebar', days: ['2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23'], free: 1 }]);
    expect(dayRanges(['2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-25'])).toBe('20.10–23.10, 25.10');
    // Days already gone are not checked.
    expect(bookingConflicts(list, plan, () => 4, '2026-10-24')).toEqual([]);
  });

  it('reads a campaign\'s days in Israel time: an end at midnight closes the day before', () => {
    expect(bookingDays({ startsAt: '2026-10-19T22:00:00Z', endsAt: '2026-10-24T21:00:00Z' }, '2026-10-15')).toEqual({ from: '2026-10-20', to: '2026-10-24' });
    expect(bookingDays({ startsAt: null, endsAt: null }, '2026-10-15')).toEqual({ from: '2026-10-15', to: null });
  });
});
