"use client";

// Carrito de la tienda: el cliente junta varias entradas (pedidos/consultas) y
// después las envía todas juntas a revisión. Recién ahí se crean las
// operaciones (una por entrada) y se avisa a los vendedores. El carrito vive
// en localStorage, así sobrevive a la navegación entre /entradas y /buscar.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import Link from "next/link";
import { fmtPrice, type MonedaVenta } from "@/lib/tickets";
import { TX, type Lang } from "@/lib/tienda-i18n";
import { resumenCarrito } from "@/lib/carrito";

export type CartItem = {
  key: string; // = ticket_id (una fila del catálogo)
  ticket_id: string;
  evento: string;
  comp: string;
  sector: string;
  monto: number; // precio UNITARIO (0 en consultas / sin precio)
  // Moneda del precio. Opcional: los carritos guardados antes de este cambio
  // no la tienen y eran todos en dólares.
  moneda?: MonedaVenta;
  cantidad: number; // cuántas entradas de este sector
  maxStock: number; // tope por stock de la tienda (0 = sin tope conocido)
  tipo: "pedido" | "consulta";
  fecha_evento: string | null;
};

type CartCtx = {
  items: CartItem[];
  count: number;
  has: (key: string) => boolean;
  add: (item: CartItem) => void;
  setQty: (key: string, cantidad: number) => void;
  remove: (key: string) => void;
  clear: () => void;
};

const Ctx = createContext<CartCtx | null>(null);

export function useCart(): CartCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useCart debe usarse dentro de <CartProvider>");
  return c;
}

const STORAGE = "tm_cart";

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([]);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setItems(parsed);
      }
    } catch {
      /* carrito corrupto: arranca vacío */
    }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(STORAGE, JSON.stringify(items));
    } catch {
      /* sin storage: el carrito igual funciona en memoria */
    }
  }, [items, ready]);

  const add = useCallback((item: CartItem) => {
    setItems((prev) => (prev.some((i) => i.key === item.key) ? prev : [...prev, item]));
  }, []);
  // Cambia la cantidad de una línea, topeada por su stock. Bajar de 1 la quita.
  const setQty = useCallback((key: string, cantidad: number) => {
    setItems((prev) => {
      if (cantidad < 1) return prev.filter((i) => i.key !== key);
      return prev.map((i) => {
        if (i.key !== key) return i;
        const max = i.maxStock > 0 ? i.maxStock : 99;
        return { ...i, cantidad: Math.min(Math.trunc(cantidad), max) };
      });
    });
  }, []);
  const remove = useCallback((key: string) => {
    setItems((prev) => prev.filter((i) => i.key !== key));
  }, []);
  const clear = useCallback(() => setItems([]), []);
  const has = useCallback((key: string) => items.some((i) => i.key === key), [items]);

  return (
    <Ctx.Provider value={{ items, count: items.length, has, add, setQty, remove, clear }}>
      {children}
    </Ctx.Provider>
  );
}

// Idioma recordado (mismo criterio que el resto de la tienda). La barra vive
// en el layout y no se vuelve a montar: el idioma se relee al abrir el
// carrito y al enviar, si no un cambio de idioma en la página no le llegaba
// (y el pedido quedaba con el idioma de la primera visita).
function leerLang(): Lang {
  try {
    const s = localStorage.getItem("tm_lang");
    if (s === "en" || s === "es") return s;
  } catch {
    /* sin storage: español */
  }
  return "es";
}

function useLang(): [Lang, () => Lang] {
  const [lang, setLang] = useState<Lang>("es");
  const releer = useCallback(() => {
    const l = leerLang();
    setLang(l);
    return l;
  }, []);
  useEffect(() => {
    releer();
  }, [releer]);
  return [lang, releer];
}

type Estado = "idle" | "sending" | "done" | "err";

