import { describe, expect, it } from "vitest";
import {
  agenciasDeClientes,
  coincidenciaBusqueda,
  fichasDeClientes,
  rankearClientes,
  type ClienteCuenta,
  type CompraDeCliente,
} from "./clientes";

const cuentas: ClienteCuenta[] = [
  { id: "a", nombre: "Ana", email: "ana@x.com" },
  { id: "b", nombre: "Bruno", email: "bruno@x.com" },
  { id: "c", nombre: "Carla", email: "carla@x.com" },
];

const compra = (o: Partial<CompraDeCliente>): CompraDeCliente => ({
  cliente_id: null,
  cliente_email: null,
  monto: 100,
  moneda: "USD",
  status: "esperando_entrada",
  ...o,
});

describe("rankearClientes", () => {
  it("ordena por cantidad de operaciones", () => {
    const r = rankearClientes(cuentas, [
      compra({ cliente_id: "b" }),
      compra({ cliente_id: "b" }),
      compra({ cliente_id: "a" }),
    ]);
    expect(r.map((c) => c.nombre)).toEqual(["Bruno", "Ana", "Carla"]);
    expect(r[0].operaciones).toBe(2);
  });

  it("con la misma cantidad, desempata el que más plata movió", () => {
    const r = rankearClientes(cuentas, [
      compra({ cliente_id: "a", monto: 50 }),
      compra({ cliente_id: "b", monto: 900 }),
    ]);
    expect(r.map((c) => c.nombre).slice(0, 2)).toEqual(["Bruno", "Ana"]);
  });

  it("los que nunca compraron van al final, por nombre", () => {
    const r = rankearClientes(cuentas, [compra({ cliente_id: "c" })]);
    expect(r.map((c) => c.nombre)).toEqual(["Carla", "Ana", "Bruno"]);
  });

  it("la lista siempre trae a TODOS, compren o no", () => {
    expect(rankearClientes(cuentas, [])).toHaveLength(3);
  });

  it("las canceladas no cuentan como compra", () => {
    const r = rankearClientes(cuentas, [
      compra({ cliente_id: "a", status: "cancelada" }),
      compra({ cliente_id: "b" }),
    ]);
    expect(r[0].nombre).toBe("Bruno");
    expect(r.find((c) => c.id === "a")!.operaciones).toBe(0);
  });

  it("vincula por email cuando la operación no tiene cliente_id", () => {
    const r = rankearClientes(cuentas, [
      compra({ cliente_email: "ANA@x.com" }),
      compra({ cliente_email: "ana@X.com" }),
    ]);
    expect(r[0].nombre).toBe("Ana");
    expect(r[0].operaciones).toBe(2);
  });

  it("no mezcla monedas: un total por cada una", () => {
    // Sumar 500.000 pesos con 300 dólares daría un número que no es de ninguna
    // de las dos monedas.
    const r = rankearClientes(cuentas, [
      compra({ cliente_id: "a", monto: 500000, moneda: "ARS" }),
      compra({ cliente_id: "a", monto: 300, moneda: "USD" }),
    ]);
    const ana = r.find((c) => c.id === "a")!;
    expect(ana.operaciones).toBe(2);
    expect(ana.totales).toEqual([
      { moneda: "ARS", total: 500000 },
      { moneda: "USD", total: 300 },
    ]);
  });

  it("una operación de alguien que no está en la lista no rompe nada", () => {
    const r = rankearClientes(cuentas, [compra({ cliente_id: "fantasma" })]);
    expect(r).toHaveLength(3);
    expect(r.every((c) => c.operaciones === 0)).toBe(true);
  });
});

describe("fichasDeClientes", () => {
  const cuenta = (id: string, nombre: string, email: string) => ({
    id, nombre, email, solicitudId: `s-${id}`, revocada: false,
  });
  const op = (extra: Partial<import("./clientes").OpDeCliente>) => ({
    cliente_id: null, cliente_email: null, monto: 100, moneda: "USD", status: "esperando_entrada",
    created_at: "2026-10-01T00:00:00Z", cerrada_at: null, ...extra,
  });

  it("cuenta operaciones, abiertas, totales por moneda y la última", () => {
    const [ana] = fichasDeClientes(
      [cuenta("a", "Ana", "ana@x.com")],
      [
        op({ cliente_id: "a", monto: 100, created_at: "2026-10-01T00:00:00Z" }),
        op({ cliente_email: "ANA@x.com", monto: 50, cerrada_at: "x", created_at: "2026-10-03T00:00:00Z" }),
        op({ cliente_id: "a", moneda: "ARS", monto: 9000, created_at: "2026-10-02T00:00:00Z" }),
        op({ cliente_id: "a", status: "cancelada", monto: 999, created_at: "2026-10-05T00:00:00Z" }),
      ]
    );
    expect(ana).toMatchObject({ operaciones: 3, abiertas: 2, ultimoPedido: "2026-10-05T00:00:00Z" });
    expect(ana.totales).toEqual([
      { moneda: "ARS", total: 9000 },
      { moneda: "USD", total: 150 },
    ]);
  });

  it("orden: pidió más reciente arriba; sin pedidos al final por nombre", () => {
    const fichas = fichasDeClientes(
      [cuenta("z", "Zoe", "z@x"), cuenta("b", "Beto", "b@x"), cuenta("a", "Ana", "a@x"), cuenta("c", "Carla", "c@x")],
      [op({ cliente_id: "c", created_at: "2026-10-01T00:00:00Z" }), op({ cliente_id: "z", created_at: "2026-10-04T00:00:00Z" })]
    );
    expect(fichas.map((f) => f.nombre)).toEqual(["Zoe", "Carla", "Ana", "Beto"]);
    expect(fichas[2]).toMatchObject({ operaciones: 0, abiertas: 0, totales: [], ultimoPedido: null });
  });
});

