# Backlog plan (analysis, no code yet)

## Decisions (answers of 2026-10-05)

1. Confirmations: inline in the same button ("¿Seguro? Sí / No").
2. Review before "Enviar pedido": no notes field.
3. Clickable metrics: the Panel cards **and** the Métricas money cards.
4. Map: automatic color highlight, but only when the color match is ≥ 90%; otherwise the current chip.
5. Stock: **unchanged**. It is still taken only when the client pays.
6. ~~More than the stock left → the line goes as "a consultar".~~ Superseded by decision 20 (split).
7. No auto-cancel. A pedido left hanging becomes a **priority** (top of the list, red age badge, bell, WhatsApp).
8. Un-marking pago still returns the stock.
9. No backfill.
10. Staff created from the app (email + temporary password).
11. Moderators can see the Clientes list. (Agustin Acosta was moved to moderador and then back to **administrador**; Emilia Gallo → administradora.)
12. Pending requests stay on the "Accesos" page.
13. Customer emails only on: **Confirmado**, **Para pagar**, **Entregada**.
14. Email domain: later. Emails get built, but stay off until `EMAIL_FROM` is set.
15. Staff get a bell in the Panel **and** WhatsApp.
16. WhatsApp: reworked, see block 8.

## Decisions (answers of 2026-10-08)

17. Priority after **2 h** for an unconfirmed pedido and **4 h** for a consulta without a quote.
18. **No quiet hours**: reminders go out at any time.
19. Customers get the **bell in the store + email**, for the same 3 moments (Confirmado, Para pagar, Entregada). Until the email domain exists, the bell is their only notice.
20. More than the stock left: **split**. The available amount goes as a pedido and the rest as a consulta (e.g. ask 5, 3 left → 3 pedido + 2 consulta).


Branch `plan/backlog`, from `main` at #74. The Accesos bug from block 6
shipped on its own in #76; blocks 1–8 are implemented together in #77
(migrations 0044 and 0045). All open questions are answered above.

Production snapshot (2026-10-05):
- 5 operations, 3 of them open and unpaid.
- 3 own tickets and 2,721 Passion tickets.
- 1,750 tickets with a map, and 21 distinct zone colors (all hex).
- Users: 3 admins, 3 clients, no moderators.
- 6 access requests.

---

## 1. In-page confirmations instead of browser pop-ups

**Today: 6 `confirm()` pop-ups.**
- Accesos (3): reject request, resend access (new password), revoke/reactivate (`components/admin/SolicitudesAcceso.tsx:80,131,167`).
- Mis pedidos (3): accept quote, reject quote, cancel order/consult (`components/tienda/MisPedidos.tsx:133,155`).
- The panel's "Cancelar operación" already had its own two-step confirmation ("¿Confirmás cancelar?"); it now uses the shared component.

**Plan.**
- One shared `ConfirmarBoton` component. The first tap turns the button into "¿Seguro? **Sí, cancelar** · No", inline in the same spot.
- It resets after ~5 s or on tapping elsewhere.
- No modal: it works the same on phone and desktop, and it is keyboard-accessible.
- It replaces the 6 pop-ups and the panel's own cancel confirmation.
- Discarding a consult also gets a confirmation.

## 2. Confirmation step before "Enviar pedido"

**Today.** The cart modal goes straight from the item list to POST `/api/pedidos`, with no review step. There are no form fields: the buyer comes from the session.

**Plan.** "Enviar pedido" opens a review step inside the same modal:
- Items, split into "Pedido" (bookable) and "Consulta" (on request).
- A total per currency.
- What happens next: "no se cobra nada ahora; te confirmamos y te pasamos cómo pagar".
- Buttons: **Confirmar y enviar** / Volver.
- A double tap can't send twice: the button disables while sending, and taps right after the review opens are ignored. (The server does **not** de-duplicate orders, so the guard is on the client.)

## 3. Clickable metrics in "Panel"

