"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { getRol } from "@/lib/auth";
import { avisarActividad } from "@/lib/actividad-cliente";
import { LANGS, TX, type Lang } from "@/lib/tienda-i18n";

// Login ÚNICO y público, con la estética de la tienda. Entran staff y clientes;
// según el rol se redirige a su lugar. Incluye el reset de contraseña.
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
  const a = TX[lang].auth;

  const [modo, setModo] = useState<"login" | "reset">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetEnviado, setResetEnviado] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError(a.badCreds);
      setLoading(false);
      return;
    }
    const rol = data.user ? getRol(data.user) : null;
    const destino =
      rol === "administrador" ? "/admin" : rol === "moderador" ? "/moderador" : "/entradas";
    // Registro de actividad, ya con la sesión puesta y antes de navegar.
    await avisarActividad("sesion.ingreso");
    // Navegación DURA (no soft): el login vive con el CSS de la tienda y el
    // panel usa Tailwind. Un router.replace cliente cruzaba de un stylesheet a
    // otro y el panel se renderizaba sin estilos (todo enorme) hasta refrescar.
    // Con una carga completa cada destino trae su propio CSS.
    window.location.assign(destino);
  }

  async function onReset(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/recuperar`,
    });
    setLoading(false);
    if (error && !/rate|limit/i.test(error.message)) {
      setError(a.resetErr);
      return;
    }
    setResetEnviado(true);
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
          <h1>{modo === "login" ? a.loginTitle : a.resetTitle}</h1>
          <p className="lp-auth-sub">{modo === "login" ? a.loginSub : a.resetSub}</p>

          {modo === "login" ? (
            <form className="lp-auth-form" onSubmit={onSubmit} noValidate>
              <label className="lp-field">
                <span>{a.email}</span>
                <input
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
              <label className="lp-field">
                <span>{a.password}</span>
                <input
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>

              {error && <p className="lp-err">{error}</p>}

              <button className="btn-primary lp-submit" type="submit" disabled={loading}>
                {loading ? a.entering : a.enter}
              </button>

              <div className="lp-auth-links">
                <button
                  type="button"
                  className="lp-auth-link"
                  onClick={() => {
                    setModo("reset");
                    setError(null);
                  }}
                >
                  {a.forgot}
                </button>
                <Link className="lp-auth-link lp-auth-link--muted" href="/">
                  {a.requestAccess}
                </Link>
              </div>
            </form>
          ) : resetEnviado ? (
            <>
              <p className="lp-ok-msg">{a.resetSent}</p>
              <button
                type="button"
                className="btn-primary lp-submit"
                style={{ marginTop: 16 }}
                onClick={() => {
                  setModo("login");
                  setResetEnviado(false);
                }}
              >
                {a.backLogin}
              </button>
            </>
          ) : (
            <form className="lp-auth-form" onSubmit={onReset} noValidate>
              <label className="lp-field">
                <span>{a.email}</span>
                <input
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>

              {error && <p className="lp-err">{error}</p>}

              <button className="btn-primary lp-submit" type="submit" disabled={loading}>
                {loading ? a.sending : a.sendLink}
              </button>

              <div className="lp-auth-links">
                <button
                  type="button"
                  className="lp-auth-link lp-auth-link--muted"
                  onClick={() => {
                    setModo("login");
                    setError(null);
                  }}
                >
                  {a.backLogin}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
