"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { avisarActividad } from "@/lib/actividad-cliente";
import { LANGS, TX, type Lang } from "@/lib/tienda-i18n";

// Destino del link de recuperación (PKCE ?code=...): con esa sesión el usuario
// setea una contraseña nueva y entra. Estética de la tienda.
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

type Fase = "verificando" | "listo" | "invalido" | "guardando" | "ok";

export default function RecuperarPage() {
  const router = useRouter();
  const [lang, setLang] = useLang();
  const a = TX[lang].auth;

  const [fase, setFase] = useState<Fase>("verificando");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    let vivo = true;
    async function preparar() {
      const url = new URL(window.location.href);
      const code = url.searchParams.get("code");
      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (!vivo) return;
        setFase(error ? "invalido" : "listo");
        return;
      }
      const { data } = await supabase.auth.getSession();
      if (!vivo) return;
      setFase(data.session ? "listo" : "invalido");
    }
    preparar();
    return () => {
      vivo = false;
    };
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError(a.min8);
      return;
    }
    if (password !== password2) {
      setError(a.noMatch);
      return;
    }
    setFase("guardando");
    const supabase = createClient();
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setError(a.saveErr);
      setFase("listo");
      return;
    }
    // Registro de actividad (keepalive: sobrevive a la redirección).
    void avisarActividad("cuenta.clave", { via: "recuperar" });
    setFase("ok");
    setTimeout(() => {
      router.replace("/entradas");
      router.refresh();
    }, 1200);
  }

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
          <h1>{a.newTitle}</h1>

          {fase === "verificando" && <p className="lp-auth-sub">{a.verifying}</p>}

          {fase === "invalido" && (
            <>
              <p className="lp-err" style={{ marginTop: 8 }}>
                {a.linkInvalid}
              </p>
              <Link
                href="/ingresar"
                className="btn-primary lp-submit"
                style={{ marginTop: 16, display: "block", textAlign: "center" }}
              >
                {a.goLogin}
              </Link>
            </>
          )}

          {fase === "ok" && <p className="lp-ok-msg" style={{ marginTop: 8 }}>{a.done}</p>}

          {(fase === "listo" || fase === "guardando") && (
            <form className="lp-auth-form" onSubmit={onSubmit} noValidate>
              <label className="lp-field">
                <span>{a.newPass}</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
              <label className="lp-field">
                <span>{a.repeat}</span>
                <input
                  type="password"
                  autoComplete="new-password"
                  required
                  value={password2}
                  onChange={(e) => setPassword2(e.target.value)}
                />
              </label>

              {error && <p className="lp-err">{error}</p>}

              <button className="btn-primary lp-submit" type="submit" disabled={fase === "guardando"}>
                {fase === "guardando" ? a.saving : a.saveEnter}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
