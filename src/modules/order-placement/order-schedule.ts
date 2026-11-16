import { BadRequestException } from '@nestjs/common';

/** Visit windows a customer can pick. Served by the form endpoint so the app hard-codes none. */
export const TIME_SLOTS = [
  '09:00 AM - 11:00 AM',
  '11:00 AM - 01:00 PM',
  '01:00 PM - 03:00 PM',
  '03:00 PM - 05:00 PM',
  '05:00 PM - 07:00 PM',
] as const;

const MAX_DAYS_AHEAD = 30;
const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000;

/** Today's calendar date in Dhaka (UTC+6), as YYYY-MM-DD, whatever the server's timezone. */
export function dhakaToday(now = new Date()): string {
  return new Date(now.getTime() + DHAKA_OFFSET_MS).toISOString().slice(0, 10);
}

export function assertValidSchedule(date: string, timeSlot: string, now = new Date()) {
  if (!(TIME_SLOTS as readonly string[]).includes(timeSlot)) {
    throw new BadRequestException('Please choose one of the available time slots');
  }
  const today = dhakaToday(now);
  const limit = dhakaToday(new Date(now.getTime() + MAX_DAYS_AHEAD * 86_400_000));
  // ISO dates compare correctly as plain strings.
  if (date < today) throw new BadRequestException('Booking date cannot be in the past');
  if (date > limit) {
    throw new BadRequestException(`Bookings open only ${MAX_DAYS_AHEAD} days ahead`);
  }
}
