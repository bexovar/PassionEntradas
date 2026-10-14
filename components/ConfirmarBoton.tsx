"use client";

// Botón con confirmación en el mismo lugar, en vez del confirm() del
// navegador: el primer toque lo cambia por "¿Seguro? Sí, … · No"; recién el
// "Sí" ejecuta. Se desarma solo a los pocos segundos, con un toque afuera o
// con Escape. Sin modal: igual en celular y en desktop, y con teclado.
// Sin estilos propios: cada pantalla pasa sus clases (panel en Tailwind,
// tienda con las suyas).

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

type Props = {
  onConfirm: () => void;
  children: ReactNode;
  // Texto del "Sí" (corto y con el verbo: "Sí, cancelar").
  si: string;
  pregunta?: string;
  no?: string;
  disabled?: boolean;
  title?: string;
  className?: string;
  // Colores que dependen de datos (p.ej. el color de cada hito del panel).
  style?: CSSProperties;
  armadoStyle?: CSSProperties;
  siStyle?: CSSProperties;
  siClassName?: string;
  noClassName?: string;
  // Contenedor de la confirmación armada (pregunta + botones).
  armadoClassName?: string;
  preguntaClassName?: string;
  msDesarme?: number;
};

// Un doble toque rápido (o el rebote de un dedo) no puede caer en el "Sí"
// que aparece debajo: los toques de este primer instante se ignoran.
const MS_GRACIA = 350;

export default function ConfirmarBoton({
  onConfirm,
  children,
  si,
  pregunta = "¿Seguro?",
  no = "No",
  disabled = false,
  title,
  className = "",
  style,
  armadoStyle,
  siStyle,
  siClassName = "",
  noClassName = "",
  armadoClassName = "inline-flex flex-wrap items-center gap-2",
  preguntaClassName = "text-xs font-semibold",
  msDesarme = 5000,
}: Props) {
  const [armado, setArmado] = useState(false);
  const armadoAt = useRef(0);
  const caja = useRef<HTMLSpanElement>(null);
  const boton = useRef<HTMLButtonElement>(null);
  const siRef = useRef<HTMLButtonElement>(null);
  // Al desarmar con teclado (No / Escape), el foco vuelve al botón original.
  const devolverFoco = useRef(false);

  useEffect(() => {
    if (!armado) {
      if (devolverFoco.current) boton.current?.focus();
      devolverFoco.current = false;
      return;
    }
    siRef.current?.focus();
    const t = window.setTimeout(() => setArmado(false), msDesarme);
    const afuera = (e: PointerEvent) => {
      if (caja.current && !caja.current.contains(e.target as Node)) setArmado(false);
    };
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        devolverFoco.current = true;
        setArmado(false);
      }
    };
    document.addEventListener("pointerdown", afuera);
    document.addEventListener("keydown", tecla);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("pointerdown", afuera);
      document.removeEventListener("keydown", tecla);
    };
  }, [armado, msDesarme]);

  // Si la acción queda bloqueada mientras está armado (otro click en vuelo),
  // la confirmación se cae: el "Sí" ya no haría nada.
  useEffect(() => {
    if (disabled) setArmado(false);
  }, [disabled]);

  if (!armado) {
    return (
      <button
        ref={boton}
        type="button"
        onClick={() => {
          armadoAt.current = Date.now();
          setArmado(true);
        }}
        disabled={disabled}
        title={title}
        className={className}
        style={style}
      >
        {children}
      </button>
    );
  }

  return (
    <span ref={caja} role="group" aria-label={pregunta} className={armadoClassName} style={armadoStyle}>
      <span className={preguntaClassName} aria-live="polite">
        {pregunta}
      </span>
      <button
        ref={siRef}
        type="button"
        onClick={() => {
          if (Date.now() - armadoAt.current < MS_GRACIA) return;
          setArmado(false);
          onConfirm();
        }}
        className={siClassName}
        style={siStyle}
      >
        {si}
      </button>
      <button
        type="button"
        onClick={() => {
          devolverFoco.current = true;
          setArmado(false);
        }}
        className={noClassName}
      >
        {no}
      </button>
    </span>
  );
}
