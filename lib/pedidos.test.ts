import { describe, expect, it } from "vitest";
import {
  entradasMovidasPorStock,
  partirPorStock,
  evaluarLimite,
  precioVenta,
  reconciliarItem,
  resumenOperacion,
  separarPorTipo,
  RL_MAX_VENTANA,
  RL_MIN_INTERVALO_MS,
  type ItemPedido,
  type TicketRef,
  tipoDelEnvio,
  detalleDeLineas,
  TIPO_ENVIO_LABEL,
} from "./pedidos";

// El cliente manda el body del pedido, así que TODO lo que llega es hostil
// hasta que se reconcilia contra `tickets`. Estos tests fijan qué gana: la
// base, no el carrito.

// Entradas reales del catálogo demo (lib/mock-tickets.ts).
const PORTAL: TicketRef = {
  evento: "Match 12, Group A - Argentina vs Chile",
  categoria: "Category 1",
  precio_final: 720, // EUR: el portal guarda en euros
  stock: 4,
  fecha: "2026-10-08T12:00:00.000Z",
  source: "portal",
};
const PROPIA: TicketRef = {
  evento: "River vs Boca - Superclásico",
  categoria: "Platea Alta",
  precio_final: 150, // USD: las entradas propias ya vienen en dólares
  stock: 2,
  fecha: "2026-10-03T00:00:00.000Z",
  source: "manual",
};

const TASA = 1.08; // cotización EUR->USD del panel

function item(over: Partial<ItemPedido> = {}): ItemPedido {
  return {
    tipo: "pedido",
    evento: "Match 12, Group A - Argentina vs Chile",
    sector: "Category 1",
    ticket_id: "1001::1",
    monto: 778,
    cantidad: 1,
    fecha_evento: "2026-10-08",
    ...over,
  };
}

describe("precioVenta (portal y propias en USD)", () => {
  it("convierte el precio del portal con la cotización", () => {
    expect(precioVenta(PORTAL, TASA)).toBeCloseTo(777.6, 5);
  });

  it("deja las entradas propias en dólares como están", () => {
    expect(precioVenta(PROPIA, TASA)).toBe(150);
  });

  // La regresión que casi se escapa: usar precio_final crudo guardaba el
  // pedido ~8% por debajo del precio que el cliente vio en la tienda.
  it("el portal pasado a dólares vale más que el número crudo (euros)", () => {
    expect(precioVenta(PORTAL, TASA)!).toBeGreaterThan(PORTAL.precio_final!);
  });

  it("cae a la cotización por defecto si la configurada es inválida", () => {
    expect(precioVenta(PORTAL, 0)).toBeCloseTo(720 * 1.08, 5);
    expect(precioVenta(PORTAL, -5)).toBeCloseTo(720 * 1.08, 5);
  });

  it("sin precio o con basura devuelve null (nunca NaN)", () => {
    expect(precioVenta({ ...PORTAL, precio_final: null }, TASA)).toBeNull();
    expect(precioVenta({ ...PORTAL, precio_final: NaN }, TASA)).toBeNull();
    expect(precioVenta({ ...PORTAL, precio_final: 0 }, TASA)).toBeNull();
  });
});

describe("reconciliarItem — el precio sale de la base", () => {
  // Coincide con lo que muestra la tienda: fmtPrice redondea 777.6 a "US$ 778".
  it("ignora el monto del cliente y usa el del catálogo, redondeado", () => {
    const r = reconciliarItem(item({ monto: 1 }), PORTAL, TASA);
    expect(r.monto).toBe(778);
  });

  it("guarda el total de la línea (unitario × cantidad)", () => {
    const r = reconciliarItem(item({ cantidad: 3, monto: 1 }), PORTAL, TASA);
    expect(r.monto).toBe(778 * 3);
  });

  it("no convierte dos veces las entradas propias", () => {
    const r = reconciliarItem(
      item({ ticket_id: "manual::demo-1", cantidad: 2, monto: 1 }),
      PROPIA,
      TASA
    );
    expect(r.monto).toBe(300);
  });

  it("un precio regalado no sobrevive", () => {
    const r = reconciliarItem(item({ monto: 0 }), PORTAL, TASA);
    expect(r.monto).toBeGreaterThan(0);
  });
});

