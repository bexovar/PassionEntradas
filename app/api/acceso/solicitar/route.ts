import { NextResponse } from "next/server";
import { createAdminSupabase } from "@/lib/supabase/server";
import { validarSolicitud } from "@/lib/acceso";
import { isMock, mockCrearSolicitud, mockListSolicitudes } from "@/lib/mock-db";
import { notificarSolicitudAcceso } from "@/lib/whatsapp";
import { notificarVendedoresEmail } from "@/lib/email";
import { avisarEquipo } from "@/lib/avisos-equipo";
import { baseUrlDe } from "@/lib/base-url";
import { registrarActividad } from "@/lib/actividad";

// POST /api/acceso/solicitar — PÚBLICO. Un visitante de la landing pide
// acceso a la tienda. Se inserta con service role (la tabla es RLS deny-all).
// Anti-spam: honeypot + validación. Una sola solicitud PENDIENTE por email
// (unique index); un duplicado se trata como éxito idempotente (no se filtra
// si el email ya pidió, ni se le da error al usuario legítimo que reintenta).
export async function POST(request: Request) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  // Honeypot: campo oculto que sólo un bot completa. Fingimos éxito para no
  // darle señal de que fue detectado.
  if (typeof body?.empresa === "string" && body.empresa.trim() !== "") {
    return NextResponse.json({ ok: true });
  }

  const parsed = validarSolicitud(body ?? {});
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const { nombre, email, telefono, legajo, mensaje, acepto } = parsed.value;

  // Aviso al staff. Best-effort y DESPUÉS de guardar: una solicitud no se
  // pierde porque WhatsApp o el mail estén caídos. Sin esto la solicitud
  // quedaba esperando a que alguien se acordara de mirar el panel.
  const avisar = async () => {
    const texto =
      `Nueva solicitud de acceso\n` +
      `Nombre: ${nombre}\n` +
      `Email: ${email}\n` +
      `Teléfono: ${telefono}\n` +
      `Legajo/CUIT: ${legajo}` +
      (mensaje ? `\nMensaje: ${mensaje}` : "") +
      `\n\nAprobala desde el panel.`;
    const [res, mail] = await Promise.all([
      // Campana de los admins + WhatsApp (lib/avisos-equipo).
      avisarEquipo(
        isMock() ? null : createAdminSupabase(),
        { tipo: "nuevo_acceso", ref: crypto.randomUUID(), datos: { nombre, email }, url: "/admin/solicitudes" },
        (para, url) => notificarSolicitudAcceso({ nombre, email, telefono, legajo, texto, link: `${baseUrlDe(request)}${url}` }, para)
      ),
      notificarVendedoresEmail(`Nueva solicitud de acceso — ${nombre}`, texto),
    ]).catch(() => [] as const);
    const wa = res?.whatsapp;
    // Antes se descartaba el resultado entero: si fallaba, no quedaba
    // ningún rastro. El log de whatsapp.ts ya cubre el motivo detallado; acá
    // alcanza con dejar una línea que diga que el aviso de ESTA solicitud
    // no salió, para no tener que adivinar mirando el panel.
    if (wa && !wa.ok) {
      console.error(`[acceso] aviso de WhatsApp no salió para ${email}: ${wa.error}`);
    }
    if (mail && !mail.ok) {
      console.error(`[acceso] aviso por email no salió para ${email}: ${mail.error}`);
    }
  };

  // Registro de actividad: alguien sin cuenta pidió acceso desde la landing.
  // Solo cuando quedó una solicitud NUEVA (un duplicado no cambia nada).
  const registrar = (admin: Parameters<typeof registrarActividad>[0], solicitudId: string | null) =>
    registrarActividad(admin, {
      actor: null,
      accion: "acceso.solicitar",
      entidad: "solicitud",
      entidad_id: solicitudId,
      resumen: `${nombre} (${email}) pidió acceso a la tienda`,
      detalle: { nombre, email, telefono, legajo, mensaje, acepto_terminos: acepto },
      origen: "landing",
    });

  if (isMock()) {
    const pendienteDe = (s: { estado: string; email: string }) =>
      s.estado === "pendiente" && s.email.toLowerCase() === email.toLowerCase();
    const yaPendiente = mockListSolicitudes().some(pendienteDe);
    const r = mockCrearSolicitud(parsed.value);
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
    if (!yaPendiente) await registrar(null, mockListSolicitudes().find(pendienteDe)?.id ?? null);
    await avisar();
    return NextResponse.json({ ok: true }, { status: 201 });
  }

  const admin = createAdminSupabase();
  const { data: creada, error } = await admin
    .from("solicitudes_acceso")
    .insert({ nombre, email, telefono, legajo, mensaje, acepto_terminos: acepto })
    .select("id");

  if (error) {
    // 23505 = unique_violation: ya hay una solicitud PENDIENTE con ese email.
    // No es un error para el usuario: ya está en la cola.
    if ((error as any).code === "23505") {
      // Ya había una solicitud pendiente de ese email: no se vuelve a avisar,
      // el staff ya la tiene en el panel.
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json(
      { error: "No se pudo registrar la solicitud" },
      { status: 500 }
    );
  }

  await registrar(admin, creada?.[0]?.id ?? null);
  await avisar();
  return NextResponse.json({ ok: true }, { status: 201 });
}
