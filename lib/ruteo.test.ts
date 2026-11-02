import { describe, expect, it } from "vitest";
import { decidirRuteo, destinoTrasLogin, inicioDe, loginConRetorno, retornoSeguro, zonaDe } from "./ruteo";

// Estos tests son los permisos del sitio. En el modo demo la autenticación se
// saltea entera, así que es el único lugar donde esto se puede verificar.
const ir = (path: string, rol: any, hay = true) => decidirRuteo(path, rol, hay);

describe("zonaDe", () => {
  it("clasifica cada ruta", () => {
    expect(zonaDe("/")).toBe("landing");
    expect(zonaDe("/ingresar")).toBe("login");
    expect(zonaDe("/admin/login")).toBe("login");
    expect(zonaDe("/entradas")).toBe("tienda");
    expect(zonaDe("/buscar")).toBe("tienda");
    expect(zonaDe("/mapa")).toBe("tienda");
    expect(zonaDe("/mis-pedidos")).toBe("tienda");
    expect(zonaDe("/cuenta")).toBe("tienda");
    expect(zonaDe("/admin")).toBe("panel");
    expect(zonaDe("/admin/entradas")).toBe("panel");
    expect(zonaDe("/moderador")).toBe("panel");
    expect(zonaDe("/op/abc")).toBe("otra");
    expect(zonaDe("/factura/abc")).toBe("otra");
  });
});

describe("sin sesión", () => {
  it("la tienda y el panel piden login", () => {
    expect(ir("/entradas", null, false)).toEqual({ accion: "redirigir", a: "/ingresar" });
    expect(ir("/admin", null, false)).toEqual({ accion: "redirigir", a: "/ingresar" });
    expect(ir("/moderador", null, false)).toEqual({ accion: "redirigir", a: "/ingresar" });
  });

  it("la landing queda abierta: es por donde se pide el acceso", () => {
    expect(ir("/", null, false)).toEqual({ accion: "seguir" });
  });

  it("el seguimiento público y la factura no piden login", () => {
    expect(ir("/op/abc", null, false)).toEqual({ accion: "seguir" });
    expect(ir("/factura/abc", null, false)).toEqual({ accion: "seguir" });
  });
});

describe("sesión sin rol", () => {
  it("no entra a ningún lado y se le cierra la sesión", () => {
    // Una cuenta creada por fuera de la app no es de nadie.
    expect(ir("/entradas", null)).toEqual({ accion: "cerrar-sesion", a: "/ingresar" });
    expect(ir("/admin", null)).toEqual({ accion: "cerrar-sesion", a: "/ingresar" });
    expect(ir("/", null)).toEqual({ accion: "cerrar-sesion", a: "/ingresar" });
  });

  it("pero puede volver a loguearse (si no, queda en loop)", () => {
    expect(ir("/ingresar", null)).toEqual({ accion: "seguir" });
  });
});

describe("cliente", () => {
  it("entra a la tienda", () => {
    expect(ir("/entradas", "cliente")).toEqual({ accion: "seguir" });
    expect(ir("/mis-pedidos", "cliente")).toEqual({ accion: "seguir" });
  });

  it("NO entra al panel", () => {
    expect(ir("/admin", "cliente")).toEqual({ accion: "redirigir", a: "/entradas" });
    expect(ir("/admin/entradas", "cliente")).toEqual({ accion: "redirigir", a: "/entradas" });
    expect(ir("/admin/configuracion", "cliente")).toEqual({ accion: "redirigir", a: "/entradas" });
    expect(ir("/moderador", "cliente")).toEqual({ accion: "redirigir", a: "/entradas" });
    expect(ir("/admin/cuenta", "cliente")).toEqual({ accion: "redirigir", a: "/entradas" });
  });

  it("sí puede ver la landing", () => {
    expect(ir("/", "cliente")).toEqual({ accion: "seguir" });
  });

  it("desde el login va a la tienda", () => {
    expect(ir("/ingresar", "cliente")).toEqual({ accion: "redirigir", a: "/entradas" });
  });
});