describe("reconciliarItem — el resto de los datos también", () => {
  it("pisa evento, sector y fecha falseados por el cliente", () => {
    const r = reconciliarItem(
      item({ evento: "HACKED", sector: "HACKED", fecha_evento: "1999-01-01" }),
      PORTAL,
      TASA
    );
    expect(r.evento).toBe(PORTAL.evento);
    expect(r.sector).toBe("Category 1");
    expect(r.fecha_evento).toBe("2026-10-08");
  });

  it("topea la cantidad por el stock real", () => {
    const r = reconciliarItem(item({ cantidad: 999 }), PORTAL, TASA);
    expect(r.cantidad).toBe(4);
    expect(r.monto).toBe(778 * 4);
  });

  it("no infla una cantidad menor al stock", () => {
    expect(reconciliarItem(item({ cantidad: 2 }), PORTAL, TASA).cantidad).toBe(2);
  });

  it("sin stock confiable respeta lo pedido (el panel lo revisa a mano)", () => {
    const r = reconciliarItem(item({ cantidad: 5 }), { ...PORTAL, stock: null }, TASA);
    expect(r.cantidad).toBe(5);
  });

  it("no muta el item original", () => {
    const original = item({ evento: "HACKED", monto: 1 });
    const copia = { ...original };
    reconciliarItem(original, PORTAL, TASA);
    expect(original).toEqual(copia);
  });
});

describe("reconciliarItem — sin entrada en el catálogo", () => {
  // El catálogo rota en cada sync, y un carrito manipulado puede no traer
  // ticket: sin fila no hay precio confiable. No se pierde: queda como
  // consulta en 0 y el staff la cotiza.
  it("un pedido sin fila en la base pasa a consulta en 0, nunca con el precio del cliente", () => {
    const p = item({ evento: "Algo viejo", monto: 500 });
    const r = reconciliarItem(p, undefined, TASA);
    expect(r.tipo).toBe("consulta");
    expect(r.monto).toBe(0);
    expect(r.comision).toBe(0);
    expect(r.evento).toBe("Algo viejo");
  });

  it("un pedido de una final por USD 1 sin ticket no se registra como pedido", () => {
    const r = reconciliarItem(item({ evento: "Final", monto: 1, ticket_id: null }), undefined, TASA);
    expect(r).toMatchObject({ tipo: "consulta", monto: 0 });
  });
});

describe("reconciliarItem — casos que NO se tocan", () => {

  // Una consulta es "a confirmar", no una compra: el monto queda en 0 igual
  // que antes de estos cambios.
  it("la consulta queda en monto 0 aunque el ticket tenga precio", () => {
    const r = reconciliarItem(item({ tipo: "consulta", monto: 9999 }), PORTAL, TASA);
    expect(r.monto).toBe(0);
  });

  it("la consulta tampoco se topea por stock", () => {
    const r = reconciliarItem(
      item({ tipo: "consulta", cantidad: 9 }),
      { ...PORTAL, stock: 1 },
      TASA
    );
    expect(r.cantidad).toBe(9);
  });

  it("un ticket sin categoría no borra el sector que mandó el cliente", () => {
    const r = reconciliarItem(item({ sector: "Lo que eligió" }), { ...PORTAL, categoria: null }, TASA);
    expect(r.sector).toBe("Lo que eligió");
  });

  it("una fecha inválida en la base no pisa la del item", () => {
    const r = reconciliarItem(item(), { ...PORTAL, fecha: "no-es-fecha" }, TASA);
    expect(r.fecha_evento).toBe("2026-10-08");
  });

  // Entrada on_request (precio a confirmar): se registra sin monto.
  it("un ticket sin precio deja el pedido en 0", () => {
    const r = reconciliarItem(item({ monto: 400 }), { ...PORTAL, precio_final: null }, TASA);
    expect(r.monto).toBe(0);
  });
});

