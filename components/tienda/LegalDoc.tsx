"use client";

// Página de un documento legal (Términos, Privacidad, Cookies, Reembolsos,
// Aviso legal). Por ahora es un MARCADOR DE POSICIÓN: estructura y encabezados
// listos, con texto de ejemplo hasta tener la redacción final. Estética de la
// tienda, bilingüe EN/ES.

import { useEffect, useState } from "react";
import Link from "next/link";
import { LANGS, TX, type Lang } from "@/lib/tienda-i18n";
import { LegalLinks } from "./LegalLinks";
import type { LegalSlug } from "@/lib/legal";
import TicketMark from "@/components/TicketMark";

function useLang(): [Lang, (l: Lang) => void] {
  const [lang, setLang] = useState<Lang>("es");
  useEffect(() => {
    const saved = localStorage.getItem("tm_lang");
    if (saved === "en" || saved === "es") setLang(saved);
  }, []);
  function change(l: Lang) {
    setLang(l);
    localStorage.setItem("tm_lang", l);
  }
  return [lang, change];
}

export function LegalDoc({ slug }: { slug: LegalSlug }) {
  const [lang, setLang] = useLang();
  const l = TX[lang].legal;
  const doc = l.docs[slug];
  const title = doc.title;

  return (
    <>
      <header className="masthead masthead--cat">
        <div className="toprow">
          <Link className="wm" href="/">
            <TicketMark className="ticketmark" /> TICKET<em>MIRROR</em>
          </Link>
          <div className="mast-right">
            <div className="lang" role="group" aria-label="Language / Idioma">
              {LANGS.map((x) => (
                <button
                  key={x}
                  type="button"
                  className={`lang-btn ${x === lang ? "active" : ""}`}
                  onClick={() => setLang(x)}
                  aria-pressed={x === lang}
                >
                  {x.toUpperCase()}
                </button>
              ))}
            </div>
            <Link className="back" href="/">
              {l.volver}
            </Link>
          </div>
        </div>
      </header>

      <main className="legal">
        <div className="section-h">
          <span className="sh-eyebrow">{l.eyebrow}</span>
          <h2>{title}</h2>
          <p>{l.updated}</p>
        </div>

        <div className="legal-body">
          {doc.sections.map(([h, body]) => (
            <section key={h}>
              <h3>{h}</h3>
              <p>{body}</p>
            </section>
          ))}
        </div>

        <footer className="foot">
          <span>TicketMirror</span>
          <LegalLinks lang={lang} />
        </footer>
      </main>
    </>
  );
}
