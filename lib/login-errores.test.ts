import { describe, expect, it } from "vitest";
import { camposFaltantes, conSolicitud, falloDeAuth } from "./login-errores";

describe("falloDeAuth", () => {
  it("email o contraseña mal", () => {
    expect(falloDeAuth({ name: "AuthApiError", status: 400, code: "invalid_credentials" })).toBe("credenciales");
    // Un 4xx sin código conocido también es de lo que se tipeó.
    expect(falloDeAuth({ name: "AuthApiError", status: 400 })).toBe("credenciales");
  });

  it("cuenta dada de baja (bloqueada en Auth)", () => {
    expect(falloDeAuth({ name: "AuthApiError", status: 400, code: "user_banned" })).toBe("inactiva");
  });

  it("sin conexión o servidor caído", () => {
    expect(falloDeAuth({ name: "AuthRetryableFetchError", status: 0, message: "Failed to fetch" })).toBe("red");
    expect(falloDeAuth({ name: "AuthApiError", status: 500 })).toBe("red");
    expect(falloDeAuth({ name: "AuthApiError", status: 503 })).toBe("red");
    expect(falloDeAuth({ name: "AuthApiError", status: 429, code: "over_request_rate_limit" })).toBe("red");
    expect(falloDeAuth({ message: "NetworkError when attempting to fetch resource." })).toBe("red");
  });
});

describe("conSolicitud", () => {
  it("credenciales mal + solicitud pendiente = en revisión", () => {
    expect(conSolicitud("credenciales", true)).toBe("revision");
    expect(conSolicitud("credenciales", false)).toBe("credenciales");
  });

  it("no pisa los otros casos", () => {
    expect(conSolicitud("red", true)).toBe("red");
    expect(conSolicitud("inactiva", true)).toBe("inactiva");
  });
});

describe("camposFaltantes", () => {
  it("marca cada campo vacío", () => {
    expect(camposFaltantes("", "")).toEqual({ email: "vacio", password: "vacio" });
    expect(camposFaltantes("  ", "x")).toEqual({ email: "vacio" });
    expect(camposFaltantes("a@b.com", "")).toEqual({ password: "vacio" });
  });

  it("completos, nada", () => {
    expect(camposFaltantes("a@b.com", "secreta")).toEqual({});
  });
});