describe("evaluarLimite", () => {
  const AHORA = Date.parse("2026-09-18T12:00:00.000Z");
  const haceMs = (ms: number) => new Date(AHORA - ms).toISOString();

  it("deja pasar al cliente sin pedidos previos", () => {
    expect(evaluarLimite([], AHORA)).toBeNull();
  });

  it("corta el doble click", () => {
    expect(evaluarLimite([haceMs(1_000)], AHORA)).toMatch(/unos segundos/);
  });

  it("deja pasar pasado el intervalo mínimo", () => {
    expect(evaluarLimite([haceMs(RL_MIN_INTERVALO_MS + 1)], AHORA)).toBeNull();
  });

  // Un carrito real son hasta 50 líneas = 50 filas: no puede rozar el tope.
  it("un carrito grande legítimo no se bloquea", () => {
    const filas = Array.from({ length: 50 }, (_, i) => haceMs(60_000 + i));
    expect(evaluarLimite(filas, AHORA)).toBeNull();
  });

  it("corta al superar el tope de la ventana", () => {
    const filas = Array.from({ length: RL_MAX_VENTANA + 1 }, (_, i) => haceMs(60_000 + i));
    expect(evaluarLimite(filas, AHORA)).toMatch(/muchos pedidos/);
  });

  it("justo en el tope todavía pasa", () => {
    const filas = Array.from({ length: RL_MAX_VENTANA }, (_, i) => haceMs(60_000 + i));
    expect(evaluarLimite(filas, AHORA)).toBeNull();
  });

  // Fail-open: perder un pedido legítimo es peor que dejar pasar uno de más.
  it("una fecha ilegible no bloquea", () => {
    expect(evaluarLimite(["no-es-fecha"], AHORA)).toBeNull();
  });
});

// Un envío del carrito arma UNA operación. Estos tests fijan cómo se resume
// un pedido de varias entradas en una sola cabecera.
describe("resumenOperacion", () => {
  const linea = (over: Partial<ItemPedido> = {}): ItemPedido => ({
    tipo: "pedido",
    evento: "Arsenal vs Lille",
    sector: "B",
    ticket_id: "t1",
    monto: 518,
    cantidad: 1,
    fecha_evento: "2026-11-05",
    ...over,
  });

  it("con una sola línea el encabezado es esa línea", () => {
    const r = resumenOperacion([linea()]);
    expect(r.evento).toBe("Arsenal vs Lille");
    expect(r.sector).toBe("B");
    expect(r.ticket_id).toBe("t1");
    expect(r.cantidad).toBe(1);
    expect(r.monto).toBe(518);
  });

  it("con varias líneas avisa cuántas más hay", () => {
    const r = resumenOperacion([linea(), linea({ evento: "Real Madrid vs City" })]);
    expect(r.evento).toBe("Arsenal vs Lille +1 más");
  });

  // Sector y ticket pertenecen a la línea: ponerlos en la cabecera con varias
  // líneas haría que la operación parezca de un solo sector.
  it("no atribuye sector ni ticket a una operación de varias líneas", () => {
    const r = resumenOperacion([linea(), linea({ sector: "C", ticket_id: "t2" })]);
    expect(r.sector).toBeNull();
    expect(r.ticket_id).toBeNull();
  });

  it("suma las entradas, no cuenta las líneas", () => {
    const r = resumenOperacion([linea({ cantidad: 2 }), linea({ cantidad: 3 })]);
    expect(r.cantidad).toBe(5);
  });

  it("suma los montos de las líneas", () => {
    const r = resumenOperacion([linea({ monto: 518 }), linea({ monto: 1556 })]);
    expect(r.monto).toBe(2074);
  });

  // La fecha de la operación marca su urgencia: manda la más próxima.
  it("toma la fecha más próxima de todas las líneas", () => {
    const r = resumenOperacion([
      linea({ fecha_evento: "2027-01-10" }),
      linea({ fecha_evento: "2026-11-05" }),
    ]);
    expect(r.fecha_evento).toBe("2026-11-05");
  });

  it("ignora las líneas sin fecha al elegir la más próxima", () => {
    const r = resumenOperacion([
      linea({ fecha_evento: null }),
      linea({ fecha_evento: "2026-12-01" }),
    ]);
    expect(r.fecha_evento).toBe("2026-12-01");
  });

  it("queda sin fecha si ninguna línea la tiene", () => {
    expect(resumenOperacion([linea({ fecha_evento: null })]).fecha_evento).toBeNull();
  });
});

