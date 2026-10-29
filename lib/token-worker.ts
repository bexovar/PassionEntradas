import { timingSafeEqual } from "crypto";

// Secreto compartido con el worker para /api/revalidar y /api/recordatorios
// (header `x-revalidar-token`).
//
// Antes era la SUPABASE_SERVICE_ROLE_KEY: viajaba en cada vuelta del worker
// (cada 5 min) y, si se filtraba, daba control total de la base. Ahora es un
// token propio, REVALIDAR_TOKEN, que solo sirve para estos dos endpoints y se
// rota sin tocar nada más.
//
// Transición: mientras REVALIDAR_TOKEN no esté configurado se sigue
// aceptando la service role key, para que el deploy no corte la
// sincronización. Apenas se configura, la key deja de valer acá.

type Env = Record<string, string | undefined>;

export const TOKEN_WORKER_MIN = 32;

export function tokenWorkerValido(recibido: string | null, env: Env = process.env): boolean {
  const propio = env.REVALIDAR_TOKEN ?? "";
  let esperado: string;
  if (propio) {
    if (propio.length < TOKEN_WORKER_MIN) {
      // Un token corto se adivina: se rechaza todo hasta que lo cambien.
      console.error(`[token-worker] REVALIDAR_TOKEN tiene que tener al menos ${TOKEN_WORKER_MIN} caracteres.`);
      return false;
    }
    esperado = propio;
  } else {
    esperado = env.SUPABASE_SERVICE_ROLE_KEY ?? "";
    if (esperado) console.warn("[token-worker] falta REVALIDAR_TOKEN: se acepta la service role key (transición).");
  }
  if (!esperado || !recibido) return false;
  const a = Buffer.from(recibido);
  const b = Buffer.from(esperado);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
