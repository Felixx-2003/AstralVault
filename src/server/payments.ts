const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };

export const PAYMENT_PACKS = [
  { id: 'stardust', label: 'Stardust Cache', credits: 300, amountMinor: 299, currency: 'usd', price: '$2.99' },
  { id: 'constellation', label: 'Constellation Case', credits: 1_200, amountMinor: 899, currency: 'usd', price: '$8.99' },
  { id: 'nebula', label: 'Nebula Reserve', credits: 3_000, amountMinor: 1_999, currency: 'usd', price: '$19.99' },
] as const;

type PaymentEnv = {
  DB: D1Database;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  PAYMENTS_TEST_ENABLED?: string;
  ACCOUNT_RECOVERY_ENABLED?: string;
};

type OrderRow = {
  order_id: string;
  player_id: string;
  bundle_id: string;
  amount_minor: number;
  currency: string;
  paid_credits: number;
  request_hash: string;
  status: 'pending' | 'paid' | 'expired';
  stripe_session_id: string | null;
  checkout_url: string | null;
};

type StripeSession = {
  id?: string;
  url?: string;
  livemode?: boolean;
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function equalConstantTime(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let i = 0; i < left.length; i += 1) difference |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return difference === 0;
}

function hex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function stripeSignature(secret: string, timestamp: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${body}`));
  return hex(new Uint8Array(signature));
}

export async function verifyStripeSignature(
  body: string,
  header: string | null,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  if (!header || !secret) return false;
  const parts = header.split(',').map((part) => part.trim().split('=', 2));
  const timestamps = parts.filter(([key]) => key === 't').map(([, value]) => value || '');
  const signatures = parts.filter(([key]) => key === 'v1').map(([, value]) => value || '');
  const timestamp = timestamps[0];
  if (!timestamp || !/^\d{1,12}$/.test(timestamp) || signatures.length === 0) return false;
  const seconds = Number(timestamp);
  if (!Number.isSafeInteger(seconds) || Math.abs(nowSeconds - seconds) > 300) return false;
  const expected = await stripeSignature(secret, timestamp, body);
  return signatures.some((signature) => /^[\da-f]{64}$/i.test(signature) && equalConstantTime(signature.toLowerCase(), expected));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function paymentDisabled(): Response {
  return json({ error: 'Purchases are unavailable. Guest archives cannot currently be recovered.' }, 503);
}

export async function createCheckout(
  env: PaymentEnv,
  playerId: string,
  requestId: string,
  requestHash: string,
  bundleId: unknown,
  origin: string,
  stripeFetch: typeof fetch = fetch,
): Promise<Response> {
  if (typeof bundleId !== 'string') return json({ error: 'Choose a valid paid-credit bundle.' }, 400);
  const bundle = PAYMENT_PACKS.find((item) => item.id === bundleId);
  if (!bundle) return json({ error: 'Choose a valid paid-credit bundle.' }, 400);
  if (env.PAYMENTS_TEST_ENABLED !== 'true' || env.ACCOUNT_RECOVERY_ENABLED !== 'true') return paymentDisabled();
  const secretKey = env.STRIPE_SECRET_KEY || '';
  const webhookSecret = env.STRIPE_WEBHOOK_SECRET || '';
  if (!secretKey.startsWith('sk_test_') || !webhookSecret.startsWith('whsec_')) return paymentDisabled();

  let order = await env.DB.prepare('SELECT * FROM checkout_orders WHERE player_id = ? AND request_id = ?')
    .bind(playerId, requestId).first<OrderRow>();
  if (order) {
    if (order.request_hash !== requestHash || order.bundle_id !== bundle.id) {
      return json({ error: 'That checkout key was already used for a different request.' }, 409);
    }
    if (order.status !== 'pending') return json({ error: 'This checkout order is no longer available.' }, 409);
    if (order.stripe_session_id && order.checkout_url) return json({ orderId: order.order_id, checkoutUrl: order.checkout_url });
  } else {
    const orderId = crypto.randomUUID();
    try {
      await env.DB.prepare(`
        INSERT INTO checkout_orders
          (order_id, player_id, bundle_id, amount_minor, currency, paid_credits, request_id, request_hash, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
      `).bind(orderId, playerId, bundle.id, bundle.amountMinor, bundle.currency, bundle.credits, requestId, requestHash, Date.now()).run();
    } catch {
      order = await env.DB.prepare('SELECT * FROM checkout_orders WHERE player_id = ? AND request_id = ?')
        .bind(playerId, requestId).first<OrderRow>();
      if (!order) return json({ error: 'The checkout order could not be prepared. Retry with the same request key.' }, 503);
      if (order.request_hash !== requestHash || order.bundle_id !== bundle.id) return json({ error: 'That checkout key was already used for a different request.' }, 409);
      if (order.stripe_session_id && order.checkout_url) return json({ orderId: order.order_id, checkoutUrl: order.checkout_url });
    }
    if (!order) order = await env.DB.prepare('SELECT * FROM checkout_orders WHERE player_id = ? AND request_id = ?')
      .bind(playerId, requestId).first<OrderRow>();
  }
  if (!order) return json({ error: 'The checkout order could not be prepared.' }, 503);

  const form = new URLSearchParams();
  form.set('mode', 'payment');
  form.set('payment_method_types[0]', 'card');
  form.set('success_url', new URL('/?checkout=complete', origin).toString());
  form.set('cancel_url', new URL('/?checkout=cancelled', origin).toString());
  form.set('client_reference_id', order.order_id);
  form.set('line_items[0][price_data][currency]', bundle.currency);
  form.set('line_items[0][price_data][unit_amount]', String(bundle.amountMinor));
  form.set('line_items[0][price_data][product_data][name]', bundle.label);
  form.set('line_items[0][price_data][product_data][description]', `${bundle.credits.toLocaleString('en-US')} Paid Astral Credits`);
  form.set('line_items[0][quantity]', '1');
  form.set('metadata[order_id]', order.order_id);
  form.set('metadata[player_id]', playerId);
  form.set('metadata[bundle_id]', bundle.id);
  form.set('payment_intent_data[metadata][order_id]', order.order_id);
  form.set('payment_intent_data[metadata][player_id]', playerId);

  let stripeResponse: Response;
  try {
    stripeResponse = await stripeFetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${secretKey}`,
        'content-type': 'application/x-www-form-urlencoded',
        'idempotency-key': `astral-vault-${order.order_id}`,
      },
      body: form.toString(),
    });
  } catch {
    return json({ error: 'Stripe could not be reached. Retry this checkout with the same request key.' }, 502);
  }
  const stripeData = await stripeResponse.json().catch(() => null) as StripeSession | null;
  if (!stripeResponse.ok || !stripeData || typeof stripeData.id !== 'string' || typeof stripeData.url !== 'string' || stripeData.livemode !== false) {
    return json({ error: 'Stripe did not create a valid test checkout. No credits were added.' }, 502);
  }
  const saved = await env.DB.prepare(`
    UPDATE checkout_orders SET stripe_session_id = ?, checkout_url = ?
    WHERE order_id = ? AND status = 'pending' AND (stripe_session_id IS NULL OR stripe_session_id = ?)
  `).bind(stripeData.id, stripeData.url, order.order_id, stripeData.id).run();
  if (saved.meta.changes !== 1) {
    const current = await env.DB.prepare('SELECT * FROM checkout_orders WHERE order_id = ?').bind(order.order_id).first<OrderRow>();
    if (current?.stripe_session_id !== stripeData.id || !current.checkout_url) return json({ error: 'The checkout order changed before it could be saved.' }, 409);
    return json({ orderId: current.order_id, checkoutUrl: current.checkout_url });
  }
  return json({ orderId: order.order_id, checkoutUrl: stripeData.url });
}