describe("separarPorTipo", () => {
  const p = (tipo: "pedido" | "consulta"): ItemPedido => ({
    tipo,
    evento: "X",
    sector: null,
    ticket_id: null,
    monto: tipo === "pedido" ? 100 : 0,
    cantidad: 1,
    fecha_evento: null,
  });

  // Carrito mixto: lo que tiene precio arma la operación, lo demás va a
  // consultas. Es el caso que define el modelo.
  it("parte un carrito mixto en pedidos y consultas", () => {
    const { pedidos, consultas } = separarPorTipo([p("pedido"), p("consulta"), p("pedido")]);
    expect(pedidos).toHaveLength(2);
    expect(consultas).toHaveLength(1);
  });

  it("un carrito solo de consultas no deja nada para la operación", () => {
    const { pedidos, consultas } = separarPorTipo([p("consulta"), p("consulta")]);
    expect(pedidos).toHaveLength(0);
    expect(consultas).toHaveLength(2);
  });
});

// La comisión es la razón por la que el negocio existe y NO se estaba
// guardando: `fee` iba en 0 para todo lo que entraba por la tienda, así que el
// tablero decía "comisión ganada: US$ 0" aunque cada entrada tuviera su markup
// adentro del precio.
describe("comisión de la línea (precio − costo)", () => {
  const base = {
    tipo: "pedido" as const,
    evento: "X",
    sector: null,
    ticket_id: "t1",
    monto: 0,
    cantidad: 1,
    fecha_evento: null,
  };

  it("portal: precio y costo se convierten con la misma tasa", () => {
    // Passion cobra 100 EUR, se vende a 120 EUR, tasa 1,10 -> 132 y 110 USD.
    const r = reconciliarItem(
      { ...base },
      {
        evento: "X",
        categoria: null,
        precio_final: 120,
        precio_origen: 100,
        stock: 5,
        fecha: null,
        source: "portal",
      },
      1.1
    );
    expect(r.monto).toBe(132);
    expect(r.comision).toBe(22);
  });

  it("propia: costo y precio ya están en la misma moneda", () => {
    const r = reconciliarItem(
      { ...base },
      {
        evento: "X",
        categoria: null,
        precio_final: 155,
        precio_costo: 120,
        stock: 5,
        fecha: null,
        source: "manual",
      },
      1.1
    );
    expect(r.monto).toBe(155);
    expect(r.comision).toBe(35);
  });

  it("monto = costo + comisión, también con cantidad", () => {
    const r = reconciliarItem(
      { ...base, cantidad: 3 },
      {
        evento: "X",
        categoria: null,
        precio_final: 155,
        precio_costo: 120,
        stock: 10,
        fecha: null,
        source: "manual",
      },
      1.1
    );
    expect(r.monto).toBe(465);
    expect(r.comision).toBe(105);
    expect(r.monto - r.comision!).toBe(360); // el costo, 120 × 3
  });

  it("sin costo cargado no se inventa comisión", () => {
    // Las filas viejas del portal no tienen precio_origen: preferimos un 0
    // honesto antes que una ganancia imaginaria en el tablero.
    const r = reconciliarItem(
      { ...base },
      { evento: "X", categoria: null, precio_final: 120, stock: 5, fecha: null, source: "portal" },
      1.1
    );
    expect(r.monto).toBe(132);
    expect(r.comision).toBe(0);
  });

  it("si el costo fuera mayor al precio, la comisión no es negativa", () => {
    const r = reconciliarItem(
      { ...base },
      {
        evento: "X",
        categoria: null,
        precio_final: 100,
        precio_costo: 130,
        stock: 5,
        fecha: null,
        source: "manual",
      },
      1
    );
    expect(r.comision).toBe(0);
  });

  it("una consulta no tiene precio ni comisión", () => {
    const r = reconciliarItem(
      { ...base, tipo: "consulta" },
      {
        evento: "X",
        categoria: null,
        precio_final: 155,
        precio_costo: 120,
        stock: 5,
        fecha: null,
        source: "manual",
      },
      1
    );
    expect(r.monto).toBe(0);
    expect(r.comision).toBe(0);
  });
});

