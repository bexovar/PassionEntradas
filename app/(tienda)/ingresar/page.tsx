"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { LANGS, type Lang } from "@/lib/tienda-i18n";
import { LoginForm } from "@/components/tienda/LoginForm";

// Login ÚNICO y público, con la estética de la tienda. Entran staff y clientes;
// según el rol se redirige a su lugar. Incluye el reset de contraseña. El
// mismo formulario está en la home; esta página queda para las redirecciones
// del middleware y de los guards.
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

export default function IngresarPage() {
  const [lang, setLang] = useLang();

  return (
    <div className="lp-auth">
      <header className="masthead masthead--home">
        <div className="toprow">
          <Link className="wm" href="/">
            <span className="ticketmark">▚</span> TICKET<em>MIRROR</em>
          </Link>
          <LangToggle lang={lang} onChange={setLang} />
        </div>
      </header>

      <div className="lp-auth-body">
        <div className="lp-auth-card">
          <span className="lp-eyebrow">TicketMirror</span>
          {/* "/#solicitar" abre el formulario de solicitud en la home. */}
          <LoginForm lang={lang} solicitarHref="/#solicitar" />
        </div>
      </div>
    </div>
  );
}
