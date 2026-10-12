import { describe, it, expect } from 'vitest';
import type { SystemClockPort } from './clock.port.js';

describe('SystemClockPort', () => {
  it('debe permitir implementar un reloj simulado (FakeSystemClock) determinista', () => {
    class FakeSystemClock implements SystemClockPort {
      private readonly fixedDate: Date;

      constructor(isoString: string) {
        this.fixedDate = new Date(isoString);
      }

      now(): Date {
        return this.fixedDate;
      }

      isoString(): string {
        return this.fixedDate.toISOString();
      }
    }

    const fixedIso = '2026-10-10T15:30:00.000Z';
    const fakeClock: SystemClockPort = new FakeSystemClock(fixedIso);

    expect(fakeClock.isoString()).toBe(fixedIso);
    expect(fakeClock.now().toISOString()).toBe(fixedIso);
  });
});
