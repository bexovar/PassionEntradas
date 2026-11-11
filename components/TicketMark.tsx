import { useId } from "react";

// Isotipo de TicketMirror ("TM"): la T toma el color del texto (currentColor),
// así sirve igual sobre fondos claros (tinta) y oscuros (blanco); la M lleva
// el degradé azul de la marca. Se dimensiona con la altura (por defecto 1em).
export default function TicketMark({ className }: { className?: string }) {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const m = `tm-m-${id}`;
  const fold = `tm-f-${id}`;
  return (
    <svg
      className={className}
      viewBox="232 173 324 191"
      height="1em"
      aria-hidden
      focusable="false"
      style={{ flexShrink: 0 }}
    >
      <defs>
        <linearGradient id={m} gradientUnits="userSpaceOnUse" x1="0" y1="173" x2="0" y2="364">
          <stop offset="0" stopColor="#55A8DE" />
          <stop offset="0.3" stopColor="#3C7EC3" />
          <stop offset="0.46" stopColor="#2A62AF" />
          <stop offset="0.67" stopColor="#1B469E" />
          <stop offset="0.88" stopColor="#0B2E8D" />
          <stop offset="1" stopColor="#051A84" />
        </linearGradient>
        <linearGradient id={fold} gradientUnits="userSpaceOnUse" x1="363" y1="0" x2="448" y2="0">
          <stop offset="0" stopColor="#57A8DA" />
          <stop offset="0.45" stopColor="#3B7FC0" />
          <stop offset="1" stopColor="#1B49A6" />
        </linearGradient>
      </defs>
      <path
        fill="currentColor"
        d="M232 173H393L438 233H333V364H232V303H240.5A31.5 31.5 0 0 0 240.5 240H232Z"
      />
      <path fill={`url(#${fold})`} d="M363 233H438L448 246L453 247L413 294L409 293Z" />
      <path fill={`url(#${m})`} d="M510 173H556V364H494V281L443.5 338L409 293Z" />
    </svg>
  );
}
