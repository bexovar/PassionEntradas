import { redirect } from "next/navigation";
import { getRol, puedeVerTienda } from "@/lib/auth";
import { isMock } from "@/lib/mock-db";
import { usuarioVerificado } from "@/lib/usuario-verificado";

// Defensa en profundidad para la tienda (/entradas, /buscar). El middleware
// solo verificó el token (claims, ver lib/claims.ts); acá usuarioVerificado()
// confirma la sesión contra Auth: una cookie forjada, revocada o de alguien
// desactivado rebota igual. Sin sesión con acceso (staff o cliente aprobado)
// -> al login de cliente.
//
// Consecuencia: la página que llama a esto se vuelve dinámica (lee cookies).
// Es lo correcto para un área privada; la landing pública (/) no lo usa.
export async function requireAccesoTienda(): Promise<void> {
  if (isMock()) return;
  const user = await usuarioVerificado();
  if (!user || !puedeVerTienda(getRol(user))) {
    redirect("/ingresar");
  }
}
