import pino from "pino";
import type { Config } from "./config/index.js";

/**
 * Logger central. Redacta agresivamente cualquier campo que pueda contener
 * credenciales, cookies o tokens. NUNCA loguear PE_PASS, storageState ni
 * la service_role key.
 */
export function createLogger(cfg: Pick<Config, "LOG_LEVEL">) {
  return pino({
    level: cfg.LOG_LEVEL,
    base: { service: "passion-entradas-worker" },
    redact: {
      paths: [
        "PE_PASS",
        "PE_USER",
        "pass",
        "password",
        "*.password",
        "*.PE_PASS",
        "cookie",
        "cookies",
        "*.cookie",
        "Cookie",
        "headers.cookie",
        'headers["set-cookie"]',
        "headers.authorization",
        "headers.Authorization",
        "authorization",
        "storageState",
        "*.storageState",
        "SUPABASE_SERVICE_ROLE_KEY",
        "REVALIDAR_TOKEN",
        'headers["x-revalidar-token"]',
        "SUPABASE_DB_URL",
        "BACKUP_DB_URL",
        "service_role",
        "apikey",
        "*.apikey",
      ],
      censor: "[redacted]",
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}

export type Logger = ReturnType<typeof createLogger>;
