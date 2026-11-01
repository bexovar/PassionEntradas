import type { Metadata } from "next";
import { Landing } from "@/components/tienda/Landing";
import { fetchCarrusel } from "@/lib/supabase/public";

// Landing pública (/): la cara nueva del sitio para captar clientes. La tienda
// de entradas pasó a ser privada (/entradas, /buscar) y sólo se ve con una
// cuenta aprobada; desde acá se solicita el acceso.
export const metadata: Metadata = {
  // Mismo registro que el hero (TKT-8): a quién está dirigido, sin precios.
  title: "TicketMirror — entradas para agencias y operadores de turismo",
  description:
    "Vendé entradas a los eventos que tus pasajeros quieren: fútbol europeo, Fórmula 1, Champions, Mundial 2026 y shows. Acceso para agencias, operadores, hoteles y vendedores de turismo.",
};

// Sigue siendo estática para el visitante (el formulario postea a la API),
// pero lleva el carrusel de eventos: se regenera cada 5 minutos y al toque
// cuando el admin lo cambia desde el panel (refrescarTienda revalida "/").
export const revalidate = 300;

export default async function LandingPage() {
  // Curado a mano en el panel, no sale del inventario: solo viaja lo que
  // muestra la tarjeta (ver lib/carrusel).
  const carrusel = await fetchCarrusel();
  return <Landing carrusel={carrusel} />;
}
