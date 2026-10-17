export interface ClockPort {
  now(): Date;
}
export const CLOCK = Symbol('CLOCK');
