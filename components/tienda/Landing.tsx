"use client";

// Landing pública (/) — la cara de TicketMirror para las agencias. El agente
// que ya es cliente entra desde acá mismo (el login está en el hero, donde
// aterriza); el que es nuevo pide su usuario con el formulario de solicitud,
// que se abre en un modal. La tienda de entradas no es pública.
// Bilingüe EN/ES (default español), mismo toggle/localStorage que la tienda.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { esStaff, getRol, type Rol } from "@/lib/auth";
import { inicioDe } from "@/lib/ruteo";
import { LANGS, TX, type Lang } from "@/lib/tienda-i18n";
import { PAISES, PAIS_DEFAULT, dialDe, nombrePais } from "@/lib/paises";
import {
  MAX_ORGANIZACION,
  TIPOS_ORGANIZACION,
  validarSolicitud,
  type CodigoErrorSolicitud,
  type TipoOrganizacion,
} from "@/lib/acceso";
import { validarCuit } from "@/lib/cuit";
import { LegalLinks } from "@/components/tienda/LegalLinks";
import { LoginForm } from "@/components/tienda/LoginForm";
import { CarruselEventos } from "@/components/tienda/CarruselEventos";
import type { TarjetaCarrusel } from "@/lib/carrusel";

// La landing es estática, pero si el visitante ya tiene sesión mostramos
// accesos de logueado (Mi cuenta / Ver entradas) en vez de "Ingresar". Se
// chequea en el cliente para no volver dinámica toda la página. Devuelve el
// rol (null = visitante) y el email de la sesión: el staff ve el acceso a su
// panel y el botón para copiar el link de solicitud.
function useRolSesion(): { rol: Rol | null; email: string | null } {
  const [sesion, setSesion] = useState<{ rol: Rol | null; email: string | null }>({ rol: null, email: null });
  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        const { data } = await createClient().auth.getSession();
        if (vivo && data.session) {
          setSesion({ rol: getRol(data.session.user), email: data.session.user.email ?? null });
        }
      } catch {
        /* sin cliente / sin sesión: se queda como visitante */
      }
    })();
    return () => {
      vivo = false;
    };
  }, []);
  return sesion;
}

