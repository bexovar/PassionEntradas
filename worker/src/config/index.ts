import "dotenv/config";
import { z } from "zod";

/** Parser tolerante para booleanos provenientes de env (strings). */
const envBool = z.preprocess((v) => {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") return ["1", "true", "yes", "y", "on"].includes(v.trim().toLowerCase());
  return false;
}, z.boolean());

/** Trata "" como undefined para que `.default()`/`.optional()` apliquen. */
const optionalString = z.preprocess(
  (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
  z.string().optional(),
);

/** Lista separada por comas -> string[] (vacía si no hay nada). */
const csvList = z.preprocess((v) => {
  if (Array.isArray(v)) return v;
  if (typeof v === "string") return v.split(",").map((s) => s.trim()).filter(Boolean);
  return [];
}, z.array(z.string()));

const ConfigSchema = z
  .object({
    // Portal
    PE_USER: z.string().min(1, "PE_USER es obligatorio"),
    PE_PASS: z.string().min(1, "PE_PASS es obligatorio"),
    PE_BASE_URL: z.string().url().default("https://passioneventsonline.eu/admin/"),
    PE_LOGIN_URL: optionalString.pipe(z.string().url().optional()),
    PE_EVENT_LIST_PATH: z.string().min(1).default("event_list.php"),
    USER_AGENT: z
      .string()
      .min(1)
      .default(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      ),
    // Filtro opcional: solo sincronizar eventos cuya Sub Category/Título matcheen
    // alguno de estos textos (case-insensitive). Vacío = todos.
    PE_SYNC_CATEGORIES: csvList.default([]),
    // Incluir eventos "On Request" (sin precio) como disponible=false.
    PE_INCLUDE_ON_REQUEST: envBool.default(true),
    // Pausa entre fetches de detalle (cortesía con el portal B2B).
    PE_DETAIL_THROTTLE_MS: z.coerce.number().int().min(0).default(1_000),
    // Máximo de detalles por ciclo (0 = sin límite). Si se aplica, el ciclo se
    // considera "incompleto" y NO se marcan ausentes (evita falsos agotados).
    PE_MAX_DETAILS_PER_CYCLE: z.coerce.number().int().min(0).default(0),

    // Pricing
    PRICE_MARKUP: z.coerce.number().min(0).default(0.2),
    CONVERT_TO_ARS: envBool.default(false),
    EUR_ARS_RATE: z.coerce.number().positive().optional(),
    ARS_ROUND_TO: z.coerce.number().positive().default(100),

    // Scheduling / robustez. Default alto (5 min) porque cada ciclo hace
    // 1 request por evento "Book" (N+1); 30-45s sería agresivo para un B2B.
    SYNC_INTERVAL_MS: z.coerce.number().int().positive().default(300_000),
    SYNC_DROP_ABORT_RATIO: z.coerce.number().min(0).max(1).default(0.7),
    UPSERT_BATCH_SIZE: z.coerce.number().int().positive().default(500),
    MAX_LOGIN_FAILURES: z.coerce.number().int().positive().default(5),
    BLOCKED_COOLDOWN_MS: z.coerce.number().int().positive().default(900_000),
    MAX_BACKOFF_MS: z.coerce.number().int().positive().default(300_000),

    // Supabase
    // La tienda a revalidar al terminar cada sync (el worker escribe directo
    // en la base y la app no se entera; con esto los cambios se ven YA).
    TIENDA_URL: z.string().url().default("https://tickermirror.vercel.app"),
    SUPABASE_URL: z.string().url(),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1, "SUPABASE_SERVICE_ROLE_KEY es obligatorio"),
    SUPABASE_DB_URL: optionalString.pipe(z.string().optional()),

    // Backup diario de la base (pg_dump). Sin BACKUP_DB_URL, apagado.
    BACKUP_DB_URL: optionalString.pipe(z.string().optional()),
    BACKUP_DIR: z.string().min(1).default("/backups"),
    BACKUP_KEEP_DAYS: z.coerce.number().int().min(1).default(14),
    // Hora de Argentina (0-23) a partir de la cual corre el backup del día.
    BACKUP_HOUR: z.coerce.number().int().min(0).max(23).default(4),

    // Runtime
    STATE_DIR: z.string().min(1).default("/data"),
    HEALTH_PORT: z.coerce.number().int().positive().default(8080),
    STALE_AFTER_MS: z.coerce.number().int().min(0).default(0),
    LOG_LEVEL: z
      .enum(["trace", "debug", "info", "warn", "error", "fatal", "silent"])
      .default("info"),
  })
  .refine((c) => !c.CONVERT_TO_ARS || (c.EUR_ARS_RATE != null && c.EUR_ARS_RATE > 0), {
    message: "EUR_ARS_RATE es obligatorio y debe ser > 0 cuando CONVERT_TO_ARS=true",
    path: ["EUR_ARS_RATE"],
  });

export type Config = z.infer<typeof ConfigSchema>;

let cached: Config | null = null;

/** Carga y valida la configuración una sola vez. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  if (cached) return cached;
  const parsed = ConfigSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Configuración inválida:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/** Lapso tras el cual un sync se considera "stale" para el healthcheck. */
export function staleAfterMs(cfg: Config): number {
  return cfg.STALE_AFTER_MS > 0 ? cfg.STALE_AFTER_MS : cfg.SYNC_INTERVAL_MS * 4;
}

/** Resumen de config SIN secretos, apto para loguear. */
export function redactedConfigSummary(cfg: Config): Record<string, unknown> {
  return {
    PE_BASE_URL: cfg.PE_BASE_URL,
    PE_EVENT_LIST_PATH: cfg.PE_EVENT_LIST_PATH,
    PE_SYNC_CATEGORIES: cfg.PE_SYNC_CATEGORIES.length ? cfg.PE_SYNC_CATEGORIES : "(todas)",
    PE_INCLUDE_ON_REQUEST: cfg.PE_INCLUDE_ON_REQUEST,
    PE_DETAIL_THROTTLE_MS: cfg.PE_DETAIL_THROTTLE_MS,
    PE_MAX_DETAILS_PER_CYCLE: cfg.PE_MAX_DETAILS_PER_CYCLE || "(sin límite)",
    PRICE_MARKUP: cfg.PRICE_MARKUP,
    CONVERT_TO_ARS: cfg.CONVERT_TO_ARS,
    EUR_ARS_RATE: cfg.CONVERT_TO_ARS ? cfg.EUR_ARS_RATE : null,
    ARS_ROUND_TO: cfg.ARS_ROUND_TO,
    SYNC_INTERVAL_MS: cfg.SYNC_INTERVAL_MS,
    SYNC_DROP_ABORT_RATIO: cfg.SYNC_DROP_ABORT_RATIO,
    HEALTH_PORT: cfg.HEALTH_PORT,
    STATE_DIR: cfg.STATE_DIR,
    TIENDA_URL: cfg.TIENDA_URL,
    SUPABASE_URL: cfg.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: "(set, redacted)",
    BACKUP: cfg.BACKUP_DB_URL
      ? { dir: cfg.BACKUP_DIR, keepDays: cfg.BACKUP_KEEP_DAYS, hour: cfg.BACKUP_HOUR }
      : "(apagado)",
    LOG_LEVEL: cfg.LOG_LEVEL,
  };
}
