import { loadConfig, redactedConfigSummary, staleAfterMs } from "./config/index.js";
import { createLogger } from "./logger.js";
import { startHealthServer } from "./health.js";
import { PortalSession } from "./portal/session.js";
import { createSupabase } from "./db/supabase.js";
import { TicketRepository } from "./db/repository.js";
import { runSyncCycle } from "./sync/cycle.js";
import { avisarTienda, pedirRecordatorios } from "./sync/revalidar.js";
import { crearBackups } from "./backup/backup.js";
import { BlockedError, LoginFailedError } from "./errors.js";
import { computeBackoffMs, sleep } from "./util/time.js";

async function main(): Promise<void> {
  const cfg = loadConfig();
  const log = createLogger(cfg);
  log.info(redactedConfigSummary(cfg), "iniciando passion-entradas-worker");

  const abort = new AbortController();
  const session = new PortalSession(cfg, log);
  const supabase = createSupabase(cfg);
  const repo = new TicketRepository(supabase, log);
  const health = startHealthServer({
    port: cfg.HEALTH_PORT,
    staleAfterMs: staleAfterMs(cfg),
    log,
  });
  const backups = crearBackups({ cfg, log, signal: abort.signal });

  let shuttingDown = false;
  let loginFailures = 0;

  const shutdown = async (sig: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info({ sig }, "shutdown: cerrando recursos...");
    abort.abort();
    await session.close();
    await health.close();
    log.info("shutdown completo");
    await sleep(50); // pequeño margen para flush de logs
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("unhandledRejection", (reason) =>
    log.error({ err: reason }, "unhandledRejection (no fatal)"),
  );

  // Loop con candado single-flight: el while + await garantiza que dos ciclos
  // nunca se solapen, aunque el portal tarde. Se espera DESPUÉS de cada ciclo.
  while (!shuttingDown) {
    const start = Date.now();
    let waitMs = cfg.SYNC_INTERVAL_MS;
    try {
      await session.ensureSession();
      loginFailures = 0;
      const summary = await runSyncCycle({ cfg, log, session, repo, signal: abort.signal });
      // Solo un ciclo publicado cuenta como "sano". Si el abort del guard
      // marcara éxito, un abort permanente dejaría el healthcheck en verde
      // con el catálogo congelado (staleness nunca dispararía).
      if (summary.status === "ok") {
        health.markSuccess();
        // Refrescar la tienda YA (fail-soft): sin esto, lo publicado tarda
        // hasta 10 min (revalidación de fondo) en verse.
        await avisarTienda({ cfg, log });
      }
      waitMs = Math.max(0, cfg.SYNC_INTERVAL_MS - (Date.now() - start));
    } catch (err) {
      if (err instanceof BlockedError) {
        // NO se evade: el portal no quiere acceso automatizado. Enfriar y alertar.
        log.error(
          { err: err.message },
          "PORTAL BLOQUEÓ ACCESO (captcha/MFA). No se evade — enfriando.",
        );
        waitMs = cfg.BLOCKED_COOLDOWN_MS;
      } else if (err instanceof LoginFailedError) {
        loginFailures++;
        waitMs = computeBackoffMs(loginFailures, cfg.SYNC_INTERVAL_MS, cfg.MAX_BACKOFF_MS);
        if (loginFailures >= cfg.MAX_LOGIN_FAILURES) {
          log.error({ err: err.message, loginFailures, waitMs }, "login falla repetidamente, backoff largo");
        } else {
          log.warn({ err: err.message, loginFailures, waitMs }, "login fallido, backoff");
        }
      } else {
        log.error({ err }, "ciclo falló, continúo (datos viejos preservados)");
        waitMs = Math.max(0, cfg.SYNC_INTERVAL_MS - (Date.now() - start));
      }
    }
    if (shuttingDown) break;
    // Recordatorios al equipo (pedidos sin confirmar, etc.): en cada vuelta,
    // aunque el sync haya fallado o el portal esté bloqueado. Fail-soft.
    await pedirRecordatorios({ cfg, log });
    // Backup diario de la base: corre solo si toca (una vez por día). Fail-soft.
    await backups.siToca();
    await sleep(waitMs, abort.signal);
  }
}

main().catch((err) => {
  // Error fatal de arranque (p.ej. config inválida). No hay logger garantizado.
  console.error("fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
