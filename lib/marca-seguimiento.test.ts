import { readFileSync } from "node:fs";
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
    for (const f of ["app/op/[id]/page.tsx", "components/StatusStub.tsx"]) {
      expect(readFileSync(f, "utf8"), f).not.toMatch(AJENA);
    }
  });
});
