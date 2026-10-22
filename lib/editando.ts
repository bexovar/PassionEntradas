// ¿Se puede refrescar la página ahora? (ver components/AutoRefresh.tsx)
//
// Nunca mientras alguien escribe. Un campo con foco dentro de un formulario o
// de algo marcado con data-editando frena el refresco mientras tenga el foco.
// Fuera de eso (el buscador del panel, las fechas de Métricas) frena solo
// mientras se está escribiendo: si no, con el foco olvidado en el buscador la
// lista dejaba de actualizarse para siempre.

// Sin teclear durante este rato, un campo suelto ya no cuenta como "escribiendo".
export const PAUSA_ESCRIBIENDO_MS = 10_000;

// Tipos de <input> en los que no se escribe: un botón o un tilde con foco no
// es "estar escribiendo".
const SIN_TEXTO = new Set(["button", "submit", "reset", "checkbox", "radio", "range", "color", "file", "image"]);

export function esCampoDeTexto(tag: string, tipo: string | null, editable: boolean): boolean {
  if (editable) return true;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  return tag === "INPUT" && !SIN_TEXTO.has((tipo ?? "text").toLowerCase());
}

export function hayQueEsperar({
  focoEnCampo,
  focoEnEdicion,
  msDesdeUltimaTecla,
  hayEdicionMarcada,
}: {
  // El elemento con foco es un campo de texto (esCampoDeTexto).
  focoEnCampo: boolean;
  // Ese campo está dentro de un <form> o de algo con data-editando.
  focoEnEdicion: boolean;
  // Desde la última vez que se escribió en cualquier campo de la página.
  msDesdeUltimaTecla: number;
  // Hay algún elemento con data-editando (datos sin guardar, modal abierto).
  hayEdicionMarcada: boolean;
}): boolean {
  if (hayEdicionMarcada) return true;
  if (!focoEnCampo) return false;
  return focoEnEdicion || msDesdeUltimaTecla < PAUSA_ESCRIBIENDO_MS;
}
