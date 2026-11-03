import { describe, expect, it } from "vitest";
import { validarCuit } from "./cuit";

// Los dígitos verificadores de estos casos se calcularon aparte (módulo 11,
// pesos 5-4-3-2-7-6-5-4-3-2), no se copiaron de memoria.
describe("validarCuit", () => {
  it("acepta un CUIT con guiones y lo deja con guiones", () => {
    expect(validarCuit("20-12345678-6")).toEqual({ ok: true, cuit: "20-12345678-6" });
  });

  it("acepta el mismo CUIT sin guiones, con espacios o con puntos", () => {
    for (const v of ["20123456786", "20 12345678 6", " 20.12345678.6 ", "20-12.345.678-6"]) {
      expect(validarCuit(v)).toEqual({ ok: true, cuit: "20-12345678-6" });
    }
  });

  it("acepta CUIT de empresa (30, 33, 34) y de persona (20, 23, 24, 27)", () => {
    expect(validarCuit("33-69345023-9").ok).toBe(true);
    expect(validarCuit("30-71234567-1").ok).toBe(true);
    expect(validarCuit("27-35123456-9").ok).toBe(true);
    expect(validarCuit("23-99999999-9").ok).toBe(true);
  });

  it("acepta un verificador 0 (cuando el cálculo da 11)", () => {
    expect(validarCuit("20-10000013-0").ok).toBe(true);
  });

  it("con otra cantidad de números o con letras, es error de formato", () => {
    for (const v of ["", "2012345678", "201234567861", "20-1234567A-6", "CUIT 20123456786", "20/12345678/6"]) {
      expect(validarCuit(v)).toEqual({ ok: false, motivo: "formato" });
    }
  });

  it("con el verificador equivocado, es un CUIT inválido", () => {
    expect(validarCuit("20-12345678-9")).toEqual({ ok: false, motivo: "invalido" });
  });

  it("si el cálculo da 10, ningún verificador sirve", () => {
    for (let d = 0; d <= 9; d++) {
      expect(validarCuit(`20-10000005-${d}`)).toEqual({ ok: false, motivo: "invalido" });
    }
  });

  it("con un prefijo que no existe, es un CUIT inválido", () => {
    // 11 y 40 no son tipos de CUIT; 99999999999 tampoco.
    expect(validarCuit("11-12345678-6")).toEqual({ ok: false, motivo: "invalido" });
    expect(validarCuit("40-12345678-6")).toEqual({ ok: false, motivo: "invalido" });
    expect(validarCuit("99999999999")).toEqual({ ok: false, motivo: "invalido" });
  });

  it("no explota con algo que no es texto", () => {
    expect(validarCuit(undefined)).toEqual({ ok: false, motivo: "formato" });
    expect(validarCuit(20123456786)).toEqual({ ok: false, motivo: "formato" });
  });
});
