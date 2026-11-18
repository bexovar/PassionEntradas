import { describe, expect, it } from "vitest";
import { claveCuit, coincidenciasPorCuit, planAlAprobar, validarCambioRol, validarFusion, veElPedido } from "@/lib/organizaciones";
import {
  mockCreateOp,
  mockCrearSolicitud,
  mockDecidirSolicitud,
  mockListSolicitudes,
  mockFusionarOrganizaciones,
  mockListMiembros,
  mockListOps,
  mockListOrganizaciones,
  mockListPedidosCliente,
  mockMiembroDe,
  mockRevocarSolicitud,
} from "@/lib/mock-db";

const DIEGO = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const VIAJES_DEL_SUR = "0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a";
const LUCIA_SOL = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const sol = { nombre: "Ana Pérez", email: "ana@x.com", legajo: "30-71234567-8", organizacion: "Turismo Ana", tipo_organizacion: "agencia" as const };

describe("TKT-10: la organización se arma al aprobar", () => {
  it("sin otra con su CUIT: organización nueva y queda como admin", () => {
    const r = planAlAprobar(sol, [], null);
    expect(r).toEqual({
      ok: true,
      plan: { tipo: "nueva", rol: "admin", datos: { nombre: "Turismo Ana", tipo: "agencia", cuit: "30712345678" } },
    });
  });

  it("con otra con su CUIT, quien aprueba tiene que elegir: nunca se asocia solo", () => {
    expect(planAlAprobar(sol, [{ id: "o1" }], null).ok).toBe(false);
    expect(planAlAprobar(sol, [{ id: "o1" }], { unirse: "o1" })).toEqual({
      ok: true,
      plan: { tipo: "unirse", organizacionId: "o1", rol: "vendedor" },
    });
    expect(planAlAprobar(sol, [{ id: "o1" }], { nueva: true })).toMatchObject({ ok: true, plan: { tipo: "nueva" } });
    // Una organización que no coincide con su CUIT no se puede elegir.
    expect(planAlAprobar(sol, [{ id: "o1" }], { unirse: "otra" }).ok).toBe(false);
  });

  it("el freelance sin nombre de organización usa el suyo", () => {
    const r = planAlAprobar({ ...sol, organizacion: null, tipo_organizacion: null }, [], null);
    expect(r).toMatchObject({ ok: true, plan: { datos: { nombre: "Ana Pérez" } } });
  });

  it("el CUIT se compara por sus dígitos y nunca contra una fusionada", () => {
    expect(claveCuit("30-71234567-8")).toBe("30712345678");
    expect(claveCuit("123")).toBeNull();
    const orgs = [
      { id: "a", cuit: "30712345678", fusionada_en: null },
      { id: "b", cuit: "30712345678", fusionada_en: "a" },
    ];
    expect(coincidenciasPorCuit("30.71234567.8", orgs).map((o) => o.id)).toEqual(["a"]);
  });
});

describe("TKT-10: quién ve qué pedido", () => {
  const admin = { userId: "u1", miembro: { organizacion_id: "org", rol: "admin" as const } };
  const vendedor = { userId: "u2", miembro: { organizacion_id: "org", rol: "vendedor" as const } };

  it("el admin ve los de todos sus vendedores; el vendedor, los suyos", () => {
    const deU2 = { cliente_id: "u2", organizacion_id: "org" };
    const deU1 = { cliente_id: "u1", organizacion_id: "org" };
    expect(veElPedido(admin, deU2)).toBe(true);
    expect(veElPedido(vendedor, deU2)).toBe(true);
    expect(veElPedido(vendedor, deU1)).toBe(false);
  });

  it("nadie ve los de otra organización", () => {
    expect(veElPedido(admin, { cliente_id: "x", organizacion_id: "otra" })).toBe(false);
    expect(veElPedido(admin, { cliente_id: "x", organizacion_id: null })).toBe(false);
  });

  it("no se fusiona una organización consigo misma ni una ya fusionada", () => {
    expect(validarFusion({ id: "a", fusionada_en: null }, { id: "a", fusionada_en: null })).toMatch(/distintas/);
    expect(validarFusion({ id: "a", fusionada_en: "c" }, { id: "b", fusionada_en: null })).toMatch(/fusionada/);
    expect(validarFusion({ id: "a", fusionada_en: null }, { id: "b", fusionada_en: null })).toBeNull();
  });
});

describe("TKT-10: una organización nunca se queda sin administrador", () => {
  const ms = [
    { user_id: "a", organizacion_id: "o1", rol: "admin" as const },
    { user_id: "b", organizacion_id: "o1", rol: "vendedor" as const },
    { user_id: "c", organizacion_id: "o2", rol: "admin" as const },
  ];
  it("el único admin no pasa a vendedor (aunque otra organización tenga admin)", () => {
    expect(validarCambioRol(ms, "a", "vendedor")?.status).toBe(409);
  });
  it("con otro admin en la organización, sí", () => {
    expect(validarCambioRol([...ms, { user_id: "d", organizacion_id: "o1", rol: "admin" }], "a", "vendedor")).toBeNull();
  });
  it("subir a admin siempre se puede; sin organización, 404", () => {
    expect(validarCambioRol(ms, "b", "admin")).toBeNull();
    expect(validarCambioRol(ms, "zz", "admin")?.status).toBe(404);
  });
});

