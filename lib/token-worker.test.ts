import { afterEach, describe, expect, it, vi } from "vitest";
import { tokenWorkerValido } from "./token-worker";

const PROPIO = "t".repeat(40);
const KEY = "service-role-key-de-prueba";

describe("tokenWorkerValido", () => {
  afterEach(() => vi.restoreAllMocks());

  it("con REVALIDAR_TOKEN acepta solo ese token", () => {
    const env = { REVALIDAR_TOKEN: PROPIO, SUPABASE_SERVICE_ROLE_KEY: KEY };
    expect(tokenWorkerValido(PROPIO, env)).toBe(true);
    expect(tokenWorkerValido("otro", env)).toBe(false);
  });

  it("con REVALIDAR_TOKEN la service role key ya no sirve", () => {
    const env = { REVALIDAR_TOKEN: PROPIO, SUPABASE_SERVICE_ROLE_KEY: KEY };
    expect(tokenWorkerValido(KEY, env)).toBe(false);
  });

  it("sin REVALIDAR_TOKEN acepta la service role key (transición)", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(tokenWorkerValido(KEY, { SUPABASE_SERVICE_ROLE_KEY: KEY })).toBe(true);
  });

  it("un REVALIDAR_TOKEN corto rechaza todo", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const corto = "abc";
    expect(tokenWorkerValido(corto, { REVALIDAR_TOKEN: corto, SUPABASE_SERVICE_ROLE_KEY: KEY })).toBe(false);
  });

  it("sin header o sin secretos configurados, rechaza", () => {
    expect(tokenWorkerValido(null, { REVALIDAR_TOKEN: PROPIO })).toBe(false);
    expect(tokenWorkerValido(PROPIO, {})).toBe(false);
  });
});
