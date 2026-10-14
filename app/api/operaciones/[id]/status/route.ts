import { NextResponse } from "next/server";
import { avisoDeSobreventa, movimientoDeStock, type LineaDescontada } from "@/lib/stock";
import { refrescarTienda } from "@/lib/refrescar-tienda";
import { createServerSupabase, createAdminSupabase } from "@/lib/supabase/server";
import {
  estadoDe,
  operacionCompleta,
  type Operacion,
  type StatusAction,
} from "@/lib/operaciones";
import { getRol, nombreDe } from "@/lib/auth";
import { isMock, mockApplyAction, mockListOps } from "@/lib/mock-db";
import { avisarCambioAlCliente, COLUMNAS_AVISO, type OpParaAviso } from "@/lib/avisos-cliente";
import { baseUrlDe } from "@/lib/base-url";
import { actorDe, actorDemo, NOMBRE_HITO, registrarActividad, type Actor } from "@/lib/actividad";


// PATCH /api/operaciones/[id]/status — aplica una acción sobre la operación.
// "entrada" y "pago" son hitos independientes que se marcan/desmarcan por
// separado; cancelar/reabrir manejan el enum. Solo admin; service role.
//
// Body: { action: "entrada"|"pago"|"proveedor"|"cerrar", done: boolean }
//     | { action: "confirmar"|"cancelar"|"reabrir" }

function parseAction(body: any): StatusAction | null {
  if (body?.action === "cancelar" || body?.action === "reabrir" || body?.action === "confirmar") {
    return { action: body.action };
  }
  if (
    (body?.action === "entrada" ||
      body?.action === "pago" ||
      body?.action === "proveedor" ||
      body?.action === "cerrar") &&
    typeof body.done === "boolean"
  ) {
    return { action: body.action, done: body.done };
  }
  return null;
}

