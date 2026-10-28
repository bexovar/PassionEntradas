# Revisión de los documentos legales: cobro al confirmar

Revisamos los documentos legales contra el flujo de cobro que se está definiendo, en el que **se cobra al confirmar la operación, antes de tener la entrada del proveedor**, y contra la Disposición 954/2025.

Los textos están en `lib/tienda-i18n.ts`, en `legal.docs`, en español y en inglés, y se muestran en `/legal/[doc]`.

> **No es asesoramiento legal.** Antes de publicar, un abogado tiene que revisar los textos y completar lo que falta (ver "Pendiente antes de publicar").

## Marco legal usado

- **Ley 24.240, art. 34, y Código Civil y Comercial, arts. 1110 y siguientes:** derecho de revocación en la venta a distancia. Es de 10 días corridos, sin causa, y el consumidor no puede cargar con ningún costo. El derecho tiene que informarse en los documentos de la venta (CCyC art. 1111).
- **Disposición 954/2025 de la Subsecretaría de Defensa del Consumidor y Lealtad Comercial** (BO 04/09/2025):
  - **Art. 1:** link "BOTÓN DE ARREPENTIMIENTO" a simple vista, en lugar destacado y desde el primer acceso al sitio, sin registro previo ni otros trámites.
  - **Art. 2:** para entradas a espectáculos o eventos, los 10 días corridos se cuentan desde la entrega de las entradas o del comprobante de pago, lo que ocurra primero, con independencia de la fecha del evento. El aviso tiene que darse con al menos 24 horas de antelación al evento.
  - **Art. 5:** dentro de las 24 horas, y por el mismo medio, hay que informar el código de identificación de la solicitud.
  - **Art. 6:** el sitio tiene que informar el canal de consultas y reclamos.
  - **Art. 7:** el incumplimiento se sanciona bajo la Ley 24.240.
  - La disposición **no regula** el medio ni el plazo del reintegro. Por eso esos datos los define TicketMirror.
- **Ley 25.326:** derechos sobre los datos personales y leyenda de la Agencia de Acceso a la Información Pública (AAIP).

Fuentes: [texto oficial de la Disposición 954/2025](https://www.argentina.gob.ar/normativa/nacional/norma-417152/texto) y [copia en PDF](https://www.consejosalta.org.ar/wp-content/uploads/DISPO.-954.pdf).

## Puntos del pedido y dónde quedaron

| Punto | Dónde | Qué dice |
|---|---|---|
| Cancelación libre vs. arrepentimiento, según el estado | Reembolsos §2, §3, §4 y §8; Términos §6 | Antes de confirmar: cancelación libre y sin costo, porque no se cobró nada. Después del cobro: arrepentimiento por 10 días corridos desde el comprobante de pago o la entrada (lo primero), con al menos 24 h antes del evento y devolución total. Pasado ese plazo: cancelación sujeta a lo que acepte el proveedor, informando el monto antes de confirmarla. |
| Se cobró y no se consigue la entrada | Reembolsos §6; Términos §6 | Aviso apenas se sabe. El pasajero elige entre el reintegro del 100% o una ubicación de categoría igual o superior sin costo, si la hay. Si no hay alternativa o no elige en 48 h, se reintegra el 100%. Nunca tiene cargo. |
| Procedimiento de reembolso: plazo, medio y quién | Reembolsos §9 | **Quién:** TicketMirror. **Medio:** el mismo con el que se pagó o, si no se puede, transferencia a una cuenta a nombre de quien pagó, en la misma moneda. **Plazo:** se inicia dentro de los 10 días hábiles; la acreditación depende del banco o la tarjeta. Se avisa con el código y el comprobante. |
| TicketMirror es el vendedor frente al pasajero | Términos §2; Reembolsos §1; Privacidad §3; Aviso legal §1 | TicketMirror vende y responde frente al pasajero, y emite el comprobante. La agencia actúa en nombre del pasajero y le transmite las condiciones. TicketMirror trata los datos del pasajero como vendedor. |

**Otros cambios:**
- **Términos:**
  - Nuevo §5, sobre el cobro al confirmar.
  - La limitación de responsabilidad ahora aclara que no recorta los derechos de la Ley 24.240.
  - Ley aplicable argentina y canal de reclamos.
  - Los cambios en los términos no afectan pedidos ya confirmados.
- **Privacidad:** se agregan los datos del pasajero, con quién se comparten (proveedor u organizador y medio de pago) y la leyenda de la AAIP.
- **Aviso legal:** ley aplicable argentina.
- **Cookies:** sin cambios.
- **Fecha de actualización:** octubre de 2026.

## Decisiones tomadas (confirmar con el cliente)

- **Reintegro:** se inicia dentro de los **10 días hábiles**.
- **Medio:** el **mismo medio de pago**, y como respaldo una transferencia a nombre de quien pagó. Se devuelve en la misma moneda.
- **Si no se consigue la entrada:** se ofrece el reintegro total o una opción equivalente sin costo, y el pasajero tiene **48 horas** para elegir.

Supuestos que conviene validar:
- **Evento cancelado por el organizador:** reintegro del 100%. Si el evento se **reprograma**, la entrada vale para la nueva fecha, y si el pasajero no puede ir se informan las opciones del organizador. Este punto depende de cada organizador.
- **Pasado el plazo de arrepentimiento:** no se garantiza la cancelación; se gestiona ante el proveedor.

## Pendiente antes de publicar

1. **Botón de arrepentimiento (bloqueante).** Los textos lo mencionan, pero **el sitio todavía no lo tiene**. La Disposición 954/2025 lo exige a la vista desde el primer acceso, con ese nombre y sin pedir sesión. Además, dentro de las 24 h tiene que devolver por el mismo medio un código de identificación de la solicitud. Hay que construirlo antes o junto con este cambio.
2. **El flujo del código todavía no cobra al confirmar.** Hoy el cliente paga cuando ya está la entrada (`listo_para_pagar`), y `clientePuedeCancelar` (`lib/operaciones.ts`) deja cancelar libremente también un pedido **confirmado**. Estos textos describen el flujo nuevo, así que tienen que mergearse junto con ese cambio. Con el cobro al confirmar, la cancelación libre desde Mis pedidos tiene que quedar solo para pedidos sin confirmar.
3. **Datos del titular.** Falta la razón social, el CUIT y el domicilio de TicketMirror (Aviso legal §1 y Términos §2). Como TicketMirror es el vendedor frente al consumidor, el sitio tiene que identificarlo.
4. **Canal de reclamos explícito** (Disposición 954/2025, art. 6). Los textos dicen "WhatsApp o email indicados en el sitio", pero el sitio no publica un email. Hay que publicar un email o un teléfono de consultas y reclamos.
5. **Relación agencia–pasajero.** Los textos asumen que la agencia compra en nombre del pasajero y le transmite las condiciones. El abogado tiene que confirmar esa figura, y si hace falta un acuerdo aparte con las agencias.
6. **Comprobante de pago.** Como el plazo de arrepentimiento corre desde el comprobante, conviene que el comprobante (`/factura/[id]`) también informe el derecho de arrepentimiento y el link al botón (CCyC art. 1111).
