import { describe, expect, it } from "vitest";
import { eventosCarrusel, fotoCarruselValida, type FotoCarrusel } from "./carrusel";
import { buildEvents, type Ticket } from "./tickets";

// La home es pública: estos tests fijan qué evento entra al carrusel, con qué
// foto, y que ningún precio se escape en lo que viaja al navegador.

const HOY = "2026-10-29";

function ticket(evento: string, competicion: string, fecha: string | null, extra: Partial<Ticket> = {}): Ticket {
  return {
    id: `${competicion}::${evento}`,
    evento,
    competicion,
    fecha,
    ciudad: "Estadio, Ciudad (ARG)",
    categoria: "Cat 1",
    precio_final: 500,
    stock: 3,
    estado: "book",
    source: "portal",
    ...extra,
  } as Ticket;
}

let n = 0;
function foto(competicion: string, evento: string | null, orden = 0): FotoCarrusel {
  n += 1;
  return { id: `f${n}`, competicion, evento, imagen_url: `/carrusel-demo/${n}.svg`, orden };
}

const WC = "FIFA World Cup 2026";

describe("eventosCarrusel", () => {
  it("usa la foto propia del evento antes que las de su competición", () => {
    const evs = buildEvents([ticket("Final", WC, "2026-12-01")]);
    const comp = foto(WC, null);
    const propia = foto(WC, "Final");
    const [t] = eventosCarrusel(evs, [comp, propia], 12, HOY);
    expect(t.imagen).toBe(propia.imagen_url);
  });

  it("de varias fotos propias muestra la primera según orden", () => {
    const evs = buildEvents([ticket("Final", WC, "2026-12-01")]);
    const segunda = foto(WC, "Final", 2);
    const primera = foto(WC, "Final", 1);
    expect(eventosCarrusel(evs, [segunda, primera], 12, HOY)[0].imagen).toBe(primera.imagen_url);
  });

  it("deja afuera los eventos sin ninguna foto", () => {
    const evs = buildEvents([
      ticket("Con foto", WC, "2026-11-10"),
      ticket("Sin foto", "Copa Libertadores", "2026-11-11"),
    ]);
    const res = eventosCarrusel(evs, [foto(WC, null)], 12, HOY);
    expect(res.map((t) => t.evento)).toEqual(["Con foto"]);
  });

  it("reparte las fotos de la competición en orden de fecha: 1, 2, 3, 1, 2", () => {
    const fechas = ["2026-11-05", "2026-11-01", "2026-11-04", "2026-11-02", "2026-11-03"];
    const evs = buildEvents(fechas.map((f) => ticket(`Partido ${f}`, WC, f)));
    const fotos = [foto(WC, null, 0), foto(WC, null, 1), foto(WC, null, 2)];
    const urls = fotos.map((f) => f.imagen_url);
    const res = eventosCarrusel(evs, fotos, 12, HOY);
    expect(res.map((t) => t.imagen)).toEqual([urls[0], urls[1], urls[2], urls[0], urls[1]]);
    // Determinístico: misma entrada, mismo resultado.
    expect(eventosCarrusel([...evs].reverse(), [...fotos].reverse(), 12, HOY)).toEqual(res);
  });

  it("un evento ya pasado no aparece aunque tenga foto", () => {
    const evs = buildEvents([ticket("Ayer", WC, "2026-10-28"), ticket("Hoy", WC, "2026-10-29")]);
    const res = eventosCarrusel(evs, [foto(WC, null)], 12, HOY);
    expect(res.map((t) => t.evento)).toEqual(["Hoy"]);
  });

  it("ordena por fecha, los sin fecha al final, y corta en max", () => {
    const evs = buildEvents([
      ticket("Sin fecha", WC, null),
      ticket("Tercero", WC, "2026-11-20"),
      ticket("Primero", WC, "2026-11-01"),
      ticket("Segundo", WC, "2026-11-10"),
    ]);
    const fotos = [foto(WC, null)];
    expect(eventosCarrusel(evs, fotos, 12, HOY).map((t) => t.evento)).toEqual([
      "Primero",
      "Segundo",
      "Tercero",
      "Sin fecha",
    ]);
    expect(eventosCarrusel(evs, fotos, 2, HOY).map((t) => t.evento)).toEqual(["Primero", "Segundo"]);
  });

  it("ninguna tarjeta lleva precio ni stock", () => {
    const evs = buildEvents([ticket("Final", WC, "2026-12-01", { precio_final: 987654, stock: 7 })]);
    const res = eventosCarrusel(evs, [foto(WC, null)], 12, HOY);
    expect(Object.keys(res[0]).sort()).toEqual(["ciudad", "clave", "competicion", "evento", "fecha", "imagen"]);
    expect(JSON.stringify(res)).not.toMatch(/987654|precio|price|stock/i);
  });
});

describe("fotoCarruselValida", () => {
  const BUCKET = "https://abc123.supabase.co/storage/v1/object/public/carrusel/wc/1.webp";

  it("acepta solo nuestro bucket `carrusel`", () => {
    expect(fotoCarruselValida(BUCKET)).toBe(BUCKET);
    expect(fotoCarruselValida("https://abc123.supabase.co/storage/v1/object/public/mapas/x.png")).toBeNull();
    expect(fotoCarruselValida("https://otro-sitio.com/foto.jpg")).toBeNull();
    expect(fotoCarruselValida("javascript:alert(1)")).toBeNull();
    expect(fotoCarruselValida(null)).toBeNull();
  });

  it("las fotos de muestra valen solo en el demo", () => {
    expect(fotoCarruselValida("/carrusel-demo/mundial-1.svg", true)).toBe("/carrusel-demo/mundial-1.svg");
    expect(fotoCarruselValida("/carrusel-demo/mundial-1.svg")).toBeNull();
    expect(fotoCarruselValida("/carrusel-demo/../secreto", true)).toBeNull();
    expect(fotoCarruselValida("data:image/webp;base64,AAAA", true)).toBe("data:image/webp;base64,AAAA");
    expect(fotoCarruselValida("data:image/webp;base64,AAAA")).toBeNull();
  });
});
