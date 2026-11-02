"use client";

import { useId, useMemo, useState } from "react";
import { filtrarOpciones, type OpcionCombo } from "@/lib/combo";

// Autocompletado propio de los formularios del panel: las sugerencias se ven
// ADENTRO de la página (un desplegable bajo el input), no en la barra del
// teclado como hacía <datalist> en móvil. Se puede elegir una o escribir otra.
// Lo usan la competición de "Cargar entrada" y el carrusel de la home.
// Teclado: ↑/↓ recorren, Enter elige (no envía el form), Esc cierra.

type Props<T> = {
  value: string;
  // Lo que se escribe.
  onChange: (v: string) => void;
  // Lo que se elige de la lista. Sin esto, elegir = escribir su texto.
  onElegir?: (o: OpcionCombo<T>) => void;
  opciones: OpcionCombo<T>[];
  inputCls: string;
  ariaLabel?: string;
  placeholder?: string;
  maxLength?: number;
  required?: boolean;
  id?: string;
};

export default function Combo<T>({
  value,
  onChange,
  onElegir,
  opciones,
  inputCls,
  ariaLabel,
  placeholder,
  maxLength,
  required,
  id,
}: Props<T>) {
  const lista = useId();
  const [abierto, setAbierto] = useState(false);
  const [activa, setActiva] = useState(-1);
  const sugerencias = useMemo(() => filtrarOpciones(opciones, value), [opciones, value]);
  const visible = abierto && sugerencias.length > 0;

  function elegir(o: OpcionCombo<T>) {
    if (onElegir) onElegir(o);
    else onChange(o.texto);
    setAbierto(false);
    setActiva(-1);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!visible) {
        setAbierto(true);
        return;
      }
      const n = sugerencias.length;
      setActiva((i) => (e.key === "ArrowDown" ? (i + 1) % n : (i - 1 + n) % n));
    } else if (e.key === "Enter" && visible && activa >= 0) {
      e.preventDefault();
      elegir(sugerencias[activa]);
    } else if (e.key === "Escape" && visible) {
      // Que no cierre también un modal de alrededor.
      e.stopPropagation();
      setAbierto(false);
    }
  }

  return (
    <div className="relative">
      <input
        id={id}
        className={inputCls}
        value={value}
        autoComplete="off"
        role="combobox"
        aria-expanded={visible}
        aria-controls={lista}
        aria-autocomplete="list"
        aria-activedescendant={visible && activa >= 0 ? `${lista}-${activa}` : undefined}
        aria-label={ariaLabel}
        placeholder={placeholder}
        maxLength={maxLength}
        required={required}
        onChange={(e) => {
          onChange(e.target.value);
          setAbierto(true);
          setActiva(-1);
        }}
        onFocus={() => setAbierto(true)}
        onBlur={() => {
          setAbierto(false);
          setActiva(-1);
        }}
        onKeyDown={onKeyDown}
      />
      {visible && (
        <ul
          id={lista}
          role="listbox"
          className="absolute left-0 right-0 top-full z-20 mt-1 max-h-60 overflow-y-auto rounded-lg border border-line bg-white py-1 shadow-lg"
        >
          {sugerencias.map((o, i) => (
            <li key={o.clave} id={`${lista}-${i}`} role="option" aria-selected={i === activa}>
              <button
                type="button"
                tabIndex={-1}
                // onMouseDown (no onClick): dispara ANTES del blur del input,
                // que si no cerraría la lista sin aplicar la selección.
                onMouseDown={(e) => {
                  e.preventDefault();
                  elegir(o);
                }}
                className={`w-full px-3 py-2 text-left text-sm transition-colors hover:bg-canvas ${
                  i === activa ? "bg-canvas" : ""
                }`}
              >
                <span className={`block ${o.detalle ? "font-medium text-body" : ""}`}>{o.texto}</span>
                {o.detalle && <span className="block text-xs text-muted">{o.detalle}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
