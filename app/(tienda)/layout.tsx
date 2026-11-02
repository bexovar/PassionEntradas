import type { Metadata } from "next";
import { Spline_Sans } from "next/font/google";
import { CartProvider, CartBar } from "@/components/tienda/Cart";
import { WhatsAppFlotante } from "@/components/WhatsAppFlotante";
import "./tienda.css";

const spline = Spline_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-spline",
  display: "swap",
});

export const metadata: Metadata = {
  title: "TicketMirror — entradas para los eventos que importan",
  description:
    "Entradas para agencias y operadores de turismo: fútbol europeo, Fórmula 1, Champions, Mundial 2026 y shows.",
};

// Layout de la tienda pública. El wrapper .tienda scopea todos los estilos
// portados de PassionEntradas para no interferir con el panel (Tailwind).
export default function TiendaLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`tienda ${spline.variable}`}>
      <CartProvider>
        <div className="tienda-app">{children}</div>
        <CartBar />
        {/* En todas las pantallas del agente, públicas y logueadas. */}
        <WhatsAppFlotante />
      </CartProvider>
    </div>
  );
}
