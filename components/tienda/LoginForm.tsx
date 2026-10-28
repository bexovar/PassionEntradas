"use client";

// Login ÚNICO (email + contraseña + "recordar usuario") con su recuperación de
// contraseña en el mismo bloque. Lo usan la home, donde aterriza el agente que
// ya es cliente, y /ingresar, adonde redirigen el middleware y los guards.
// Según el rol se redirige a su lugar.

import { useEffect, useState, type Ref } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { getRol } from "@/lib/auth";
import { avisarActividad } from "@/lib/actividad-cliente";
import { emailRecordado, guardarRecordado } from "@/lib/recordar-usuario";
import { TX, type Lang } from "@/lib/tienda-i18n";

export function LoginForm({
  lang,
  titulo: Titulo = "h1",
  solicitarHref,
  emailRef,
}: {
  lang: Lang;
  // h1 en /ingresar (es la página); h2 en la home, donde el h1 es el hero.
  titulo?: "h1" | "h2";
  // Link a "Solicitar acceso" debajo del form. La home no lo usa: tiene su
  // propio bloque de "Nuevo usuario" al lado.
  solicitarHref?: string;
  emailRef?: Ref<HTMLInputElement>;
}) {
  const a = TX[lang].auth;

  const [modo, setModo] = useState<"login" | "reset">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [recordar, setRecordar] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetEnviado, setResetEnviado] = useState(false);

  // El email recordado se lee en el cliente (localStorage no existe en SSR).
  useEffect(() => {
    const guardado = emailRecordado(localStorage);
    if (guardado) {
      setEmail(guardado);
      setRecordar(true);
    }
  }, []);

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
    guardarRecordado(localStorage, email, recordar);
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
    <>
      <Titulo className="lp-auth-title">{modo === "login" ? a.loginTitle : a.resetTitle}</Titulo>
      <p className="lp-auth-sub">{modo === "login" ? a.loginSub : a.resetSub}</p>

      {modo === "login" ? (
        <form className="lp-auth-form" onSubmit={onSubmit} noValidate>
          <label className="lp-field">
            <span>{a.email}</span>
            <input
              ref={emailRef}
              type="email"
              name="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label className="lp-field">
            <span>{a.password}</span>
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>

          <label className="lp-consent">
            <input
              type="checkbox"
              name="recordar"
              checked={recordar}
              onChange={(e) => setRecordar(e.target.checked)}
            />
            <span>{a.remember}</span>
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
            {solicitarHref && (
              <Link className="lp-auth-link lp-auth-link--muted" href={solicitarHref}>
                {a.requestAccess}
              </Link>
            )}
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
    </>
  );
}
