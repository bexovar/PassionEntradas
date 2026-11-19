import { describe, expect, it } from "vitest";
import {
  consultaCoincide,
  filtroDeLink,
  filtroDeParams,
  etiquetaFiltro,
  opCoincide,
  urlPanel,
} from "./panel-filtros";
import type { Operacion } from "./operaciones";

const op = (extra: Partial<Operacion> = {}): Operacion =>
  ({
    id: "o", code: "BX", evento: "E", fecha_evento: null, created_at: "2026-10-09T00:00:00Z",
    status: "esperando_entrada", tipo: "operacion", moneda: "USD",
    entrada_recibida_at: null, pago_confirmado_at: null, pago_proveedor_at: null, cerrada_at: null,
    confirmada_at: null, ...extra,
  }) as Operacion;

const AHORA = new Date("2026-10-09T12:00:00Z");

describe("filtroDeParams", () => {
  it("sin filtro o con uno inválido es 'todas'", () => {
    expect(filtroDeParams(undefined)).toEqual({ filtro: "todas" });
    expect(filtroDeParams({ filtro: "cualquiera" })).toEqual({ filtro: "todas" });
    expect(filtroDeParams({ filtro: ["en_curso", "x"] })).toEqual({ filtro: "todas" });
  });
  it("lee moneda y período solo donde aplican", () => {
    expect(filtroDeParams({ filtro: "cobradas", moneda: "ARS", desde: "2026-10-01", hasta: "2026-10-09" })).toEqual({
      filtro: "cobradas", moneda: "ARS", desde: "2026-10-01", hasta: "2026-10-09",
    });
    expect(filtroDeParams({ filtro: "sin_cobrar", moneda: "USD", desde: "2026-10-01" })).toEqual({
      filtro: "sin_cobrar", moneda: "USD",
    });
    expect(filtroDeParams({ filtro: "en_curso", moneda: "USD" })).toEqual({ filtro: "en_curso" });
    expect(filtroDeParams({ filtro: "cobradas", moneda: "EUR", desde: "ayer" })).toEqual({ filtro: "cobradas" });
  });
  it("ida y vuelta por la URL", () => {
    const f = { filtro: "cobradas" as const, moneda: "USD" as const, desde: "2026-09-01", hasta: "2026-09-30" };
    const url = new URL(urlPanel(f), "https://x.test");
    expect(url.pathname).toBe("/admin");
    expect(filtroDeParams(Object.fromEntries(url.searchParams))).toEqual(f);
  });
});

describe("opCoincide", () => {
  it("cobradas: pago confirmado, no cancelada, en la moneda y el período (día argentino)", () => {
    const f = { filtro: "cobradas" as const, moneda: "USD" as const, desde: "2026-10-01", hasta: "2026-10-08" };
    expect(opCoincide(op({ pago_confirmado_at: "2026-10-05T12:00:00Z" }), f)).toBe(true);
    expect(opCoincide(op(), f)).toBe(false);
    expect(opCoincide(op({ pago_confirmado_at: "2026-10-05T12:00:00Z", status: "cancelada" }), f)).toBe(false);
    expect(opCoincide(op({ pago_confirmado_at: "2026-10-05T12:00:00Z", moneda: "ARS" }), f)).toBe(false);
    // 01:00 UTC del 9 son las 22 h del 8 en Buenos Aires: entra.
    expect(opCoincide(op({ pago_confirmado_at: "2026-10-09T01:00:00Z" }), f)).toBe(true);
    expect(opCoincide(op({ pago_confirmado_at: "2026-10-09T04:00:00Z" }), f)).toBe(false);
  });
  it("sin_cobrar: abierta sin pago, sin contar pedidos sin confirmar", () => {
    const f = { filtro: "sin_cobrar" as const };
    expect(opCoincide(op(), f)).toBe(true);
    expect(opCoincide(op({ tipo: "pedido" }), f)).toBe(false);
    expect(opCoincide(op({ tipo: "pedido", confirmada_at: "x" }), f)).toBe(true);
    expect(opCoincide(op({ pago_confirmado_at: "x" }), f)).toBe(false);
    expect(opCoincide(op({ cerrada_at: "x" }), f)).toBe(false);
    expect(opCoincide(op({ status: "cancelada" }), f)).toBe(false);
    expect(opCoincide(op({ moneda: "ARS" }), { ...f, moneda: "USD" })).toBe(false);
  });
  it("los filtros de consultas no muestran operaciones", () => {
    expect(opCoincide(op(), { filtro: "a_cotizar" })).toBe(false);
  });
  it("las pestañas y las etapas (TKT-21)", () => {
    expect(opCoincide(op({ tipo: "pedido" }), { filtro: "pendiente_confirmar" })).toBe(true);
    expect(opCoincide(op(), { filtro: "esperando_pago" })).toBe(true);
    expect(opCoincide(op({ pago_confirmado_at: "x" }), { filtro: "pendiente_pago_proveedor" })).toBe(true);
    expect(opCoincide(op({ reembolso_at: "x", pago_confirmado_at: "x" }), { filtro: "reembolsos" })).toBe(true);
    expect(opCoincide(op({ reembolso_at: "x", pago_confirmado_at: "x" }), { filtro: "pendiente_pago_proveedor" })).toBe(false);
    expect(opCoincide(op({ status: "cancelada" }), { filtro: "canceladas" })).toBe(true);
    expect(opCoincide(op({ status: "cancelada" }), { filtro: "en_curso" })).toBe(false);
  });
});

