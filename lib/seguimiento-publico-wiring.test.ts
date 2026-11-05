import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { mockCreateOp, mockOpPublica } from "./mock-db";

// TKT-24, criterios de aceptación sobre lo que de verdad llega al link: la
// página, los RPC de la base y el modo demo. Las funciones puras están en
// seguimiento-publico.test.ts; esto verifica que la página y la base las usan.

const leer = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/^\s*--.*$/gm, "");

const pagina = leer("../app/op/[id]/page.tsx");
const migracion = leer("../supabase/migrations/0053_seguimiento_publico_sin_montos.sql");

describe("TKT-24: la página /op/<uuid>", () => {
  it("arranca siempre por la vista pública (recortada)", () => {
    expect(pagina).toMatch(/let vista[^=]*=\s*recortarParaPublico\(op, items\)/);
  });

  it("solo pasa a la vista completa si vistaSeguimiento dice 'completa'", () => {
    expect(pagina).toMatch(/vistaSeguimiento\([\s\S]{0,120}?\)\s*===\s*"completa"/);
    // Los importes se leen con service role, nunca del RPC público.
    expect(pagina).toMatch(/\.from\("operaciones"\)[\s\S]{0,80}monto/);
  });

  it("a la tarjeta le llega la vista, no la fila cruda del RPC", () => {
    expect(pagina).toMatch(/<StatusStub op=\{vista\.op\} items=\{vista\.items\}/);
    expect(pagina).not.toMatch(/<StatusStub op=\{op\}/);
  });

  it("el link sigue abriendo sin login: la página no exige sesión", () => {
    expect(pagina).not.toMatch(/redirect\(/);
    expect(pagina).not.toMatch(/requireUser|requireAuth|getUserOrRedirect/);
  });
});

describe("TKT-24: los RPC públicos (migración 0053)", () => {
  const fn = (nombre: string) => {
    const i = migracion.indexOf(`create function public.${nombre}(`);
    expect(i, nombre).toBeGreaterThan(-1);
    return migracion.slice(i, migracion.indexOf("$$;", i));
  };

  it("operacion_publica no devuelve el monto", () => {
    const f = fn("operacion_publica");
    const columnas = f.slice(f.indexOf("returns table"), f.indexOf(")\nlanguage"));
    expect(columnas).not.toMatch(/\bmonto\b|\bfee\b/);
    expect(f).not.toMatch(/o\.monto|o\.fee/);
  });

  it("operacion_publica devuelve solo el nombre de pila, y nada si es un email", () => {
    const f = fn("operacion_publica");
    expect(f).toMatch(/position\('@' in o\.comprador_alias\) > 0 then null/);
    expect(f).toMatch(/regexp_split_to_array\(btrim\(o\.comprador_alias\), '\\s\+'\)\)\[1\]/);
  });

  it("operacion_items_publicos no devuelve el precio de las líneas", () => {
    expect(fn("operacion_items_publicos")).not.toMatch(/precio/);
  });

  it("los dos RPC siguen abiertos para el link anónimo", () => {
    expect(migracion).toMatch(/grant execute on function public\.operacion_publica\(uuid\) to anon/);
    expect(migracion).toMatch(/grant execute on function public\.operacion_items_publicos\(uuid\) to anon/);
  });
});

describe("TKT-24: el modo demo se comporta igual que la base", () => {
  it("la operación pública del mock no trae monto y el comprador va por su nombre de pila", () => {
    const op = mockCreateOp({
      evento: "River vs Boca",
      comprador_alias: "María Emilia Gallo",
      vendedor_alias: null,
      monto: 897,
      fee: 0,
      ticket_id: null,
      fecha_evento: "2026-11-20",
      notas: null,
      cuenta_debitar: null,
      moneda: "USD",
    });
    const pub = mockOpPublica(op.id)!;
    expect(pub).not.toHaveProperty("monto");
    expect(pub.comprador_alias).toBe("María");
    expect(JSON.stringify(pub)).not.toMatch(/897/);
  });
});
