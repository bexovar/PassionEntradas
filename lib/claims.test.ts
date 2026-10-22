import { describe, expect, it } from "vitest";
import { usuarioDeClaims } from "./claims";
import { getRol } from "./auth";
import type { User } from "@supabase/supabase-js";

describe("usuarioDeClaims", () => {
  const claims = {
    sub: "b62999a3-b2e2-4a0f-983e-2d62b2b7da57",
    role: "authenticated",
    email: "nacho@example.com",
    app_metadata: { provider: "email", role: "administrador" },
    user_metadata: { nombre: "Ignacio" },
  };

  it("arma el usuario con lo que usan getRol y el ruteo", () => {
    const u = usuarioDeClaims(claims)!;
    expect(u.id).toBe(claims.sub);
    expect(u.email).toBe("nacho@example.com");
    expect(getRol(u as User)).toBe("administrador");
    expect(u.user_metadata).toEqual({ nombre: "Ignacio" });
  });

  it("desactivado en el token: sin rol, igual que con getUser()", () => {
    const u = usuarioDeClaims({ ...claims, app_metadata: { role: "moderador", desactivado: true } })!;
    expect(getRol(u as User)).toBeNull();
  });

  it("sin sesión o sin sub: null", () => {
    expect(usuarioDeClaims(null)).toBeNull();
    expect(usuarioDeClaims(undefined)).toBeNull();
    expect(usuarioDeClaims({})).toBeNull();
    expect(usuarioDeClaims({ ...claims, sub: "" })).toBeNull();
    expect(usuarioDeClaims({ ...claims, sub: 42 })).toBeNull();
  });

  it("un token que no es de una sesión de usuario no cuenta", () => {
    expect(usuarioDeClaims({ ...claims, role: "anon" })).toBeNull();
    expect(usuarioDeClaims({ ...claims, role: "service_role" })).toBeNull();
  });

  it("metadata ausente o rara: objetos vacíos, sin rol", () => {
    const u = usuarioDeClaims({ sub: "x", role: "authenticated", app_metadata: "nada", user_metadata: [1] })!;
    expect(u.app_metadata).toEqual({});
    expect(u.user_metadata).toEqual({});
    expect(u.email).toBeUndefined();
    expect(getRol(u as User)).toBeNull();
  });
});
