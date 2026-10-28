import { describe, expect, it } from "vitest";
import { CLAVE_RECORDAR, emailRecordado, guardarRecordado } from "./recordar-usuario";

function almacen(inicial: Record<string, string> = {}) {
  const m = new Map(Object.entries(inicial));
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    m,
  };
}

describe("recordar usuario", () => {
  it("sin nada guardado no hay email", () => {
    expect(emailRecordado(almacen())).toBeNull();
    expect(emailRecordado(almacen({ [CLAVE_RECORDAR]: "  " }))).toBeNull();
  });

  it("guarda el email (sin espacios) si se pidió recordarlo", () => {
    const a = almacen();
    guardarRecordado(a, "  agente@agencia.com ", true);
    expect(emailRecordado(a)).toBe("agente@agencia.com");
  });

  it("destildar borra el email recordado", () => {
    const a = almacen({ [CLAVE_RECORDAR]: "agente@agencia.com" });
    guardarRecordado(a, "agente@agencia.com", false);
    expect(a.m.has(CLAVE_RECORDAR)).toBe(false);
  });

  it("un email vacío no se recuerda", () => {
    const a = almacen({ [CLAVE_RECORDAR]: "viejo@agencia.com" });
    guardarRecordado(a, " ", true);
    expect(emailRecordado(a)).toBeNull();
  });
});
