"use client";

// Tienda pública (TicketMirror) portada del front Vite de PassionEntradas.
// Un solo componente cliente con las dos vistas (home y catálogo); la data
// llega ya cargada desde el server component.
// Bilingüe EN/ES (default español): los textos viven en lib/tienda-i18n.ts y
// el toggle del header se recuerda en localStorage.

import { memo, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { compararAZ } from "@/lib/orden";
import { createPortal } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  buildEvents,
  fmtDate,
  fmtPrice,
  isWC,
  parseTitle,
  waLink,
  zonaDelMapa,
  type EventoAgrupado,
  type Ticket,
} from "@/lib/tickets";
import { LANGS, mesLabelLang, TX, type Lang } from "@/lib/tienda-i18n";
import { useCart } from "@/components/tienda/Cart";
import { CapaFoco, useFocoMapa } from "@/components/tienda/MapaFoco";
import Campana from "@/components/tienda/Campana";
import { LegalLinks } from "@/components/tienda/LegalLinks";
import { empezarNavegacion } from "@/components/NavProgress";
import type { ResumenHome } from "@/lib/resumen-home";
import { desempacarCatalogo, type CatalogoCompacto } from "@/lib/catalogo-compacto";
import { useContextoWhatsApp } from "@/components/WhatsAppFlotante";
import { badgeEvento } from "@/lib/badge-stock";

// Idioma elegido: default español; se recuerda entre visitas.
function useLang() {
  const [lang, setLang] = useState<Lang>("es");
  useEffect(() => {
    const saved = localStorage.getItem("tm_lang");
    if (saved === "en" || saved === "es") setLang(saved);
  }, []);
  function change(l: Lang) {
    setLang(l);
    localStorage.setItem("tm_lang", l);
  }
  return [lang, change] as const;
}

// Cuánto tapa lo que está pegado arriba (header, barra de filtros): lo
// sticky que ahora mismo está en el borde superior.
function altoPegadoArriba(): number {
  let tope = 0;
  document.querySelectorAll<HTMLElement>(".tienda .masthead--cat, .tienda .masthead--home .toprow, .tienda .bar").forEach((el) => {
    if (getComputedStyle(el).position !== "sticky") return;
    const r = el.getBoundingClientRect();
    if (r.top <= 1 && r.bottom > 0) tope = Math.max(tope, r.bottom);
  });
  return tope;
}

