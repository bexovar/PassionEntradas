// CUIT argentino: 11 números (tipo, documento, verificador), "20-12345678-6".
// Se valida el formato, el tipo y el dígito verificador (módulo 11), que es lo
// que separa un CUIT real de uno tipeado mal o inventado. NO se consulta a
// ARCA: que el número exista no se puede saber desde acá.

// Tipos que existen: persona (20, 23, 24, 25, 26, 27) y empresa (30, 33, 34).
const PREFIJOS = new Set(["20", "23", "24", "25", "26", "27", "30", "33", "34"]);
const PESOS = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];

export type ResultadoCuit = { ok: true; cuit: string } | { ok: false; motivo: "formato" | "invalido" };

/** Valida un CUIT tipeado con o sin guiones, espacios o puntos; lo devuelve como "20-12345678-6". */
export function validarCuit(raw: unknown): ResultadoCuit {
  if (typeof raw !== "string") return { ok: false, motivo: "formato" };
  const digitos = raw.replace(/[\s.-]/g, "");
  if (!/^\d{11}$/.test(digitos)) return { ok: false, motivo: "formato" };
  if (!PREFIJOS.has(digitos.slice(0, 2))) return { ok: false, motivo: "invalido" };
  const suma = PESOS.reduce((acc, peso, i) => acc + peso * Number(digitos[i]), 0);
  const resto = 11 - (suma % 11);
  // 11 → verificador 0; 10 → ese número no tiene verificador válido.
  const verificador = resto === 11 ? 0 : resto;
  if (verificador === 10 || verificador !== Number(digitos[10])) return { ok: false, motivo: "invalido" };
  return { ok: true, cuit: `${digitos.slice(0, 2)}-${digitos.slice(2, 10)}-${digitos[10]}` };
}
