"use client";

// Botón flotante de WhatsApp (TKT-9), el mismo en todo el sitio del agente:
// la home, el login, la tienda, mis pedidos y el seguimiento de un pedido.
// Abre la conversación directo, con el mensaje ya escrito según la pantalla
// (lib/whatsapp-flotante). Sin panel en el medio ni estados de "disponible":
// el canal está, y eso es lo que importa.
//
// No tapa nada:
// - la barra de pedido (CartBar) publica su alto en --tm-barra-pedido y el
//   botón sube por encima mientras está visible;
// - si queda encima de algo marcado data-sin-wa (los CTA de acceso, el envío
//   de un formulario, los botones de pedir/consultar) se aparta mientras se
//   cruzan y vuelve apenas se libera.

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { waLink } from "@/lib/tickets";
import { mensajeWa, pantallaWaDe, type ContextoWa } from "@/lib/whatsapp-flotante";

// Lo que la pantalla sabe (el evento abierto, el pedido): lo cuenta con
// useContextoWhatsApp y el botón lo lee. Un solo valor para toda la página.
let contextoActual: ContextoWa | null = null;
const oyentes = new Set<() => void>();
function setContexto(c: ContextoWa | null) {
  contextoActual = c;
  oyentes.forEach((f) => f());
}
function suscribir(f: () => void) {
  oyentes.add(f);
  return () => {
    oyentes.delete(f);
  };
}

/** Una pantalla le dice al botón de qué evento o pedido se está hablando. */
export function useContextoWhatsApp(contexto: ContextoWa | null) {
  const clave = contexto ? JSON.stringify(contexto) : "";
  useEffect(() => {
    if (!clave) return;
    setContexto(JSON.parse(clave) as ContextoWa);
    return () => setContexto(null);
  }, [clave]);
}

type Lang = "es" | "en";

// Mismo idioma que el resto del sitio (toggle EN/ES, en localStorage).
function langGuardado(): Lang {
  try {
    return localStorage.getItem("tm_lang") === "en" ? "en" : "es";
  } catch {
    return "es";
  }
}

const SIN_TAPAR = "[data-sin-wa]";

function useSinTapar(ref: React.RefObject<HTMLElement>, pathname: string) {
  useEffect(() => {
    const boton = ref.current;
    if (!boton) return;
    let raf = 0;
    function revisar() {
      raf = 0;
      if (!boton) return;
      const b = boton.getBoundingClientRect();
      const tapa = Array.from(document.querySelectorAll(SIN_TAPAR)).some((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.left < b.right && r.right > b.left && r.top < b.bottom && r.bottom > b.top;
      });
      boton.classList.toggle("wa-flotante--aparte", tapa);
    }
    const programar = () => {
      if (!raf) raf = requestAnimationFrame(revisar);
    };
    revisar();
    window.addEventListener("scroll", programar, { passive: true });
    window.addEventListener("resize", programar);
    // La página cambia de alto sin scroll (un error que aparece, la lista
    // que carga más): también se revisa.
    const ro = new ResizeObserver(programar);
    ro.observe(document.body);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("scroll", programar);
      window.removeEventListener("resize", programar);
      ro.disconnect();
    };
  }, [ref, pathname]);
}

export function WhatsAppFlotante({ contexto }: { contexto?: ContextoWa | null }) {
  const pathname = usePathname() ?? "/";
  const deLaPantalla = useSyncExternalStore(
    suscribir,
    () => contextoActual,
    () => null
  );
  const ctx = contexto ?? deLaPantalla;
  // "es" en el render del server (mismo HTML al hidratar); después, el del
  // visitante.
  const [lang, setLang] = useState<Lang>("es");
  useEffect(() => setLang(langGuardado()), [pathname]);

  const ref = useRef<HTMLAnchorElement>(null);
  useSinTapar(ref, pathname);

  const hrefDe = (l: Lang) => waLink(mensajeWa(pantallaWaDe(pathname), ctx, l));

  return (
    <a
      ref={ref}
      className="wa-flotante"
      href={hrefDe(lang)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={lang === "en" ? "Message us on WhatsApp" : "Escribinos por WhatsApp"}
      onClick={(e) => {
        // El idioma pudo cambiar en esta misma pestaña (el toggle no avisa):
        // el mensaje sale en el de ahora.
        const l = langGuardado();
        if (l !== lang) {
          setLang(l);
          e.currentTarget.href = hrefDe(l);
        }
      }}
    >
      <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {/* Globo de chat con un tubo de teléfono adentro. */}
        <path d="M20.5 11.6a8.4 8.4 0 0 1-12.4 7.4L3.5 20.5l1.6-4.4a8.4 8.4 0 1 1 15.4-4.5z" />
        <path d="M9.2 8.4c.3-.3.8-.3 1 .1l.7 1.3c.2.3.1.7-.1.9l-.5.5c.4.9 1.2 1.8 2.2 2.3l.5-.5c.3-.2.6-.3.9-.1l1.3.7c.4.2.4.7.1 1-.6.7-1.5 1-2.4.7-2.1-.7-3.7-2.4-4.4-4.4-.3-.9 0-1.8.7-2.5z" />
      </svg>
    </a>
  );
}
