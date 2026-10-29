import type { Config } from "../config/index.js";
import type { Logger } from "../logger.js";

/**
 * Token para la tienda: REVALIDAR_TOKEN, un secreto que solo sirve para estos
 * dos endpoints. Mientras no esté configurado se manda la service role key
 * (transición), que da control total de la base si se filtra.
 */
export function tokenTienda(cfg: Pick<Config, "REVALIDAR_TOKEN" | "SUPABASE_SERVICE_ROLE_KEY">): string {
  return cfg.REVALIDAR_TOKEN ?? cfg.SUPABASE_SERVICE_ROLE_KEY;
}

/**
 * Avisa a la tienda que hay datos nuevos: POST /api/revalidar, que refresca
 * las páginas cacheadas al instante (sin esto, lo que el worker escribe en
 * la base tarda hasta 10 min — la revalidación de fondo — en verse).
 *
 * Auth por secreto compartido (tokenTienda). Enteramente fail-soft: si la
 * tienda no responde, el sync ya publicó igual y el refresco de fondo la
 * cubre.
 */
export async function avisarTienda(deps: { cfg: Config; log: Logger }): Promise<boolean> {
  const { cfg, log } = deps;
  const url = `${cfg.TIENDA_URL.replace(/\/$/, "")}/api/revalidar`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "x-revalidar-token": tokenTienda(cfg) },
      signal: AbortSignal.timeout(5_000),
    });
    if (res.ok) {
      log.info("tienda revalidada: los cambios del sync ya están visibles");
      return true;
    }
    log.warn({ status: res.status, url }, "la tienda rechazó la revalidación (no crítico)");
    return false;
  } catch (err) {
    log.warn({ err, url }, "no se pudo avisar a la tienda (no crítico)");
    return false;
  }
}

/**
 * Le pide a la tienda que revise lo que quedó esperando y avise al equipo
 * (POST /api/recordatorios). Se llama en CADA vuelta del loop, haya o no
 * sync publicado: los recordatorios no dependen del portal. Fail-soft.
 */
export async function pedirRecordatorios(deps: { cfg: Config; log: Logger }): Promise<boolean> {
  const { cfg, log } = deps;
  const url = `${cfg.TIENDA_URL.replace(/\/$/, "")}/api/recordatorios`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "x-revalidar-token": tokenTienda(cfg) },
      signal: AbortSignal.timeout(20_000),
    });
    if (res.ok) {
      const r = (await res.json().catch(() => ({}))) as { avisosNuevos?: number; whatsapps?: number };
      if (r.avisosNuevos) log.info({ avisos: r.avisosNuevos, whatsapps: r.whatsapps }, "recordatorios enviados");
      return true;
    }
    log.warn({ status: res.status, url }, "la tienda rechazó los recordatorios (no crítico)");
    return false;
  } catch (err) {
    log.warn({ err, url }, "no se pudo pedir los recordatorios (no crítico)");
    return false;
  }
}
