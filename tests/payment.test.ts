import { beforeEach, describe, expect, it } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { createCheckout, PAYMENT_PACKS } from '../src/server/payments';

const ORIGIN = 'https://astral-vault.test';
const WEBHOOK_SECRET = 'whsec_test_for_automated_signature_checks_2026';
let playerId = '';

function toHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function signature(rawBody: string, timestamp = Math.floor(Date.now() / 1000), secret = WEBHOOK_SECRET): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const value = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${timestamp}.${rawBody}`));
  return `t=${timestamp},v1=${toHex(new Uint8Array(value))}`;
}

async function reset() {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM paid_credit_ledger'),
    env.DB.prepare('DELETE FROM stripe_events'),
    env.DB.prepare('DELETE FROM checkout_orders'),
    env.DB.prepare('DELETE FROM action_receipts'),
    env.DB.prepare('DELETE FROM player_team'),
    env.DB.prepare('DELETE FROM collection'),
    env.DB.prepare('DELETE FROM players'),
    env.DB.prepare('DELETE FROM guest_bootstrap_limits'),
  ]);
  playerId = '';
}

async function guest() {
  const response = await SELF.fetch(`${ORIGIN}/api/state`, { headers: { 'cf-connecting-ip': '203.0.113.81' } });
  expect(response.status).toBe(200);
  const cookie = response.headers.get('set-cookie')!.split(';')[0]!;
  playerId = cookie.split('.')[0]!.split('=')[1]!;
  return cookie;
}

async function seedOrder(id = 'checkout-order-test-001') {
  const pack = PAYMENT_PACKS[0];
  await env.DB.prepare(`
    INSERT INTO checkout_orders
      (order_id, player_id, bundle_id, amount_minor, currency, paid_credits, request_id, request_hash, status, stripe_session_id, checkout_url, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
  `).bind(id, playerId, pack.id, pack.amountMinor, pack.currency, pack.credits, 'checkout-request-0001', 'test-hash', 'cs_test_checkout_001', 'https://checkout.stripe.test/session', Date.now()).run();
  return { id, pack, sessionId: 'cs_test_checkout_001' };
}

function makeEvent(order: Awaited<ReturnType<typeof seedOrder>>, patch: {
  id?: string;
  eventLivemode?: boolean;
  livemode?: boolean;
  amount?: number;
  currency?: string;
  paymentStatus?: string;
  status?: string;
  playerId?: string;
} = {}) {
  return {
    id: patch.id || 'evt_astral_test_payment_0001',
    object: 'event',
    type: 'checkout.session.completed',
    livemode: patch.eventLivemode ?? false,
    data: {
      object: {
        id: order.sessionId,
        object: 'checkout.session',
        client_reference_id: order.id,
        mode: 'payment',
        status: patch.status || 'complete',
        payment_status: patch.paymentStatus || 'paid',
        livemode: patch.livemode ?? false,
        currency: patch.currency || order.pack.currency,
        amount_total: patch.amount ?? order.pack.amountMinor,
        metadata: { order_id: order.id, player_id: patch.playerId || playerId, bundle_id: order.pack.id },
      },
    },
  };
}

async function sendEvent(event: unknown, signatureHeader?: string) {
  const rawBody = JSON.stringify(event);
  const sig = signatureHeader || await signature(rawBody);
  return SELF.fetch(`${ORIGIN}/api/stripe/webhook`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'stripe-signature': sig },
    body: rawBody,
  });
}

beforeEach(reset);

describe('test-mode Stripe adapter', () => {
  it('keeps checkout disabled until account recovery and test credentials are explicitly configured', async () => {
    const cookie = await guest();
    const response = await SELF.fetch(`${ORIGIN}/api/checkout`, {
      method: 'POST',
      headers: { origin: ORIGIN, cookie, 'content-type': 'application/json', 'idempotency-key': 'checkout-request-disabled-01' },
      body: JSON.stringify({ bundleId: 'stardust' }),
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: expect.stringContaining('unavailable') });
    const rows = await env.DB.prepare('SELECT COUNT(*) AS count FROM checkout_orders').first<{ count: number }>();
    expect(rows?.count).toBe(0);
  });

  it('persists a fixed-price idempotent pending order before opening a Stripe test session', async () => {
    const cookie = await guest();
    let calls = 0;
    const stripeFetch: typeof fetch = async (input, init) => {
      calls += 1;
      expect(String(input)).toBe('https://api.stripe.com/v1/checkout/sessions');
      expect(new Headers(init?.headers).get('idempotency-key')).toMatch(/^astral-vault-/);
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer sk_test_fixture_only');
      const form = new URLSearchParams(String(init?.body));
      expect(form.get('line_items[0][price_data][unit_amount]')).toBe(String(PAYMENT_PACKS[0].amountMinor));
      expect(form.get('line_items[0][price_data][currency]')).toBe('usd');
      expect(form.get('payment_method_types[0]')).toBe('card');
      return new Response(JSON.stringify({ id: 'cs_test_checkout_fixture', url: 'https://checkout.stripe.test/fixture', livemode: false }), { status: 200 });
    };
    const paymentEnv = {
      DB: env.DB,
      PAYMENTS_TEST_ENABLED: 'true',
      ACCOUNT_RECOVERY_ENABLED: 'true',
      STRIPE_SECRET_KEY: 'sk_test_fixture_only',
      STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
    };
    const key = 'checkout-request-fixed-0001';
    const hash = 'a'.repeat(64);
    const player = cookie.split('.')[0]!.split('=')[1]!;
    const first = await createCheckout(paymentEnv, player, key, hash, 'stardust', ORIGIN, stripeFetch);
    expect(first.status).toBe(200);
    const result = await first.json() as { orderId: string; checkoutUrl: string };
    expect(result.checkoutUrl).toBe('https://checkout.stripe.test/fixture');
    const order = await env.DB.prepare('SELECT * FROM checkout_orders WHERE player_id = ? AND request_id = ?').bind(player, key).first<Record<string, string | number>>();
    expect(order).toMatchObject({ bundle_id: 'stardust', amount_minor: 299, currency: 'usd', paid_credits: 300, request_hash: hash, status: 'pending' });
    expect(order?.order_id).toBe(result.orderId);
    const retry = await createCheckout(paymentEnv, player, key, hash, 'stardust', ORIGIN, stripeFetch);
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual(result);
    expect(calls).toBe(1);
    const changed = await createCheckout(paymentEnv, player, key, 'b'.repeat(64), 'nebula', ORIGIN, stripeFetch);
    expect(changed.status).toBe(409);
    expect(calls).toBe(1);
  });

  it('rejects an invalid signature without recording an event or crediting the account', async () => {
    await guest();
    const order = await seedOrder();
    const response = await sendEvent(makeEvent(order), 't=1,v1=invalid');
    expect(response.status).toBe(400);
    const player = await env.DB.prepare('SELECT paid_balance FROM players WHERE player_id = ?').bind(playerId).first<{ paid_balance: number }>();
    const eventCount = await env.DB.prepare('SELECT COUNT(*) AS count FROM stripe_events').first<{ count: number }>();
    expect(player?.paid_balance).toBe(0);
    expect(eventCount?.count).toBe(0);
  });

  it('credits once for a verified payment and safely acknowledges event and order replays', async () => {
    await guest();
    const order = await seedOrder();
    const event = makeEvent(order);
    const first = await sendEvent(event);
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ received: true, credited: order.pack.credits });
    const replay = await sendEvent(event);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ received: true, replayed: true });

    const anotherEventForPaidOrder = await sendEvent(makeEvent(order, { id: 'evt_astral_test_payment_0002' }));
    expect(anotherEventForPaidOrder.status).toBe(200);
    expect(await anotherEventForPaidOrder.json()).toMatchObject({ received: true, replayed: true });
    const player = await env.DB.prepare('SELECT paid_balance FROM players WHERE player_id = ?').bind(playerId).first<{ paid_balance: number }>();
    const ledger = await env.DB.prepare('SELECT COUNT(*) AS count FROM paid_credit_ledger').first<{ count: number }>();
    const events = await env.DB.prepare('SELECT COUNT(*) AS count FROM stripe_events').first<{ count: number }>();
    expect(player?.paid_balance).toBe(order.pack.credits);
    expect(ledger?.count).toBe(1);
    expect(events?.count).toBe(2);
  });

  it.each([
    ['wrong amount', { amount: 298 }],
    ['wrong currency', { currency: 'eur' }],
    ['unpaid session', { paymentStatus: 'unpaid' }],
    ['open session', { status: 'open' }],
    ['live-mode session', { livemode: true }],
    ['live-mode event', { eventLivemode: true }],
    ['different player', { playerId: 'not-the-order-owner' }],
  ])('does not credit a %s', async (_label, patch) => {
    await guest();
    const order = await seedOrder();
    const response = await sendEvent(makeEvent(order, patch));
    expect(response.status).toBeGreaterThanOrEqual(400);
    const player = await env.DB.prepare('SELECT paid_balance FROM players WHERE player_id = ?').bind(playerId).first<{ paid_balance: number }>();
    const orderRow = await env.DB.prepare('SELECT status FROM checkout_orders WHERE order_id = ?').bind(order.id).first<{ status: string }>();
    expect(player?.paid_balance).toBe(0);
    expect(orderRow?.status).toBe('pending');
  });

  it('rejects stale signed webhook timestamps', async () => {
    await guest();
    const order = await seedOrder();
    const event = makeEvent(order);
    const raw = JSON.stringify(event);
    const stale = await signature(raw, Math.floor(Date.now() / 1000) - 301);
    const response = await sendEvent(event, stale);
    expect(response.status).toBe(400);
  });
});