describe("moderador", () => {
  it("entra a su módulo", () => {
    expect(ir("/moderador", "moderador")).toEqual({ accion: "seguir" });
  });

  it("NO entra al panel de administración", () => {
    expect(ir("/admin", "moderador")).toEqual({ accion: "redirigir", a: "/moderador" });
    expect(ir("/admin/entradas", "moderador")).toEqual({ accion: "redirigir", a: "/moderador" });
    expect(ir("/admin/solicitudes", "moderador")).toEqual({ accion: "redirigir", a: "/moderador" });
    expect(ir("/admin/equipo", "moderador")).toEqual({ accion: "redirigir", a: "/moderador" });
    expect(ir("/admin/clientes/x", "moderador")).toEqual({ accion: "redirigir", a: "/moderador" });
    expect(ir("/admin/configuracion", "moderador")).toEqual({ accion: "redirigir", a: "/moderador" });
  });

  it("salvo su propia cuenta, para cambiar la contraseña", () => {
    expect(ir("/admin/cuenta", "moderador")).toEqual({ accion: "seguir" });
  });

  it("y la lista de Clientes", () => {
    expect(ir("/admin/clientes", "moderador")).toEqual({ accion: "seguir" });
    expect(ir("/admin/clientes", "cliente")).toEqual({ accion: "redirigir", a: "/entradas" });
  });

  it("puede ver la tienda (carga pedidos desde ahí)", () => {
    expect(ir("/entradas", "moderador")).toEqual({ accion: "seguir" });
  });
});

describe("administrador", () => {
  it("entra a todo el panel", () => {
    expect(ir("/admin", "administrador")).toEqual({ accion: "seguir" });
    expect(ir("/admin/entradas", "administrador")).toEqual({ accion: "seguir" });
    expect(ir("/admin/configuracion", "administrador")).toEqual({ accion: "seguir" });
    expect(ir("/moderador", "administrador")).toEqual({ accion: "seguir" });
  });

  it("y a la tienda", () => {
    expect(ir("/entradas", "administrador")).toEqual({ accion: "seguir" });
  });
});

describe("el staff y la landing", () => {
  it("puede abrir la home pública (para copiar el link de solicitud)", () => {
    expect(ir("/", "administrador")).toEqual({ accion: "seguir" });
    expect(ir("/", "moderador")).toEqual({ accion: "seguir" });
  });

  it("desde el login va a su panel", () => {
    expect(ir("/ingresar", "administrador")).toEqual({ accion: "redirigir", a: "/admin" });
    expect(ir("/admin/login", "moderador")).toEqual({ accion: "redirigir", a: "/moderador" });
  });
});

describe("inicioDe", () => {
  it("cada rol tiene su punto de partida", () => {
    expect(inicioDe("administrador")).toBe("/admin");
    expect(inicioDe("moderador")).toBe("/moderador");
    expect(inicioDe("cliente")).toBe("/entradas");
    expect(inicioDe(null)).toBe("/entradas");
  });
});

describe("volver al link profundo", () => {
  it("el login lleva el link pedido", () => {
    expect(loginConRetorno("/buscar?q=river boca")).toBe("/ingresar?next=%2Fbuscar%3Fq%3Driver%20boca");
  });

  it("vuelve al link si el rol puede entrar", () => {
    expect(retornoSeguro("/buscar?q=x", "cliente")).toBe("/buscar?q=x");
    expect(retornoSeguro("/mis-pedidos#P-12", "cliente")).toBe("/mis-pedidos#P-12");
    expect(retornoSeguro("/admin/solicitudes", "administrador")).toBe("/admin/solicitudes");
  });

  it("no sigue links a otro sitio (redirect abierto)", () => {
    expect(retornoSeguro("https://malo.com", "cliente")).toBeNull();
    expect(retornoSeguro("//malo.com/x", "cliente")).toBeNull();
    expect(retornoSeguro("/\\malo.com", "cliente")).toBeNull();
    expect(retornoSeguro("javascript:alert(1)", "cliente")).toBeNull();
  });

  it("no manda a donde el rol no entra, ni a otro login", () => {
    expect(retornoSeguro("/admin", "cliente")).toBeNull();
    expect(retornoSeguro("/admin/equipo", "moderador")).toBeNull();
    expect(retornoSeguro("/ingresar", "cliente")).toBeNull();
  });

  it("sin link (o con uno que no sirve) va a su inicio", () => {
    expect(destinoTrasLogin("cliente")).toBe("/entradas");
    expect(destinoTrasLogin("administrador", null)).toBe("/admin");
    expect(destinoTrasLogin("cliente", "/admin")).toBe("/entradas");
    expect(destinoTrasLogin("cliente", "/buscar?q=f1")).toBe("/buscar?q=f1");
  });
});
