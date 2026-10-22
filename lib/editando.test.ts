import { describe, expect, it } from "vitest";
import { PAUSA_ESCRIBIENDO_MS, esCampoDeTexto, hayQueEsperar } from "./editando";

describe("esCampoDeTexto", () => {
  it("cuenta los campos en los que se escribe", () => {
    expect(esCampoDeTexto("INPUT", "text", false)).toBe(true);
    expect(esCampoDeTexto("INPUT", "search", false)).toBe(true);
    expect(esCampoDeTexto("INPUT", "date", false)).toBe(true);
    expect(esCampoDeTexto("INPUT", "number", false)).toBe(true);
    expect(esCampoDeTexto("INPUT", null, false)).toBe(true);
    expect(esCampoDeTexto("TEXTAREA", null, false)).toBe(true);
    expect(esCampoDeTexto("SELECT", null, false)).toBe(true);
    expect(esCampoDeTexto("DIV", null, true)).toBe(true);
  });

  it("no cuenta botones, tildes ni lo que no es un campo", () => {
    expect(esCampoDeTexto("INPUT", "checkbox", false)).toBe(false);
    expect(esCampoDeTexto("INPUT", "submit", false)).toBe(false);
    expect(esCampoDeTexto("BUTTON", null, false)).toBe(false);
    expect(esCampoDeTexto("A", null, false)).toBe(false);
  });
});

describe("hayQueEsperar", () => {
  const base = { focoEnCampo: false, focoEnEdicion: false, msDesdeUltimaTecla: Infinity, hayEdicionMarcada: false };

  it("refresca si nadie está escribiendo", () => {
    expect(hayQueEsperar(base)).toBe(false);
  });

  it("espera mientras se escribe en un campo suelto (el buscador del panel)", () => {
    expect(hayQueEsperar({ ...base, focoEnCampo: true, msDesdeUltimaTecla: 0 })).toBe(true);
    expect(hayQueEsperar({ ...base, focoEnCampo: true, msDesdeUltimaTecla: PAUSA_ESCRIBIENDO_MS - 1 })).toBe(true);
  });

  it("un campo suelto con foco pero sin escribir hace rato no frena la lista", () => {
    expect(hayQueEsperar({ ...base, focoEnCampo: true, msDesdeUltimaTecla: PAUSA_ESCRIBIENDO_MS })).toBe(false);
  });

  it("dentro de un formulario espera mientras tenga el foco, aunque no escriba", () => {
    expect(hayQueEsperar({ ...base, focoEnCampo: true, focoEnEdicion: true })).toBe(true);
  });

  it("se escribió hace poco pero el foco ya no está en un campo: refresca", () => {
    expect(hayQueEsperar({ ...base, msDesdeUltimaTecla: 0 })).toBe(false);
  });

  it("datos sin guardar marcados con data-editando: espera siempre", () => {
    expect(hayQueEsperar({ ...base, hayEdicionMarcada: true })).toBe(true);
  });
});
