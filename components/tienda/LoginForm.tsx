"use client";

// Login ÚNICO (email + contraseña + "recordar mi email") con su recuperación
// de contraseña en el mismo bloque. Lo usan la home, donde aterriza el agente
// que ya es cliente, y /ingresar, adonde redirigen el middleware y los guards.
// Al entrar vuelve al link que traía (?next=) o va al inicio de su rol.
// Cada fallo tiene su mensaje (lib/login-errores), arriba del formulario y
// sin borrar lo tipeado.

import { useEffect, useState, type Ref } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { getRol } from "@/lib/auth";
import { destinoTrasLogin, PARAM_RETORNO } from "@/lib/ruteo";
import { camposFaltantes, conSolicitud, falloDeAuth, type CamposLogin, type FalloLogin } from "@/lib/login-errores";
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
  const [faltan, setFaltan] = useState<CamposLogin>({});
  const [verPass, setVerPass] = useState(false);
  const [resetEnviado, setResetEnviado] = useState(false);

  const mensajeDe: Record<FalloLogin, string> = {
    credenciales: a.badCreds,
    revision: a.errRevision,
    inactiva: a.errInactiva,
    red: a.errRed,
  };

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
    setError(null);
    // Campos vacíos: se marca cada uno antes de ir a Auth.
    const vacios = camposFaltantes(email, password);
    setFaltan(vacios);
    if (vacios.email || vacios.password) return;
    setLoading(true);

    const fallar = (f: FalloLogin) => {
      setError(mensajeDe[f]);
      setLoading(false);
    };

    const supabase = createClient();
    let data: Awaited<ReturnType<typeof supabase.auth.signInWithPassword>>["data"];
    try {
      const r = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (r.error) {
        let fallo = falloDeAuth(r.error);
        // Sin usuario todavía: ¿pidió acceso y espera la aprobación?
        if (fallo === "credenciales") fallo = conSolicitud(fallo, await enRevision(email));
        return fallar(fallo);
      }
      data = r.data;
    } catch {
      return fallar("red");
    }

    const rol = data.user ? getRol(data.user) : null;
    // Usuario sin rol: acceso revocado o miembro del equipo desactivado. La
    // contraseña estaba bien, pero no entra a ningún lado: se cierra acá en
    // vez de dejar que el middleware lo rebote sin explicación.
    if (!rol) {
      await supabase.auth.signOut({ scope: "local" }).catch(() => {});
      return fallar("inactiva");
    }
    guardarRecordado(localStorage, email, recordar);
    const next = new URLSearchParams(window.location.search).get(PARAM_RETORNO);
    const destino = destinoTrasLogin(rol, next);
    // Registro de actividad, ya con la sesión puesta y antes de navegar.
    await avisarActividad("sesion.ingreso");
    // Navegación DURA (no soft): el login vive con el CSS de la tienda y el
    // panel usa Tailwind. Un router.replace cliente cruzaba de un stylesheet a
    // otro y el panel se renderizaba sin estilos (todo enorme) hasta refrescar.
    // Con una carga completa cada destino trae su propio CSS.
    window.location.assign(destino);
  }

  async function enRevision(mail: string): Promise<boolean> {
    try {
      const res = await fetch("/api/acceso/estado", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: mail }),
      });
      const j = await res.json().catch(() => ({}));
      return j?.enRevision === true;
    } catch {
      return false;
    }
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
          {/* El mensaje va arriba del formulario y no lo reemplaza: lo
              tipeado queda. */}
          {error && (
            <p className="lp-err" role="alert">
              {error}
            </p>
          )}
          <label className="lp-field">
            <span>{a.email}</span>
            <input
              ref={emailRef}
              type="email"
              name="email"
              autoComplete="username"
              required
              aria-invalid={faltan.email ? true : undefined}
              aria-describedby={faltan.email ? "login-email-err" : undefined}
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (faltan.email) setFaltan((f) => ({ ...f, email: undefined }));
              }}
            />
            {faltan.email && (
              <small className="lp-field-err" id="login-email-err">
                {a.errEmailVacio}
              </small>
            )}
          </label>
          <div className="lp-field">
            <label htmlFor="login-password">{a.password}</label>
            <div className="lp-pass">
              <input
                id="login-password"
                type={verPass ? "text" : "password"}
                name="password"
                autoComplete="current-password"
                required
                aria-invalid={faltan.password ? true : undefined}
                aria-describedby={faltan.password ? "login-pass-err" : undefined}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (faltan.password) setFaltan((f) => ({ ...f, password: undefined }));
                }}
              />
              <button
                type="button"
                className="lp-pass-ver"
                aria-label={verPass ? a.ocultarPassAria : a.mostrarPassAria}
                aria-pressed={verPass}
                onClick={() => setVerPass((v) => !v)}
              >
                {verPass ? a.ocultarPass : a.mostrarPass}
              </button>
            </div>
            {faltan.password && (
              <small className="lp-field-err" id="login-pass-err">
                {a.errPassVacia}
              </small>
            )}
          </div>

          <label className="lp-consent">
            <input
              type="checkbox"
              name="recordar"
              checked={recordar}
              onChange={(e) => setRecordar(e.target.checked)}
            />
            <span>{a.remember}</span>
          </label>

          <button className="btn-primary lp-submit" type="submit" disabled={loading} aria-busy={loading}>
            {loading ? a.entering : a.enter}
          </button>

          <div className="lp-auth-links">
            <button
              type="button"
              className="lp-auth-link"
              onClick={() => {
                setModo("reset");
                setError(null);
                setFaltan({});
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