describe("Clientes por agencia", () => {
  const orgs = [
    { id: "o1", nombre: "Viajes del Sur", tipo: "agencia" as const, cuit: "30712345678", fusionada_en: null },
    { id: "o2", nombre: "Rafael Sainz", tipo: null, cuit: null, fusionada_en: null },
    { id: "o3", nombre: "Vieja", tipo: null, cuit: null, fusionada_en: "o1" },
  ];
  const miembros = [
    { user_id: "u1", organizacion_id: "o1", rol: "vendedor" as const, nombre: "Martín", email: "martin@vds.com" },
    { user_id: "u2", organizacion_id: "o1", rol: "admin" as const, nombre: "Laura", email: "laura@vds.com" },
    { user_id: "u3", organizacion_id: "o2", rol: "admin" as const, nombre: "Rafael Sainz", email: "rafa@x.com" },
    // Pasó al equipo: no es cliente aunque siga en la organización.
    { user_id: "staff", organizacion_id: "o2", rol: "vendedor" as const, nombre: "Staff", email: "s@tm.com" },
  ];
  const cuentas = [
    { id: "u1", nombre: "Martín Gómez", email: "martin@vds.com", solicitudId: "s1", revocada: true },
    { id: "u2", nombre: "Laura Pérez", email: "laura@vds.com", solicitudId: "s2", revocada: false },
    { id: "u3", nombre: "Rafael Sainz", email: "rafa@x.com", solicitudId: "s3", revocada: false },
    { id: "u4", nombre: "Suelto", email: "suelto@x.com", solicitudId: "s4", revocada: false },
  ];
  const op = (o: Partial<{ cliente_id: string; organizacion_id: string; monto: number; status: string; created_at: string; cerrada_at: string | null }>) => ({
    cliente_id: null,
    cliente_email: null,
    organizacion_id: null,
    monto: 100,
    moneda: "USD",
    status: "pendiente",
    created_at: "2026-11-01T10:00:00Z",
    cerrada_at: null,
    ...o,
  });
  const ops = [
    op({ cliente_id: "u1", organizacion_id: "o1", created_at: "2026-11-10T10:00:00Z" }),
    op({ cliente_id: "u2", organizacion_id: "o1", monto: 300, cerrada_at: "2026-11-05T10:00:00Z", created_at: "2026-11-02T10:00:00Z" }),
    op({ cliente_id: "u2", organizacion_id: "o1", status: "cancelada", created_at: "2026-11-12T10:00:00Z" }),
    op({ cliente_id: "u3", organizacion_id: "o2", created_at: "2026-10-01T10:00:00Z" }),
  ];

  const r = agenciasDeClientes({ orgs, miembros, cuentas, ops, equipo: new Set(["staff"]) });

  it("una fila por agencia viva, la del pedido más reciente arriba", () => {
    expect(r.agencias.map((a) => a.id)).toEqual(["o1", "o2"]);
  });

  it("los números de la agencia salen de sus pedidos (sin canceladas)", () => {
    const vds = r.agencias[0];
    expect(vds).toMatchObject({ operaciones: 2, abiertas: 1, ultimoPedido: "2026-11-12T10:00:00Z" });
    expect(vds.totales).toEqual([{ moneda: "USD", total: 400 }]);
  });

  it("la gente adentro: el admin primero, con rol, acceso y sus pedidos", () => {
    const [laura, martin] = r.agencias[0].personas;
    expect(laura).toMatchObject({ id: "u2", nombre: "Laura Pérez", rol: "admin", solicitudId: "s2", operaciones: 1 });
    expect(martin).toMatchObject({ id: "u1", rol: "vendedor", revocada: true, operaciones: 1, abiertas: 1 });
  });

  it("los del equipo no aparecen y los que no tienen organización van aparte", () => {
    expect(r.agencias[1].personas.map((p) => p.id)).toEqual(["u3"]);
    expect(r.sinAgencia.map((p) => p.id)).toEqual(["u4"]);
    expect(r.sinAgencia[0].rol).toBeNull();
  });

  it("un miembro sin solicitud aprobada igual se muestra, sin poder revocarlo", () => {
    const x = agenciasDeClientes({
      orgs,
      miembros: [{ user_id: "u9", organizacion_id: "o2", rol: "admin", nombre: null, email: "nueve@x.com" }],
      cuentas: [],
      ops: [],
    });
    expect(x.agencias.find((a) => a.id === "o2")?.personas[0]).toMatchObject({
      id: "u9",
      nombre: "nueve@x.com",
      solicitudId: null,
    });
  });

  it("búsqueda: por agencia, CUIT o persona", () => {
    const vds = r.agencias[0];
    expect(coincidenciaBusqueda(vds, "")).toEqual({ agencia: true, personas: new Set() });
    expect(coincidenciaBusqueda(vds, "viajes del")?.agencia).toBe(true);
    expect(coincidenciaBusqueda(vds, "30-71234")?.agencia).toBe(true);
    const porPersona = coincidenciaBusqueda(vds, "laura@");
    expect(porPersona?.agencia).toBe(false);
    expect(Array.from(porPersona?.personas ?? [])).toEqual(["u2"]);
    expect(coincidenciaBusqueda(vds, "nadie")).toBeNull();
    // Sin acentos también encuentra.
    expect(coincidenciaBusqueda({ ...vds, nombre: "Turismo Ñandú" }, "nandu")?.agencia).toBe(true);
  });
});
