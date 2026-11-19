import { describe, expect, it } from "vitest";
import { resumenHome } from "@/lib/resumen-home";
import { MOCK_TICKETS } from "@/lib/mock-tickets";
import { buildEvents, normalizarPrecios, type Ticket } from "@/lib/tickets";
import type { Destacado } from "@/lib/destacados";

// Una fila por evento: con stock (book + stock + precio) o a consulta.
function fila(evento: string, dias: number, conStock: boolean, competicion = "Liga"): Ticket {
  const fecha = new Date(Date.UTC(2030, 0, 1 + dias)).toISOString();
  return {
    id: `${evento}::1`,
    evento,
    competicion,
    fecha,
    ciudad: "Buenos Aires (ARG)",
    categoria: "Platea",
    precio_final: conStock ? 100 : null,
    stock: conStock ? 2 : 0,
    estado: conStock ? "book" : "on_request",
    source: "manual",
  } as Ticket;
}

const destacado = (evento: string, orden: number, competicion = "Liga"): Destacado => ({
  id: `d-${evento}`,
  competicion,
  evento,
  orden,
});

describe("resumen de la home", () => {
  const rows = normalizarPrecios(MOCK_TICKETS, { eurUsd: 1.1, arsPorUsd: 1200 });
  const r = resumenHome(rows);
  const events = buildEvents(rows);

  it("totales iguales a los del catálogo", () => {
    expect(r.totalEv).toBe(events.length);
    expect(r.totalStock).toBe(events.reduce((a, e) => a + e.bookStock, 0));
  });

  it("no viajan los sectores", () => {
    for (const e of [...r.destacados, ...r.proximos]) expect("ubicaciones" in e).toBe(false);
  });

  it("hasta 8 categorías, en orden alfabético, con su cantidad", () => {
    expect(r.topCats.length).toBeLessThanOrEqual(8);
    const nombres = r.topCats.map(([c]) => c);
    expect([...nombres].sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base" }))).toEqual(nombres);
    for (const [c, n] of r.topCats) expect(n).toBe(events.filter((e) => e.comp === c).length);
  });

  it("vacío", () => {
    expect(resumenHome([])).toEqual({
      totalEv: 0,
      totalStock: 0,
      destacados: [],
      curados: false,
      proximos: [],
      topCats: [],
    });
  });
});

describe("TKT-14: destacados en el medio, próximos abajo", () => {
  // Los más próximos son a consulta: justo lo que la tienda mostraba primero.
  const rows = [
    fila("Semana A", 1, false),
    fila("Semana B", 2, false),
    fila("Boca vs Estudiantes", 10, true),
    fila("River vs Racing", 12, true),
    fila("Boca vs Talleres", 20, false),
    fila("Lejano", 90, true),
  ];

  it("sin curaduría: el bloque del medio son los comprables, por fecha", () => {
    const r = resumenHome(rows);
    expect(r.curados).toBe(false);
    expect(r.destacados.map((e) => e.evento)).toEqual(["Boca vs Estudiantes", "River vs Racing", "Lejano"]);
    expect(r.destacados.every((e) => e.bookable > 0)).toBe(true);
  });

  it("los próximos no repiten lo que ya está arriba", () => {
    const r = resumenHome(rows);
    expect(r.proximos.map((e) => e.evento)).toEqual(["Semana A", "Semana B", "Boca vs Talleres"]);
  });

  it("con curaduría: los del panel, comprables primero y en el orden del panel", () => {
    const r = resumenHome(rows, [
      destacado("Boca vs Talleres", 0),
      destacado("River vs Racing", 1),
      destacado("Boca vs Estudiantes", 2),
    ]);
    expect(r.curados).toBe(true);
    expect(r.destacados.map((e) => e.evento)).toEqual(["River vs Racing", "Boca vs Estudiantes", "Boca vs Talleres"]);
    expect(r.proximos.map((e) => e.evento)).toEqual(["Semana A", "Semana B", "Lejano"]);
  });

  it("un destacado que ya no está en el catálogo no se muestra; si no queda ninguno, vuelve el respaldo", () => {
    expect(resumenHome(rows, [destacado("No existe", 0), destacado("River vs Racing", 1)]).destacados.map((e) => e.evento)).toEqual([
      "River vs Racing",
    ]);
    const soloViejos = resumenHome(rows, [destacado("No existe", 0)]);
    expect(soloViejos.curados).toBe(false);
    expect(soloViejos.destacados[0].evento).toBe("Boca vs Estudiantes");
  });

  it("la clave no distingue mayúsculas ni espacios de más", () => {
    const r = resumenHome(rows, [destacado("  river VS racing ", 0, "LIGA")]);
    expect(r.destacados.map((e) => e.evento)).toEqual(["River vs Racing"]);
  });
});
