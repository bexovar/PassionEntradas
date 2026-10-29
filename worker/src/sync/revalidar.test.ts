import { describe, expect, it } from "vitest";
import { ConfigSchema } from "../config/index.js";
import { tokenTienda } from "./revalidar.js";

const base = {
  PE_USER: "u",
  PE_PASS: "p",
  SUPABASE_URL: "https://x.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-role",
};

describe("TIENDA_URL", () => {
  it("acepta https y http solo para localhost", () => {
    expect(ConfigSchema.safeParse({ ...base, TIENDA_URL: "https://tienda.example" }).success).toBe(true);
    expect(ConfigSchema.safeParse({ ...base, TIENDA_URL: "http://localhost:3000" }).success).toBe(true);
    expect(ConfigSchema.safeParse({ ...base, TIENDA_URL: "http://127.0.0.1:3000/" }).success).toBe(true);
  });

  it("rechaza http a cualquier otro host: el token viajaría en claro", () => {
    expect(ConfigSchema.safeParse({ ...base, TIENDA_URL: "http://tienda.example" }).success).toBe(false);
    expect(ConfigSchema.safeParse({ ...base, TIENDA_URL: "http://localhost.evil.com" }).success).toBe(false);
  });
});

describe("REVALIDAR_TOKEN", () => {
  it("es opcional, pero si está tiene que tener 32 caracteres o más", () => {
    expect(ConfigSchema.safeParse(base).success).toBe(true);
    expect(ConfigSchema.safeParse({ ...base, REVALIDAR_TOKEN: "corto" }).success).toBe(false);
    expect(ConfigSchema.safeParse({ ...base, REVALIDAR_TOKEN: "x".repeat(32) }).success).toBe(true);
  });

  it("la tienda recibe el token propio; la service role key solo si falta", () => {
    expect(tokenTienda({ REVALIDAR_TOKEN: "t".repeat(32), SUPABASE_SERVICE_ROLE_KEY: "key" })).toBe("t".repeat(32));
    expect(tokenTienda({ REVALIDAR_TOKEN: undefined, SUPABASE_SERVICE_ROLE_KEY: "key" })).toBe("key");
  });
});
