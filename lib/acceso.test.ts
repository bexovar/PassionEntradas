import { describe, expect, it } from "vitest";
import {
  evaluarLimiteSolicitud,
  ipDe,
  SOL_AVISOS_POR_HORA,
  SOL_MAX_POR_IP,
  TIPOS_ORGANIZACION,
  validarSolicitud,
} from "./acceso";

describe("evaluarLimiteSolicitud", () => {
  it("acepta hasta el tope por IP y después no", () => {
    expect(evaluarLimiteSolicitud({ deEstaIp: 0, total: 0 }).aceptar).toBe(true);
    expect(evaluarLimiteSolicitud({ deEstaIp: SOL_MAX_POR_IP - 1, total: 0 }).aceptar).toBe(true);
    expect(evaluarLimiteSolicitud({ deEstaIp: SOL_MAX_POR_IP, total: 0 }).aceptar).toBe(false);
  });

  it("pasado el tope total de la hora deja de avisar afuera (WhatsApp y email)", () => {
    expect(evaluarLimiteSolicitud({ deEstaIp: 0, total: SOL_AVISOS_POR_HORA - 1 }).avisarAfuera).toBe(true);
    expect(evaluarLimiteSolicitud({ deEstaIp: 0, total: SOL_AVISOS_POR_HORA }).avisarAfuera).toBe(false);
  });
});

describe("ipDe", () => {
  const h = (o: Record<string, string>) => ({ get: (k: string) => o[k] ?? null });
  it("toma la primera IP de x-forwarded-for", () => {
    expect(ipDe(h({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }))).toBe("203.0.113.7");
  });
  it("si no está, usa x-real-ip; si no hay ninguna, null", () => {
    expect(ipDe(h({ "x-real-ip": "198.51.100.2" }))).toBe("198.51.100.2");
    expect(ipDe(h({}))).toBeNull();
  });
});

// El formulario de acceso es público y sin auth, así que TODO lo que llega es
// input hostil. Estos tests fijan qué se acepta y qué mensaje se devuelve.

const base = {
  tipoOrganizacion: "agencia",
  organizacion: "Viajes del Sur",
  nombre: "Lucía Fernández",
  email: "lucia@example.com",
  telefono: "+54 9 11 5555 1234",
  cuit: "27-35123456-9",
  acepto: true,
};

const error = (raw: Record<string, unknown>) => {
  const r = validarSolicitud(raw);
  return r.ok ? null : r;
};

describe("validarSolicitud — organización (TKT-11)", () => {
  it("acepta la solicitud completa y devuelve los datos limpios", () => {
    const r = validarSolicitud({ ...base, organizacion: "  Viajes   del Sur " });
    expect(r).toEqual({
      ok: true,
      value: {
        tipoOrganizacion: "agencia",
        organizacion: "Viajes del Sur",
        nombre: "Lucía Fernández",
        email: "lucia@example.com",
        telefono: "+54 9 11 5555 1234",
        cuit: "27-35123456-9",
        acepto: true,
      },
    });
  });

  it("acepta los cinco tipos del dropdown", () => {
    for (const t of TIPOS_ORGANIZACION) expect(validarSolicitud({ ...base, tipoOrganizacion: t }).ok).toBe(true);
    expect(TIPOS_ORGANIZACION).toEqual(["agencia", "operador", "freelance", "hoteleria", "otro"]);
  });

  it("no se puede enviar sin tipo de organización, ni con uno inventado", () => {
    expect(error({ ...base, tipoOrganizacion: "" })?.codigo).toBe("tipo");
    expect(error({ ...base, tipoOrganizacion: "aerolinea" })?.codigo).toBe("tipo");
    expect(error({ ...base, tipoOrganizacion: undefined })?.codigo).toBe("tipo");
  });

  it("no se puede enviar sin nombre de organización", () => {
    expect(error({ ...base, organizacion: "" })?.codigo).toBe("organizacion");
    expect(error({ ...base, organizacion: " x " })?.codigo).toBe("organizacion");
  });

  it("acota un nombre de organización absurdamente largo", () => {
    const r = validarSolicitud({ ...base, organizacion: "A".repeat(500) });
    expect(r.ok && r.value.organizacion.length).toBe(120);
  });

  it("el freelance pone su propio nombre como organización", () => {
    const r = validarSolicitud({ ...base, tipoOrganizacion: "freelance", organizacion: "Lucía Fernández" });
    expect(r.ok).toBe(true);
  });

  it("valida primero la organización: es lo primero del form", () => {
    expect(error({ ...base, tipoOrganizacion: "", nombre: "", cuit: "" })?.codigo).toBe("tipo");
  });
});

