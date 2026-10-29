"use client";

// Carrusel de eventos de la home: tarjetas tipo ticket (foto arriba, talón
// perforado abajo) en una pista con scroll-snap. En el celular se desliza con
// el dedo; en escritorio hay flechas. Sin autoplay. Sin precios: las tarjetas
// llegan ya recortadas a lo que se muestra (lib/carrusel).

import { useEffect, useRef, useState } from "react";
import { fmtDate, parseTitle } from "@/lib/tickets";
import { TX, type Lang } from "@/lib/tienda-i18n";
import type { TarjetaCarrusel } from "@/lib/carrusel";

export function CarruselEventos({
  tarjetas,
  lang,
  ctaHref,
  ctaLabel,
}: {
  tarjetas: TarjetaCarrusel[];
  lang: Lang;
  ctaHref: string;
  ctaLabel: string;
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
          const f = fmtDate(t.fecha, lang);
          const { title, context } = parseTitle(t.evento, t.competicion);
          return (
            <li className="lp-cc" key={t.clave} aria-label={`${i + 1} / ${total}`}>
              <div className="lp-cc-foto">
                {/* Fondo: la misma foto desenfocada. Solo se ve si la foto no es 4:3. */}
                <img className="lp-cc-fondo" src={t.imagen} alt="" aria-hidden loading="lazy" />
                <img className="lp-cc-img" src={t.imagen} alt={title} loading={i < 3 ? "eager" : "lazy"} />
              </div>
              <div className="lp-cc-stub">
                <div className="cal" aria-label={f.full}>
                  <b>{f.d}</b>
                  <span>{f.m}</span>
                </div>
                <div className="lp-cc-txt">
                  <span className="lp-cc-comp">{t.competicion}</span>
                  <h3>{title}</h3>
                  {context && <span className="lp-cc-ctx">{context}</span>}
                  {t.ciudad && <span className="lp-cc-donde">{t.ciudad}</span>}
                </div>
              </div>
            </li>
          );
        })}
        <li className="lp-cc lp-cc--cierre">
          <p>{lp.carruselCierre}</p>
          <a className="btn-primary" href={ctaHref}>
            {ctaLabel}
          </a>
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
