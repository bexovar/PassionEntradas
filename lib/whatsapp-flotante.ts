// El botón flotante de WhatsApp (TKT-9): qué mensaje lleva ya escrito según
// dónde está el agente. El de un evento y el de un pedido son los que más
// ahorran ida y vuelta: del otro lado ya saben de qué se trata. Puro y con
// tests; components/WhatsAppFlotante solo lo aplica.

export type PantallaWa = "publica" | "tienda" | "pedidos";

/** Lo que la pantalla sabe y el mensaje usa: el evento abierto o el pedido. */
export type ContextoWa =
  | { tipo: "evento"; nombre: string; fecha: string | null }
  | { tipo: "pedido"; codigo: string };

type Lang = "es" | "en";

export function pantallaWaDe(pathname: string): PantallaWa {
  if (pathname.startsWith("/mis-pedidos") || pathname.startsWith("/op/")) return "pedidos";
  if (
    pathname.startsWith("/entradas") ||
    pathname === "/buscar" ||
    pathname === "/mapa" ||
    pathname.startsWith("/cuenta")
  ) {
    return "tienda";
  }
  // La home, el login, recuperar contraseña y los legales: el que todavía no
  // entró.
  return "publica";
}

// El día del evento viene como día UTC (ver fmtDate en lib/tickets): se
// formatea en UTC para no correrlo al día anterior.
function fechaEvento(iso: string | null, lang: Lang): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(lang === "en" ? "en-US" : "es-AR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function mensajeWa(pantalla: PantallaWa, contexto: ContextoWa | null, lang: Lang): string {
  const en = lang === "en";
  if (contexto?.tipo === "evento" && contexto.nombre.trim()) {
    const nombre = contexto.nombre.trim();
    const fecha = fechaEvento(contexto.fecha, lang);
    const que = fecha ? `${nombre}, ${fecha}` : nombre;
    return en ? `Hi, I'm asking about ${que}.` : `Hola, consulto por ${que}.`;
  }
  if (contexto?.tipo === "pedido" && contexto.codigo.trim()) {
    const codigo = contexto.codigo.trim();
    return en ? `Hi, I'm asking about order ${codigo}.` : `Hola, consulto por el pedido ${codigo}.`;
  }
  if (pantalla === "pedidos") {
    return en ? "Hi, I'm asking about an order." : "Hola, consulto por un pedido.";
  }
  if (pantalla === "tienda") {
    return en
      ? "Hi, I'm looking for tickets and I have a question."
      : "Hola, estoy buscando entradas y tengo una consulta.";
  }
  return en ? "Hi, I'd like to request access to TicketMirror." : "Hola, quiero pedir acceso a TicketMirror.";
}
