import { describe, expect, it } from "vitest";
import { filtrarOpciones } from "./combo";

const op = (texto: string, detalle?: string) => ({ clave: texto, texto, detalle, valor: texto });

describe("filtrarOpciones", () => {
  const opciones = [op("Fórmula 1"), op("UEFA Champions League"), op("LaLiga"), op("Liga Profesional")];

  it("sin texto devuelve todas, en el orden recibido", () => {
    expect(filtrarOpciones(opciones, "").map((o) => o.texto)).toEqual([
      "Fórmula 1",
      "UEFA Champions League",
      "LaLiga",
      "Liga Profesional",
    ]);
  });

  it("filtra por lo que contiene, sin mayúsculas ni acentos", () => {
    expect(filtrarOpciones(opciones, "liga").map((o) => o.texto)).toEqual(["LaLiga", "Liga Profesional"]);
    expect(filtrarOpciones(opciones, "formula").map((o) => o.texto)).toEqual(["Fórmula 1"]);
  });

  it("también busca en el detalle", () => {
    const eventos = [op("River vs Boca", "Liga Profesional · nov 2026"), op("Gran Premio", "Fórmula 1 · jun 2027")];
    expect(filtrarOpciones(eventos, "formula").map((o) => o.texto)).toEqual(["Gran Premio"]);
  });

  it("no vuelve a sugerir la que ya está escrita igual", () => {
    expect(filtrarOpciones(opciones, "laliga").map((o) => o.texto)).toEqual([]);
  });

  it("corta en el máximo", () => {
    const muchas = Array.from({ length: 20 }, (_, i) => op(`Evento ${i}`));
    expect(filtrarOpciones(muchas, "evento", 8)).toHaveLength(8);
  });
});
