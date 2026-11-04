// Badge de stock a nivel evento (TKT-16), el mismo en /buscar y en /entradas.
// Responde "¿hay algo comprable acá?", no "¿está todo disponible?": alcanza
// con una ubicación con stock (`bookable`, las "N con stock" de la card).
// Adentro del desplegable cada ubicación dice si la tiene o no.
export type BadgeStock = "con_stock" | "a_consultar";

export function badgeEvento(ev: { bookable: number }): BadgeStock {
  return ev.bookable > 0 ? "con_stock" : "a_consultar";
}
