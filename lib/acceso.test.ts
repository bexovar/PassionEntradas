import { describe, expect, it } from "vitest";
import { evaluarLimiteSolicitud, ipDe, SOL_AVISOS_POR_HORA, SOL_MAX_POR_IP, validarSolicitud } from "./acceso";

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
  nombre: "Lucía Fernández",
  email: "lucia@example.com",
  telefono: "+54 9 11 5555 1234",
  legajo: "27-35123456-4",
  mensaje: "Busco la final del Mundial",
  acepto: true,
};

describe("validarSolicitud — legajo", () => {
  it("acepta un CUIT con guiones", () => {
    const r = validarSolicitud(base);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.legajo).toBe("27-35123456-4");
  });

  // "Legajo" depende de cada empresa: puede ser un número interno corto,
  // un CUIL sin guiones, o un alfanumérico. No se valida el formato.
  it("acepta un legajo interno sin formato de CUIT", () => {
    const r = validarSolicitud({ ...base, legajo: "A-4471" });
    expect(r.ok).toBe(true);
  });

  it("acepta un CUIL sin guiones", () => {
    const r = validarSolicitud({ ...base, legajo: "20123456789" });
    expect(r.ok).toBe(true);
  });

  it("lo rechaza si está vacío", () => {
    const r = validarSolicitud({ ...base, legajo: "" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/legajo/i);
  });

  it("lo rechaza si es demasiado corto para ser real", () => {
    const r = validarSolicitud({ ...base, legajo: "12" });
    expect(r.ok).toBe(false);
  });

  it("recorta espacios sobrantes", () => {
    const r = validarSolicitud({ ...base, legajo: "   20-12345678-9   " });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.legajo).toBe("20-12345678-9");
  });

  // Tope de 40: la columna es texto libre, pero no hay por qué guardar un
  // párrafo en un campo de legajo.
  it("acota un valor absurdamente largo", () => {
    const r = validarSolicitud({ ...base, legajo: "9".repeat(500) });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.legajo.length).toBe(40);
  });

  it("no lo confunde con la dirección vieja", () => {
    // El formulario viejo mandaba `direccion`. Ese payload ya no alcanza:
    // sin legajo la solicitud se rechaza, venga o no la dirección.
    const { legajo: _fuera, ...sinLegajo } = base;
    const r = validarSolicitud({ ...sinLegajo, direccion: "Av. Corrientes 1234" } as Record<string, unknown>);
    expect(r.ok).toBe(false);
  });
});

describe("validarSolicitud — el resto de los campos sigue igual", () => {
  it("exige nombre", () => {
    expect(validarSolicitud({ ...base, nombre: "L" }).ok).toBe(false);
  });

  it("exige un email con forma de email", () => {
    expect(validarSolicitud({ ...base, email: "lucia@" }).ok).toBe(false);
    expect(validarSolicitud({ ...base, email: "lucia.example.com" }).ok).toBe(false);
  });

  it("normaliza el email a minúsculas", () => {
    const r = validarSolicitud({ ...base, email: "  LUCIA@Example.COM " });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.email).toBe("lucia@example.com");
  });

  it("exige un teléfono plausible", () => {
    expect(validarSolicitud({ ...base, telefono: "123" }).ok).toBe(false);
  });

  it("deja el mensaje opcional", () => {
    const r = validarSolicitud({ ...base, mensaje: "" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.mensaje).toBeNull();
  });

  // Sin consentimiento no hay solicitud: lo revalida la API aunque la landing
  // ya lo bloquee.
  it("exige aceptar los términos", () => {
    const r = validarSolicitud({ ...base, acepto: false });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/términos/i);
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
