// Autocompletado de los formularios del panel (components/admin/Combo): qué
// sugerencias se muestran para lo que se va escribiendo. Puro y con tests.

export type OpcionCombo<T> = {
  clave: string;
  // Lo que se muestra y lo que queda escrito al elegirla.
  texto: string;
  // Segunda línea (ej. "UEFA Champions League · 11 nov 2026"). También se busca acá.
  detalle?: string;
  valor: T;
};

// Sin mayúsculas ni acentos: "formula" encuentra "Fórmula 1".
const plano = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

/**
 * Las opciones que contienen lo escrito (en el texto o en el detalle), en el
 * orden recibido y hasta `max`. La que ya está escrita igual no se sugiere.
 */
export function filtrarOpciones<T>(opciones: OpcionCombo<T>[], q: string, max = 8): OpcionCombo<T>[] {
  const buscado = plano(q);
  const base = buscado
    ? opciones.filter((o) => plano(`${o.texto} ${o.detalle ?? ""}`).includes(buscado))
    : opciones;
  return base.filter((o) => plano(o.texto) !== buscado).slice(0, max);
}
