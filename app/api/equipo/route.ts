import { NextResponse } from "next/server";
import { createServerSupabase, createAdminSupabase } from "@/lib/supabase/server";
import { getRol, nombreDe, rolGuardado } from "@/lib/auth";
import { generarPassword } from "@/lib/acceso";
import { emailConfigurado, enviarEmail } from "@/lib/email";
import { leerUsuarios, mensajeAltaEquipo, parsearAlta, rolEquipoDeUsuario, type AltaEquipo } from "@/lib/equipo";
import { isMock, MOCK_USER, mockAltaEquipo } from "@/lib/mock-db";
import { actorDe, actorDemo, registrarActividad, type Actor } from "@/lib/actividad";

// Aleatoriedad de calidad para la contraseña (no Math.random).
function randomCrypto(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0]! / 2 ** 32;
}

function urlIngreso(request: Request): string {
  const base = process.env.NEXT_PUBLIC_SITE_URL
    ? process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "")
    : new URL(request.url).origin;
  return `${base}/ingresar`;
}

// POST /api/equipo — SOLO administrador. Suma a alguien al equipo:
// - email nuevo: crea el usuario con contraseña temporal y devuelve las
//   credenciales UNA vez (y las manda por email si hay proveedor);
// - email de un cliente que ya tiene cuenta: con `promover` le cambia el rol
//   (sin tocar su contraseña); sin `promover` avisa, para confirmarlo.
// Queda registrado en equipo_cambios y en Actividad (nunca la contraseña).
export async function POST(request: Request) {
  let por = MOCK_USER.email;
  let actor: Actor | null = isMock() ? actorDemo() : null;
  if (!isMock()) {
    const supabase = createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    if (getRol(user) !== "administrador") {
      return NextResponse.json({ error: "Solo un administrador gestiona el equipo" }, { status: 403 });
    }
    por = nombreDe(user) ?? user.email ?? "admin";
    actor = actorDe(user);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }
  const alta = parsearAlta(body);
  if ("error" in alta) return NextResponse.json({ error: alta.error }, { status: 400 });

  const conCredenciales = async (credenciales: { email: string; password: string } | null) => {
    if (!credenciales) return { credenciales: null, mensaje: null, emailEnviado: false };
    const mensaje = mensajeAltaEquipo({
      nombre: alta.nombre,
      email: credenciales.email,
      password: credenciales.password,
      urlIngreso: urlIngreso(request),
      rol: alta.rol,
    });
    // Best-effort, como en Accesos: el usuario ya está creado.
    let emailEnviado = false;
    if (emailConfigurado()) {
      const envio = await enviarEmail({ to: credenciales.email, subject: "Tu acceso al equipo de TicketMirror", text: mensaje });
      emailEnviado = envio.ok;
    }
    return { credenciales, mensaje, emailEnviado };
  };

  if (isMock()) {
    const r = mockAltaEquipo(alta, por);
    if (!r.ok) return NextResponse.json({ error: r.error, esCliente: r.esCliente ?? false }, { status: r.status });
    const extra = await conCredenciales(r.credenciales);
    // El demo solo promueve clientes (sin credenciales); con credenciales es alguien nuevo.
    await registrarActividad(
      null,
      r.credenciales
        ? actividadAlta(actor, r.id, alta, extra.emailEnviado)
        : actividadPromover(actor, r.id, alta, quienDe(alta.nombre, alta.email), "cliente")
    );
    return NextResponse.json({ id: r.id, ...extra });
  }

  const admin = createAdminSupabase();
  let existente;
  try {
    existente = (await leerUsuarios(admin)).find((u) => (u.email ?? "").toLowerCase() === alta.email);
  } catch (e) {
    return NextResponse.json({ error: `No se pudo leer los usuarios: ${(e as Error).message}` }, { status: 503 });
  }

  if (existente) {
    if (rolEquipoDeUsuario(existente)) {
      return NextResponse.json({ error: "Ya es parte del equipo." }, { status: 409 });
    }
    if (!alta.promover) {
      // Cualquier cuenta que no es del equipo se puede pasar al equipo:
      // también la de un cliente con el acceso revocado (rol vacío), que si no
      // quedaba sin forma de sumarse.
      const revocado = rolGuardado(existente) !== "cliente";
      return NextResponse.json(
        { error: revocado ? "Ya tiene cuenta (con el acceso revocado)." : "Ya tiene cuenta de cliente.", esCliente: true, revocado },
        { status: 409 }
      );
    }
    const { error } = await admin.auth.admin.updateUserById(existente.id, {
      app_metadata: { role: alta.rol, desactivado: false },
      ban_duration: "none",
    });
    if (error) return NextResponse.json({ error: `No se pudo cambiar el rol: ${error.message}` }, { status: 500 });
    const { error: logErr } = await admin.from("equipo_cambios").insert({
      user_id: existente.id,
      email: existente.email,
      accion: "alta",
      rol_antes: rolGuardado(existente),
      rol_despues: alta.rol,
      por,
    });
    await registrarActividad(
      admin,
      actividadPromover(actor, existente.id, alta, quienDe(nombreDe(existente), existente.email ?? alta.email), rolGuardado(existente))
    );
    return NextResponse.json({
      id: existente.id,
      ...(await conCredenciales(null)),
      aviso: logErr ? "El cambio se hizo pero no quedó en el registro." : undefined,
    });
  }

  const password = generarPassword(randomCrypto);
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: alta.email,
    password,
    email_confirm: true,
    app_metadata: { role: alta.rol },
    user_metadata: { nombre: alta.nombre, apellido: alta.apellido },
  });
  if (createErr || !created?.user) {
    return NextResponse.json(
      { error: `No se pudo crear el usuario: ${createErr?.message ?? "error desconocido"}` },
      { status: 409 }
    );
  }
  const { error: logErr } = await admin.from("equipo_cambios").insert({
    user_id: created.user.id,
    email: alta.email,
    accion: "alta",
    rol_antes: null,
    rol_despues: alta.rol,
    por,
  });
  const extra = await conCredenciales({ email: alta.email, password });
  await registrarActividad(admin, actividadAlta(actor, created.user.id, alta, extra.emailEnviado));
  return NextResponse.json({
    id: created.user.id,
    ...extra,
    aviso: logErr ? "El usuario se creó pero el alta no quedó en el registro." : undefined,
  });
}

