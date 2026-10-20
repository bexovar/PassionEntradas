"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

// Refresca los datos del Server Component en intervalo, sin recargar la página.
// Así "esta página se actualiza sola" sin que las partes tengan que preguntar.
//
// Nunca mientras alguien está cargando algo. router.refresh() conserva lo
// escrito, salvo cuando el pedido de fondo falla (timeout, sesión vencida) o
// hubo un deploy en el medio: ahí Next recarga la página ENTERA y se pierde lo
// que estaba a medio cargar (pasó con "Nueva operación"). Por eso se saltea el
// refresco si hay un campo con foco o algún elemento marcado con
// data-editando (formularios con datos sin guardar, modales abiertos); se
// vuelve a intentar en el tick siguiente.
//
// Con `versionUrl`, en vez de refrescar siempre, cada tick consulta un endpoint
// mínimo que devuelve { v } y solo dispara router.refresh() cuando la versión
// cambió. Eso reduce el tráfico de fondo de re-renderizar toda la página a un
// JSON de pocos bytes por intervalo.
function estaEditando(): boolean {
  const el = document.activeElement as HTMLElement | null;
  // El foco cuenta solo dentro de un formulario o de algo marcado como en
  // edición: el buscador y los selectores de orden o período del panel no son
  // "cargar algo", y con el foco ahí la lista dejaba de actualizarse.
  if (el && el.closest("form, [data-editando]")) {
    const tag = el.tagName;
    if (tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable) return true;
    if (tag === "INPUT") {
      const tipo = (el as HTMLInputElement).type;
      // Un botón o un tilde con foco no es "estar escribiendo".
      if (!["button", "submit", "reset", "checkbox", "radio", "range", "color", "file", "image"].includes(tipo)) {
        return true;
      }
    }
  }
  return document.querySelector("[data-editando]") != null;
}

export default function AutoRefresh({
  intervalMs = 12000,
  versionUrl,
}: {
  intervalMs?: number;
  versionUrl?: string;
}) {
  const router = useRouter();
  // Última versión vista. null = todavía no tenemos línea de base.
  const lastVersion = useRef<string | null>(null);
  const pendienteRef = useRef(false);
  // La sesión se cayó: se deja de preguntar y se avisa.
  const [sesionCaida, setSesionCaida] = useState(false);
  // Hay datos nuevos esperando a que terminen de cargar algo (ver
  // estaEditando): se avisa para que no parezca que la lista se trabó.
  const [pendiente, setPendiente] = useState(false);

  useEffect(() => {
    let vivo = true;

    const tick = async () => {
      // Solo refrescamos si la pestaña está visible (ahorra requests).
      if (document.visibilityState !== "visible") return;

      if (!versionUrl) {
        if (!estaEditando()) router.refresh();
        return;
      }
      // Ya se sabe que hay algo nuevo: refrescar apenas se termine de editar,
      // sin volver a preguntar.
      if (pendienteRef.current) {
        if (!estaEditando()) {
          pendienteRef.current = false;
          setPendiente(false);
          router.refresh();
        }
        return;
      }

      try {
        const res = await fetch(versionUrl, { cache: "no-store" });

        // La sesión se cayó (la cerraron, borraron el usuario, venció de
        // verdad). Sin esto la pestaña se queda pidiendo cada 12 segundos para
        // siempre: cada pedido vuelve a intentar refrescar un token muerto y
        // deja un error en el log del servidor, y mientras tanto el panel
        // muestra datos viejos como si todo anduviera.
        //
        // Se corta el intervalo y se avisa, pero NO se recarga sola: si el 401
        // vuelve a aparecer después de recargar, eso es un loop de recargas
        // contra el servidor. Recargar es decisión de la persona, con el
        // botón, y ahí el middleware borra la cookie y la manda al login.
        if (res.status === 401 || res.status === 403) {
          if (!vivo) return;
          clearInterval(id);
          setSesionCaida(true);
          return;
        }

        if (!res.ok || !vivo) return;
        const data = (await res.json()) as { v?: string };
        const v = typeof data.v === "string" ? data.v : null;
        if (v == null || !vivo) return;
        if (lastVersion.current == null) {
          // Primer fetch: solo fija la línea de base (la página ya está fresca).
          lastVersion.current = v;
          return;
        }
        if (v !== lastVersion.current) {
          lastVersion.current = v;
          // Alguien está cargando algo: se refresca en el primer tick sin edición.
          if (estaEditando()) {
            pendienteRef.current = true;
            setPendiente(true);
          } else {
            router.refresh();
          }
        }
      } catch {
        // Sin red / error transitorio: no refrescar, probamos al próximo tick.
      }
    };

    const id = setInterval(() => void tick(), intervalMs);

    // Con versión: fijar la línea de base apenas monta (no refresca). Sin
    // versión NO se llama: el tick refresca siempre, y re-pedir la página que
    // acaba de llegar la armaba dos veces en cada visita.
    if (versionUrl) void tick();

    // Al volver a la pestaña, chequear de inmediato.
    const onVisible = () => void tick();
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      vivo = false;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router, intervalMs, versionUrl]);

  if (!sesionCaida) {
    if (!pendiente) return null;
    return (
      <div
        role="status"
        style={{
          position: "fixed",
          right: 16,
          bottom: 80,
          zIndex: 9998,
          maxWidth: 300,
          padding: "8px 12px",
          borderRadius: 10,
          background: "#1f2937",
          color: "#fff",
          boxShadow: "0 8px 24px rgba(0,0,0,.2)",
          fontSize: 12.5,
          lineHeight: 1.35,
        }}
      >
        Hay novedades. La página se actualiza cuando termines lo que estás cargando.
      </div>
    );
  }

  // Estilos en línea a propósito: este componente se monta tanto en el panel
  // (Tailwind) como en la tienda (CSS propio), y el cartel tiene que verse
  // igual en los dos.
  return (
    <div
      role="alert"
      style={{
        position: "fixed",
        left: 16,
        right: 16,
        bottom: 16,
        zIndex: 9999,
        margin: "0 auto",
        maxWidth: 420,
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "12px 14px",
        borderRadius: 10,
        background: "#1f2937",
        color: "#fff",
        boxShadow: "0 8px 24px rgba(0,0,0,.25)",
        fontSize: 14,
        lineHeight: 1.35,
      }}
    >
      <span style={{ flex: 1 }}>
        Se cerró tu sesión, así que esta página dejó de actualizarse.
      </span>
      <a
        href="/ingresar"
        style={{
          flexShrink: 0,
          padding: "7px 12px",
          borderRadius: 8,
          background: "#fff",
          color: "#1f2937",
          fontWeight: 600,
          textDecoration: "none",
        }}
      >
        Entrar
      </a>
    </div>
  );
}