export async function PATCH(
  request: Request,
  { params }: { params: { id: string } }
) {
  // Auditoría: quién ejecuta la acción (queda en <hito>_por al marcar).
  let quien: string | null = null;
  let actor: Actor | null = isMock() ? actorDemo() : null;
  if (!isMock()) {
    const supabase = createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    // Los moderadores solo cargan operaciones; el estado lo maneja el admin.
    if (getRol(user) !== "administrador") {
      return NextResponse.json(
        { error: "Solo el administrador puede cambiar estados" },
        { status: 403 }
      );
    }
    // "Nombre Apellido" si cargó sus datos en Mi cuenta; si no, el email.
    quien = nombreDe(user);
    actor = actorDe(user);
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
  }

  const action = parseAction(body);
  if (!action) {
    return NextResponse.json({ error: "Acción inválida" }, { status: 400 });
  }

  if (isMock()) {
    const previa = mockListOps().find((o) => o.id === params.id);
    const antes = previa ? { ...previa } : null;
    const res = mockApplyAction(params.id, action);
    if (!res.ok) {
      return NextResponse.json({ error: res.error }, { status: res.status });
    }
    // Confirmar, cancelar o reabrir pueden haber movido el stock de una propia.
    if (antes && movimientoDeStock(action, antes, res.op)) refrescarTienda();
    if (antes) await avisarCambioAlCliente(null, antes, res.op as OpParaAviso, baseUrlDe(request));
    if (antes) await registrarActividad(null, actividadDe(action, antes, res.op as Operacion, actor, null));
    return NextResponse.json({ ...pickResult(res.op), ...(res.aviso ? { aviso: res.aviso } : {}) });
  }

  const admin = createAdminSupabase();

  const { data: current, error: readErr } = await admin
    .from("operaciones")
    // Además de los hitos, lo necesario para avisarle al cliente.
    .select(`${COLUMNAS_AVISO}, pago_proveedor_at, ticket_id`)
    .eq("id", params.id)
    .maybeSingle();

  if (readErr) {
    return NextResponse.json({ error: readErr.message }, { status: 500 });
  }
  if (!current) {
    return NextResponse.json(
      { error: "Operación no encontrada" },
      { status: 404 }
    );
  }

  const cancelada = current.status === "cancelada";
  let patch: Record<string, unknown>;

  // Un intento que el server rechaza también queda registrado: muestra qué
  // vio la persona en pantalla (p.ej. una tarjeta desactualizada).
  const rechazo = async (error: string, status = 409) => {
    await registrarActividad(admin, {
      actor,
      accion: "operacion.rechazado",
      entidad: "operacion",
      entidad_id: params.id,
      codigo: (current as { code?: string }).code ?? null,
      resumen: `Intento rechazado: ${describir(action, current as Operacion)}. ${error}`,
      detalle: { accion: action, pasos: pasosDe(current as Operacion), error },
    });
    return NextResponse.json({ error }, { status });
  };

  switch (action.action) {
    case "entrada":
    case "pago":
    case "proveedor": {
      if (cancelada) {
        return rechazo("La operación está cancelada; reabrila para editar hitos");
      }
      // Congela recién con los CUATRO hechos: haber entregado no es haber
      // terminado, y mientras falte alguno hay que poder seguir marcando
      // (se entrega antes de pagarle al proveedor todo el tiempo).
      if (operacionCompleta(current as any)) {
        return rechazo("La operación está completa; desmarcá un hito para volver a editarla");
      }
      // Los hitos NO tienen orden: en la práctica la secuencia varía (a veces
      // se le paga al proveedor antes de tener la entrada en mano). Antes acá
      // había dos 409 que forzaban entrada -> pago; se fueron junto con la
      // regla equivalente del trigger de la base.
      const COLS = {
        entrada: ["entrada_recibida_at", "entrada_recibida_por"],
        pago: ["pago_confirmado_at", "pago_confirmado_por"],
        proveedor: ["pago_proveedor_at", "pago_proveedor_por"],
      } as const;
      const [col, colPor] = COLS[action.action as keyof typeof COLS];
      patch = {
        [col]: action.done ? new Date().toISOString() : null,
        // Quién lo marcó; al desmarcar se limpia junto con el hito.
        [colPor]: action.done ? quien : null,
      };
      // Trabajar un pedido nuevo es confirmarlo: si se marca un hito sin
      // haber tocado "Confirmar pedido", queda confirmado igual.
      if (action.done && !current.confirmada_at) {
        patch.confirmada_at = new Date().toISOString();
        patch.confirmada_por = quien;
      }
      break;
    }
    case "confirmar": {
      if (cancelada) {
        return rechazo("La operación está cancelada; reabrila para confirmarla");
      }
      if (current.confirmada_at) {
        return rechazo("El pedido ya está confirmado");
      }
      patch = { confirmada_at: new Date().toISOString(), confirmada_por: quien };
      break;
    }
    case "cerrar": {
      if (cancelada) {
        return rechazo("La operación está cancelada; no se puede cerrar");
      }
      // Cerrar ya no exige hitos previos: la entrega puede estar hecha con
      // el resto pendiente de registrar, y forzarlo llevaba a marcar hitos
      // falsos solo para poder cerrar.
      patch = {
        cerrada_at: action.done ? new Date().toISOString() : null,
        cerrada_por: action.done ? quien : null,
      };
      // Igual que los otros hitos: entregar un pedido nuevo lo confirma.
      if (action.done && !current.confirmada_at) {
        patch.confirmada_at = new Date().toISOString();
        patch.confirmada_por = quien;
      }
      break;
    }
    case "cancelar": {
      if (cancelada) {
        return rechazo("La operación ya está cancelada");
      }
      // Una operación cerrada ya terminó bien: no se cancela (el trigger de
      // la base lo bloquearía igual, pero acá devolvemos un 409 claro).
      if (current.cerrada_at) {
        return rechazo("La operación está cerrada; reabrí el cierre antes de cancelar");
      }
      patch = {
        status: "cancelada",
        cancelada_at: new Date().toISOString(),
        cancelada_por: quien,
      };
      break;
    }
    case "reabrir": {
      if (!cancelada) {
        return rechazo("Solo se puede reabrir una operación cancelada");
      }
      patch = { status: "esperando_entrada", cancelada_at: null, cancelada_por: null };
      break;
    }
  }

  const { data, error } = await admin
    .from("operaciones")
    .update(patch)
    .eq("id", params.id)
    .select(
      "id, status, entrada_recibida_at, pago_confirmado_at, pago_proveedor_at, cerrada_at, entrada_recibida_por, pago_confirmado_por, pago_proveedor_por, cerrada_por, confirmada_at, confirmada_por, cancelada_at, cancelada_por, updated_at"
    )
    .single();

  if (error) {
    // P0001 = RAISE del trigger validar_orden_hitos: dos admins tocando la
    // misma operación a la vez pueden pasar el check de arriba y chocar acá.
    // Es un conflicto de estado, no un error del servidor -> 409 con el
    // mensaje del trigger (que ya está escrito para humanos).
    const esInvariante = (error as { code?: string }).code === "P0001";
    if (esInvariante) return rechazo(error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Stock de entradas propias: se toma cuando el pedido queda confirmado y se
  // devuelve al cancelar (ver lib/stock.ts y la función stock_operacion).
  // Fail-soft: si falla, la operación ya quedó actualizada igual y el stock se
  // corrige desde Entradas; se avisa en la respuesta.
  let aviso: string | null = null;
  const mov = movimientoDeStock(action, current as Operacion, data as Operacion);
  if (mov) {
    const { data: lineas, error: errStock } = await admin.rpc("stock_operacion", {
      p_op: params.id,
      p_tomar: mov === "tomar",
    });
    if (errStock) {
      console.error(`[stock] no se pudo ${mov} stock de ${params.id}: ${errStock.message}`);
      aviso = "No se pudo actualizar el stock de la tienda; revisalo en Entradas.";
    } else {
      if (mov === "tomar") aviso = avisoDeSobreventa(lineas as LineaDescontada[]);
      // La tienda muestra el stock: reflejarlo al instante.
      refrescarTienda();
    }
  }

  // Confirmado / Para pagar / Entregada: aviso al cliente (campana + email).
  // Nunca traba la respuesta con un error: se registra y sigue.
  await avisarCambioAlCliente(
    admin,
    current as OpParaAviso,
    { ...(current as OpParaAviso), ...(data as Partial<OpParaAviso>) },
    baseUrlDe(request)
  );

  await registrarActividad(
    admin,
    actividadDe(action, current as Operacion, { ...(current as Operacion), ...(data as Operacion) }, actor, mov)
  );

  return NextResponse.json({ ...pickResult(data as Operacion), ...(aviso ? { aviso } : {}) });
}

type Pasos = { confirmado: boolean; entrada: boolean; pago: boolean; proveedor: boolean; entregada: boolean; cancelada: boolean };

function pasosDe(op: Partial<Operacion>): Pasos {
  return {
    confirmado: !!op.confirmada_at,
    entrada: !!op.entrada_recibida_at,
    pago: !!op.pago_confirmado_at,
    proveedor: !!op.pago_proveedor_at,
    entregada: !!op.cerrada_at,
    cancelada: op.status === "cancelada",
  };
}

// Qué se pidió, en palabras: "desmarcar «Pago recibido»", "reabrir la operación".
function describir(action: StatusAction, antes: Partial<Operacion>): string {
  switch (action.action) {
    case "confirmar":
      return "confirmar el pedido";
    case "cancelar":
      return "cancelar la operación";
    case "reabrir":
      return "reabrir la operación cancelada";
    default: {
      const nombre = NOMBRE_HITO[action.action];
      if (action.action === "cerrar" && !action.done && operacionCompleta(antes as Operacion)) {
        return `reabrir la operación completa (desmarcar «${nombre}»)`;
      }
      return `${action.done ? "marcar" : "desmarcar"} «${nombre}»`;
    }
  }
}

function actividadDe(
  action: StatusAction,
  antes: Partial<Operacion>,
  despues: Partial<Operacion>,
  actor: Actor | null,
  stock: string | null
) {
  let resumen: string;
  switch (action.action) {
    case "confirmar":
      resumen = "Confirmó el pedido";
      break;
    case "cancelar":
      resumen = "Canceló la operación";
      break;
    case "reabrir":
      resumen = "Reabrió la operación cancelada";
      break;
    default: {
      const nombre = NOMBRE_HITO[action.action];
      resumen =
        action.action === "cerrar" && !action.done && operacionCompleta(antes as Operacion)
          ? `Reabrió la operación completa (desmarcó «${nombre}»)`
          : `${action.done ? "Marcó" : "Desmarcó"} «${nombre}»`;
      // Marcar un paso en un pedido sin confirmar también lo confirma.
      if (action.done && !antes.confirmada_at && despues.confirmada_at) resumen += " y confirmó el pedido";
    }
  }
  return {
    actor,
    accion: action.action === "confirmar" || action.action === "cancelar" || action.action === "reabrir"
      ? `operacion.${action.action}`
      : "operacion.hito",
    entidad: "operacion",
    entidad_id: (despues.id ?? antes.id) as string,
    codigo: (despues.code ?? antes.code ?? null) as string | null,
    resumen,
    detalle: {
      accion: action,
      antes: pasosDe(antes),
      despues: pasosDe(despues),
      ...(stock ? { stock } : {}),
    },
  };
}

function pickResult(
  op: Pick<
    Operacion,
    | "id"
    | "status"
    | "entrada_recibida_at"
    | "pago_confirmado_at"
    | "pago_proveedor_at"
    | "cerrada_at"
    | "entrada_recibida_por"
    | "pago_confirmado_por"
    | "cerrada_por"
  > & {
    updated_at?: string;
    pago_proveedor_por?: string | null;
    confirmada_at?: string | null;
    confirmada_por?: string | null;
    cancelada_at?: string | null;
    cancelada_por?: string | null;
  }
) {
  return {
    id: op.id,
    status: op.status,
    entrada_recibida_at: op.entrada_recibida_at,
    pago_confirmado_at: op.pago_confirmado_at,
    // El hito del proveedor faltaba acá: el panel marcaba el check, el
    // servidor lo guardaba, y la respuesta volvía sin él — así que la tarjeta
    // mostraba el hito sin tildar hasta refrescar la página.
    pago_proveedor_at: op.pago_proveedor_at,
    pago_proveedor_por: (op as { pago_proveedor_por?: string | null }).pago_proveedor_por ?? null,
    cerrada_at: op.cerrada_at,
    entrada_recibida_por: op.entrada_recibida_por,
    pago_confirmado_por: op.pago_confirmado_por,
    cerrada_por: op.cerrada_por,
    confirmada_at: op.confirmada_at ?? null,
    confirmada_por: op.confirmada_por ?? null,
    cancelada_at: op.cancelada_at ?? null,
    cancelada_por: op.cancelada_por ?? null,
    // El panel lo usa para no dejar que un refresco más viejo pise esto.
    updated_at: op.updated_at ?? null,
    estado: estadoDe(op),
  };
}