function LangToggle({ lang, onChange }: { lang: Lang; onChange: (l: Lang) => void }) {
  return (
    <div className="lang" role="group" aria-label="Language / Idioma">
      {LANGS.map((l) => (
        <button
          key={l}
          className={`lang-btn ${l === lang ? "active" : ""}`}
          onClick={() => onChange(l)}
          aria-pressed={l === lang}
        >
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

// Link profundo al evento (mismo formato que el botón compartir) para pegar
// en los mensajes de WhatsApp: el agente abre y ve exactamente qué entrada
// le están pidiendo. Base determinística (env con fallback al dominio de
// prod) para que el server y el cliente rendericen el mismo href.
const SITE_BASE = (
  process.env.NEXT_PUBLIC_SITE_URL || "https://tickermirror.vercel.app"
).replace(/\/$/, "");

function eventoLink(evento: string, comp: string): string {
  return `${SITE_BASE}/buscar?ev=${encodeURIComponent(evento)}&c=${encodeURIComponent(comp)}`;
}

function Wordmark() {
  // La marca lleva al home de la tienda (zona logueada), no a la landing.
  return (
    <Link className="wm" href="/entradas">
      <span className="ticketmark">▚</span> TICKET<em>MIRROR</em>
    </Link>
  );
}

// Visor del mapa de sectores a pantalla completa.
//
// En PC el mapa de la tarjeta ya se agranda al pasar el mouse (CSS); esto es
// para cuando eso no alcanza y para el celular, donde no hay hover: se toca la
// imagen y se abre acá, con zoom y arrastre.
//
// El zoom es por pasos y no por pinch propio: adentro del visor el scroll
// nativo hace el desplazamiento, así que alcanza con agrandar la imagen y
// dejar que el contenedor scrollee. Menos código y no pelea con el navegador.
const ZOOMS = [1, 2, 3];

function PlanoLightbox({
  src,
  alt,
  t,
  onClose,
  capa = null,
}: {
  src: string;
  alt: string;
  t: (typeof TX)[Lang];
  onClose: () => void;
  // Zona marcada en el mapa de la tarjeta (sigue marcada acá).
  capa?: ImageData | null;
}) {
  const [nivel, setNivel] = useState(0);
  const zoom = ZOOMS[nivel];

  // Escape cierra, y mientras está abierto el fondo no scrollea.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const previo = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previo;
    };
  }, [onClose]);

  // Cerrar al tocar afuera, pero SOLO si el clic fue en el vacío y no en algo
  // de adentro: el área de scroll ocupa toda la pantalla, así que sin este
  // chequeo o no cerraba nunca (si frenaba el evento) o cerraba al tocar la
  // imagen (si no lo frenaba).
  const cerrarSiEsElFondo = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  // Va al <body> y no donde está la tarjeta: la tarjeta (o alguno de sus
  // padres) tiene transform para las animaciones de apertura, y un transform
  // convierte al elemento en el marco de referencia de los `position: fixed`
  // de adentro. Sin el portal el visor quedaba encerrado en la tarjeta, del
  // tamaño de la tarjeta, en vez de ocupar la pantalla.
  return createPortal(
    <div
      className="plano-modal"
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      onClick={cerrarSiEsElFondo}
    >
      <div className="plano-bar">
        <span className="plano-ayuda">{t.plano.ayuda}</span>
        <span className="plano-acciones">
          <button
            type="button"
            className="plano-btn"
            onClick={() => setNivel((n) => Math.max(0, n - 1))}
            disabled={nivel === 0}
            aria-label={t.plano.alejar}
            title={t.plano.alejar}
          >
            −
          </button>
          <span className="plano-zoom">{zoom}×</span>
          <button
            type="button"
            className="plano-btn"
            onClick={() => setNivel((n) => Math.min(ZOOMS.length - 1, n + 1))}
            disabled={nivel === ZOOMS.length - 1}
            aria-label={t.plano.acercar}
            title={t.plano.acercar}
          >
            +
          </button>
          <button
            type="button"
            className="plano-btn plano-btn--cerrar"
            onClick={onClose}
            aria-label={t.plano.cerrar}
            title={t.plano.cerrar}
          >
            ✕
          </button>
        </span>
      </div>
      {/* El scroll del contenedor es el que permite recorrer la imagen cuando
          está acercada. Clic en la imagen = siguiente nivel (y vuelve a 1×
          cuando llegó al último), que es el gesto que se espera en celular. */}
      <div className="plano-scroll" onClick={cerrarSiEsElFondo}>
        <span className="plano-capas" style={{ width: `${zoom * 100}%` }}>
          <img
            src={src}
            alt={alt}
            className="plano-img"
            onClick={() => setNivel((n) => (n + 1) % ZOOMS.length)}
          />
          <CapaFoco capa={capa} className="plano-foco" />
        </span>
      </div>
    </div>,
    document.body
  );
}

// Botón del mapa mundial de eventos (header de la tienda).
function MapaNavLink({ label }: { label: string }) {
  return (
    <Link className="mapa-nav" href="/mapa" title={label} aria-label={label}>
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M12 21s-6-5.2-6-10a6 6 0 1 1 12 0c0 4.8-6 10-6 10Z" />
        <circle cx="12" cy="11" r="2.3" />
      </svg>
    </Link>
  );
}

function WcLogo({ comp }: { comp: string | null }) {
  if (!isWC(comp)) return null;
  return (
    <span className="wc-logo" title="World Cup" role="img" aria-label="World Cup">
      🏆
    </span>
  );
}

function Foot({ lang }: { lang: Lang }) {
  const t = TX[lang];
  return (
    <footer className="foot foot--legal">
      <span>TicketMirror</span>
      <span>{t.footSync}</span>
      <LegalLinks lang={lang} />
    </footer>
  );
}

// ---- fila de sector dentro de la card ----------------------------------------
// La acción agrega la entrada al carrito (pedido si tiene precio/stock,
// consulta si no). El cliente junta varias y las envía todas juntas desde la
// barra del carrito; recién ahí se crean las operaciones y se avisa a los
// vendedores.
function LadderRow({
  u,
  ev,
  lang,
  foco = false,
  onFoco,
}: {
  u: Ticket;
  ev: EventoAgrupado;
  lang: Lang;
  // La zona de este sector está marcada en el mapa.
  foco?: boolean;
  // Solo si el mapa tiene el color de la zona (ver useFocoMapa).
  onFoco?: () => void;
}) {
  const t = TX[lang];
  const cart = useCart();
  const hasPrice = u.precio_final != null && Number(u.precio_final) > 0;
  const moneda = u.moneda_venta ?? "USD";
  const precio = hasPrice ? fmtPrice(u.precio_final, lang, moneda) : null;
  const stk = u.stock ?? 0;
  const bookable = stk > 0 && u.estado === "book" && hasPrice;
  const low = stk > 0 && stk <= 2;
  const sector = u.categoria || t.entradaGeneral;
  // Zona del mapa a la que pertenece este sector: el mapa ya viene con las
  // zonas pintadas, así que alcanza con decir cuál mirar.
  const zona = zonaDelMapa(u.zona_color);
  const tipo: "pedido" | "consulta" = bookable ? "pedido" : "consulta";
  const item = cart.items.find((i) => i.key === u.id);
  const inCart = !!item;
  // Precio unitario redondeado, igual que el que se muestra (fmtPrice usa
  // round): lo guardado debe coincidir con lo que vio el cliente, no truncar.
  const unit = bookable && hasPrice ? Math.round(Number(u.precio_final)) : 0;

  function agregar() {
    cart.add({
      key: u.id,
      ticket_id: u.id,
      evento: ev.evento,
      comp: ev.comp,
      sector,
      monto: unit,
      moneda,
      cantidad: 1,
      // Solo los pedidos con stock permiten más de una; el stepper se topea acá.
      maxStock: bookable ? stk : 0,
      tipo,
      fecha_evento: ev.fecha ? ev.fecha.slice(0, 10) : null,
    });
  }

  return (
    <li className={`seat ${bookable ? "" : "seat--req"}`}>
      <span className="seat-name">
        {sector}
        {zona && onFoco ? (
          // El mapa tiene este color: el chip marca la zona en el mapa.
          <button
            type="button"
            className={`seat-zona seat-zona--foco ${zona.texto ? "" : "seat-zona--solo"}`}
            onClick={onFoco}
            aria-pressed={foco}
            title={foco ? t.mapaFoco.quitar : t.mapaFoco.ver}
            aria-label={`${foco ? t.mapaFoco.quitar : t.mapaFoco.ver}: ${zona.texto ?? sector}`}
          >
            {zona.color && (
              <i className="seat-zona-dot" style={{ background: zona.color }} aria-hidden />
            )}
            {zona.texto}
            <span className="seat-zona-ver" aria-hidden>
              {foco ? "✕" : "⌖"}
            </span>
          </button>
        ) : (
          zona && (
            // Sin nombre de zona (el portal mandó un hexa) el chip es solo el
            // círculo, y más grande: lo que sirve es comparar el color con el
            // mapa, no leer "#E4572E".
            <span
              className={`seat-zona ${zona.texto ? "" : "seat-zona--solo"}`}
              title={`${t.zonaMapa}: ${zona.texto ?? zona.crudo}`}
              aria-label={`${t.zonaMapa}: ${zona.texto ?? zona.crudo}`}
            >
              {zona.color && (
                <i className="seat-zona-dot" style={{ background: zona.color }} aria-hidden />
              )}
              {zona.texto}
            </span>
          )
        )}
      </span>
      <span className="seat-price">{precio ?? <span className="consult">{t.consultar}</span>}</span>
      <span className="seat-stat">
        {stk > 0 ? (
          <>
            <i className={`dot ${low ? "low" : "ok"}`} />
            {low ? t.quedan(stk) : t.lugares(stk)}
          </>
        ) : u.stock == null && u.estado === "on_request" ? (
          // Stock desconocido (a pedido), no agotado: "sin cupo" espantaba
          // consultas por entradas que sí se pueden conseguir.
          <>
            <i className="dot req" />
            {t.aPedido}
          </>
        ) : (
          <>
            <i className="dot req" />
            {t.sinCupo}
          </>
        )}
      </span>
      {!inCart ? (
        <button
          type="button"
          className={`seat-act ${bookable ? "go" : "ask"}`}
          onClick={agregar}
          data-sin-wa
        >
          {bookable ? t.pedir : t.consultar}
        </button>
      ) : bookable ? (
        // En el carrito: stepper de cantidad topeado por el stock del sector.
        <span className="seat-qty" role="group" aria-label={t.carrito.cantidad} data-sin-wa>
          <button
            type="button"
            onClick={() => cart.setQty(u.id, (item?.cantidad ?? 1) - 1)}
            aria-label={t.carrito.menos}
          >
            −
          </button>
          <span className="seat-qty-n" aria-live="polite">
            {item?.cantidad ?? 1}
          </span>
          <button
            type="button"
            onClick={() => cart.setQty(u.id, (item?.cantidad ?? 1) + 1)}
            disabled={stk > 0 && (item?.cantidad ?? 1) >= stk}
            aria-label={t.carrito.mas}
          >
            +
          </button>
        </span>
      ) : (
        <button type="button" className="seat-act done" onClick={() => cart.remove(u.id)} data-sin-wa>
          {t.agregado}
        </button>
      )}
    </li>
  );
}

// ---- card de evento (talón) ----------------------------------------------------
function TicketCardBase({
  ev,
  i,
  lang,
  defaultOpen = false,
}: {
  ev: EventoAgrupado;
  i: number;
  lang: Lang;
  defaultOpen?: boolean;
}) {
  const t = TX[lang];
  const [open, setOpen] = useState(defaultOpen);
  // Los sectores (y el mapa) se dibujan recién la primera vez que se abre la
  // card: cerradas son la mayoría y así la lista pesa mucho menos. Después
  // quedan montados para que cerrar anime igual que antes.
  const [abierta, setAbierta] = useState(defaultOpen);
  if (open && !abierta) setAbierta(true);
  const [shared, setShared] = useState(false);
  // Mapa de sectores abierto a pantalla completa.
  const [plano, setPlano] = useState(false);
  const rollRef = useRef<HTMLDivElement>(null);
  // Zona marcada en el mapa (hexa del sector tocado) y qué zonas se pueden
  // marcar: el mapa se analiza recién cuando la tarjeta se abre.
  const [foco, setFoco] = useState<string | null>(null);
  const mapaRef = useRef<HTMLButtonElement>(null);
  const focoMapa = useFocoMapa(
    ev.imagen,
    ev.ubicaciones.map((u) => u.zona_color ?? ""),
    abierta
  );
  const capa = focoMapa.capa(foco);
  function tocarZona(hex: string) {
    const nuevo = foco === hex ? null : hex;
    setFoco(nuevo);
    // Que el mapa se vea: en el celular suele quedar arriba, fuera de pantalla.
    const mapa = mapaRef.current;
    if (!nuevo || !mapa) return;
    // En tablet y escritorio el header y la barra de filtros quedan pegados
    // arriba: si el mapa está (aunque sea en parte) debajo de ellos, se baja
    // justo lo necesario para que quede entero a la vista.
    const tope = altoPegadoArriba();
    const r = mapa.getBoundingClientRect();
    if (tope > 0 && r.top < tope + 8) window.scrollBy({ top: r.top - tope - 8, behavior: "smooth" });
    else mapa.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
  const { title, context } = parseTitle(ev.evento, ev.comp);
  const date = fmtDate(ev.fecha, lang);
  const n = ev.ubicaciones.length;
  // N.º de talón (cosmético): primer segmento del id del portal, o el uuid
  // para las propias (antes esas mostraban literalmente "N.º manual").
  const segs = (ev.ubicaciones[0]?.id || "").split("::");
  const code = (segs[0] === "manual" ? segs[1] ?? "" : segs[0])
    .replace(/-/g, "")
    .slice(0, 6)
    .padStart(6, "0")
    .toUpperCase();

  useEffect(() => {
    const roll = rollRef.current;
    if (!roll) return;
    if (open) {
      roll.style.maxHeight = roll.scrollHeight + "px";
      // Terminada la animación, sin tope: lo que crezca después (el mapa que
      // carga, los chips que pasan a "Ver en el mapa", el stepper del carrito)
      // tiene que verse entero. Con el alto fijo, la última fila quedaba
      // cortada en el celular.
      const fin = (e: TransitionEvent) => {
        if (e.target === roll && e.propertyName === "max-height" && roll.style.maxHeight !== "0px") {
          roll.style.maxHeight = "none";
        }
      };
      roll.addEventListener("transitionend", fin);
      return () => roll.removeEventListener("transitionend", fin);
    }
    // Para animar el cierre desde "none" primero hay que volver a un alto en
    // px (de "none" a 0 no hay transición).
    if (roll.style.maxHeight === "none") {
      roll.style.maxHeight = roll.scrollHeight + "px";
      void roll.offsetHeight;
    }
    roll.style.maxHeight = "0px";
    setFoco(null);
  }, [open]);

  async function share() {
    // Link profundo al evento puntual: el catálogo lo abre filtrado y con la
    // card desplegada (antes se compartía /buscar a secas y el que recibía
    // caía en la cartelera completa sin saber cuál era). Va también la
    // competición: los eventos se agrupan por (competición, evento) y dos
    // torneos pueden repetir el mismo nombre de partido.
    const url = `${location.origin}/buscar?ev=${encodeURIComponent(ev.evento)}&c=${encodeURIComponent(ev.comp)}`;
    const data = { title: "TicketMirror", text: t.shareText(title), url };
    try {
      if (navigator.share) await navigator.share(data);
      else {
        await navigator.clipboard.writeText(url);
        setShared(true);
        setTimeout(() => setShared(false), 1500);
      }
    } catch {}
  }

  return (
    <article
      className={`ticket ${ev.bookable ? "is-live" : ""} ${open ? "open" : ""}`}
      style={{ "--i": Math.min(i, 12) } as React.CSSProperties}
    >
      <div className="ticket-body">
        <div className="ticket-top">
          <div className="top-left">
            <span className={`flag flag--${badgeEvento(ev)}`}>{t.badge[badgeEvento(ev)]}</span>
            {ev.propias && <span className="own">{t.nuestra}</span>}
            <WcLogo comp={ev.comp} />
            <span className="eyebrow">{context || ev.comp}</span>
          </div>
          <span className="cal">
            <b>{date.d}</b>
            <span>{date.m}</span>
          </span>
        </div>
        <h3 className="match">{title}</h3>
        <p className="where">
          {ev.ciudad ? "◓ " + ev.ciudad : t.sedeTBC} · {date.full}
        </p>
        <div className="ticket-actions">
          <button className="reveal" aria-expanded={open} onClick={() => setOpen(!open)}>
            <span className="reveal-txt">{open ? t.ocultarUbic : t.verUbic(n)}</span>
            <span className="reveal-ic" aria-hidden>
              ▼
            </span>
          </button>
          <button className="share" title="Share" onClick={share}>
            {shared ? "✓" : "↗"}
          </button>
        </div>
        <div className="roll-wrap" ref={rollRef} style={{ maxHeight: 0 }}>
          <span className="scroll-rod" aria-hidden />
          {abierta && ev.imagen && (
            // Botón y no <img> suelta: se abre con el dedo en celular y con
            // Enter en teclado. En PC además crece al pasar el mouse (CSS),
            // que para la mayoría de los mapas ya alcanza.
            <button
              ref={mapaRef}
              type="button"
              className={`mapa-wrap ${capa ? "has-foco" : ""}`}
              onClick={() => setPlano(true)}
              aria-label={t.plano.abrir}
              title={t.plano.abrir}
            >
              <span className="mapa-capas">
              <img
                src={ev.imagen}
                alt={`${title} — seating map`}
                loading="lazy"
                className="mapa-sectores"
                // La animación de despliegue fija maxHeight con el alto medido
                // al abrir; si la imagen (lazy) carga después, el contenido
                // crecería recortado. Al cargar, re-medimos.
                onLoad={() => {
                  const roll = rollRef.current;
                  if (roll && open && roll.style.maxHeight !== "none") roll.style.maxHeight = roll.scrollHeight + "px";
                }}
              />
              <CapaFoco capa={capa} className="mapa-foco" />
              </span>
              <span className="mapa-lupa" aria-hidden>
                ⤢
              </span>
            </button>
          )}
          {plano && ev.imagen && (
            <PlanoLightbox
              src={ev.imagen}
              alt={`${title} — seating map`}
              t={t}
              onClose={() => setPlano(false)}
              capa={capa}
            />
          )}
          {abierta && (
            <ul className="ladder">
              {ev.ubicaciones.map((u) => (
                <LadderRow
                  key={u.id}
                  u={u}
                  ev={ev}
                  lang={lang}
                  foco={!!foco && foco.toUpperCase() === (u.zona_color ?? "").trim().toUpperCase()}
                  onFoco={
                    focoMapa.puede(u.zona_color) ? () => tocarZona((u.zona_color ?? "").trim()) : undefined
                  }
                />
              ))}
            </ul>
          )}
          <span className="scroll-curl" aria-hidden />
        </div>
      </div>
      <aside className="ticket-stub">
        <span className="stub-label">{ev.minPrice != null ? t.desde : t.precio}</span>
        <span className={`stub-price ${ev.minPrice == null ? "is-consult" : ""}`}>
          {ev.minPrice != null ? fmtPrice(ev.minPrice, lang, ev.minMoneda) : t.consultar}
        </span>
        <span className="stub-meta">
          {t.ubicaciones(n)}
          {ev.bookable ? t.conStock(ev.bookable) : ""}
        </span>
        <span className="barcode" aria-hidden />
        <span className="stub-code">N.º {code}</span>
      </aside>
    </article>
  );
}

// Memo: al filtrar, las cards que siguen en la lista no se vuelven a dibujar.
const TicketCard = memo(TicketCardBase);

// =============================== HOME ==========================================
export function StorefrontHome({ resumen }: { resumen: ResumenHome }) {
  const router = useRouter();
  const [lang, setLang] = useLang();
  const t = TX[lang];
  // Calculado en el server (lib/resumen-home.ts): no viaja el catálogo entero.
  const { totalEv, totalStock, populares, topCats } = resumen;

  if (!totalEv) return <div className="splash">No events yet.</div>;

  return (
    <>
      <header className="masthead masthead--home">
        <div className="toprow">
          <Wordmark />
          <div className="mast-right">
            <LangToggle lang={lang} onChange={setLang} />
            <MapaNavLink label={t.mapa.nav} />
            <Campana lang={lang} />
            <Link className="lp-nav-login" href="/mis-pedidos">
              {t.lp.navPedidos}
            </Link>
            <Link className="lp-nav-login" href="/cuenta">
              {t.lp.navCuenta}
            </Link>
          </div>
        </div>
        <div className="hero hero--home">
          <h1>
            {t.heroTitle1}
            <br />
            <span>{t.heroTitle2}</span>
          </h1>
          <p>{t.heroP}</p>
          <div className="cta-row">
            <Link className="btn-primary" href="/buscar">
              {t.ctaSearch}
            </Link>
            <a
              className="btn-ghost"
              href={waLink(t.waFloatMsg)}
              target="_blank"
              rel="noopener noreferrer"
            >
              {t.ctaWhatsapp}
            </a>
            <span className="stat">
              <b>{totalEv}</b> {t.statEventos}
            </span>
            <span className="stat">
              <b>{totalStock}</b> {t.statStock}
            </span>
          </div>
        </div>
      </header>

      <section className="block">
        <div className="section-h">
          <span className="sh-eyebrow">{t.proximosEyebrow}</span>
          <h2>{t.proximosH2}</h2>
          <p>{t.proximosP}</p>
        </div>
        <ol className="rank">
          {populares.map((ev, idx) => {
            const { title } = parseTitle(ev.evento, ev.comp);
            const date = fmtDate(ev.fecha, lang);
            return (
              <li
                key={ev.comp + ev.evento}
                className="rank-item"
                style={{ "--i": idx } as React.CSSProperties}
                onClick={() => {
                  empezarNavegacion();
                  router.push(`/buscar?q=${encodeURIComponent(ev.evento)}`);
                }}
              >
                <div className="rank-main">
                  <span className="rank-eyebrow">
                    <span className={`flag flag--${badgeEvento(ev)}`}>{t.badge[badgeEvento(ev)]}</span>
                    <WcLogo comp={ev.comp} />
                    {ev.propias && <span className="own">{t.nuestra}</span>}
                    {ev.comp}
                  </span>
                  <h3 className="rank-title">{title}</h3>
                  <span className="rank-meta">
                    {date.d} {date.m} {date.y} · {ev.lugar}
                  </span>
                </div>
                <div className="rank-aside">
                  {/* Sin stock el badge ya dice "a consultar": no se repite acá,
                      y sin el span vacío no queda un hueco en el celular. */}
                  {ev.bookStock > 0 && (
                    <span className="rank-stock">
                      {ev.bookStock} <small>{t.entradasRank}</small>
                    </span>
                  )}
                  <span className="rank-price">
                    {ev.minPrice != null
                      ? t.desdeMayus + " " + fmtPrice(ev.minPrice, lang, ev.minMoneda)
                      : t.aConsultar}
                  </span>
                </div>
                <a
                  className="rank-act"
                  href={waLink(
                    ev.bookStock > 0
                      ? t.msgReservarRank(ev.evento, eventoLink(ev.evento, ev.comp))
                      : t.msgConsultarRank(ev.evento, eventoLink(ev.evento, ev.comp))
                  )}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                >
                  {ev.bookStock > 0 ? t.reservar : t.consultar}
                </a>
              </li>
            );
          })}
        </ol>
      </section>

      <section className="block">
        <div className="section-h">
          <span className="sh-eyebrow">{t.exploraEyebrow}</span>
          <h2>{t.exploraH2}</h2>
        </div>
        <div className="catstrip">
          {topCats.map(([c, count]) => (
            <Link key={c} className="catlink" href={`/buscar?cat=${encodeURIComponent(c)}`}>
              {c}
              <small>{count}</small>
            </Link>
          ))}
          <Link className="catlink catlink--all" href="/buscar">
            {t.verTodo}
            <small>{totalEv}</small>
          </Link>
        </div>
      </section>

      <section className="block">
        <div className="section-h">
          <span className="sh-eyebrow">{t.comoEyebrow}</span>
          <h2>{t.comoH2}</h2>
        </div>
        <div className="steps">
          {t.pasos.map(([tt, d], i) => (
            <div className="step" key={tt}>
              <span className="step-n">{i + 1}</span>
              <h3>{tt}</h3>
              <p>{d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="block">
        <div className="section-h">
          <span className="sh-eyebrow">{t.porqueEyebrow}</span>
          <h2>{t.porqueH2}</h2>
        </div>
        <div className="cards3">
          {t.porque.map(([tt, d]) => (
            <div className="card3" key={tt}>
              <h3>{tt}</h3>
              <p>{d}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="block">
        <div className="section-h">
          <span className="sh-eyebrow">{t.dudasEyebrow}</span>
          <h2>{t.dudasH2}</h2>
        </div>
        <div className="faq">
          {t.faqs.map(([q, a]) => (
            <details className="faq-item" key={q}>
              <summary>{q}</summary>
              <p>{a}</p>
            </details>
          ))}
        </div>
      </section>

      <section className="cta-band">
        <div>
          <h2>{t.ctaBandH2}</h2>
          <p>{t.ctaBandP}</p>
        </div>
        <a
          className="btn-primary"
          href={waLink(t.msgBuscoEvento)}
          target="_blank"
          rel="noopener noreferrer"
        >
          {t.ctaBandBtn}
        </a>
      </section>

      <Foot lang={lang} />
    </>
  );
}

// =============================== CATÁLOGO ======================================
// `evento` es el link profundo compartido (?ev=): match exacto de un evento,
// tiene prioridad sobre el resto de los filtros y se limpia al tocar cualquier
// filtro. Vacío = navegación normal.
type FilterState = { cat: string; lugar: string; mes: string; q: string; evento: string; comp: string };

function uniqueOptions(
  events: EventoAgrupado[],
  getter: (e: EventoAgrupado) => { key: string; label: string },
  alfabetico: boolean
) {
  const counts = new Map<string, { label: string; key: string; n: number }>();
  for (const ev of events) {
    const v = getter(ev);
    counts.set(v.key, { label: v.label, key: v.key, n: (counts.get(v.key)?.n || 0) + 1 });
  }
  let arr = Array.from(counts.values());
  // Categorías y lugares: A–Z (pedido del cliente). Las fechas se ordenan por
  // su clave (YYYY-MM): cronológico, que es lo que se espera en un menú de meses.
  arr = alfabetico
    ? arr.sort((a, b) => compararAZ(a.label, b.label))
    : arr.sort((a, b) => a.key.localeCompare(b.key));
  return arr.map((a) => ({ value: a.key, label: `${a.label} (${a.n})` }));
}

// A nivel módulo (no adentro del render): definido adentro, React lo veía
// como un componente NUEVO en cada render y remontaba los <select>,
// perdiendo el foco mientras se tipeaba en el buscador.
function Select({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  // Mismos elementos mientras no cambien las opciones: React no vuelve a
  // recorrer los cientos de <option> en cada tecla del buscador.
  const opciones = useMemo(
    () =>
      options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      )),
    [options]
  );
  return (
    <label className="sel">
      <span>{label}</span>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {opciones}
      </select>
    </label>
  );
}

export function StorefrontCatalog({ catalogo }: { catalogo: CatalogoCompacto }) {
  const params = useSearchParams();
  const [lang, setLang] = useLang();
  const t = TX[lang];
  // El catálogo viaja empaquetado (lib/catalogo-compacto.ts) y se arma acá una
  // vez: los filtros corren en el navegador, sin volver a pedirle nada al server.
  const events = useMemo(
    () => buildEvents(desempacarCatalogo<Ticket>(catalogo)),
    [catalogo]
  );
  const [state, setState] = useState<FilterState>({
    cat: params.get("cat") || "*",
    lugar: params.get("lugar") || "*",
    mes: params.get("mes") || "*",
    q: params.get("q") || "",
    evento: params.get("ev") || "",
    comp: params.get("c") || "",
  });

  // Los filtros responden al toque (selects e input usan `state`) y la lista
  // se recalcula con la versión diferida: React la arma en segundo plano y
  // la descarta si llega otra tecla, así escribir no se traba en el celular.
  const filtro = useDeferredValue(state);
  const filtered = useMemo(() => {
    const out = events.filter((ev) => {
      // Link compartido: solo ese evento (y su competición, si vino en el
      // link: dos torneos pueden repetir nombre de partido).
      if (filtro.evento) {
        return ev.evento === filtro.evento && (!filtro.comp || ev.comp === filtro.comp);
      }
      if (filtro.cat !== "*" && ev.comp !== filtro.cat) return false;
      if (filtro.lugar !== "*" && ev.lugar !== filtro.lugar) return false;
      if (filtro.mes !== "*" && ev.mes !== filtro.mes) return false;
      if (filtro.q) {
        const q = filtro.q.toLowerCase();
        const hit =
          ev.evento.toLowerCase().includes(q) ||
          (ev.ciudad || "").toLowerCase().includes(q) ||
          ev.ubicaciones.some((u) => (u.categoria || "").toLowerCase().includes(q));
        if (!hit) return false;
      }
      return true;
    });
    out.sort((a, b) => {
      if (!!a.bookable !== !!b.bookable) return b.bookable - a.bookable;
      const da = a.fecha ? Date.parse(a.fecha) : Infinity;
      const db = b.fecha ? Date.parse(b.fecha) : Infinity;
      return da - db;
    });
    return out;
  }, [events, filtro]);

  // Se muestran los primeros 30 y "Ver más" agrega otros 30: la cartelera
  // tiene cientos de eventos y dibujarlos todos traba el celular. Filtrar no
  // le pide nada al server (todo está en `events`).
  const TANDA = 30;
  const [mostrar, setMostrar] = useState(TANDA);
  // Al cambiar cualquier filtro se vuelve a la primera tanda.
  useEffect(() => {
    setMostrar(TANDA);
  }, [state.cat, state.lugar, state.mes, state.q, state.evento]);

  // Detalle de un evento (link /buscar?ev=…): el WhatsApp flotante ya sale
  // con el nombre y la fecha.
  const abierto = state.evento ? filtered.find((ev) => ev.evento === state.evento) : undefined;
  useContextoWhatsApp(
    abierto ? { tipo: "evento", nombre: abierto.evento, fecha: abierto.fecha ?? null } : null
  );

  // Link compartido: centrar la card del evento apenas se abre la página.
  // (La card ya viene desplegada por defaultOpen.)
  useEffect(() => {
    if (!state.evento) return;
    const t = setTimeout(() => {
      document
        .querySelector(".feed .ticket")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 120);
    return () => clearTimeout(t);
  }, [state.evento]);

  const visible = filtered.slice(0, mostrar);
  const quedan = filtered.length - visible.length;

  // Memo: armar y ordenar las opciones (orden alfabético con acentos) sobre
  // cientos de eventos en CADA tecla era buena parte de lo que trababa el buscador.
  const { catOpts, lugarOpts, mesOpts } = useMemo(
    () => ({
      catOpts: [
        { value: "*", label: t.todasCategorias },
        ...uniqueOptions(events, (e) => ({ key: e.comp, label: e.comp }), true),
      ],
      lugarOpts: [
        { value: "*", label: t.todosLugares },
        ...uniqueOptions(events, (e) => ({ key: e.lugar, label: e.lugar }), true),
      ],
      // El label del mes se arma acá (no en buildEvents) para que siga el idioma.
      mesOpts: [
        { value: "*", label: t.todasFechas },
        ...uniqueOptions(events, (e) => ({ key: e.mes, label: mesLabelLang(e.mes, lang) }), false),
      ],
    }),
    [events, lang, t]
  );
  const filtrando =
    state.cat !== "*" || state.lugar !== "*" || state.mes !== "*" || !!state.q || !!state.evento;

  return (
    <>
      <header className="masthead masthead--cat">
        <div className="toprow">
          <Wordmark />
          <div className="mast-right">
            <LangToggle lang={lang} onChange={setLang} />
            <MapaNavLink label={t.mapa.nav} />
            <Campana lang={lang} />
            <Link className="lp-nav-login" href="/mis-pedidos">
              {t.lp.navPedidos}
            </Link>
            <Link className="lp-nav-login" href="/cuenta">
              {t.lp.navCuenta}
            </Link>
            <Link className="back" href="/entradas">
              {t.backHome}
            </Link>
          </div>
        </div>
      </header>

      <div className="bar">
        <div className="filters">
          {/* Tocar un filtro libera el link compartido (evento: "") para
              volver a la navegación normal. */}
          <Select
            id="f-cat"
            label={t.fCategoria}
            value={state.cat}
            options={catOpts}
            onChange={(v) => setState((s) => ({ ...s, cat: v, evento: "", comp: "" }))}
          />
          <Select
            id="f-lugar"
            label={t.fLugar}
            value={state.lugar}
            options={lugarOpts}
            onChange={(v) => setState((s) => ({ ...s, lugar: v, evento: "", comp: "" }))}
          />
          <Select
            id="f-mes"
            label={t.fFecha}
            value={state.mes}
            options={mesOpts}
            onChange={(v) => setState((s) => ({ ...s, mes: v, evento: "", comp: "" }))}
          />
        </div>
        <input
          className="search"
          type="search"
          placeholder={t.buscarPlaceholder}
          value={state.q}
          onChange={(e) => setState((s) => ({ ...s, q: e.target.value, evento: "", comp: "" }))}
        />
      </div>

      <div className="result-line">
        <b>{filtered.length}</b> {t.eventos(filtered.length)}
        {quedan > 0 && <span className="range">{t.mostrando(1, visible.length)}</span>}
        {filtrando && (
          <button
            className="clear"
            onClick={() => setState({ cat: "*", lugar: "*", mes: "*", q: "", evento: "", comp: "" })}
          >
            {t.limpiar}
          </button>
        )}
      </div>

      <main className="feed">
        {filtered.length ? (
          visible.map((ev, i) => (
            <TicketCard
              key={ev.comp + ev.evento}
              ev={ev}
              i={Math.min(i, 12)}
              lang={lang}
              defaultOpen={
                !!state.evento &&
                ev.evento === state.evento &&
                (!state.comp || ev.comp === state.comp)
              }
            />
          ))
        ) : (
          // Sin resultados: el WhatsApp es LA salida, así que va como botón
          // (antes era un link en el texto y no se notaba que se podía tocar).
          <div className="empty">
            <p>{t.vacio1}</p>
            <p className="empty-sub">{t.vacio2}</p>
            <a
              className="empty-wa"
              href={waLink(t.msgBuscoEvento)}
              target="_blank"
              rel="noopener noreferrer"
            >
              <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.1l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.1-1.2l-.4-.3Z" />
              </svg>
              {t.vacioLink}
            </a>
          </div>
        )}
      </main>

      {quedan > 0 && (
        <div className="pager">
          <button className="pager-btn ver-mas" onClick={() => setMostrar((m) => m + TANDA)}>
            {t.verMas(quedan)}
          </button>
        </div>
      )}

      <Foot lang={lang} />
    </>
  );
}