// El vendedor recibe el aviso por WhatsApp y tiene que saber, sin abrir nada,
// qué le entró: si es un pedido con precio cerrado o una consulta a cotizar, y
// cuántas entradas son.
describe("aviso a los vendedores", () => {
  const linea = (o: Partial<ItemPedido>): ItemPedido => ({
    tipo: "pedido",
    evento: "River vs Boca",
    sector: "Platea Alta",
    ticket_id: null,
    monto: 100,
    cantidad: 1,
    fecha_evento: null,
    ...o,
  });

  describe("tipoDelEnvio", () => {
    it("solo entradas con precio: pedido", () => {
      expect(tipoDelEnvio([linea({})], [])).toBe("pedido");
    });
    it("solo entradas a cotizar: consulta", () => {
      expect(tipoDelEnvio([], [linea({ tipo: "consulta" })])).toBe("consulta");
    });
    it("las dos cosas en el mismo carrito: mixto", () => {
      expect(tipoDelEnvio([linea({})], [linea({ tipo: "consulta" })])).toBe("mixto");
    });
    it("un carrito vacío no rompe", () => {
      expect(tipoDelEnvio([], [])).toBe("pedido");
    });

    it("la etiqueta trae el artículo y concuerda en género", () => {
      // La plantilla dice "Entró {{1}} en la tienda": sin el artículo salía
      // "Nuevo consulta".
      expect(TIPO_ENVIO_LABEL.pedido).toBe("un pedido");
      expect(TIPO_ENVIO_LABEL.consulta).toBe("una consulta");
      expect(TIPO_ENVIO_LABEL.mixto).toBe("un pedido con consultas");
    });
  });

  describe("detalleDeLineas", () => {
    it("una sola entrada: evento y sector", () => {
      expect(detalleDeLineas([linea({})], [])).toBe("River vs Boca (Platea Alta)");
    });

    it("la cantidad se ve cuando es más de una", () => {
      expect(detalleDeLineas([linea({ cantidad: 3 })], [])).toContain("x3");
      expect(detalleDeLineas([linea({ cantidad: 1 })], [])).not.toContain("x1");
    });

    it("varias entradas se listan todas", () => {
      const d = detalleDeLineas([linea({}), linea({ evento: "Final", sector: "Cat 1" })], []);
      expect(d).toBe("River vs Boca (Platea Alta) + Final (Cat 1)");
    });

    it("con más de `max` resume el resto en vez de estirarse", () => {
      const muchas = Array.from({ length: 8 }, (_, i) => linea({ evento: `E${i}` }));
      const d = detalleDeLineas(muchas, [], 3);
      expect(d).toContain("y 5 mas");
      expect(d.split("+").length).toBe(3);
    });

    it("carrito mixto: cada grupo va rotulado", () => {
      // Sin el rótulo el vendedor no sabe cuál tiene que cotizar.
      const d = detalleDeLineas(
        [linea({ evento: "River vs Boca" })],
        [linea({ tipo: "consulta", evento: "Final", sector: "Cat 1" })]
      );
      expect(d).toBe("A reservar: River vs Boca (Platea Alta) | A cotizar: Final (Cat 1)");
    });

    it("sin mezcla no se rotula: no aporta nada", () => {
      expect(detalleDeLineas([linea({})], [])).not.toContain("A reservar");
    });

    it("nunca tiene saltos de línea (es un parámetro de plantilla)", () => {
      const d = detalleDeLineas([linea({ evento: "A\nB" })], [linea({ tipo: "consulta" })]);
      expect(d).not.toMatch(/\n/);
    });

    it("sin líneas devuelve vacío y no un separador suelto", () => {
      expect(detalleDeLineas([], [])).toBe("");
    });
  });
});

