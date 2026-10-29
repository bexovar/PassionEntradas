import { NextResponse } from "next/server";
import { createHash } from "crypto";
import { createAdminSupabase } from "@/lib/supabase/server";
import { evaluarLimiteSolicitud, ipDe, SOL_VENTANA_MS, validarSolicitud } from "@/lib/acceso";
import { isMock, mockCrearSolicitud, mockListSolicitudes } from "@/lib/mock-db";
import { notificarSolicitudAcceso } from "@/lib/whatsapp";
import { notificarVendedoresEmail } from "@/lib/email";
import { avisarEquipo } from "@/lib/avisos-equipo";
import { baseUrlDe } from "@/lib/base-url";
import { registrarActividad } from "@/lib/actividad";

// POST /api/acceso/solicitar — PÚBLICO. Un visitante de la landing pide
// acceso a la tienda. Se inserta con service role (la tabla es RLS deny-all).
// Anti-spam: honeypot + validación + límite por hora (por IP y en total, ver
// evaluarLimiteSolicitud). Una sola solicitud PENDIENTE por email (unique
// index); un duplicado se trata como éxito idempotente (no se filtra si el
// email ya pidió, ni se le da error al usuario legítimo que reintenta).
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
  // `afuera` = false (pasó el tope de la hora): solo la campana del panel,
  // sin WhatsApp ni email.
  const avisar = async (afuera: boolean) => {
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
        afuera
          ? (para, url) => notificarSolicitudAcceso({ nombre, email, telefono, legajo, texto, link: `${baseUrlDe(request)}${url}` }, para)
          : null
      ),
      afuera ? notificarVendedoresEmail(`Nueva solicitud de acceso — ${nombre}`, texto) : null,
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
    await avisar(true);
    return NextResponse.json({ ok: true }, { status: 201 });
  }

  const admin = createAdminSupabase();

  // Límite de la última hora. Si contar falla (o la columna ip_hash todavía
  // no existe, 0050 sin aplicar) se cuenta 0: mejor dejar pasar una
  // solicitud legítima que perderla.
  const ip = ipDe(request.headers);
  const ipHash = ip ? createHash("sha256").update(`tm-solicitud:${ip}`).digest("hex") : null;
  const desde = new Date(Date.now() - SOL_VENTANA_MS).toISOString();
  const contar = async (soloEstaIp: boolean) => {
    let q = admin.from("solicitudes_acceso").select("id", { count: "exact", head: true }).gte("created_at", desde);
    if (soloEstaIp) q = q.eq("ip_hash", ipHash);
    const { count, error } = await q;
    return error ? 0 : count ?? 0;
  };
  const [deEstaIp, total] = await Promise.all([ipHash ? contar(true) : 0, contar(false)]);
  const limite = evaluarLimiteSolicitud({ deEstaIp, total });
  if (!limite.aceptar) {
    // Igual que el honeypot: éxito fingido, sin guardar ni avisar.
    console.warn(`[acceso] tope por IP alcanzado (${deEstaIp} en la última hora): solicitud descartada`);
    return NextResponse.json({ ok: true });
  }

  const fila = { nombre, email, telefono, legajo, mensaje, acepto_terminos: acepto };
  let { data: creada, error } = await admin
    .from("solicitudes_acceso")
    .insert({ ...fila, ip_hash: ipHash })
    .select("id");
  // 42703 = columna inexistente: la migración 0050 todavía no se aplicó.
  if (error && (error as { code?: string }).code === "42703") {
    ({ data: creada, error } = await admin.from("solicitudes_acceso").insert(fila).select("id"));
  }

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
  if (!limite.avisarAfuera) console.warn(`[acceso] ${total} solicitudes en la última hora: aviso solo en la campana`);
  await avisar(limite.avisarAfuera);
  return NextResponse.json({ ok: true }, { status: 201 });
}
