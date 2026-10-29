"use client";

import { useEffect, useRef, useState } from "react";
import {
  MARCO,
  MIN_LADO,
  SALIDA,
  ZOOM_MAX,
  centrar,
  fotoMuyChica,
  mover,
  rectRecorte,
  tamanoEnMarco,
  zoomear,
  type Encuadre,
  type Tamano,
} from "@/lib/encuadre";

// Editor de encuadre de una foto del carrusel. Marco fijo 4:3, igual al de la
// tarjeta de la home: el admin arrastra la foto y hace zoom con el slider; lo
// que ve en el marco es exactamente lo que se sube. El recorte se hace acá
// (canvas) y sale a 1200×900 WebP, así todas las fotos quedan iguales y
// livianas. La cuenta vive en lib/encuadre (con test).

type Props = {
  archivo: File;
  // Para la vista previa del talón de la tarjeta.
  competicion: string;
  evento: string | null;
  // "2 de 3" cuando se eligieron varias a la vez.
  progreso?: string;
  onListo: (foto: Blob) => void;
  onCancelar: () => void;
};

export default function EncuadreFoto({ archivo, competicion, evento, progreso, onListo, onCancelar }: Props) {
  const marco = useRef<HTMLDivElement>(null);
  const arrastre = useRef<{ id: number; x: number; y: number } | null>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [tam, setTam] = useState<Tamano | null>(null);
  const [enc, setEnc] = useState<Encuadre | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exportando, setExportando] = useState(false);

  useEffect(() => {
    const url = URL.createObjectURL(archivo);
    const el = new Image();
    // Al limpiar se revoca la URL y esta carga falla: que no pise a la siguiente.
    let vigente = true;
    el.onload = () => {
      if (!vigente) return;
      const t = { w: el.naturalWidth, h: el.naturalHeight };
      if (fotoMuyChica(t)) {
        setError(
          `La foto es muy chica (${t.w}×${t.h} px), se vería pixelada. Tiene que medir al menos ${MIN_LADO} px de ancho y de alto.`
        );
        return;
      }
      setImg(el);
      setSrc(url);
      setTam(t);
      setEnc(centrar(t));
    };
    el.onerror = () => {
      if (vigente) setError("No se pudo abrir la imagen. Probá con un JPG, PNG o WEBP.");
    };
    el.src = url;
    return () => {
      vigente = false;
      URL.revokeObjectURL(url);
    };
  }, [archivo]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancelar();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancelar]);

  // Píxeles de pantalla → unidades del marco.
  function aUnidades(px: number): number {
    return (px * MARCO.w) / (marco.current?.clientWidth || MARCO.w);
  }

  function onPointerDown(e: React.PointerEvent) {
    e.currentTarget.setPointerCapture(e.pointerId);
    arrastre.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
  }

  function onPointerMove(e: React.PointerEvent) {
    const a = arrastre.current;
    if (!a || a.id !== e.pointerId || !tam || !enc) return;
    setEnc(mover(tam, enc, aUnidades(e.clientX - a.x), aUnidades(e.clientY - a.y)));
    arrastre.current = { ...a, x: e.clientX, y: e.clientY };
  }

  function onPointerUp() {
    arrastre.current = null;
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!tam || !enc) return;
    const paso = e.shiftKey ? 40 : 10;
    const d: Record<string, [number, number]> = {
      ArrowLeft: [paso, 0],
      ArrowRight: [-paso, 0],
      ArrowUp: [0, paso],
      ArrowDown: [0, -paso],
    };
    if (d[e.key]) {
      e.preventDefault();
      setEnc(mover(tam, enc, ...d[e.key]));
    }
  }

  async function usar() {
    if (!img || !tam || !enc) return;
    setExportando(true);
    try {
      const r = rectRecorte(tam, enc);
      const canvas = document.createElement("canvas");
      canvas.width = SALIDA.w;
      canvas.height = SALIDA.h;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("sin canvas");
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, r.x, r.y, r.w, r.h, 0, 0, SALIDA.w, SALIDA.h);
      const aBlob = (tipo: string, calidad: number) =>
        new Promise<Blob | null>((res) => canvas.toBlob(res, tipo, calidad));
      // Safari viejo no exporta WebP (devuelve PNG): ahí va JPG, que pesa menos.
      let blob = await aBlob("image/webp", 0.86);
      if (!blob || blob.type !== "image/webp") blob = await aBlob("image/jpeg", 0.88);
      if (!blob) throw new Error("sin blob");
      onListo(blob);
    } catch {
      setError("No se pudo preparar la foto. Probá de nuevo o con otra imagen.");
      setExportando(false);
    }
  }

  const t = tam && enc ? tamanoEnMarco(tam, enc.zoom) : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="encuadre-titulo"
      data-editando=""
    >
      <div className="max-h-full w-full max-w-[520px] overflow-y-auto rounded-2xl bg-white p-5 shadow-xl">
        <div className="flex items-baseline justify-between gap-3">
          <h3 id="encuadre-titulo" className="font-display text-lg font-bold tracking-tight">
            Encuadrar la foto
          </h3>
          {progreso && <span className="font-mono text-xs text-muted">{progreso}</span>}
        </div>
        <p className="mt-1 text-sm text-[#4A4E5E]">
          Arrastrá la foto y usá el zoom para elegir qué parte se ve. Así queda en la tarjeta de la home.
        </p>

        {error ? (
          <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700" role="alert">
            {error}
          </p>
        ) : (
          <>
            {/* Vista previa de la tarjeta: la foto 4:3 y el talón. */}
            <div className="mt-4 overflow-hidden rounded-lg border-[1.5px] border-ink">
              <div
                ref={marco}
                className="relative aspect-[4/3] cursor-grab touch-none select-none overflow-hidden bg-ink outline-none focus-visible:ring-2 focus-visible:ring-brand active:cursor-grabbing"
                tabIndex={0}
                aria-label="Encuadre: arrastrá o usá las flechas para mover la foto"
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                onKeyDown={onKeyDown}
              >
                {src && enc && t && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={src}
                    alt=""
                    draggable={false}
                    className="pointer-events-none absolute max-w-none"
                    style={{
                      left: `${(enc.x / MARCO.w) * 100}%`,
                      top: `${(enc.y / MARCO.h) * 100}%`,
                      width: `${(t.w / MARCO.w) * 100}%`,
                      height: `${(t.h / MARCO.h) * 100}%`,
                    }}
                  />
                )}
              </div>
              <div className="border-t-2 border-dashed border-ink px-4 py-3">
                <p className="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-brand">{competicion}</p>
                <p className="font-display text-base font-extrabold uppercase leading-tight">
                  {evento ?? "Todos los partidos de la competición"}
                </p>
              </div>
            </div>

            <label className="mt-4 flex items-center gap-3 text-sm">
              <span className="w-10 shrink-0 text-muted">Zoom</span>
              <input
                type="range"
                min={1}
                max={ZOOM_MAX}
                step={0.01}
                value={enc?.zoom ?? 1}
                disabled={!tam || !enc}
                onChange={(e) => tam && enc && setEnc(zoomear(tam, enc, Number(e.target.value)))}
                className="w-full accent-brand"
              />
            </label>
          </>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onCancelar}
            className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold transition-colors hover:bg-canvas"
          >
            {error ? "Cerrar" : "Cancelar"}
          </button>
          {!error && (
            <button
              onClick={usar}
              disabled={!enc || exportando}
              className="rounded-lg bg-brand px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-brand-deep disabled:opacity-50"
            >
              {exportando ? "Preparando…" : "Usar esta foto"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
