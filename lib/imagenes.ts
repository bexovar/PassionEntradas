// Subidas de imágenes del panel (mapas de estadio, fotos del carrusel). Se
// valida el contenido, no el nombre ni el tipo que dice el navegador: se leen
// los primeros bytes del archivo.

export const MAX_BYTES_IMAGEN = 5 * 1024 * 1024;

export function tipoReal(b: Uint8Array): { mime: string; ext: string } | null {
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { mime: "image/png", ext: "png" };
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  if (
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  ) {
    return { mime: "image/webp", ext: "webp" };
  }
  return null;
}

// "840 KB", "1,2 MB": para el registro de actividad.
export function pesoLegible(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${new Intl.NumberFormat("es-AR", { maximumFractionDigits: 1 }).format(bytes / (1024 * 1024))} MB`;
}
