import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// TKT-19, "el copy y el comportamiento del botón coinciden": el corte vive en
// tres lugares (la pantalla, la API y el trigger de la base) y los tres tienen
// que cortar en el mismo punto. El corte es el pago procesado (o la entrega),
// NO la entrada recibida, que es cuando se le pide pagar.
// Los tests corren sin base ni DOM: se verifica el código de cada capa.

const fuente = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/^\s*--.*$/gm, "");

describe("TKT-19: el mismo corte en las tres capas", () => {
  it("API: el UPDATE ya no exige que la entrada no esté recibida", () => {
    const api = fuente("../app/api/mis-pedidos/[id]/cancelar/route.ts");
    const update = api.slice(api.indexOf(".update({ status: \"cancelada\""), api.indexOf(".select(\"id\")", api.indexOf(".update({ status: \"cancelada\"")));
    expect(update).toMatch(/\.is\("pago_confirmado_at", null\)/);
    expect(update).toMatch(/\.is\("cerrada_at", null\)/);
    expect(update).not.toMatch(/entrada_recibida_at/);
    // Y antes del UPDATE, la misma regla que usa la pantalla.
    expect(api).toMatch(/if \(!clientePuedeCancelar\(op/);
  });

  it("base (0054): el trigger corta por pago o cierre, no por entrada recibida", () => {
    const sql = fuente("../supabase/migrations/0054_cancelar_hasta_pago_procesado.sql");
    const i = sql.indexOf("new.cancelada_por = 'cliente'");
    expect(i).toBeGreaterThan(-1);
    const regla = sql.slice(i, sql.indexOf("end if;", i));
    expect(regla).toMatch(/new\.pago_confirmado_at is not null/);
    expect(regla).toMatch(/new\.cerrada_at is not null/);
    expect(regla).not.toMatch(/entrada_recibida_at/);
  });

  it("pantalla: cada pedido pasa por las dos reglas y muestra una u otra vía", () => {
    const page = fuente("../app/(tienda)/mis-pedidos/page.tsx");
    expect(page).toMatch(/puedeCancelar: clientePuedeCancelar\(/);
    expect(page).toMatch(/puedePedirCancelacion: clientePuedePedirCancelacion\(/);

    const ui = fuente("../components/tienda/MisPedidos.tsx");
    expect(ui).toMatch(/\{p\.puedePedirCancelacion && \(/);
    // "Pedir cancelación" abre WhatsApp con el número del pedido.
    expect(ui).toMatch(/href=\{waLink\(mp\.waPedirCancelacion\(p\.code\)\)\}/);
    expect(ui).toMatch(/\{mp\.pedirCancelacion\}/);
  });
});
