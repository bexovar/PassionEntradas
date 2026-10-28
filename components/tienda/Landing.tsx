"use client";

// Landing pública (/) — la cara de TicketMirror para las agencias. El agente
// que ya es cliente entra desde acá mismo (el login está en el hero, donde
// aterriza); el que es nuevo pide su usuario con el formulario de solicitud,
// que se abre en un modal. La tienda de entradas no es pública.
// Bilingüe EN/ES (default español), mismo toggle/localStorage que la tienda.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { LANGS, TX, type Lang } from "@/lib/tienda-i18n";
import { PAISES, PAIS_DEFAULT, dialDe, nombrePais } from "@/lib/paises";
import { LegalLinks } from "@/components/tienda/LegalLinks";
import { LoginForm } from "@/components/tienda/LoginForm";

// La landing es estática, pero si el visitante ya tiene sesión mostramos
// accesos de logueado (Mi cuenta / Ver entradas) en vez de "Ingresar". Se
// chequea en el cliente para no volver dinámica toda la página.
function useLogueado(): boolean {
  const [logueado, setLogueado] = useState(false);
  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const { data } = await createClient().auth.getSession();
        if (vivo) setLogueado(!!data.session);
      } catch {
        /* sin cliente / sin sesión: se queda como visitante */
      }
    })();
    return () => {
      vivo = false;
    };
  }, []);
  return logueado;
}

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

type Estado = "idle" | "sending" | "ok" | "error";

