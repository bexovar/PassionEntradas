"use client";

// Carrusel de eventos de la home (TKT-12): tarjetas tipo ticket (foto 4:3
// arriba, talón perforado abajo) en una pista con scroll-snap. En el celular
// se desliza con el dedo; en escritorio hay flechas. Sin autoplay. Curado a
// mano desde el panel; sin precio, stock ni disponibilidad (lib/carrusel).
//
// Tocar una tarjeta abre el modal de solicitud de acceso: el visitante está
// deslogueado y en el evento no podría ver nada, así que la curiosidad
// desemboca en el formulario. Con sesión, la tarjeta lleva a la tienda.

import { useEffect, useRef, useState } from "react";
import { TX, type Lang } from "@/lib/tienda-i18n";
import { mesLegible, type TarjetaCarrusel } from "@/lib/carrusel";

export function CarruselEventos({
  tarjetas,
  lang,
  logueado,
  onSolicitar,
}: {
  tarjetas: TarjetaCarrusel[];
  lang: Lang;
  logueado: boolean;
  onSolicitar: () => void;
}) {
  const lp = TX[lang].lp;
  const pista = useRef<HTMLUListElement>(null);
  const [activa, setActiva] = useState(0);
  const [bordes, setBordes] = useState({ inicio: true, fin: false });
  const total = tarjetas.length + 1; // + la tarjeta de cierre

  // Qué tarjeta está al frente (para los puntitos) y si se puede seguir
  // avanzando para cada lado (para apagar las flechas).
  useEffect(() => {
    const el = pista.current;
    if (!el) return;
    function medir() {
      if (!el) return;
      const paso = (el.firstElementChild as HTMLElement | null)?.offsetWidth ?? el.clientWidth;
      setActiva(Math.min(total - 1, Math.round(el.scrollLeft / Math.max(1, paso))));
      setBordes({
        inicio: el.scrollLeft <= 4,
        fin: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4,
      });
    }
    medir();
    el.addEventListener("scroll", medir, { passive: true });
    window.addEventListener("resize", medir);
    return () => {
      el.removeEventListener("scroll", medir);
      window.removeEventListener("resize", medir);
    };
  }, [total]);

  function mover(dir: 1 | -1) {
    const el = pista.current;
    if (!el) return;
    const paso = (el.firstElementChild as HTMLElement | null)?.offsetWidth ?? el.clientWidth;
    const gap = parseFloat(getComputedStyle(el).columnGap) || 0;
    const suave = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollBy({ left: dir * (paso + gap), behavior: suave ? "smooth" : "auto" });
  }

  if (tarjetas.length === 0) return null;

  // La tarjeta entera es el botón (o el link, con sesión). Función de render,
  // no componente: así las tarjetas no se remontan al deslizar.
  function accion(label: string, children: React.ReactNode) {
    return logueado ? (
      <a className="lp-cc-accion" href="/entradas" aria-label={label} data-sin-wa>
        {children}
      </a>
    ) : (
      <button type="button" className="lp-cc-accion" onClick={onSolicitar} aria-label={label} data-sin-wa>
        {children}
      </button>
    );
  }

  return (
    <section className="block lp-carrusel" aria-roledescription="carousel" aria-label={lp.carruselH2}>
      <div className="section-h lp-carrusel-h">
        <div>
          <span className="sh-eyebrow">{lp.carruselEyebrow}</span>
          <h2>{lp.carruselH2}</h2>
        </div>
        <div className="lp-carrusel-flechas">
          <button type="button" onClick={() => mover(-1)} disabled={bordes.inicio} aria-label={lp.carruselAnterior}>
            ←
          </button>
          <button type="button" onClick={() => mover(1)} disabled={bordes.fin} aria-label={lp.carruselSiguiente}>
            →
          </button>
        </div>
      </div>

      <ul className="lp-carrusel-pista" ref={pista}>
        {tarjetas.map((t, i) => {
          const m = mesLegible(t.mes, lang);
          const label = `${t.nombre} · ${t.categoria} · ${m.completo}. ${logueado ? lp.irEntradas : lp.carruselTocar}`;
          return (
            <li className="lp-cc" key={t.id} aria-label={`${i + 1} / ${total}`}>
              {accion(
                label,
                <>
                  <span className="lp-cc-foto">
                    {/* Todas recortadas igual (4:3, ya encuadradas en el panel). */}
                    {t.imagen_url && (
                      <img className="lp-cc-img" src={t.imagen_url} alt="" loading={i < 3 ? "eager" : "lazy"} />
                    )}
                  </span>
                  <span className="lp-cc-stub">
                    <span className="cal" aria-hidden>
                      <b>{m.mes}</b>
                      <span>{m.anio}</span>
                    </span>
                    <span className="lp-cc-txt">
                      <span className="lp-cc-comp">{t.categoria}</span>
                      <span className="lp-cc-nombre">{t.nombre}</span>
                    </span>
                  </span>
                </>
              )}
            </li>
          );
        })}
        <li className="lp-cc lp-cc--cierre">
          <p>{lp.carruselCierre}</p>
          {logueado ? (
            <a className="btn-primary" href="/entradas">
              {lp.irEntradas}
            </a>
          ) : (
            <button type="button" className="btn-primary" onClick={onSolicitar}>
              {lp.nuevoBtn}
            </button>
          )}
        </li>
      </ul>

      <div className="lp-carrusel-puntos" aria-hidden>
        {Array.from({ length: total }, (_, i) => (
          <span key={i} className={i === activa ? "on" : ""} />
        ))}
      </div>
    </section>
  );
}
