import { spawn } from "node:child_process";
import { chmod, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { Config } from "../config/index.js";
import type { Logger } from "../logger.js";

/**
 * Backup diario de la base: Supabase Free no tiene backups restaurables.
 *
 * Una vez por día, desde BACKUP_HOUR (hora de Argentina), corre pg_dump y deja
 * en BACKUP_DIR dos archivos en formato custom (se restauran con pg_restore,
 * ver README):
 *   passion-AAAA-MM-DD_HHMM.dump       esquema + datos de `public` (y el
 *                                      historial de migraciones)
 *   passion-AAAA-MM-DD_HHMM.auth.dump  solo los datos de auth.users y
 *                                      auth.identities (los logins)
 * Sin ningún backup en la carpeta (recién instalado), hace uno enseguida.
 * Guarda BACKUP_KEEP_DAYS días y solo borra viejos tras un backup exitoso.
 *
 * Fail-soft: si falla, se loguea y se reintenta en una hora; nunca frena el sync.
 */

const ZONA = "America/Argentina/Buenos_Aires";
const RE_ARCHIVO = /^passion-(\d{4}-\d{2}-\d{2})_(\d{4})(\.auth)?\.dump$/;
const REINTENTO_MS = 60 * 60_000;
const TIMEOUT_MS = 10 * 60_000;

/** Fecha (AAAA-MM-DD), hora y HHMM de Argentina para un instante. */
export function fechaHoraAr(d: Date): { fecha: string; hora: number; hhmm: string } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: ZONA,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return { fecha: `${p.year}-${p.month}-${p.day}`, hora: Number(p.hour), hhmm: `${p.hour}${p.minute}` };
}

/** Fechas con un backup completo: las que tienen el .dump principal. */
function fechasConBackup(archivos: string[]): Set<string> {
  const fechas = new Set<string>();
  for (const a of archivos) {
    const m = RE_ARCHIVO.exec(a);
    if (m?.[1] && !m[3]) fechas.add(m[1]);
  }
  return fechas;
}

export function tocaBackup(o: {
  ahora: Date;
  horaBackup: number;
  archivos: string[];
  ultimoFallo: number | null;
}): boolean {
  if (o.ultimoFallo !== null && o.ahora.getTime() - o.ultimoFallo < REINTENTO_MS) return false;
  const fechas = fechasConBackup(o.archivos);
  if (fechas.size === 0) return true;
  const { fecha, hora } = fechaHoraAr(o.ahora);
  return hora >= o.horaBackup && !fechas.has(fecha);
}