**Today.** The 5 cards in `AdminDashboard` (A cotizar, Esperando cliente, En curso, Para entregar, Entregadas) are display-only. The money metrics (Volumen, Comisiones, Entradas, Capital comprometido) live in a separate board on `/moderador`.

**Plan.**
- Each card becomes a button that sets the list filter, scrolls to the list, and highlights the active card. Tapping again clears it.
- **En curso**, **Para entregar** and **Entregadas** map 1:1 to existing tabs.
- **A cotizar** and **Esperando cliente** need 2 new filters that show only consults in that state. Today consults never filter by state.

## 4. Colored sector marker on the stadium map

> Decided: option A (decision 4). When two different zones of the same event match the same map color, neither is highlighted and both keep the chip.

**Today.**
- A sector has `zona_color` (hex) shown as a dot and text chip, plus one map image per event.
- There are **no coordinates** anywhere, so we can't know where a sector is on the image.

**Options.**
- **A. Automatic color highlight (recommended).**
  - When a sector is tapped, the browser reads the map image and finds the pixels of that zone's color.
  - It dims the rest and outlines or pulses the zone.
  - No data entry, and it works for all 1,750 mapped tickets at once.
  - Risk: maps where two zones share a color, or with gradients. In those cases it falls back to today's chip.
- **B. Manual pins.**
  - An admin taps once per zone per map in "Entradas" to place a marker (stored as x/y %).
  - Exact, but it means manual work on ~255 maps, and new Passion maps start without pins.
- **C. Hybrid.** Automatic by default, plus manual pins where the automatic one is wrong.

## 5. Stock (decided: unchanged; only the over-stock split)

> Superseded by decisions 5–9 and 20. The analysis below is kept for reference. The only change is this: when an order line for an own ticket asks for more than the stock left, the server **splits** it: the stock left goes as a pedido and the rest as a consulta (ask 5 with 3 left → 3 pedido + 2 consulta; 0 left → all consulta).

### Original analysis

**Today.**
- Stock moves only when **payment** is marked: taken on pago ✓, returned on pago ✗ or on cancel.
- It only applies to **own** tickets (`manual::…`). Passion stock is overwritten by the worker every 5 min from the portal, so the app never touches it.
- The store caps the cart at the visible stock. The server does not block a sold-out own ticket (stock 0 counts as "no data"), and nothing is reserved between order and payment.

**Original plan (dropped by decision 5, not built).**
- ~~Stock is taken for own tickets as soon as an operation exists (store order, staff-created op, accepted quote). It stays when paid/delivered and is returned when cancelled (by client or admin). Reopening takes it again.~~
- ~~Same SQL function (`stock_operacion`), so the move is atomic and recorded per line in `stock_descontado`.~~
- ~~One migration to take stock for the open unpaid ops that exist today.~~

## 6. "Equipo / Clientes" admin screen (+ Accesos bug)