// "Juan Pérez (juan@x.com)", o solo el email si no hay nombre.
function quienDe(nombre: string | null | undefined, email: string): string {
  const n = (nombre ?? "").trim();
  return n && n.toLowerCase() !== email.toLowerCase() ? `${n} (${email})` : email;
}

// Alta de alguien nuevo. Sin la contraseña temporal: solo si salió por email.
function actividadAlta(actor: Actor | null, id: string, alta: AltaEquipo, emailEnviado: boolean) {
  const nombre = `${alta.nombre} ${alta.apellido}`.trim();
  return {
    actor,
    accion: "equipo.alta",
    entidad: "usuario",
    entidad_id: id,
    codigo: null,
    resumen: `Sumó a ${quienDe(nombre, alta.email)} al equipo como ${alta.rol}${emailEnviado ? " (credenciales por email)" : ""}`,
    detalle: { email: alta.email, nombre: alta.nombre, apellido: alta.apellido, rol: alta.rol, nuevo: true, email_enviado: emailEnviado },
    origen: "panel" as const,
  };
}

// Una cuenta que ya existía (cliente, o con el acceso revocado) pasa al equipo.
function actividadPromover(actor: Actor | null, id: string, alta: AltaEquipo, quien: string, rolAntes: string | null) {
  const antes = rolAntes === "cliente" ? "era cliente" : "tenía el acceso revocado";
  return {
    actor,
    accion: "equipo.alta",
    entidad: "usuario",
    entidad_id: id,
    codigo: null,
    resumen: `Pasó a ${quien} al equipo como ${alta.rol} (${antes})`,
    detalle: { email: alta.email, rol_antes: rolAntes, rol_despues: alta.rol, nuevo: false },
    origen: "panel" as const,
  };
}
