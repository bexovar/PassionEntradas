import { describe, expect, it } from "vitest";
import { archivosVencidos, conexion, fechaHoraAr, pistaDeConexion, tocaBackup } from "./backup.js";

describe("fechaHoraAr", () => {
  it("usa la hora de Argentina (UTC-3)", () => {
    expect(fechaHoraAr(new Date("2026-10-13T06:30:00Z"))).toEqual({ fecha: "2026-10-13", hora: 3, hhmm: "0330" });
    expect(fechaHoraAr(new Date("2026-10-14T02:05:00Z"))).toEqual({ fecha: "2026-10-13", hora: 23, hhmm: "2305" });
    expect(fechaHoraAr(new Date("2026-10-14T03:00:00Z"))).toEqual({ fecha: "2026-10-14", hora: 0, hhmm: "0000" });
  });
});

describe("tocaBackup", () => {
  const ayer = ["passion-2026-10-12_0400.dump", "passion-2026-10-12_0400.auth.dump"];
  const a = (iso: string, archivos: string[], ultimoFallo: number | null = null) =>
    tocaBackup({ ahora: new Date(iso), horaBackup: 4, archivos, ultimoFallo });

  it("sin ningún backup, enseguida aunque no sea la hora", () => {
    expect(a("2026-10-13T15:00:00Z", [])).toBe(true);
    expect(a("2026-10-13T15:00:00Z", ["passion-2026-10-12_0400.auth.dump", "x.dump.tmp"])).toBe(true);
  });

  it("con backups, espera a la hora y hace uno por día", () => {
    expect(a("2026-10-13T06:59:00Z", ayer)).toBe(false); // 03:59 AR
    expect(a("2026-10-13T07:00:00Z", ayer)).toBe(true); // 04:00 AR
    expect(a("2026-10-13T20:00:00Z", ayer)).toBe(true); // el worker estuvo caído a las 4
    expect(a("2026-10-13T20:00:00Z", [...ayer, "passion-2026-10-13_0400.dump"])).toBe(false);
  });

  it("un backup a medias (sin el .dump principal) no cuenta", () => {
    expect(a("2026-10-13T08:00:00Z", [...ayer, "passion-2026-10-13_0400.auth.dump"])).toBe(true);
  });

  it("tras un fallo, espera una hora", () => {
    const ahora = new Date("2026-10-13T08:00:00Z").getTime();
    expect(a("2026-10-13T08:00:00Z", ayer, ahora - 59 * 60_000)).toBe(false);
    expect(a("2026-10-13T08:00:00Z", ayer, ahora - 60 * 60_000)).toBe(true);
    expect(a("2026-10-13T08:00:00Z", [], ahora - 5 * 60_000)).toBe(false);
  });
});

describe("archivosVencidos", () => {
  it("deja los últimos N días y no toca otros archivos", () => {
    const archivos = [
      "passion-2026-09-29_0400.dump",
      "passion-2026-09-29_0400.auth.dump",
      "passion-2026-09-30_0400.dump",
      "passion-2026-10-13_0400.dump",
      "notas.txt",
      "passion-2026-09-01_0400.dump.tmp",
    ];
    expect(archivosVencidos(archivos, "2026-10-13", 14)).toEqual([
      "passion-2026-09-29_0400.dump",
      "passion-2026-09-29_0400.auth.dump",
    ]);
  });

  it("cruza meses y años", () => {
    expect(archivosVencidos(["passion-2026-12-31_0400.dump", "passion-2027-01-01_0400.dump"], "2027-01-02", 1)).toEqual([
      "passion-2026-12-31_0400.dump",
      "passion-2027-01-01_0400.dump",
    ]);
  });
});

describe("conexion", () => {
  it("saca la contraseña del URI (decodificada)", () => {
    const c = conexion("postgresql://postgres.abc:p%40ss%23w@aws-0-sa-east-1.pooler.supabase.com:5432/postgres");
    expect(c).toEqual({
      dbname: "postgresql://postgres.abc@aws-0-sa-east-1.pooler.supabase.com:5432/postgres",
      password: "p@ss#w",
      host: "aws-0-sa-east-1.pooler.supabase.com",
      port: "5432",
    });
  });

  it("rechaza lo que no es un URI de Postgres", () => {
    expect(() => conexion("https://abc.supabase.co")).toThrow();
    expect(() => conexion("no es una url")).toThrow();
  });
});

describe("pistaDeConexion", () => {
  it("avisa de la conexión directa y del Transaction pooler", () => {
    expect(pistaDeConexion("db.vcovindqjrzpkoxandnv.supabase.co", "5432")).toMatch(/Session pooler/);
    expect(pistaDeConexion("aws-0-sa-east-1.pooler.supabase.com", "6543")).toMatch(/5432/);
    expect(pistaDeConexion("aws-0-sa-east-1.pooler.supabase.com", "5432")).toBeNull();
  });
});