export async function handleStripeWebhook(request: Request, env: PaymentEnv): Promise<Response> {
  const secret = env.STRIPE_WEBHOOK_SECRET || '';
  if (!secret.startsWith('whsec_')) return json({ error: 'Payment notifications are not configured.' }, 503);
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > 65_536) return json({ error: 'Webhook body is too large.' }, 413);
  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > 65_536) return json({ error: 'Webhook body is too large.' }, 413);
  if (!await verifyStripeSignature(rawBody, request.headers.get('stripe-signature'), secret)) {
    return json({ error: 'Invalid or expired Stripe signature.' }, 400);
  }

  let event: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(rawBody);
    if (!isRecord(parsed)) throw new Error('Invalid event.');
    event = parsed;
  } catch {
    return json({ error: 'Malformed Stripe event.' }, 400);
  }
  const eventId = event.id;
  const eventData = isRecord(event.data) ? event.data : null;
  const session = eventData && isRecord(eventData.object) ? eventData.object : null;
  const metadata = session && isRecord(session.metadata) ? session.metadata : null;
  const orderId = metadata?.order_id;
  if (typeof eventId !== 'string' || !/^evt_[A-Za-z0-9_]+$/.test(eventId) || event.type !== 'checkout.session.completed' || event.livemode !== false || !session || !metadata) {
    return json({ error: 'Unsupported Stripe event.' }, 400);
  }
  const priorEvent = await env.DB.prepare('SELECT order_id FROM stripe_events WHERE event_id = ?').bind(eventId).first<{ order_id: string }>();
  if (priorEvent) {
    if (priorEvent.order_id !== orderId) return json({ error: 'Stripe event identifier is already linked to another order.' }, 409);
    return json({ received: true, replayed: true });
  }

  const sessionId = session.id;
  const playerId = metadata.player_id;
  const bundleId = metadata.bundle_id;
  if (session.livemode !== false || session.mode !== 'payment' || session.status !== 'complete' || session.payment_status !== 'paid') {
    return json({ error: 'Only completed, paid test-mode checkout sessions can be credited.' }, 400);
  }
  if (typeof orderId !== 'string' || typeof playerId !== 'string' || typeof bundleId !== 'string' || typeof sessionId !== 'string' || session.client_reference_id !== orderId) {
    return json({ error: 'Stripe session metadata is incomplete or does not match.' }, 400);
  }

  const order = await env.DB.prepare('SELECT * FROM checkout_orders WHERE order_id = ?').bind(orderId).first<OrderRow>();
  if (!order) return json({ error: 'Checkout order was not found.' }, 404);
  const bundle = PAYMENT_PACKS.find((item) => item.id === order.bundle_id);
  const amount = session.amount_total;
  const currency = session.currency;
  if (!bundle || order.player_id !== playerId || order.bundle_id !== bundleId || order.amount_minor !== bundle.amountMinor || order.currency !== bundle.currency || order.paid_credits !== bundle.credits || amount !== order.amount_minor || currency !== order.currency) {
    return json({ error: 'Stripe amount, currency or account does not match the saved order.' }, 400);
  }
  if (order.status === 'paid') {
    if (order.stripe_session_id !== sessionId) return json({ error: 'This order has already been paid by another checkout session.' }, 409);
    await env.DB.prepare('INSERT OR IGNORE INTO stripe_events (event_id, order_id, session_id, received_at) VALUES (?, ?, ?, ?)')
      .bind(eventId, orderId, sessionId, Date.now()).run();
    return json({ received: true, replayed: true });
  }
  if (order.status !== 'pending' || (order.stripe_session_id && order.stripe_session_id !== sessionId)) {
    return json({ error: 'Checkout order is not pending for this Stripe session.' }, 409);
  }

  try {
    const results = await env.DB.batch([
      env.DB.prepare('INSERT INTO stripe_events (event_id, order_id, session_id, received_at) VALUES (?, ?, ?, ?)')
        .bind(eventId, orderId, sessionId, Date.now()),
      env.DB.prepare(`
        UPDATE checkout_orders SET status = 'paid', stripe_session_id = ?, paid_at = ?
        WHERE order_id = ? AND player_id = ? AND status = 'pending' AND amount_minor = ? AND currency = ?
          AND paid_credits = ? AND (stripe_session_id IS NULL OR stripe_session_id = ?) AND changes() = 1
      `).bind(sessionId, Date.now(), orderId, playerId, order.amount_minor, order.currency, order.paid_credits, sessionId),
      env.DB.prepare(`
        UPDATE players SET paid_balance = paid_balance + ?, revision = revision + 1
        WHERE player_id = ? AND changes() = 1
          AND EXISTS (SELECT 1 FROM checkout_orders WHERE order_id = ? AND status = 'paid' AND stripe_session_id = ?)
      `).bind(order.paid_credits, playerId, orderId, sessionId),
      env.DB.prepare(`
        INSERT INTO paid_credit_ledger (order_id, event_id, player_id, credits, created_at)
        VALUES (?, ?, ?, CASE WHEN changes() = 1 THEN ? ELSE -1 END, ?)
      `).bind(orderId, eventId, playerId, order.paid_credits, Date.now()),
    ]);
    if (results.some((result) => result.meta.changes !== 1)) return json({ error: 'The paid order could not be committed.' }, 409);
  } catch {
    const accepted = await env.DB.prepare('SELECT order_id FROM stripe_events WHERE event_id = ?').bind(eventId).first<{ order_id: string }>();
    if (accepted?.order_id === orderId) return json({ received: true, replayed: true });
    const current = await env.DB.prepare('SELECT status, stripe_session_id FROM checkout_orders WHERE order_id = ?').bind(orderId).first<{ status: string; stripe_session_id: string | null }>();
    if (current?.status === 'paid' && current.stripe_session_id === sessionId) return json({ received: true, replayed: true });
    return json({ error: 'The paid order could not be committed.' }, 409);
  }
  return json({ received: true, credited: order.paid_credits });
}