describe("consultaCoincide", () => {
  const base = { id: "c", code: "BX-C", evento: "E", created_at: "2026-10-09T11:00:00Z" };
  const pendiente = { ...base, estado: "pendiente" as const, vence_at: null };
  const cotizada = { ...base, estado: "cotizada" as const, vence_at: "2026-10-10T00:00:00Z" };
  const vencida = { ...base, estado: "cotizada" as const, vence_at: "2026-10-01T00:00:00Z" };
  it("a cotizar / esperando pago / vencidos separan las consultas por estado", () => {
    expect(consultaCoincide(pendiente, { filtro: "a_cotizar" }, AHORA)).toBe(true);
    expect(consultaCoincide(cotizada, { filtro: "a_cotizar" }, AHORA)).toBe(false);
    expect(consultaCoincide(cotizada, { filtro: "esperando_pago" }, AHORA)).toBe(true);
    expect(consultaCoincide(vencida, { filtro: "esperando_pago" }, AHORA)).toBe(false);
    expect(consultaCoincide(vencida, { filtro: "vencido" }, AHORA)).toBe(true);
    expect(consultaCoincide(pendiente, { filtro: "esperando_pago" }, AHORA)).toBe(false);
  });
  it("todas y en curso muestran todas; el resto ninguna", () => {
    expect(consultaCoincide(pendiente, { filtro: "todas" }, AHORA)).toBe(true);
    expect(consultaCoincide(cotizada, { filtro: "en_curso" }, AHORA)).toBe(true);
    expect(consultaCoincide(pendiente, { filtro: "cobradas" }, AHORA)).toBe(false);
  });
});

describe("prioridad", () => {
  it("lo que lleva rato esperando, operaciones y consultas", () => {
    const AH = new Date("2026-10-09T15:00:00Z");
    expect(opCoincide(op({ tipo: "pedido", created_at: "2026-10-09T12:00:00Z" }), { filtro: "prioridad" }, AH)).toBe(true);
    expect(opCoincide(op({ tipo: "pedido", created_at: "2026-10-09T14:00:00Z" }), { filtro: "prioridad" }, AH)).toBe(false);
    const c = { id: "c", code: "C", evento: "E", estado: "pendiente" as const, vence_at: null };
    expect(consultaCoincide({ ...c, created_at: "2026-10-09T10:00:00Z" }, { filtro: "prioridad" }, AH)).toBe(true);
    expect(consultaCoincide({ ...c, created_at: "2026-10-09T14:00:00Z" }, { filtro: "prioridad" }, AH)).toBe(false);
    expect(filtroDeParams({ filtro: "prioridad" })).toEqual({ filtro: "prioridad" });
    expect(etiquetaFiltro({ filtro: "prioridad" })).toBe("Con prioridad");
  });
});

