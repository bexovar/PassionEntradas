// "Recordar usuario" del login: guarda el email en el navegador para que el
// agente que entra todos los días no lo tenga que escribir. Solo el email,
// nunca la contraseña (de eso se ocupa el gestor de contraseñas del navegador).
// Va a localStorage para que sobreviva al cierre de sesión y del navegador.

export const CLAVE_RECORDAR = "tm_recordar_email";

type Almacen = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function emailRecordado(almacen: Almacen): string | null {
  const v = almacen.getItem(CLAVE_RECORDAR)?.trim();
  return v ? v : null;
}

// Se llama recién con el ingreso OK, para no recordar un email mal tipeado.
// Destildar "recordar" borra el que hubiera.
export function guardarRecordado(almacen: Almacen, email: string, recordar: boolean): void {
  const limpio = email.trim();
  if (recordar && limpio) almacen.setItem(CLAVE_RECORDAR, limpio);
  else almacen.removeItem(CLAVE_RECORDAR);
}