// Barra flotante + hoja de revisión. Se renderiza una vez, a nivel layout de
// la tienda; se muestra sola cuando hay entradas en el carrito.
export function CartBar() {
  const { items, count, setQty, remove, clear } = useCart();
  const [lang, releerLang] = useLang();
  const c = TX[lang].carrito;
  const [open, setOpen] = useState(false);
  const [estado, setEstado] = useState<Estado>("idle");
  const [error, setError] = useState("");
  // Un solo paso (TKT-17): el modal "Tu pedido" ya muestra las entradas, el
  // total y qué pasa después, y "Enviar pedido" hace el POST. Mandar el
  // pedido es una consulta de disponibilidad: no cobra ni reserva, así que no
  // lleva doble confirmación.
  // Cuándo se abrió el modal. "Enviar pedido" cae en la fila de abajo, donde
  // en el celular estaba la barra que lo abre: sin esto, el segundo toque de
  // un doble toque mandaba el pedido sin que el cliente lo llegara a ver.
  // Mismo margen que ConfirmarBoton.
  const abiertoAt = useRef(0);
  const barraRef = useRef<HTMLDivElement>(null);
  // Entradas que no tenían stock y el server pasó a consulta (ver partirPorStock).
  const [aConsulta, setAConsulta] = useState(0);

  // Un total POR MONEDA: pesos y dólares nunca se suman. Cada moneda termina
  // siendo una operación aparte al enviar (ver /api/pedidos).
  const { totales } = resumenCarrito(items);
  const totalTexto = totales.map((t) => fmtPrice(t.total, lang, t.moneda)).join(" + ");

  function cerrar() {
    setOpen(false);
    if (estado === "done" || estado === "err") {
      setEstado("idle");
      setError("");
    }
  }

  async function enviar() {
    if (estado === "sending" || items.length === 0) return;
    if (Date.now() - abiertoAt.current < 400) return;
    setEstado("sending");
    setError("");
    try {
      const res = await fetch("/api/pedidos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lang: releerLang(),
          items: items.map((i) => ({
            tipo: i.tipo,
            ticket_id: i.ticket_id,
            evento: i.evento,
            sector: i.sector,
            monto: i.monto, // precio unitario; el server calcula el total
            cantidad: i.cantidad,
            fecha_evento: i.fecha_evento,
          })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || c.errGeneric);
        setEstado("err");
        return;
      }
      clear();
      setAConsulta(Number(data.aConsultaPorStock) || 0);
      setEstado("done");
    } catch {
      setError(c.errRed);
      setEstado("err");
    }
  }

  // Mientras la barra está a la vista, el WhatsApp flotante sube por encima
  // (lee --tm-barra-pedido: del borde de abajo al tope de la barra, + aire).
  const barraVisible = count > 0 && !open;
  useEffect(() => {
    const raiz = document.documentElement;
    const barra = barraRef.current;
    if (!barraVisible || !barra) return;
    const medir = () => {
      const r = barra.getBoundingClientRect();
      raiz.style.setProperty("--tm-barra-pedido", `${Math.round(window.innerHeight - r.top + 12)}px`);
    };
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(barra);
    window.addEventListener("resize", medir);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", medir);
      raiz.style.removeProperty("--tm-barra-pedido");
    };
  }, [barraVisible]);

  // Nada que mostrar: carrito vacío y sin el cartel de "enviado".
  if (count === 0 && estado !== "done") return null;

  return (
    <>
      {barraVisible && (
        <div className="cart-bar" ref={barraRef}>
          <button
            type="button"
            onClick={() => {
              // Un envío anterior que terminó con el carrito cerrado no puede
              // tapar el carrito nuevo con su "Pedido enviado".
              if (estado === "done") setEstado("idle");
              releerLang();
              abiertoAt.current = Date.now();
              setOpen(true);
            }}
          >
            <span className="cart-count">{count}</span>
            {c.revisar}
            {totales.length > 0 && <span className="cart-bar-total">{totalTexto}</span>}
          </button>
        </div>
      )}

      {open && (
        <div className="cart-modal" role="dialog" aria-modal="true" aria-label={c.titulo}>
          <div className="cart-panel">
            {estado === "done" ? (
              <div className="cart-ok">
                <h2>{c.okTitulo}</h2>
                <p>{c.okP}</p>
                {aConsulta > 0 && <p className="cart-ok-nota">{c.okStock(aConsulta)}</p>}
                <div className="cart-ok-acciones">
                  <Link className="btn-primary" href="/mis-pedidos" onClick={cerrar}>
                    {c.okCta}
                  </Link>
                  <button type="button" className="cart-keep" onClick={cerrar}>
                    {c.cerrar}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="cart-h">
                  <div>
                    <h2>{c.titulo}</h2>
                    <p>{c.sub}</p>
                  </div>
                  <button
                    type="button"
                    className="cart-x"
                    onClick={cerrar}
                    aria-label={c.cerrar}
                    // Mientras sale el pedido no se cierra: si no, el aviso de
                    // "Pedido enviado" (y el de entradas sin stock) no se veía.
                    disabled={estado === "sending"}
                  >
                    ✕
                  </button>
                </div>

                <ul className="cart-list">
                  {items.map((i) => (
                    <li className="cart-it" key={i.key}>
                      <span className={`cart-it-tag ${i.tipo}`}>
                        {i.tipo === "pedido" ? c.pedidoTag : c.consultaTag}
                      </span>
                      <div className="cart-it-main">
                        <div className="cart-it-ev">{i.evento}</div>
                        <div className="cart-it-meta">
                          <span>{i.sector}</span>
                          {i.comp && <span>· {i.comp}</span>}
                        </div>
                        {/* Cantidad solo en pedidos (la consulta es por una);
                            topeada por el stock del sector. */}
                        {i.tipo === "pedido" && (
                          <div className="cart-qty" role="group" aria-label={c.cantidad}>
                            <button
                              type="button"
                              onClick={() => setQty(i.key, i.cantidad - 1)}
                              disabled={estado === "sending"}
                              aria-label={c.menos}
                            >
                              −
                            </button>
                            <span className="cart-qty-n" aria-live="polite">
                              {i.cantidad}
                            </span>
                            <button
                              type="button"
                              onClick={() => setQty(i.key, i.cantidad + 1)}
                              disabled={
                                estado === "sending" || (i.maxStock > 0 && i.cantidad >= i.maxStock)
                              }
                              aria-label={c.mas}
                            >
                              +
                            </button>
                            {i.maxStock > 0 && (
                              <span className="cart-qty-max">{c.stock(i.maxStock)}</span>
                            )}
                          </div>
                        )}
                      </div>
                      <span className="cart-it-price">
                        {i.monto > 0
                          ? fmtPrice(i.monto * i.cantidad, lang, i.moneda ?? "USD")
                          : c.aConsultar}
                      </span>
                      <button
                        type="button"
                        className="cart-rm"
                        onClick={() => remove(i.key)}
                        // Mientras sale el pedido, lo que se ve es lo que se manda.
                        disabled={estado === "sending"}
                        aria-label={`${c.quitar}: ${i.evento}`}
                      >
                        {c.quitar}
                      </button>
                    </li>
                  ))}
                </ul>

                {totales.map((t) => (
                  <div className="cart-total" key={t.moneda}>
                    <span>{totales.length > 1 ? `${c.total} (${t.moneda})` : c.total}</span>
                    <span>{fmtPrice(t.total, lang, t.moneda)}</span>
                  </div>
                ))}
                {totales.length > 0 && <p className="cart-nota-monedas">{c.totalNota}</p>}
                {totales.length > 1 && <p className="cart-nota-monedas">{c.dosMonedas}</p>}

                <div className="cart-sigue">
                  <strong>{c.queSigue}</strong>
                  <p>{c.queSigueP}</p>
                </div>

                {estado === "err" && <p className="cart-err">{error}</p>}

                <div className="cart-actions">
                  <button
                    type="button"
                    className="cart-keep"
                    onClick={cerrar}
                    disabled={estado === "sending"}
                  >
                    {c.seguir}
                  </button>
                  {/* Deshabilitado mientras sale: un doble toque no manda dos
                      veces (y el server igual deduplica el envío). */}
                  <button
                    type="button"
                    className="cart-send"
                    onClick={enviar}
                    disabled={estado === "sending" || items.length === 0}
                  >
                    {estado === "sending" ? c.enviando : c.enviar}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
