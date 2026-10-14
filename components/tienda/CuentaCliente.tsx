"use client";

// Mi cuenta del CLIENTE (logueado en la tienda): perfil (nombre/teléfono/
// dirección), idioma (se guarda en la cuenta, no solo en el dispositivo),
// contacto por WhatsApp, cambio de contraseña y cerrar sesión. Estética de la
// tienda; bilingüe EN/ES.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { avisarActividad } from "@/lib/actividad-cliente";
import { LANGS, TX, type Lang } from "@/lib/tienda-i18n";
import { waLink } from "@/lib/tickets";

export type PerfilInicial = {
  nombre: string;
  telefono: string;
  // Mismo dato que cargó al pedir acceso: viaja sin cambiar de nombre por
  // solicitud -> cuenta -> perfil -> factura.
  legajo: string;
  lang: Lang | null;
};

function LangToggle({ lang, onChange }: { lang: Lang; onChange: (l: Lang) => void }) {
  return (
    <div className="lang" role="group" aria-label="Language / Idioma">
      {LANGS.map((l) => (
        <button
          key={l}
          type="button"
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

type Estado = "idle" | "saving" | "ok";

export function CuentaCliente({ mock, perfil }: { mock: boolean; perfil: PerfilInicial }) {
  const router = useRouter();

  // Idioma: arranca del que guardó la cuenta (si hay); si no, del dispositivo.
  const [lang, setLang] = useState<Lang>(perfil.lang ?? "es");
  useEffect(() => {
    if (perfil.lang) {
      localStorage.setItem("tm_lang", perfil.lang);
      return;
    }
    const saved = localStorage.getItem("tm_lang");
    if (saved === "en" || saved === "es") setLang(saved);
  }, [perfil.lang]);
  const lp = TX[lang].lp;

  async function cambiarIdioma(l: Lang) {
    const antes = lang;
    setLang(l);
    localStorage.setItem("tm_lang", l);
    if (!mock) {
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({ data: { lang: l } });
      // Tocar el idioma que ya estaba no es un cambio.
      if (!error && l !== antes) void avisarActividad("cuenta.idioma", { idioma: l });
    }
  }

  // Perfil.
  const [nombre, setNombre] = useState(perfil.nombre);
  const [telefono, setTelefono] = useState(perfil.telefono);
  const [legajo, setLegajo] = useState(perfil.legajo);
  const [perfilEstado, setPerfilEstado] = useState<Estado>("idle");
  const [perfilError, setPerfilError] = useState<string | null>(null);
  // Lo último guardado, para registrar solo los campos que cambiaron.
  const perfilGuardado = useRef({ nombre: perfil.nombre, telefono: perfil.telefono, legajo: perfil.legajo });

  async function guardarPerfil(e: React.FormEvent) {
    e.preventDefault();
    if (perfilEstado === "saving") return;
    setPerfilError(null);
    if (mock) {
      setPerfilError("Demo mode: no hay cuentas reales.");
      return;
    }
    setPerfilEstado("saving");
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({
        data: { nombre, telefono, legajo },
      });
      if (error) {
        setPerfilError(lp.cuentaErrGeneric);
        setPerfilEstado("idle");
        return;
      }
      const nuevos = { nombre, telefono, legajo };
      const campos = (Object.keys(nuevos) as (keyof typeof nuevos)[]).filter(
        (k) => nuevos[k] !== perfilGuardado.current[k]
      );
      perfilGuardado.current = nuevos;
      if (campos.length) void avisarActividad("cuenta.datos", { campos });
      setPerfilEstado("ok");
      router.refresh();
    } catch {
      setPerfilError(lp.cuentaErrGeneric);
      setPerfilEstado("idle");
    }
  }

  // Contraseña.
  const [clave, setClave] = useState("");
  const [repetir, setRepetir] = useState("");
  const [claveEstado, setClaveEstado] = useState<Estado>("idle");
  const [claveError, setClaveError] = useState<string | null>(null);

  async function guardarClave(e: React.FormEvent) {
    e.preventDefault();
    if (claveEstado === "saving") return;
    setClaveError(null);
    if (clave.length < 8) {
      setClaveError(lp.cuentaErrCorta);
      return;
    }
    if (clave !== repetir) {
      setClaveError(lp.cuentaErrMatch);
      return;
    }
    if (mock) {
      setClaveError("Demo mode: no hay cuentas reales.");
      return;
    }
    setClaveEstado("saving");
    try {
      const supabase = createClient();
      const { error } = await supabase.auth.updateUser({ password: clave });
      if (error) {
        setClaveError(lp.cuentaErrGeneric);
        setClaveEstado("idle");
        return;
      }
      void avisarActividad("cuenta.clave");
      setClave("");
      setRepetir("");
      setClaveEstado("ok");
      router.refresh();
    } catch {
      setClaveError(lp.cuentaErrGeneric);
      setClaveEstado("idle");
    }
  }

  async function logout() {
    // Antes del signOut: después ya no hay sesión a quién atribuirlo. En demo
    // no hay cuenta de cliente (quedaría a nombre del admin demo).
    if (!mock) await avisarActividad("sesion.salida");
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.assign("/ingresar");
  }

  return (
    <>
      <header className="masthead masthead--home">
        <div className="toprow">
          <Link className="wm" href="/entradas">
            <span className="ticketmark">▚</span> TICKET<em>MIRROR</em>
          </Link>
          <Link className="back" href="/entradas">
            {lp.cuentaVolver}
          </Link>
        </div>
      </header>

      {/* Un solo encabezado; las dos secciones (perfil y contraseña) van en
          UNA línea (lado a lado en desktop, apiladas en mobile), cada una con
          su título compacto adentro de la tarjeta. */}
      <section className="block">
        <div className="section-h">
          <span className="sh-eyebrow">TicketMirror</span>
          <h2>{lp.navCuenta}</h2>
        </div>

        <div className="lp-cuenta-grid">
          {/* Perfil + idioma + WhatsApp */}
          <form className="lp-form" onSubmit={guardarPerfil} noValidate>
            <div className="lp-form-head">
              <h2>{lp.cuentaPerfilH}</h2>
            </div>
            <label className="lp-field">
              <span>{lp.fNombre}</span>
              <input
                type="text"
                autoComplete="name"
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
              />
            </label>
            <label className="lp-field">
              <span>{lp.fTelefono}</span>
              <input
                type="tel"
                autoComplete="tel"
                value={telefono}
                onChange={(e) => setTelefono(e.target.value)}
              />
            </label>
            <label className="lp-field">
              <span>{lp.fLegajo}</span>
              <input
                type="text"
                autoComplete="off"
                placeholder={lp.fLegajoPh}
                value={legajo}
                onChange={(e) => setLegajo(e.target.value)}
              />
            </label>

            <div className="lp-field">
              <span>{lp.cuentaIdioma}</span>
              <LangToggle lang={lang} onChange={cambiarIdioma} />
            </div>

            {perfilEstado === "ok" && <p className="lp-ok-msg">{lp.cuentaPerfilOk}</p>}
            {perfilError && <p className="lp-err">{perfilError}</p>}

            <button className="btn-primary lp-submit" type="submit" disabled={perfilEstado === "saving"}>
              {perfilEstado === "saving" ? lp.cuentaGuardando : lp.cuentaGuardarPerfil}
            </button>

            {/* Contacto, separado del guardar por un divisor (no pegado). */}
            <div className="lp-cuenta-wa">
              <a
                className="btn-ghost"
                href={waLink(lp.cuentaWaMsg(nombre))}
                target="_blank"
                rel="noopener noreferrer"
              >
                {lp.cuentaWhatsapp}
              </a>
            </div>
          </form>

          {/* Contraseña */}
          <form className="lp-form" onSubmit={guardarClave} noValidate>
            <div className="lp-form-head">
              <h2>{lp.cuentaPassH}</h2>
            </div>
            <label className="lp-field">
              <span>{lp.cuentaNueva}</span>
              <input
                type="password"
                autoComplete="new-password"
                placeholder={lp.cuentaMin}
                value={clave}
                onChange={(e) => setClave(e.target.value)}
              />
            </label>
            <label className="lp-field">
              <span>{lp.cuentaRepetir}</span>
              <input
                type="password"
                autoComplete="new-password"
                value={repetir}
                onChange={(e) => setRepetir(e.target.value)}
              />
            </label>

            {claveEstado === "ok" && <p className="lp-ok-msg">{lp.cuentaOk}</p>}
            {claveError && <p className="lp-err">{claveError}</p>}

            <button className="btn-primary lp-submit" type="submit" disabled={claveEstado === "saving"}>
              {claveEstado === "saving" ? lp.cuentaGuardando : lp.cuentaGuardar}
            </button>
          </form>
        </div>

        <div className="lp-cuenta-logout">
          <button className="back" onClick={logout}>
            {lp.cuentaSalir}
          </button>
        </div>
      </section>
    </>
  );
}