describe("TKT-10: de punta a punta en la base demo", () => {
  it("dos usuarios activos en la misma organización, el admin ve lo del vendedor, la baja de uno no toca al otro y la fusión no pierde operaciones", () => {
    // Lucía pide con el CUIT de Viajes del Sur: hay que elegir.
    expect(mockDecidirSolicitud(LUCIA_SOL, "aprobar", "admin")).toMatchObject({ ok: false, status: 409 });
    const r = mockDecidirSolicitud(LUCIA_SOL, "aprobar", "admin", { unirse: VIAJES_DEL_SUR });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const lucia = r.solicitud.user_id!;
    expect(r.organizacion).toMatchObject({ id: VIAJES_DEL_SUR, rol: "vendedor" });

    // Una organización con más de un usuario activo.
    expect(mockListMiembros().filter((m) => m.organizacion_id === VIAJES_DEL_SUR)).toHaveLength(2);

    // La operación de Lucía queda en la organización y la ve Diego (admin).
    const op = mockCreateOp({
      evento: "Final Copa",
      comprador_alias: null,
      vendedor_alias: null,
      monto: 500,
      fee: 50,
      ticket_id: null,
      fecha_evento: null,
      notas: null,
      cuenta_debitar: null,
      tipo: "pedido",
      cliente_id: lucia,
    });
    expect(op.organizacion_id).toBe(VIAJES_DEL_SUR);
    expect(mockListPedidosCliente(DIEGO, null, VIAJES_DEL_SUR).map((o) => o.id)).toContain(op.id);
    // Lucía, vendedora, no ve los de Diego.
    const deDiego = mockListOps().filter((o) => o.cliente_id === DIEGO).map((o) => o.id);
    expect(mockListPedidosCliente(lucia, null).some((o) => deDiego.includes(o.id))).toBe(false);

    // Dar de baja a Lucía no cambia nada de Diego.
    expect(mockRevocarSolicitud(LUCIA_SOL, "revocar", "admin").ok).toBe(true);
    expect(mockMiembroDe(DIEGO)).toMatchObject({ organizacion_id: VIAJES_DEL_SUR, rol: "admin" });

    // Una duplicada ("Viajes del Sur SRL") con su usuario: se fusiona sin perder nada.
    const dup = mockDecidirSolicitud(
      mockNuevaSolicitudDemo(),
      "aprobar",
      "admin",
      { nueva: true }
    );
    expect(dup.ok).toBe(true);
    if (!dup.ok) return;
    const dupOrg = dup.organizacion!.id;
    mockCreateOp({
      evento: "Recital",
      comprador_alias: null,
      vendedor_alias: null,
      monto: 100,
      fee: 10,
      ticket_id: null,
      fecha_evento: null,
      notas: null,
      cuenta_debitar: null,
      tipo: "pedido",
      cliente_id: dup.solicitud.user_id!,
    });
    const antes = mockListOps().filter((o) => o.organizacion_id === VIAJES_DEL_SUR || o.organizacion_id === dupOrg).length;
    const f = mockFusionarOrganizaciones(dupOrg, VIAJES_DEL_SUR);
    expect(f).toEqual({ ok: true, movidas: 1 });
    expect(mockListOps().filter((o) => o.organizacion_id === VIAJES_DEL_SUR)).toHaveLength(antes);
    expect(mockListOps().some((o) => o.organizacion_id === dupOrg)).toBe(false);
    expect(mockMiembroDe(dup.solicitud.user_id!)?.organizacion_id).toBe(VIAJES_DEL_SUR);
    expect(mockListOrganizaciones().find((o) => o.id === dupOrg)?.fusionada_en).toBe(VIAJES_DEL_SUR);
  });
});

// Solicitud pendiente nueva en la base demo, con el mismo CUIT que Viajes del Sur.
function mockNuevaSolicitudDemo(): string {
  const email = `pablo.${Date.now()}@example.com`;
  const r = mockCrearSolicitud({
    nombre: "Pablo Gómez",
    email,
    telefono: "+54 9 11 4444 4444",
    legajo: "27-35123456-9",
    mensaje: null,
    acepto: true,
    tipoOrganizacion: "agencia",
    organizacion: "Viajes del Sur SRL",
    cuit: "27-35123456-9",
  } as any);
  expect(r.ok).toBe(true);
  return mockListSolicitudes().find((s) => s.email === email)!.id;
}