// Copia al portapapeles. Sin la API (http que no es localhost, navegador
// viejo) prueba con execCommand sobre un textarea temporal.
async function copiarTexto(texto: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(texto);
    return true;
  } catch {
    try {
      const t = document.createElement("textarea");
      t.value = texto;
      t.setAttribute("readonly", "");
      t.style.cssText = "position:fixed;top:0;left:0;opacity:0";
      document.body.appendChild(t);
      t.select();
      const ok = document.execCommand("copy");
      t.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

// "Copiar link de solicitud": el admin se lo manda a quien quiere sumar. El
// link abre la home con el formulario ya abierto (/#solicitar). No se muestra
// la URL: el botón la copia y avisa.
function CopiarLinkSolicitud({ lang }: { lang: Lang }) {
  const lp = TX[lang].lp;
  const [estado, setEstado] = useState<"idle" | "ok" | "error">("idle");
  async function copiar() {
    const ok = await copiarTexto(`${window.location.origin}/#solicitar`);
    setEstado(ok ? "ok" : "error");
    setTimeout(() => setEstado("idle"), 2500);
  }
  return (
    <>
      <button
        type="button"
        className={`btn-ghost lp-nuevo-btn lp-copiar-btn${estado === "ok" ? " is-ok" : ""}`}
        onClick={copiar}
        data-sin-wa
      >
        {estado === "ok" ? `✓ ${lp.linkCopiado}` : lp.copiarLink}
      </button>
      {estado === "error" && <p className="lp-copiar-err">{lp.copiarError}</p>}
      <span className="lp-sr" role="status">
        {estado === "ok" ? lp.linkCopiado : estado === "error" ? lp.copiarError : ""}
      </span>
    </>
  );
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

export function Landing({ carrusel = [] }: { carrusel?: TarjetaCarrusel[] }) {
  const [lang, setLang] = useLang();
  const lp = TX[lang].lp;
  const { rol, email: emailSesion } = useRolSesion();
  const logueado = rol != null;

  const emailRef = useRef<HTMLInputElement>(null);
  // <dialog> nativo: showModal() trae gratis el foco atrapado, el Esc y el
  // fondo inerte. Queda siempre montado, así cerrarlo sin querer no borra lo
  // que el usuario ya había completado.
  const modalRef = useRef<HTMLDialogElement>(null);
  // Quién abrió el modal, para devolverle el foco al cerrar (X, Esc o click
  // afuera).
  const abridorRef = useRef<HTMLElement | null>(null);

  function abrirSolicitud() {
    const m = modalRef.current;
    if (!m || m.open) return;
    abridorRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
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
              // Mismo armado que el de visitante: arriba lo principal (entrar),
              // y el staff abajo, separado, el link para sumar una agencia.
              <div className="lp-auth-card lp-acceso lp-sesion">
                <h2 className="lp-auth-title">{lp.logueadoH}</h2>
                {emailSesion && (
                  <p className="lp-auth-sub">
                    {lp.sesionComo} <b className="lp-sesion-email">{emailSesion}</b>
                  </p>
                )}
                {esStaff(rol) ? (
                  <>
                    {/* Carga completa: el panel trae su propio CSS. */}
                    <a className="btn-primary lp-submit lp-sesion-btn" href={inicioDe(rol)} data-sin-wa>
                      {lp.irPanel}
                    </a>
                    <div className="lp-nuevo">
                      <h3>{lp.sumarAgenciaH}</h3>
                      <p className="lp-sesion-nota">{lp.sumarAgenciaP}</p>
                      <CopiarLinkSolicitud lang={lang} />
                    </div>
                  </>
                ) : (
                  <Link className="btn-primary lp-submit lp-sesion-btn" href="/entradas" data-sin-wa>
                    {lp.irEntradas}
                  </Link>
                )}
              </div>
            ) : (
              <div className="lp-auth-card lp-acceso">
                <LoginForm lang={lang} titulo="h2" emailRef={emailRef} />
                <div className="lp-nuevo">
                  <h3>{lp.nuevoH}</h3>
                  <p className="lp-cartel" data-sin-wa>
                    {lp.cartelPre}
                    <button type="button" className="lp-cartel-link" onClick={abrirSolicitud}>
                      {lp.cartelLink}
                    </button>
                    {lp.cartelPost}
                  </p>
                  <button type="button" className="btn-ghost lp-nuevo-btn" onClick={abrirSolicitud} data-sin-wa>
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
        onClose={() => {
          abridorRef.current?.focus();
          abridorRef.current = null;
        }}
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

      {/* Eventos con foto y sin precio, curados en el panel: el cierre de la
          home. Tocar una tarjeta abre el mismo modal de solicitud. */}
      <CarruselEventos tarjetas={carrusel} lang={lang} logueado={logueado} onSolicitar={abrirSolicitud} />

      <footer className="foot foot--legal">
        <span>TicketMirror</span>
        <span>{lp.footTagline}</span>
        <LegalLinks lang={lang} />
      </footer>
    </>
  );
}

// Formulario de solicitud de acceso (va dentro del modal). Campos de TKT-11:
// primero la organización, después la persona, y el CUIT validado. Se valida
// con lo mismo que la API (validarSolicitud) antes de enviar.

// El campo del form que marca cada error de validarSolicitud.
type CampoForm = "tipoOrganizacion" | "organizacion" | "nombre" | "email" | "telefono" | "cuit" | "acepto";
const CAMPO_DE: Record<CodigoErrorSolicitud, CampoForm> = {
  tipo: "tipoOrganizacion",
  organizacion: "organizacion",
  nombre: "nombre",
  email: "email",
  telefono: "telefono",
  cuit_formato: "cuit",
  cuit_invalido: "cuit",
  acepto: "acepto",
};

function SolicitudForm({ lang }: { lang: Lang }) {
  const t = TX[lang];
  const lp = t.lp;
  const formRef = useRef<HTMLFormElement>(null);

  const [tipo, setTipo] = useState<TipoOrganizacion | "">("");
  const [organizacion, setOrganizacion] = useState("");
  const [nombre, setNombre] = useState("");
  const [email, setEmail] = useState("");
  // Teléfono en dos partes: país (código) + número. Se combinan al enviar.
  const [pais, setPais] = useState(PAIS_DEFAULT);
  const [telefono, setTelefono] = useState("");
  const [cuit, setCuit] = useState("");
  // Consentimiento de términos: obligatorio para poder enviar la solicitud.
  const [acepto, setAcepto] = useState(false);
  // Honeypot: un bot rellena todo; un humano no ve este campo. NO se llama
  // "empresa" ni nada parecido: al lado del campo de organización, el
  // autocompletar del navegador lo llenaba y la solicitud se descartaba.
  const [trampa, setTrampa] = useState("");
  const [estado, setEstado] = useState<Estado>("idle");
  // Error general (red, servidor): arriba del botón.
  const [error, setError] = useState<string | null>(null);
  // Error de un campo: debajo de ese campo.
  const [errorCampo, setErrorCampo] = useState<{ campo: CampoForm; codigo: CodigoErrorSolicitud } | null>(null);

  const datos = () => ({
    tipoOrganizacion: tipo,
    organizacion,
    nombre,
    email,
    // El número se manda con el prefijo del país elegido.
    telefono: telefono.trim() ? `${dialDe(pais)} ${telefono.trim()}` : "",
    cuit,
    acepto,
  });

  // Marca el campo que falló y lo enfoca, para corregirlo sin buscarlo.
  function marcar(codigo: CodigoErrorSolicitud) {
    const campo = CAMPO_DE[codigo];
    setErrorCampo({ campo, codigo });
    setEstado("idle");
    formRef.current?.querySelector<HTMLElement>(`[name="${campo}"]`)?.focus();
  }

  // El campo que se está corrigiendo deja de marcarse.
  const limpiar = (campo: CampoForm) => {
    if (errorCampo?.campo === campo) setErrorCampo(null);
  };

  // CUIT: al salir del campo se valida; si está bien, queda con guiones.
  function onCuitBlur() {
    if (!cuit.trim()) return;
    const r = validarCuit(cuit);
    if (r.ok) setCuit(r.cuit);
    else setErrorCampo({ campo: "cuit", codigo: r.motivo === "formato" ? "cuit_formato" : "cuit_invalido" });
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (estado === "sending") return;
    setError(null);
    // Mismo criterio que la API: con un campo mal, no se envía.
    const v = validarSolicitud(datos());
    if (!v.ok) {
      marcar(v.codigo);
      return;
    }
    setErrorCampo(null);
    setEstado("sending");
    try {
      const res = await fetch("/api/acceso/solicitar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...datos(), hp_campo: trampa }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const codigo = data?.codigo as CodigoErrorSolicitud | undefined;
        if (codigo && codigo in CAMPO_DE) {
          marcar(codigo);
          return;
        }
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
    setTipo("");
    setOrganizacion("");
    setNombre("");
    setEmail("");
    setPais(PAIS_DEFAULT);
    setTelefono("");
    setCuit("");
    setAcepto(false);
    setEstado("idle");
    setError(null);
    setErrorCampo(null);
  }

  const invalido = (c: CampoForm) => errorCampo?.campo === c;
  const errId = (c: CampoForm) => `sol-${c}-err`;
  const aria = (c: CampoForm) =>
    invalido(c) ? { "aria-invalid": true as const, "aria-describedby": errId(c) } : {};
  const errorDe = (c: CampoForm) =>
    invalido(c) && errorCampo ? (
      <small className="lp-field-err" id={errId(c)}>
        {lp.erroresSolicitud[errorCampo.codigo]}
      </small>
    ) : null;

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
    <form ref={formRef} className="lp-form" onSubmit={onSubmit} noValidate>
      <div className="lp-form-head">
        <span className="sh-eyebrow">{lp.formEyebrow}</span>
        <h2>{lp.formTitle}</h2>
      </div>
      <label className="lp-field">
        <span>{lp.fTipo}</span>
        <select
          name="tipoOrganizacion"
          required
          value={tipo}
          onChange={(e) => {
            setTipo(e.target.value as TipoOrganizacion | "");
            limpiar("tipoOrganizacion");
          }}
          {...aria("tipoOrganizacion")}
        >
          <option value="" disabled>
            {lp.fTipoPh}
          </option>
          {TIPOS_ORGANIZACION.map((k) => (
            <option key={k} value={k}>
              {lp.tiposOrg[k]}
            </option>
          ))}
        </select>
        {errorDe("tipoOrganizacion")}
      </label>
      <label className="lp-field">
        <span>{lp.fOrganizacion}</span>
        <input
          type="text"
          name="organizacion"
          autoComplete="organization"
          required
          maxLength={MAX_ORGANIZACION}
          placeholder={lp.fOrganizacionPh}
          value={organizacion}
          onChange={(e) => {
            setOrganizacion(e.target.value);
            limpiar("organizacion");
          }}
          {...aria("organizacion")}
        />
        {tipo === "freelance" && !invalido("organizacion") && (
          <small className="lp-field-hint">{lp.fOrganizacionFreelance}</small>
        )}
        {errorDe("organizacion")}
      </label>
      <label className="lp-field">
        <span>{lp.fNombre}</span>
        <input
          type="text"
          name="nombre"
          autoComplete="name"
          required
          value={nombre}
          onChange={(e) => {
            setNombre(e.target.value);
            limpiar("nombre");
          }}
          {...aria("nombre")}
        />
        {errorDe("nombre")}
      </label>
      <label className="lp-field">
        <span>{lp.fEmail}</span>
        <input
          type="email"
          name="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            limpiar("email");
          }}
          {...aria("email")}
        />
        {errorDe("email")}
      </label>
      <label className="lp-field">
        <span>{lp.fWhatsapp}</span>
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
            onChange={(e) => {
              setTelefono(e.target.value);
              limpiar("telefono");
            }}
            {...aria("telefono")}
          />
        </div>
        {errorDe("telefono")}
      </label>
      <label className="lp-field">
        <span>{lp.fCuit}</span>
        <input
          type="text"
          name="cuit"
          // Teclado numérico: el CUIT entra igual sin guiones.
          inputMode="numeric"
          autoComplete="off"
          maxLength={20}
          placeholder={lp.fCuitPh}
          required
          value={cuit}
          onChange={(e) => {
            setCuit(e.target.value);
            limpiar("cuit");
          }}
          onBlur={onCuitBlur}
          {...aria("cuit")}
        />
        {errorDe("cuit")}
      </label>

      {/* Honeypot anti-spam: oculto para personas, tentador para bots. */}
      <div className="lp-hp" aria-hidden>
        <label>
          No completar
          <input
            type="text"
            name="hp_campo"
            tabIndex={-1}
            autoComplete="off"
            value={trampa}
            onChange={(e) => setTrampa(e.target.value)}
          />
        </label>
      </div>

      {/* Consentimiento obligatorio de términos y condiciones. */}
      <label className="lp-consent">
        <input
          type="checkbox"
          name="acepto"
          checked={acepto}
          onChange={(e) => {
            setAcepto(e.target.checked);
            limpiar("acepto");
          }}
          required
          {...aria("acepto")}
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
      {errorDe("acepto")}

      {estado === "error" && error && <p className="lp-err">{error}</p>}

      <button
        className="btn-primary lp-submit"
        type="submit"
        disabled={estado === "sending" || !acepto}
        data-sin-wa
      >
        {estado === "sending" ? lp.enviando : lp.enviar}
      </button>
    </form>
  );
}
