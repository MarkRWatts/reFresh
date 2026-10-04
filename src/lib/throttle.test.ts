import { describe, expect, it } from "vitest";
import { SlidingWindowThrottle, throttle } from "./throttle";

describe("SlidingWindowThrottle", () => {
  it("allows up to max hits in a window, then refuses", () => {
    const t = new SlidingWindowThrottle({ windowMs: 1000, max: 3 });
    expect(t.consume("k", 0).allowed).toBe(true);
    expect(t.consume("k", 10).allowed).toBe(true);
    expect(t.consume("k", 20).allowed).toBe(true);
    const refused = t.consume("k", 30);
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterMs).toBe(970); // first hit at 0 falls out at 1000
  });

  it("slides: old hits fall out of the window", () => {
    const t = new SlidingWindowThrottle({ windowMs: 1000, max: 2 });
    t.consume("k", 0);
    t.consume("k", 500);
    expect(t.consume("k", 999).allowed).toBe(false);
    expect(t.consume("k", 1001).allowed).toBe(true); // the hit at 0 expired
    expect(t.consume("k", 1002).allowed).toBe(false); // 500 and 1001 still count
  });

  it("does not record refused hits, so a flood can't extend its own lockout", () => {
    const t = new SlidingWindowThrottle({ windowMs: 1000, max: 1 });
    t.consume("k", 0);
    for (let i = 1; i < 50; i++) expect(t.consume("k", i).allowed).toBe(false);
    expect(t.consume("k", 1001).allowed).toBe(true);
  });

  it("keys are independent", () => {
    const t = new SlidingWindowThrottle({ windowMs: 1000, max: 1 });
    expect(t.consume("a", 0).allowed).toBe(true);
    expect(t.consume("b", 0).allowed).toBe(true);
    expect(t.consume("a", 1).allowed).toBe(false);
  });

  it("sweeps idle keys so memory is bounded", () => {
    const t = new SlidingWindowThrottle({ windowMs: 100, max: 5 }, { sweepEvery: 10 });
    for (let i = 0; i < 9; i++) t.consume(`k${i}`, 0);
    expect(t.size).toBe(9);
    t.consume("late", 1000); // 10th consume triggers a sweep at t=1000; the others are stale
    expect(t.size).toBe(1);
  });

  it("throttle() returns one shared instance per name", () => {
    const a = throttle("test-shared", { windowMs: 1000, max: 1 });
    const b = throttle("test-shared", { windowMs: 1000, max: 1 });
    expect(a).toBe(b);
    expect(a.consume("x").allowed).toBe(true);
    expect(b.consume("x").allowed).toBe(false);
  });

  it("caps the number of tracked keys, evicting the oldest", () => {
    const t = new SlidingWindowThrottle({ windowMs: 1000, max: 1 }, { maxKeys: 3 });
    for (const k of ["a", "b", "c", "d", "e"]) t.consume(k, 0);
    expect(t.size).toBe(3);
    // The newest key is still tracked, the oldest was forgotten.
    expect(t.consume("e", 1).allowed).toBe(false);
    expect(t.consume("a", 1).allowed).toBe(true);
  });
});