**Bug found (fixed in #76).**
- `revocar/route.ts:75-77` wrote `role: null` on revoke and hardcoded `role: "cliente"` on reactivate.
- A staff member who also had an access request (e.g. a client later made admin) lost their staff role on Revocar→Restaurar.
- "Reenviar acceso" also reset their password, and `/api/clientes` listed them as a client.
- No check prevented an admin from doing this to themselves.
- Since #76, staff are no longer managed from Accesos at all.

**Today.**
- No way to create staff or change roles from the app (only the Supabase dashboard).
- No staff list.
- Clients only exist through access requests.

**Plan: new "Equipo" section (admin only), two tabs.**
- **Equipo:**
  - Lists admins/moderators.
  - Invite staff (email → user created with a temporary password emailed, same as clients).
  - Change role.
  - Deactivate/reactivate (blocks login without erasing the role).
  - Guards: can't demote or deactivate yourself, can't remove the last admin.
- **Clientes:**
  - Every client with orders, open orders, total bought per currency, and last order.
  - Click → their orders in the panel.
  - Revoke/reactivate.
  - "Accesos" (pending requests) stays on its own page (decision 12).
- Every role change is logged: who, when, from→to.

## 7. Customer bell and emails (PR E)

**Today.**
- Customers get **no** notifications except the credentials email.
- No status-change emails, no "your quote is ready", no bell.
- Resend is wired (`lib/email.ts`) but production needs `RESEND_API_KEY` + `EMAIL_FROM` on a verified domain.

**Plan (narrowed by decisions 13, 14 and 19).**
- **Emails to the customer, in their language (es/en), only for three moments:**
  - Confirmado.
  - **Para pagar** (with the payment text per currency).
  - Entregada.
- Only when the order moves **forward**: un-marking a step or reopening sends nothing.
- They stay off until `EMAIL_FROM` is set (decision 14). Until then the bell is the customer's only notice.
- Each email links to Mis pedidos.
- **Bell in the store header:** unread count plus a list of the same three moments, marked read on open. Backed by a `notificaciones` table filled by the same code that sends the emails. The panel's order card shows what the customer was notified of and whether the email went out.

## 8. WhatsApp for staff (reworked)

What changes the design:
- Volume is low (a few operations a week) and the team is 3 people.
- Meta charges per business-initiated template, and every template needs approval.
- Template variables can't contain line breaks.
- Staff will now also have the in-app bell (decision 15).

So WhatsApp is only for "someone has to act and you're probably not looking at the panel". The bell covers the rest.

**Two kinds of message, three templates total.**
1. **Instant: new work.** Sent for:
   - A new pedido (to confirm).
   - A new consulta (to quote).
   - A customer accepting or cancelling.
   - A new access request.

   It's one short line plus a link that opens that exact operation. This reuses `nuevo_pedido` / `nuevo_acceso`, plus one new generic `aviso_operacion` template.
2. **Reminder: left hanging** (decision 7). One message per item, never repeated:
   - A pedido unconfirmed after **2 h** (decision 17).
   - A consulta not quoted after **4 h** (decision 17).
   - A quote expiring in < 6 h.
   - An event in < 48 h that isn't delivered yet.

   The item also turns red and jumps to the top of the Panel.
   - If several items are due at once, they go together as one message: "3 pendientes: 2 por confirmar, 1 por entregar", with a link to the Panel already filtered.
   - No daily digest when there's nothing pending.

**The clock.** Reminders need something that checks every few minutes. Vercel's free cron only runs once a day, but **the worker already calls the app every 5 minutes** (`/api/revalidar`, with the server key). It will also call `/api/recordatorios`, so there's nothing new to host or pay for.

**Who gets what.**
- Each staff member uses the phone in their profile (it already exists in "Mi cuenta"), with an on/off switch in Equipo.
- Instead of one global list (`WHATSAPP_VENDEDORES`):
  - Notices and reminders for an operation go to its **vendedor** when the vendedor names exactly one team member who can act on it (full name, first name or email); otherwise to everyone with the right role.
  - Consultas go to whoever can quote (admins and moderators), including a customer cancelling one.
- `WHATSAPP_VENDEDORES` stays as the fallback: it is used only while nobody on the team has the switch on, so the deploy changes nothing until someone turns it on.

**Quiet hours.** None (decision 18).

**No duplicates.** Every notification is a row in the same `notificaciones` table the bell uses. The row records what was sent and to whom (the person's phone or the fallback list), so nothing is sent twice and failures stay visible in the panel's bell with the reason, not only in the Vercel logs.

## Order (as done)

1. **Accesos bug fix** (block 6): #76, merged.
2. **Blocks 1–8**, together in #77:
   - UX batch: 1 + 2 + 3.
   - Equipo / Clientes: 6 (migration 0044).
   - Over-stock split: 5 (no migration; stock at creation was dropped).
   - Map highlight: 4.
   - Customer bell + emails: 7 (migration 0045).
   - Staff bell, WhatsApp and reminders: 8 (migration 0045). It reuses 3's filters.
3. **Release:** apply 0044 and 0045, merge #77, redeploy the worker, create and approve the `aviso_operacion` template and set `WHATSAPP_TEMPLATE_AVISO`. Later: `RESEND_API_KEY` and `EMAIL_FROM` for customer emails.