describe("validarSolicitud — CUIT (TKT-11)", () => {
  it("lo guarda siempre con guiones, venga como venga", () => {
    const r = validarSolicitud({ ...base, cuit: "27351234569" });
    expect(r.ok && r.value.cuit).toBe("27-35123456-9");
  });

  it("sin CUIT o con formato inválido, el error dice qué formato se espera", () => {
    for (const cuit of ["", "A-4471", "2735123456"]) {
      const e = error({ ...base, cuit });
      expect(e?.codigo).toBe("cuit_formato");
      expect(e?.error).toMatch(/11 números/);
      expect(e?.error).toMatch(/20-12345678-6/);
    }
  });

  it("el error nombra CUIT y CUIL: el campo acepta cualquiera de los dos", () => {
    expect(error({ ...base, cuit: "" })?.error).toMatch(/CUIT o CUIL/);
    expect(error({ ...base, cuit: "27-35123456-4" })?.error).toMatch(/CUIT o CUIL/);
  });

  it("con números que no forman un CUIT real, lo rechaza y muestra el formato", () => {
    const e = error({ ...base, cuit: "27-35123456-4" });
    expect(e?.codigo).toBe("cuit_invalido");
    expect(e?.error).toMatch(/20-12345678-6/);
  });

  it("ya no acepta un legajo interno en lugar del CUIT", () => {
    const { cuit: _c, ...sinCuit } = base;
    expect(error({ ...sinCuit, legajo: "A-4471" })?.codigo).toBe("cuit_formato");
  });
});

describe("validarSolicitud — el resto de los campos sigue igual", () => {
  it("exige nombre", () => {
    expect(error({ ...base, nombre: "L" })?.codigo).toBe("nombre");
  });

  it("exige un email con forma de email", () => {
    expect(error({ ...base, email: "lucia@" })?.codigo).toBe("email");
    expect(validarSolicitud({ ...base, email: "lucia.example.com" }).ok).toBe(false);
  });

  it("normaliza el email a minúsculas", () => {
    const r = validarSolicitud({ ...base, email: "  LUCIA@Example.COM " });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.email).toBe("lucia@example.com");
  });

  it("exige un teléfono plausible", () => {
    expect(error({ ...base, telefono: "123" })?.codigo).toBe("telefono");
  });

  it("ignora el mensaje: el campo salió del formulario", () => {
    const r = validarSolicitud({ ...base, mensaje: "Busco la final del Mundial" } as Record<string, unknown>);
    expect(r.ok && "mensaje" in r.value).toBe(false);
  });

  // Sin consentimiento no hay solicitud: lo revalida la API aunque la landing
  // ya lo bloquee.
  it("exige aceptar los términos", () => {
    const e = error({ ...base, acepto: false });
    expect(e?.codigo).toBe("acepto");
    expect(e?.error).toMatch(/términos/i);
  });

  it("no acepta un 'acepto' que no sea exactamente true", () => {
    expect(validarSolicitud({ ...base, acepto: "true" }).ok).toBe(false);
    expect(validarSolicitud({ ...base, acepto: 1 }).ok).toBe(false);
  });

  it("no explota con un objeto vacío", () => {
    const r = validarSolicitud({});
    expect(r.ok).toBe(false);
  });
});
