import { describe, expect, it } from "vitest";
import { eventoPasado } from "./tickets";

describe("eventoPasado", () => {
  const hoy = "2026-10-22";

  it("un evento de un día anterior ya pasó", () => {
    expect(eventoPasado("2026-10-21T00:00:00+00:00", hoy)).toBe(true);
    expect(eventoPasado("2025-12-31T12:00:00Z", hoy)).toBe(true);
  });

  it("el del día todavía no pasó (se ve hasta que termina el día)", () => {
    expect(eventoPasado("2026-10-22T00:00:00+00:00", hoy)).toBe(false);
    expect(eventoPasado("2026-10-22T23:00:00Z", hoy)).toBe(false);
  });

  it("los futuros y los sin fecha no pasaron", () => {
    expect(eventoPasado("2026-10-23T00:00:00+00:00", hoy)).toBe(false);
    expect(eventoPasado(null, hoy)).toBe(false);
  });
});