describe("partirPorStock — más que el stock se parte en pedido + consulta", () => {
  it("pedís 5, quedan 3: 3 pedido + 2 consulta", () => {
    const partes = partirPorStock(item({ cantidad: 5, monto: 500 }), { ...PROPIA, stock: 3 });
    expect(partes.map((p) => [p.tipo, p.cantidad])).toEqual([
      ["pedido", 3],
      ["consulta", 2],
    ]);
    expect(partes[0].monto).toBe(300);
    expect(partes[1].monto).toBe(0);
  });
  it("con stock 0 la línea entera es consulta", () => {
    const partes = partirPorStock(item({ cantidad: 2 }), { ...PROPIA, stock: 0 });
    expect(partes).toHaveLength(1);
    expect(partes[0]).toMatchObject({ tipo: "consulta", cantidad: 2, monto: 0 });
  });
  it("dentro del stock, sin dato de stock o sin entrada vinculada: no se toca", () => {
    const p = item({ cantidad: 2 });
    expect(partirPorStock(p, PROPIA)).toEqual([p]);
    expect(partirPorStock(item({ cantidad: 9 }), { ...PROPIA, stock: null })).toHaveLength(1);
    expect(partirPorStock(item({ cantidad: 9 }), undefined)).toHaveLength(1);
    expect(partirPorStock(item({ tipo: "consulta", cantidad: 9 }), PROPIA)).toHaveLength(1);
  });
  it("cada parte se reconcilia con su precio y el resto queda a cotizar", () => {
    const partes = partirPorStock(item({ cantidad: 5 }), PORTAL).map((p) => reconciliarItem(p, PORTAL, TASA));
    expect(partes.map((p) => [p.tipo, p.cantidad, p.monto])).toEqual([
      ["pedido", 4, 778 * 4],
      ["consulta", 1, 0],
    ]);
    expect(entradasMovidasPorStock(item({ cantidad: 5 }), partirPorStock(item({ cantidad: 5 }), PORTAL))).toBe(1);
  });
  it("sin precio no se parte: una sola consulta, y no cuenta como falta de stock", () => {
    const sinPrecio = { ...PROPIA, precio_final: null, stock: 3 };
    const partes = partirPorStock(item({ cantidad: 5 }), sinPrecio);
    expect(partes).toHaveLength(1);
    expect(entradasMovidasPorStock(item({ cantidad: 5 }), partes)).toBe(0);
    const final = partes.map((p) => reconciliarItem(p, sinPrecio, TASA));
    expect(final.map((p) => [p.tipo, p.cantidad])).toEqual([["consulta", 5]]);
  });
  it("una consulta de entrada nunca cuenta como movida por stock", () => {
    expect(entradasMovidasPorStock(item({ tipo: "consulta", cantidad: 2 }), [item({ tipo: "consulta", cantidad: 2 })])).toBe(0);
  });
});