export function Landing() {
  const [lang, setLang] = useLang();
  const lp = TX[lang].lp;
  const logueado = useLogueado();

  const emailRef = useRef<HTMLInputElement>(null);
  // <dialog> nativo: showModal() trae gratis el foco atrapado, el Esc y el
  // fondo inerte. Queda siempre montado, así cerrarlo sin querer no borra lo
  // que el usuario ya había completado.
  const modalRef = useRef<HTMLDialogElement>(null);

  function abrirSolicitud() {
    const m = modalRef.current;
    if (!m || m.open) return;
    m.showModal();
    // showModal enfoca la ×; arrancar en el primer campo es lo que se espera.
    m.querySelector<HTMLInputElement>("input[name=nombre]")?.focus();
  }

  // "/#solicitar" (el link de /ingresar, o uno compartido) abre el formulario.
  useEffect(() => {
    if (window.location.hash === "#solicitar") abrirSolicitud();
  }, []);

  // "Ingresar" del header: el login ya está en la página, solo lo enfoca.
  function irAlLogin(e: React.MouseEvent) {
    e.preventDefault();
    document.getElementById("acceso")?.scrollIntoView({ behavior: "smooth", block: "center" });
    emailRef.current?.focus({ preventScroll: true });
  }

  return (
    <>
      <header className="masthead masthead--home">
        <div className="toprow">
          <span className="wm wm--static">
            <span className="ticketmark">▚</span> TICKET<em>MIRROR</em>
          </span>
          <div className="mast-right">
            <LangToggle lang={lang} onChange={setLang} />
            {logueado ? (
              <>
                <Link className="lp-nav-login" href="/mis-pedidos">
                  {lp.navPedidos}
                </Link>
                <Link className="lp-nav-login" href="/cuenta">
                  {lp.navCuenta}
                </Link>
              </>
            ) : (
              <a className="lp-nav-login" href="#acceso" onClick={irAlLogin}>
                {lp.navIngresar}
              </a>
            )}
          </div>
        </div>

        <div className="lp-hero">
          {/* Columna de venta: corta y al grano. */}
          <div className="hero hero--home lp-hero-copy">
            <span className="lp-eyebrow">{lp.heroEyebrow}</span>
            <h1>
              {lp.heroTitle1}
              <br />
              <span>{lp.heroTitle2}</span>
            </h1>
            <p>{lp.heroP}</p>
            <ul className="lp-bullets">
              {lp.bullets.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          </div>

          {/* Bloque de acceso: ingresar primero (lo que más se usa), y abajo el
              camino del que todavía no tiene usuario. */}
          <div className="lp-hero-form" id="acceso">
            {logueado ? (
              <div className="lp-auth-card">
                <h2 className="lp-auth-title">{lp.logueadoH}</h2>
                <Link className="btn-primary lp-submit" href="/entradas">
                  {lp.irEntradas}
                </Link>
              </div>
            ) : (
              <div className="lp-auth-card lp-acceso">
                <LoginForm lang={lang} titulo="h2" emailRef={emailRef} />
                <div className="lp-nuevo">
                  <h3>{lp.nuevoH}</h3>
                  <p className="lp-cartel">
                    {lp.cartelPre}
                    <button type="button" className="lp-cartel-link" onClick={abrirSolicitud}>
                      {lp.cartelLink}
                    </button>
                    {lp.cartelPost}
                  </p>
                  <button type="button" className="btn-ghost lp-nuevo-btn" onClick={abrirSolicitud}>
                    {lp.nuevoBtn}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      <dialog
        ref={modalRef}
        className="lp-modal"
        aria-label={lp.formTitle}
        // Click en el fondo (fuera de la tarjeta) cierra, como el Esc.
        onClick={(e) => {
          if (e.target === e.currentTarget) e.currentTarget.close();
        }}
      >
        <button
          type="button"
          className="lp-modal-cerrar"
          aria-label={lp.cerrar}
          onClick={() => modalRef.current?.close()}
        >
          ×
        </button>
        <SolicitudForm lang={lang} />
      </dialog>

      {/* Cómo funciona: tres pasos, rápido. */}
      <section className="block">
        <div className="section-h">
          <span className="sh-eyebrow">{lp.comoEyebrow}</span>
          <h2>{lp.comoH2}</h2>
        </div>
        <div className="steps">
          {lp.pasos.map(([tt, d], i) => (
            <div className="step" key={tt}>
              <span className="step-n">{i + 1}</span>
              <h3>{tt}</h3>
              <p>{d}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="foot foot--legal">
        <span>TicketMirror</span>
        <span>{lp.footTagline}</span>
        <LegalLinks lang={lang} />
      </footer>
    </>
  );
}

// Formulario de solicitud de acceso (va dentro del modal).
function SolicitudForm({ lang }: { lang: Lang }) {
  const t = TX[lang];
  const lp = t.lp;

  const [nombre, setNombre] = useState("");
  const [email, setEmail] = useState("");
  // Teléfono en dos partes: país (código) + número. Se combinan al enviar.
  const [pais, setPais] = useState(PAIS_DEFAULT);
  const [telefono, setTelefono] = useState("");
  const [legajo, setLegajo] = useState("");
  const [mensaje, setMensaje] = useState("");
  // Consentimiento de términos: obligatorio para poder enviar la solicitud.
  const [acepto, setAcepto] = useState(false);
  // Honeypot: un bot rellena todo; un humano no ve este campo.
  const [empresa, setEmpresa] = useState("");
  const [estado, setEstado] = useState<Estado>("idle");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (estado === "sending") return;
    // Sin consentimiento no se envía (además la API lo revalida).
    if (!acepto) {
      setError(lp.consentError);
      setEstado("error");
      return;
    }
    setEstado("sending");
    setError(null);
    try {
      // El número se manda con el prefijo del país elegido.
      const telefonoCompleto = telefono.trim() ? `${dialDe(pais)} ${telefono.trim()}` : "";
      const res = await fetch("/api/acceso/solicitar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre, email, telefono: telefonoCompleto, legajo, mensaje, empresa, acepto }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(typeof data?.error === "string" ? data.error : lp.errGeneric);
        setEstado("error");
        return;
      }
      setEstado("ok");
    } catch {
      setError(lp.errGeneric);
      setEstado("error");
    }
  }

  function reset() {
    setNombre("");
    setEmail("");
    setPais(PAIS_DEFAULT);
    setTelefono("");
    setLegajo("");
    setMensaje("");
    setAcepto(false);
    setEstado("idle");
    setError(null);
  }

  return estado === "ok" ? (
    <div className="lp-ok" role="status">
      <span className="lp-ok-ic" aria-hidden>
        ✓
      </span>
      <h3>{lp.okTitle}</h3>
      <p>{lp.okP}</p>
      <button className="btn-ghost" onClick={reset}>
        {lp.okOtra}
      </button>
    </div>
  ) : (
    <form className="lp-form" onSubmit={onSubmit} noValidate>
      <div className="lp-form-head">
        <span className="sh-eyebrow">{lp.formEyebrow}</span>
        <h2>{lp.formTitle}</h2>
      </div>
      <label className="lp-field">
        <span>{lp.fNombre}</span>
        <input
          type="text"
          name="nombre"
          autoComplete="name"
          required
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
        />
      </label>
      <label className="lp-field">
        <span>{lp.fEmail}</span>
        <input
          type="email"
          name="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>
      <label className="lp-field">
        <span>{lp.fTelefono}</span>
        <div className="lp-tel">
          <select
            className="lp-tel-cod"
            name="pais"
            aria-label="Código de país"
            value={pais}
            onChange={(e) => setPais(e.target.value)}
          >
            {PAISES.map((p) => (
              <option key={p.iso} value={p.iso}>
                {p.dial} · {nombrePais(p, lang)}
              </option>
            ))}
          </select>
          <input
            type="tel"
            name="telefono"
            inputMode="tel"
            autoComplete="tel-national"
            required
            value={telefono}
            onChange={(e) => setTelefono(e.target.value)}
          />
        </div>
      </label>
      <label className="lp-field">
        <span>{lp.fLegajo}</span>
        <input
          type="text"
          name="legajo"
          inputMode="text"
          autoComplete="off"
          placeholder={lp.fLegajoPh}
          required
          value={legajo}
          onChange={(e) => setLegajo(e.target.value)}
        />
      </label>
      <label className="lp-field">
        <span>{lp.fMensaje}</span>
        <textarea
          name="mensaje"
          rows={2}
          placeholder={lp.fMensajePh}
          value={mensaje}
          onChange={(e) => setMensaje(e.target.value)}
        />
      </label>

      {/* Honeypot anti-spam: oculto para personas, tentador para bots. */}
      <div className="lp-hp" aria-hidden>
        <label>
          Empresa
          <input
            type="text"
            name="empresa"
            tabIndex={-1}
            autoComplete="off"
            value={empresa}
            onChange={(e) => setEmpresa(e.target.value)}
          />
        </label>
      </div>

      {/* Consentimiento obligatorio de términos y condiciones. */}
      <label className="lp-consent">
        <input
          type="checkbox"
          name="acepto"
          checked={acepto}
          onChange={(e) => setAcepto(e.target.checked)}
          required
        />
        <span>
          {lp.consentPre}
          <Link href="/legal/terminos" target="_blank" rel="noopener noreferrer">
            {t.legal.docs.terminos.title}
          </Link>
          {lp.consentMid}
          <Link href="/legal/privacidad" target="_blank" rel="noopener noreferrer">
            {t.legal.docs.privacidad.title}
          </Link>
          .
        </span>
      </label>

      {estado === "error" && error && <p className="lp-err">{error}</p>}

      <button
        className="btn-primary lp-submit"
        type="submit"
        disabled={estado === "sending" || !acepto}
      >
        {estado === "sending" ? lp.enviando : lp.enviar}
      </button>
    </form>
  );
}