/** Archivos de backup de hace `keepDays` días o más (hoy cuenta como uno). */
export function archivosVencidos(archivos: string[], hoy: string, keepDays: number): string[] {
  const d = new Date(`${hoy}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - keepDays);
  const corte = d.toISOString().slice(0, 10);
  return archivos.filter((a) => {
    const fecha = RE_ARCHIVO.exec(a)?.[1];
    return fecha != null && fecha <= corte;
  });
}

/**
 * Separa la contraseña del URI: viaja a pg_dump por PGPASSWORD, no en la
 * línea de comandos (que se ve en `ps`).
 */
export function conexion(url: string): { dbname: string; password: string; host: string; port: string } {
  const u = new URL(url);
  if (u.protocol !== "postgresql:" && u.protocol !== "postgres:") {
    throw new Error("tiene que empezar con postgresql://");
  }
  const password = decodeURIComponent(u.password);
  u.password = "";
  return { dbname: u.toString(), password, host: u.hostname, port: u.port || "5432" };
}

/** Los dos errores de conexión típicos con Supabase, en criollo. */
export function pistaDeConexion(host: string, port: string): string | null {
  if (/^db\.[a-z0-9]+\.supabase\.co$/i.test(host)) {
    return "es la conexión directa (en el plan Free solo anda por IPv6): usá la del Session pooler";
  }
  if (port === "6543") {
    return "es el Transaction pooler (puerto 6543): pg_dump necesita el Session pooler (puerto 5432)";
  }
  return null;
}

function pgDump(args: string[], password: string, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    // Entorno mínimo: pg_dump no necesita los secretos del worker.
    const hijo = spawn("pg_dump", args, {
      env: { PATH: process.env.PATH, PGPASSWORD: password, PGCONNECT_TIMEOUT: "20", PGAPPNAME: "passion-backup" },
      stdio: ["ignore", "ignore", "pipe"],
      signal,
    });
    let stderr = "";
    hijo.stderr.on("data", (c: Buffer) => {
      if (stderr.length < 4_000) stderr += c.toString();
    });
    hijo.on("error", (err: NodeJS.ErrnoException) =>
      reject(err.code === "ENOENT" ? new Error("pg_dump no está instalado (viene en la imagen de Docker)") : err),
    );
    hijo.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(stderr.trim() || `pg_dump salió con código ${code}`)),
    );
  });
}

export interface Backups {
  /** Llamar en cada vuelta del loop: hace el backup solo si toca. */
  siToca(): Promise<void>;
}

export function crearBackups(deps: { cfg: Config; log: Logger; signal: AbortSignal }): Backups {
  const { cfg, log } = deps;
  const apagado: Backups = { siToca: async () => {} };
  if (!cfg.BACKUP_DB_URL) {
    log.info("backup de la base apagado (falta BACKUP_DB_URL)");
    return apagado;
  }
  let con: ReturnType<typeof conexion>;
  try {
    con = conexion(cfg.BACKUP_DB_URL);
  } catch (err) {
    log.error({ error: (err as Error).message }, "BACKUP_DB_URL inválida: backup de la base apagado");
    return apagado;
  }
  const pista = pistaDeConexion(con.host, con.port);
  if (pista) log.warn({ host: con.host, port: con.port }, `BACKUP_DB_URL ${pista}`);

  const dir = cfg.BACKUP_DIR;
  const comunes = [`--dbname=${con.dbname}`, "--no-password", "--format=custom", "--lock-wait-timeout=60s"];
  let ultimoFallo: number | null = null;

  return {
    async siToca() {
      try {
        await mkdir(dir, { recursive: true, mode: 0o700 });
        const archivos = await readdir(dir);
        const ahora = new Date();
        if (!tocaBackup({ ahora, horaBackup: cfg.BACKUP_HOUR, archivos, ultimoFallo })) return;

        // Restos de un intento cortado (reinicio a mitad de un pg_dump).
        for (const a of archivos) if (a.endsWith(".tmp")) await rm(path.join(dir, a), { force: true });

        const { fecha, hhmm } = fechaHoraAr(ahora);
        const base = path.join(dir, `passion-${fecha}_${hhmm}`);
        const signal = AbortSignal.any([deps.signal, AbortSignal.timeout(TIMEOUT_MS)]);
        const t0 = Date.now();
        await pgDump(
          [...comunes, "--schema=public", "--schema=supabase_migrations", `--file=${base}.dump.tmp`],
          con.password,
          signal,
        );
        await pgDump(
          [...comunes, "--data-only", "--table=auth.users", "--table=auth.identities", `--file=${base}.auth.dump.tmp`],
          con.password,
          signal,
        );
        // El principal se renombra último: que exista marca el backup completo.
        for (const f of [`${base}.auth.dump`, `${base}.dump`]) {
          await chmod(`${f}.tmp`, 0o600);
          await rename(`${f}.tmp`, f);
        }
        ultimoFallo = null;

        const bytes = (await stat(`${base}.dump`)).size + (await stat(`${base}.auth.dump`)).size;
        const vencidos = archivosVencidos(await readdir(dir), fecha, cfg.BACKUP_KEEP_DAYS);
        for (const a of vencidos) await rm(path.join(dir, a), { force: true });
        log.info(
          { archivo: `${path.basename(base)}.dump`, kb: Math.round(bytes / 1024), ms: Date.now() - t0, borrados: vencidos.length },
          "backup de la base listo",
        );
      } catch (err) {
        if (deps.signal.aborted) return;
        ultimoFallo = Date.now();
        const error =
          (err as Error).name === "AbortError" ? "pg_dump tardó más de 10 min" : (err as Error).message;
        log.error(
          { error, pista: pista ?? undefined },
          "backup de la base falló; se reintenta en 1 h",
        );
      }
    },
  };
}