describe("cliente (Ver sus pedidos)", () => {
  const ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const c = { id: ID, email: "ana@gmail.com", nombre: "Ana" };
  it("se lee de la URL y vuelve igual", () => {
    const url = new URL(urlPanel({ filtro: "todas", cliente: c }), "https://x.test");
    expect(url.searchParams.get("filtro")).toBeNull();
    expect(filtroDeParams(Object.fromEntries(url.searchParams))).toEqual({ filtro: "todas", cliente: c });
    expect(filtroDeParams({ cliente: "no-es-un-id" })).toEqual({ filtro: "todas" });
    expect(filtroDeParams({ filtro: "en_curso", cliente: ID.toUpperCase(), email: " ANA@gmail.com " })).toEqual({
      filtro: "en_curso",
      cliente: { id: ID, email: "ana@gmail.com" },
    });
  });
  it("exacto: por cuenta, o por email exacto si no se vinculó (mariana@ no es ana@)", () => {
    const f = { filtro: "todas" as const, cliente: c };
    expect(opCoincide(op({ cliente_id: ID }), f)).toBe(true);
    expect(opCoincide(op({ cliente_id: "otro" }), f)).toBe(false);
    expect(opCoincide(op({ cliente_id: null, cliente_email: "Ana@Gmail.com" }), f)).toBe(true);
    expect(opCoincide(op({ cliente_id: null, cliente_email: "mariana@gmail.com" }), f)).toBe(false);
    // Vinculada a otra cuenta con el mismo email: manda la cuenta.
    expect(opCoincide(op({ cliente_id: "otro", cliente_email: "ana@gmail.com" }), f)).toBe(false);
  });
  it("se combina con los demás filtros y con las consultas", () => {
    const AH = new Date("2026-10-09T12:00:00Z");
    expect(opCoincide(op({ cliente_id: ID, status: "cancelada" }), { filtro: "en_curso", cliente: c })).toBe(false);
    const cons = { id: "x", code: "C", evento: "E", estado: "pendiente" as const, vence_at: null, created_at: "2026-10-09T11:00:00Z" };
    expect(consultaCoincide({ ...cons, cliente_id: ID }, { filtro: "todas", cliente: c }, AH)).toBe(true);
    expect(consultaCoincide({ ...cons, cliente_id: "otro" }, { filtro: "todas", cliente: c }, AH)).toBe(false);
  });
});

describe("etiquetaFiltro", () => {
  it("solo para filtros de tarjeta", () => {
    expect(etiquetaFiltro({ filtro: "en_curso" })).toBeNull();
    expect(etiquetaFiltro({ filtro: "a_cotizar" })).toBe("A cotizar");
    expect(etiquetaFiltro({ filtro: "cobradas", moneda: "USD", desde: "2026-10-01", hasta: "2026-10-09" })).toBe(
      "Con pago confirmado · USD · 01/10 → 09/10"
    );
  });
});

describe("filtroDeLink (links de la campana estando en el Panel)", () => {
  it("lee el filtro y la búsqueda del link", () => {
    expect(filtroDeLink("/admin?q=BX-AB12CD34")).toEqual({ filtro: { filtro: "todas" }, q: "BX-AB12CD34" });
    // Los links viejos siguen andando (avisos y emails ya mandados).
    expect(filtroDeLink("/admin?filtro=nuevos")).toEqual({ filtro: { filtro: "pendiente_confirmar" }, q: "" });
    expect(filtroDeLink("/admin?filtro=esperando")).toEqual({ filtro: { filtro: "esperando_pago" }, q: "" });
    expect(filtroDeLink("/admin")).toEqual({ filtro: { filtro: "todas" }, q: "" });
  });
  it("lo que no es el Panel no es un filtro", () => {
    expect(filtroDeLink("/admin/solicitudes")).toBeNull();
    expect(filtroDeLink("/admin/clientes?x=1")).toBeNull();
    expect(filtroDeLink("/moderador")).toBeNull();
  });
});

describe("Panel filtrado por agencia (Ver pedidos en Clientes)", () => {
  const ORG = "0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a";

  it("el link de la agencia ida y vuelta", () => {
    const url = urlPanel({ filtro: "todas", organizacion: { id: ORG, nombre: "Viajes del Sur" } });
    expect(url).toBe(`/admin?organizacion=${ORG}&organizacion_nombre=Viajes+del+Sur`);
    expect(filtroDeLink(url)?.filtro).toEqual({ filtro: "todas", organizacion: { id: ORG, nombre: "Viajes del Sur" } });
  });

  it("un id que no es uuid se ignora", () => {
    expect(filtroDeParams({ organizacion: "x' or 1=1" }).organizacion).toBeUndefined();
  });

  it("solo pasan las operaciones y consultas de esa agencia", () => {
    const f = { filtro: "todas" as const, organizacion: { id: ORG } };
    expect(opCoincide(op({ organizacion_id: ORG }), f, AHORA)).toBe(true);
    expect(opCoincide(op({ organizacion_id: ORG.toUpperCase() }), f, AHORA)).toBe(true);
    expect(opCoincide(op({ organizacion_id: "otra" }), f, AHORA)).toBe(false);
    expect(opCoincide(op({ organizacion_id: null }), f, AHORA)).toBe(false);
    const c = { id: "c", code: "BX-C", evento: "E", created_at: "2026-10-09T11:00:00Z", estado: "pendiente" as const, vence_at: null };
    expect(consultaCoincide({ ...c, organizacion_id: ORG }, { filtro: "a_cotizar", organizacion: { id: ORG } }, AHORA)).toBe(true);
    expect(consultaCoincide({ ...c, organizacion_id: null }, { filtro: "a_cotizar", organizacion: { id: ORG } }, AHORA)).toBe(false);
  });
});
