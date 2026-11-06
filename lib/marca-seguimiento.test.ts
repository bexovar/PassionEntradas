import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MARCA_SEGUIMIENTO } from "./marca-seguimiento";
import { whatsappMessage } from "./operaciones";

// TKT-20: el link de seguimiento es la pantalla que el agente le reenvía a su
// pasajero. Frente al pasajero el vendedor es TicketMirror: ninguna marca
// ajena (AdminTickets, "Custodia") en la pantalla ni en el mensaje que la manda.
const AJENA = /admintickets|custodia/i;

describe("marca del link de seguimiento", () => {
  it("encabezado, franja y pie dicen TicketMirror", () => {
    expect(MARCA_SEGUIMIENTO.encabezado).toBe("TicketMirror");
    expect(MARCA_SEGUIMIENTO.franja).toBe("TICKETMIRROR·OPERACIÓN VERIFICADA·");
    expect(MARCA_SEGUIMIENTO.pie).toBe("TicketMirror · Seguimiento de operaciones");
  });

  it("el mensaje de WhatsApp que manda el link no nombra a la marca ajena", () => {
    const msg = whatsappMessage("River vs Boca", "https://x/op/1");
    expect(msg).not.toMatch(AJENA);
    expect(msg).toMatch(/TicketMirror/);
  });

  it("la página /op y su tarjeta no tienen la marca ajena escrita a mano", () => {
    // Rutas desde este archivo (no desde donde se corre vitest), y sin los
    // comentarios: "custodia" es vocabulario del dominio y puede aparecer en
    // un comentario; lo que importa es lo que se renderiza.
    for (const f of ["../app/op/[id]/page.tsx", "../components/StatusStub.tsx"]) {
      const fuente = readFileSync(fileURLToPath(new URL(f, import.meta.url)), "utf8");
      const sinComentarios = fuente
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
      expect(sinComentarios, f).not.toMatch(AJENA);
    }
  });

  const leer = (f: string) => readFileSync(fileURLToPath(new URL(f, import.meta.url)), "utf8");

  it("la tarjeta usa las tres constantes y la franja se repite seis veces", () => {
    const stub = leer("../components/StatusStub.tsx");
    expect(stub).toMatch(/MARCA_SEGUIMIENTO\.encabezado/);
    expect(stub).toMatch(/MARCA_SEGUIMIENTO\.franja\.repeat\(6\)/);
    const pagina = leer("../app/op/[id]/page.tsx");
    expect(pagina).toMatch(/MARCA_SEGUIMIENTO\.pie/);
  });

  it("el texto más largo de la franja no rompe el layout: una sola línea, recortada", () => {
    const css = leer("../app/globals.css");
    const regla = css.slice(css.indexOf(".microtext {"), css.indexOf("}", css.indexOf(".microtext {")));
    expect(regla).toMatch(/white-space:\s*nowrap/);
    expect(regla).toMatch(/overflow:\s*hidden/);
  });

  it("el título de la pestaña tampoco nombra a la marca ajena", () => {
    expect(leer("../app/layout.tsx")).not.toMatch(AJENA);
  });
});
