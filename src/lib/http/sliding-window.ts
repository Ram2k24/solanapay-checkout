// Sliding-window rate limiting, approximated from two fixed-window counters (the
// current window and the one before it), as stored in the rate_limits table.
//
// A plain fixed window allows up to 2x the limit across a window boundary (a burst at
// the end of one window plus another at the start of the next). The sliding estimate
// weights the previous window by how much of it still lies inside the last
// `windowMs`, which removes that burst:
//
//   estimate = previous * (windowMs - elapsedMs) / windowMs + current
//
// where elapsedMs is the time since the current window started.

export function slidingEstimate(previous: number, current: number, elapsedMs: number, windowMs: number): number {
  return (previous * (windowMs - elapsedMs)) / windowMs + current;
}

// Whether one more request fits under `limit` right now.
export function slidingAllows(previous: number, current: number, elapsedMs: number, windowMs: number, limit: number): boolean {
  return slidingEstimate(previous, current, elapsedMs, windowMs) + 1 <= limit;
}

// The earliest delay (ms) after which one more request would be allowed, assuming no
// other requests arrive meanwhile. 0 if allowed now.
export function slidingRetryAfterMs(previous: number, current: number, elapsedMs: number, windowMs: number, limit: number): number {
  if (slidingAllows(previous, current, elapsedMs, windowMs, limit)) return 0;
  const untilNextWindow = windowMs - elapsedMs;

  // Still within the current window: the previous window's weight decays linearly.
  if (current + 1 <= limit && previous > 0) {
    const wait = untilNextWindow - (windowMs * (limit - current - 1)) / previous;
    if (wait < untilNextWindow) return Math.max(0, wait);
  }
  // In the next window, today's `current` becomes the decaying `previous` and the new
  // window starts empty.
  const waitInNext = current > 0 ? Math.max(0, windowMs * (1 - (limit - 1) / current)) : 0;
  return untilNextWindow + waitInNext;
}
