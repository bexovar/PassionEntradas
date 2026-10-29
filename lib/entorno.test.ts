import { describe, expect, it, vi } from "vitest";
import { esProduccion, modoDemo } from "./entorno";

describe("modoDemo", () => {
  it("sin MOCK_DATA no hay modo demo", () => {
    expect(modoDemo({})).toBe(false);
    expect(modoDemo({ MOCK_DATA: "0" })).toBe(false);
  });

  it("MOCK_DATA=1 fuera de producción (local, CI, preview) activa el demo", () => {
    expect(modoDemo({ MOCK_DATA: "1" })).toBe(true);
    expect(modoDemo({ MOCK_DATA: "1", VERCEL_ENV: "preview" })).toBe(true);
    expect(modoDemo({ MOCK_DATA: "1", VERCEL_ENV: "development" })).toBe(true);
  });

  it("en producción MOCK_DATA=1 se ignora: nunca abre la app sin login", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(modoDemo({ MOCK_DATA: "1", VERCEL_ENV: "production" })).toBe(false);
    expect(err).toHaveBeenCalled();
    err.mockRestore();
  });
});

describe("esProduccion", () => {
  it("solo el deploy de producción de Vercel", () => {
    expect(esProduccion({ VERCEL_ENV: "production" })).toBe(true);
    expect(esProduccion({ VERCEL_ENV: "preview" })).toBe(false);
    expect(esProduccion({})).toBe(false);
  });
});
