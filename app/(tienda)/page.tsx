import type { Metadata } from "next";
import { Landing } from "@/components/tienda/Landing";

// Landing pública (/): la cara nueva del sitio para captar clientes. La tienda
// de entradas pasó a ser privada (/entradas, /buscar) y sólo se ve con una
// cuenta aprobada; desde acá se solicita el acceso.
export const metadata: Metadata = {
  // Mismo registro que el hero (TKT-8): a quién está dirigido, sin precios.
  title: "TicketMirror — entradas para agencias y operadores de turismo",
  description:
    "Vendé entradas a los eventos que tus pasajeros quieren: fútbol europeo, Fórmula 1, Champions, Mundial 2026 y shows. Acceso para agencias, operadores, hoteles y vendedores de turismo.",
};

// Página estática (sin datos dinámicos): el formulario postea a la API.
export const dynamic = "force-static";

export default function LandingPage() {
  return <Landing />;
}
