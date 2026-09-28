import { DAILY_REWARD, HEROES, HERO_BY_ID, PITY, PULL_ODDS, STARTING_FREE_PULLS, SUMMON_COST } from '../shared/catalog';
import { deriveStats, resolveBattle, secureRandom, simulateSummons, type BattleUnit, type OwnedCard } from '../shared/engine';
import { BATTLE_DAILY_CREDIT_CAP, BATTLE_DAILY_SHARD_CAP, BOSS_BONUS, CAMPAIGN_ISLANDS, CAMPAIGN_LENGTH, CAMPAIGN_STAGES, PRACTICE_REWARD, campaignStage, type Stance } from '../shared/campaign';
import { createCheckout, handleStripeWebhook, PAYMENT_PACKS } from './payments';

interface PlayerRow {
  player_id: string;
  soft_balance: number;
  paid_balance: number;
  shards: number;
  free_pulls: number;
  pity5: number;
  pity4: number;
  total_pulls: number;
  revision: number;
  last_daily: string | null;
  battle_wins: number;
  last_battle_at: number;
  battle_reward_day: string | null;
  battle_reward_credits: number;
  battle_reward_shards: number;
  campaign_cleared: number;
  starter_team_granted: number;
  created_at: number;
}

interface CollectionRow {
  hero_id: string;
  level: number;
  roll_attack: number;
  roll_hp: number;
  roll_defense: number;
  acquired_at: number;
}

interface ReceiptRow {
  fingerprint: string;
  response_json: string;
  action: string;
}

type Env = {
  DB: D1Database;
  ASSETS: Fetcher;
  SESSION_SECRET?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  PAYMENTS_TEST_ENABLED?: string;
  ACCOUNT_RECOVERY_ENABLED?: string;
};

type Replay = { kind: 'new' } | { kind: 'replay'; response: Response };

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };
const COOKIE_NAME = 'astral_session';
const BATTLE_COOLDOWN_SECONDS = 3;
const GUEST_CREATION_LIMIT = 10;
const GUEST_CREATION_WINDOW_SECONDS = 60 * 60;
const STORE = {
  enabled: false,
  paidCurrency: 'Paid Astral Credits',
  message: 'Purchases are unavailable while the game uses guest-only accounts. No payment will be taken.',
  bundles: PAYMENT_PACKS.map(({ id, label, credits, price }) => ({ id, label, amount: credits, price })),
};

function json(data: unknown, status = 200, extraHeaders?: HeadersInit): Response {
  return new Response(JSON.stringify(data), { status, headers: { ...JSON_HEADERS, ...extraHeaders } });
}

function withCookie(response: Response, cookie: string | null): Response {
  if (!cookie) return response;
  const headers = new Headers(response.headers);
  headers.set('set-cookie', cookie);
  return new Response(response.body, { status: response.status, headers });
}

function readCookie(request: Request, name: string): string | null {
  const cookieHeader = request.headers.get('cookie') || '';
  for (const part of cookieHeader.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return rest.join('=') || null;
  }
  return null;
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return base64Url(new Uint8Array(signature));
}

async function takeGuestCreationSlot(request: Request, env: Env): Promise<boolean> {
  const url = new URL(request.url);
  const forwardedIp = request.headers.get('cf-connecting-ip')?.trim();
  const localHost = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1';
  const address = forwardedIp || (localHost ? '127.0.0.1' : '');
  if (!address || address.length > 64 || !/^[A-Fa-f0-9:.]+$/.test(address)) {
    throw new ApiError(503, 'A secure guest session could not be opened. Please retry shortly.');
  }
  const secret = env.SESSION_SECRET;
  if (!secret || secret.length < 24) throw new Error('SESSION_SECRET must contain at least 24 characters.');
  const ipHash = await hmac(secret, address.toLowerCase());
  const now = Math.floor(Date.now() / 1000);
  const windowStart = Math.floor(now / GUEST_CREATION_WINDOW_SECONDS) * GUEST_CREATION_WINDOW_SECONDS;
  await env.DB.prepare('DELETE FROM guest_bootstrap_limits WHERE window_start < ?')
    .bind(windowStart - 24 * GUEST_CREATION_WINDOW_SECONDS).run();
  const result = await env.DB.prepare(`
    INSERT INTO guest_bootstrap_limits (ip_hash, window_start, requests) VALUES (?, ?, 1)
    ON CONFLICT(ip_hash, window_start) DO UPDATE SET requests = requests + 1
    WHERE requests < ?
  `).bind(ipHash, windowStart, GUEST_CREATION_LIMIT).run();
  return result.meta.changes === 1;
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let i = 0; i < left.length; i += 1) difference |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return difference === 0;
}

async function sessionFor(request: Request, env: Env, allowCreate = true): Promise<{ playerId: string; cookie: string | null }> {
  const secret = env.SESSION_SECRET;
  if (!secret || secret.length < 24) throw new Error('SESSION_SECRET must contain at least 24 characters.');
  const candidate = readCookie(request, COOKIE_NAME);
  if (candidate) {
    const separator = candidate.lastIndexOf('.');
    const playerId = separator > 0 ? candidate.slice(0, separator) : '';
    const signature = separator > 0 ? candidate.slice(separator + 1) : '';
    if (/^[0-9a-f-]{36}$/i.test(playerId) && signature) {
      const expected = await hmac(secret, playerId);
      if (constantTimeEqual(signature, expected)) {
        const found = await env.DB.prepare('SELECT player_id FROM players WHERE player_id = ?').bind(playerId).first<{ player_id: string }>();
        if (found) return { playerId, cookie: null };
      }
    }
  }

  if (!allowCreate) throw new ApiError(401, 'Open the archive before taking this action.');
  if (!await takeGuestCreationSlot(request, env)) throw new ApiError(429, 'Too many new guest archives from this connection. Please try again later.');

  const playerId = crypto.randomUUID();
  const createdAt = Date.now();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO players (player_id, free_pulls, starter_team_granted, created_at) VALUES (?, ?, 1, ?)')
      .bind(playerId, STARTING_FREE_PULLS, createdAt),
    ...(['pax', 'eda'] as const).map((heroId) => env.DB.prepare('INSERT INTO collection (player_id, hero_id, level, roll_attack, roll_hp, roll_defense, acquired_at) VALUES (?, ?, 1, 0, 0, 0, ?)')
      .bind(playerId, heroId, createdAt)),
    ...(['pax', 'eda'] as const).map((heroId, slot) => env.DB.prepare('INSERT INTO player_team (player_id, slot, hero_id) VALUES (?, ?, ?)')
      .bind(playerId, slot, heroId)),
  ]);
  const signed = `${playerId}.${await hmac(secret, playerId)}`;
  const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
  const cookie = `${COOKIE_NAME}=${signed}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax${secure}`;
  return { playerId, cookie };
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${canonical(object[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

async function parseJson(request: Request): Promise<Record<string, unknown>> {
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > 4096) throw new ApiError(413, 'Request body is too large.');
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > 4096) throw new ApiError(413, 'Request body is too large.');
  let data: unknown;
  try { data = JSON.parse(text || '{}'); } catch { throw new ApiError(400, 'Send a valid JSON object.'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new ApiError(400, 'Send a JSON object.');
  return data as Record<string, unknown>;
}

class ApiError extends Error {
  constructor(public status: number, message: string, public details?: unknown) { super(message); }
}

function assertOrigin(request: Request): void {
  const origin = request.headers.get('origin');
  if (!origin || origin !== new URL(request.url).origin) throw new ApiError(403, 'This action must come from the game site.');
}

function idempotencyKey(request: Request): string {
  const value = request.headers.get('idempotency-key') || '';
  if (!/^[A-Za-z0-9_-]{12,100}$/.test(value)) throw new ApiError(400, 'A unique Idempotency-Key is required.');
  return value;
}

async function actionReplay(db: D1Database, playerId: string, key: string, action: string, fingerprint: string): Promise<Replay> {
  const receipt = await db.prepare('SELECT action, fingerprint, response_json FROM action_receipts WHERE player_id = ? AND idempotency_key = ?')
    .bind(playerId, key).first<ReceiptRow>();
  if (!receipt) return { kind: 'new' };
  if (receipt.action !== action || receipt.fingerprint !== fingerprint) {
    return { kind: 'replay', response: json({ error: 'That request key was already used for different data. Start a new action.' }, 409) };
  }
  return { kind: 'replay', response: new Response(receipt.response_json, { headers: JSON_HEADERS }) };
}

function receiptGate(playerId: string, key: string, actionId: string): { sql: string; values: string[] } {
  return {
    sql: 'EXISTS (SELECT 1 FROM action_receipts WHERE player_id = ? AND idempotency_key = ? AND action_id = ?)',
    values: [playerId, key, actionId],
  };
}

async function commitAction(
  db: D1Database,
  player: PlayerRow,
  key: string,
  action: string,
  fingerprint: string,
  actionId: string,
  responseBody: unknown,
  updateSql: string,
  updateValues: unknown[],
  afterUpdate: D1PreparedStatement[] = [],
): Promise<'committed' | 'conflict' | 'replay' | 'key-conflict'> {
  const gate = receiptGate(player.player_id, key, actionId);
  const update = db.prepare(updateSql).bind(...updateValues);
  const storeReceipt = db.prepare(`
    INSERT INTO action_receipts (player_id, idempotency_key, action, fingerprint, action_id, response_json, created_at)
    SELECT ?, ?, ?, ?, ?, ?, ? WHERE changes() = 1
  `).bind(player.player_id, key, action, fingerprint, actionId, JSON.stringify(responseBody), Date.now());
  const guardedWrites = afterUpdate.map((statement) => statement);
  const results = await db.batch([update, storeReceipt, ...guardedWrites]);
  if (results[0]?.meta.changes === 1 && results[1]?.meta.changes === 1) return 'committed';
  const prior = await db.prepare('SELECT action, fingerprint FROM action_receipts WHERE player_id = ? AND idempotency_key = ?')
    .bind(player.player_id, key).first<Pick<ReceiptRow, 'action' | 'fingerprint'>>();
  if (prior) return prior.action === action && prior.fingerprint === fingerprint ? 'replay' : 'key-conflict';
  return 'conflict';
}

function newActionId(): string { return crypto.randomUUID(); }

async function requirePlayer(db: D1Database, playerId: string): Promise<PlayerRow> {
  const player = await db.prepare('SELECT * FROM players WHERE player_id = ?').bind(playerId).first<PlayerRow>();
  if (!player) throw new ApiError(401, 'Guest session expired. Refresh the game to start a new guest session.');
  return player;
}

function dayKey(timestamp = Date.now()): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

async function getState(db: D1Database, playerId: string): Promise<Record<string, unknown>> {
  const [playerResult, collectionResult, teamResult, recordsResult] = await db.batch([
    db.prepare('SELECT * FROM players WHERE player_id = ?').bind(playerId),
    db.prepare('SELECT hero_id, level, roll_attack, roll_hp, roll_defense, acquired_at FROM collection WHERE player_id = ?').bind(playerId),
    db.prepare('SELECT hero_id FROM player_team WHERE player_id = ? ORDER BY slot ASC').bind(playerId),
    db.prepare('SELECT stage, best_stars, best_rounds FROM stage_records WHERE player_id = ? ORDER BY stage ASC').bind(playerId),
  ]);
  const player = (playerResult.results as PlayerRow[] | undefined)?.[0];
  if (!player) throw new ApiError(401, 'Guest session expired. Refresh the game to start a new guest session.');
  const collection = ((collectionResult.results as CollectionRow[] | undefined) || []).flatMap((row) => {
    const hero = HERO_BY_ID.get(row.hero_id);
    if (!hero) return [];
    const owned: OwnedCard = {
      heroId: row.hero_id,
      level: Number(row.level),
      rollAttack: Number(row.roll_attack),
      rollHp: Number(row.roll_hp),
      rollDefense: Number(row.roll_defense),
    };
    return [{ ...hero, level: owned.level, stats: deriveStats(hero, owned), acquiredAt: Number(row.acquired_at) }];
  });
  const today = dayKey();
  const lastBattleRemaining = Math.max(0, BATTLE_COOLDOWN_SECONDS - Math.ceil((Date.now() - player.last_battle_at) / 1000));
  const reset = new Date(`${today}T00:00:00.000Z`);
  reset.setUTCDate(reset.getUTCDate() + 1);
  const battleCreditsEarned = player.battle_reward_day === today ? Number(player.battle_reward_credits) : 0;
  const battleShardsEarned = player.battle_reward_day === today ? Number(player.battle_reward_shards) : 0;
  const cleared = Math.min(CAMPAIGN_LENGTH, Number(player.campaign_cleared));
  const records = ((recordsResult.results as { stage: number; best_stars: number; best_rounds: number }[] | undefined) || [])
    .map((row) => ({ stage: Number(row.stage), stars: Number(row.best_stars), bestRounds: Number(row.best_rounds) }));
  return {
    player: {
      credits: player.soft_balance,
      paidCurrency: player.paid_balance,
      shards: player.shards,
      freePulls: player.free_pulls,
      pity5: player.pity5,
      pity4: player.pity4,
      totalPulls: player.total_pulls,
      revision: player.revision,
      battleWins: player.battle_wins,
      lastDaily: player.last_daily,
    },
    collection,
    team: ((teamResult.results as { hero_id: string }[] | undefined) || []).map((row) => row.hero_id),
    daily: { available: player.last_daily !== today, reward: DAILY_REWARD, nextResetUtc: reset.toISOString() },
    campaign: {
      cleared,
      total: CAMPAIGN_LENGTH,
      complete: cleared >= CAMPAIGN_LENGTH,
      currentStage: Math.min(CAMPAIGN_LENGTH, cleared + 1),
      nextBoss: cleared >= CAMPAIGN_LENGTH ? null : Math.ceil((cleared + 1) / 5) * 5,
      records,
      stars: records.reduce((total, record) => total + record.stars, 0),
    },
    battle: {
      cooldownSeconds: lastBattleRemaining,
      stage: Math.min(CAMPAIGN_LENGTH, cleared + 1),
      rewardCreditsEarned: battleCreditsEarned,
      rewardCreditsCap: BATTLE_DAILY_CREDIT_CAP,
      rewardCreditsRemaining: Math.max(0, BATTLE_DAILY_CREDIT_CAP - battleCreditsEarned),
      rewardShardsEarned: battleShardsEarned,
      rewardShardsCap: BATTLE_DAILY_SHARD_CAP,
      rewardShardsRemaining: Math.max(0, BATTLE_DAILY_SHARD_CAP - battleShardsEarned),
    },
    store: STORE,
  };
}

function conflictResponse(message = 'Your saved game changed while this action was running. Refresh and try again.') {
  return json({ error: message, retry: true }, 409);
}

async function routeApi(request: Request, env: Env, playerId: string): Promise<Response> {
  const { pathname } = new URL(request.url);
  const method = request.method.toUpperCase();

  if (method === 'GET' && pathname === '/api/catalog') {
    return json({ heroes: HEROES, odds: PULL_ODDS, pity: PITY, summonCost: SUMMON_COST, startingFreePulls: STARTING_FREE_PULLS, dailyReward: DAILY_REWARD, islands: CAMPAIGN_ISLANDS, stages: CAMPAIGN_STAGES, store: STORE });
  }
  if (method === 'GET' && pathname === '/api/state') {
    return json(await getState(env.DB, playerId));
  }
  if (method !== 'POST') return json({ error: 'This API route accepts POST or GET only.' }, 405);

  assertOrigin(request);
  if (!(request.headers.get('content-type') || '').toLowerCase().includes('application/json')) throw new ApiError(415, 'Use application/json for game actions.');
  const body = await parseJson(request);
  const key = idempotencyKey(request);
  const fingerprint = await sha256(canonical(body));
  const action = pathname.slice('/api/'.length);
  const replay = await actionReplay(env.DB, playerId, key, action, fingerprint);
  if (replay.kind === 'replay') return replay.response;
  const player = await requirePlayer(env.DB, playerId);
  const actionId = newActionId();

  if (pathname === '/api/summon') {
    if (Object.keys(body).length !== 1 || !Object.hasOwn(body, 'count')) throw new ApiError(400, 'Summon accepts only a count of one or ten.');
    const count = body.count;
    if (count !== 1 && count !== 10) throw new ApiError(400, 'Choose one or ten summons.');
    const freeUsed = Math.min(Number(player.free_pulls), count);
    const creditCost = (count - freeUsed) * SUMMON_COST;
    if (player.soft_balance + player.paid_balance < creditCost) throw new ApiError(402, `You need ${creditCost} credits for this summon.`);
    const softCreditsSpent = Math.min(Number(player.soft_balance), creditCost);
    const paidCreditsSpent = creditCost - softCreditsSpent;
    const ownedRows = await env.DB.prepare('SELECT hero_id, level, roll_attack, roll_hp, roll_defense FROM collection WHERE player_id = ?')
      .bind(playerId).all<CollectionRow>();
    const owned = new Map((ownedRows.results || []).map((row) => [row.hero_id, {
      heroId: row.hero_id, level: Number(row.level), rollAttack: Number(row.roll_attack), rollHp: Number(row.roll_hp), rollDefense: Number(row.roll_defense),
    }]));
    const simulation = simulateSummons(HEROES, count, Number(player.pity5), Number(player.pity4), owned, secureRandom);
    const responseBody = {
      count,
      freeUsed,
      creditsSpent: creditCost,
      softCreditsSpent,
      paidCreditsSpent,
      pity5: simulation.pity5,
      pity4: simulation.pity4,
      results: simulation.results.map((result) => ({
        heroId: result.hero.id,
        rarity: result.rarity,
        duplicate: result.duplicate,
        shards: result.shards,
        guaranteed: result.guaranteed,
        stats: result.stats,
      })),
      shardsEarned: simulation.shardsEarned,
    };
    const newFree = Number(player.free_pulls) - freeUsed;
    const writeStatements = simulation.newCards.map((card) => {
      const gate = receiptGate(playerId, key, actionId);
      return env.DB.prepare(`
        INSERT OR IGNORE INTO collection (player_id, hero_id, level, roll_attack, roll_hp, roll_defense, acquired_at)
        SELECT ?, ?, ?, ?, ?, ?, ? WHERE ${gate.sql}
      `).bind(playerId, card.heroId, card.level, card.rollAttack, card.rollHp, card.rollDefense, Date.now(), ...gate.values);
    });
    const result = await commitAction(
      env.DB, player, key, 'summon', fingerprint, actionId, responseBody,
      `UPDATE players SET soft_balance = soft_balance - ?, paid_balance = paid_balance - ?, free_pulls = ?, shards = shards + ?, pity5 = ?, pity4 = ?, total_pulls = total_pulls + ?, revision = revision + 1 WHERE player_id = ? AND revision = ? AND soft_balance >= ? AND paid_balance >= ? AND NOT EXISTS (SELECT 1 FROM action_receipts WHERE player_id = ? AND idempotency_key = ?)`,
      [softCreditsSpent, paidCreditsSpent, newFree, simulation.shardsEarned, simulation.pity5, simulation.pity4, count, playerId, player.revision, softCreditsSpent, paidCreditsSpent, playerId, key], writeStatements,
    );
    if (result === 'replay') return (await actionReplay(env.DB, playerId, key, 'summon', fingerprint) as Extract<Replay, { kind: 'replay' }>).response;
    if (result === 'key-conflict') throw new ApiError(409, 'That request key was already used for different data. Start a new action.');
    if (result === 'conflict') {
      const latest = await requirePlayer(env.DB, playerId);
      if (latest.soft_balance + latest.paid_balance < Math.max(0, (Number(count) - latest.free_pulls) * SUMMON_COST)) throw new ApiError(402, 'Your credits changed. Pull fewer cards or earn more credits.');
      return conflictResponse();
    }
    return json(responseBody);
  }

  if (pathname === '/api/checkout') {
    if (Object.keys(body).length !== 1 || !Object.hasOwn(body, 'bundleId')) throw new ApiError(400, 'Checkout accepts only a fixed bundle identifier.');
    return createCheckout(env, playerId, key, fingerprint, body.bundleId, new URL(request.url).origin);
  }

  if (pathname === '/api/daily') {
    if (Object.keys(body).length !== 0) throw new ApiError(400, 'Daily claim does not accept custom rewards.');
    const today = dayKey();
    if (player.last_daily === today) throw new ApiError(409, 'Today’s daily reward has already been claimed.');
    const responseBody = { claimed: true, credits: DAILY_REWARD.credits, shards: DAILY_REWARD.shards, day: today };
    const result = await commitAction(
      env.DB, player, key, 'daily', fingerprint, actionId, responseBody,
      `UPDATE players SET soft_balance = soft_balance + ?, shards = shards + ?, last_daily = ?, revision = revision + 1 WHERE player_id = ? AND revision = ? AND (last_daily IS NULL OR last_daily < ?) AND NOT EXISTS (SELECT 1 FROM action_receipts WHERE player_id = ? AND idempotency_key = ?)`,
      [DAILY_REWARD.credits, DAILY_REWARD.shards, today, playerId, player.revision, today, playerId, key],
    );
    if (result === 'replay') return (await actionReplay(env.DB, playerId, key, 'daily', fingerprint) as Extract<Replay, { kind: 'replay' }>).response;
    if (result === 'key-conflict') throw new ApiError(409, 'That request key was already used for different data. Start a new action.');
    if (result === 'conflict') throw new ApiError(409, 'Today’s reward was already claimed in another tab.');
    return json(responseBody);
  }

  if (pathname === '/api/team') {
    if (Object.keys(body).length !== 1 || !Object.hasOwn(body, 'heroIds')) throw new ApiError(400, 'Team updates accept only a list of owned card IDs.');
    const ids = body.heroIds;
    if (!Array.isArray(ids) || ids.length > 4 || ids.some((id) => typeof id !== 'string') || new Set(ids).size !== ids.length) {
      throw new ApiError(400, 'Choose up to four different owned cards.');
    }
    const ownedRows = await env.DB.prepare('SELECT hero_id FROM collection WHERE player_id = ?').bind(playerId).all<{ hero_id: string }>();
    const ownedIds = new Set((ownedRows.results || []).map((row) => row.hero_id));
    if (ids.some((id) => !ownedIds.has(id))) throw new ApiError(400, 'Your team can contain cards from your collection only.');
    const responseBody = { team: ids };
    const gate = receiptGate(playerId, key, actionId);
    const teamWrites: D1PreparedStatement[] = [
      env.DB.prepare(`DELETE FROM player_team WHERE player_id = ? AND ${gate.sql}`).bind(playerId, ...gate.values),
      ...ids.map((id, slot) => env.DB.prepare(`INSERT INTO player_team (player_id, slot, hero_id) SELECT ?, ?, ? WHERE ${gate.sql}`)
        .bind(playerId, slot, id, ...gate.values)),
    ];
    const result = await commitAction(
      env.DB, player, key, 'team', fingerprint, actionId, responseBody,
      `UPDATE players SET revision = revision + 1 WHERE player_id = ? AND revision = ? AND NOT EXISTS (SELECT 1 FROM action_receipts WHERE player_id = ? AND idempotency_key = ?)`,
      [playerId, player.revision, playerId, key], teamWrites,
    );
    if (result === 'replay') return (await actionReplay(env.DB, playerId, key, 'team', fingerprint) as Extract<Replay, { kind: 'replay' }>).response;
    if (result === 'key-conflict') throw new ApiError(409, 'That request key was already used for different data. Start a new action.');
    if (result === 'conflict') return conflictResponse();
    return json(responseBody);
  }

  if (pathname === '/api/upgrade') {
    if (Object.keys(body).length !== 1 || !Object.hasOwn(body, 'heroId')) throw new ApiError(400, 'Upgrade accepts only an owned card ID.');
    const heroId = body.heroId;
    if (typeof heroId !== 'string' || !HERO_BY_ID.has(heroId)) throw new ApiError(400, 'Choose a valid card to upgrade.');
    const owned = await env.DB.prepare('SELECT level FROM collection WHERE player_id = ? AND hero_id = ?').bind(playerId, heroId).first<{ level: number }>();
    if (!owned) throw new ApiError(404, 'That card is not in your collection.');
    const level = Number(owned.level);
    if (level >= 10) throw new ApiError(409, 'This card has reached the level cap.');
    const cost = 12 + level * 8;
    if (player.shards < cost) throw new ApiError(402, `This upgrade needs ${cost} shards.`);
    const responseBody = { heroId, level: level + 1, shardsSpent: cost };
    const gate = receiptGate(playerId, key, actionId);
    const cardUpdate = env.DB.prepare(`UPDATE collection SET level = level + 1 WHERE player_id = ? AND hero_id = ? AND level = ? AND ${gate.sql}`)
      .bind(playerId, heroId, level, ...gate.values);
    const result = await commitAction(
      env.DB, player, key, 'upgrade', fingerprint, actionId, responseBody,
      `UPDATE players SET shards = shards - ?, revision = revision + 1 WHERE player_id = ? AND revision = ? AND shards >= ? AND NOT EXISTS (SELECT 1 FROM action_receipts WHERE player_id = ? AND idempotency_key = ?)`,
      [cost, playerId, player.revision, cost, playerId, key], [cardUpdate],
    );
    if (result === 'replay') return (await actionReplay(env.DB, playerId, key, 'upgrade', fingerprint) as Extract<Replay, { kind: 'replay' }>).response;
    if (result === 'key-conflict') throw new ApiError(409, 'That request key was already used for different data. Start a new action.');
    if (result === 'conflict') return conflictResponse();
    return json(responseBody);
  }

  if (pathname === '/api/battle') {
    if (Object.keys(body).length !== 2 || !Object.hasOwn(body, 'stage') || !Object.hasOwn(body, 'stance')) {
      throw new ApiError(400, 'Choose a stage and a tactic before fighting. Refresh the game if this action is unavailable.');
    }
    const stage = body.stage;
    const stance = body.stance;
    if (!Number.isInteger(stage) || typeof stage !== 'number' || stage < 1 || stage > CAMPAIGN_LENGTH || stage > Number(player.campaign_cleared) + 1) {
      throw new ApiError(400, 'Choose the next rescue stage or one you have already cleared.');
    }
    if (stance !== 'assault' && stance !== 'guard' && stance !== 'break') throw new ApiError(400, 'Choose Assault, Guard, or Break.');
    const encounter = campaignStage(stage);
    const elapsed = Math.floor((Date.now() - player.last_battle_at) / 1000);
    if (player.last_battle_at > 0 && elapsed < BATTLE_COOLDOWN_SECONDS) {
      throw new ApiError(429, `Your crew needs ${BATTLE_COOLDOWN_SECONDS - elapsed} more seconds to recover.`);
    }
    const rows = await env.DB.prepare(`
      SELECT c.hero_id, c.level, c.roll_attack, c.roll_hp, c.roll_defense
      FROM player_team t JOIN collection c ON c.player_id = t.player_id AND c.hero_id = t.hero_id
      WHERE t.player_id = ? ORDER BY t.slot ASC
    `).bind(playerId).all<CollectionRow>();
    const team: BattleUnit[] = (rows.results || []).flatMap((row) => {
      const hero = HERO_BY_ID.get(row.hero_id);
      if (!hero) return [];
      const owned: OwnedCard = { heroId: row.hero_id, level: Number(row.level), rollAttack: Number(row.roll_attack), rollHp: Number(row.roll_hp), rollDefense: Number(row.roll_defense) };
      const stats = deriveStats(hero, owned);
      return [{ heroId: hero.id, name: hero.name, hp: stats.hp, maxHp: stats.hp, attack: stats.attack, defense: stats.defense, skillId: hero.skillId }];
    });
    if (team.length === 0) throw new ApiError(409, 'Assign at least one card to your team before battle.');
    const report = resolveBattle(team, stage, stance as Stance);
    const firstClear = report.won && stage === Number(player.campaign_cleared) + 1;
    const practice = stage <= Number(player.campaign_cleared);
    const today = dayKey();
    const creditsBefore = player.battle_reward_day === today ? Number(player.battle_reward_credits) : 0;
    const shardsBefore = player.battle_reward_day === today ? Number(player.battle_reward_shards) : 0;
    const baseCredits = report.won ? Math.min(firstClear ? report.rewardCredits : PRACTICE_REWARD.credits, Math.max(0, BATTLE_DAILY_CREDIT_CAP - creditsBefore)) : 0;
    const baseShards = report.won ? Math.min(firstClear ? report.rewardShards : PRACTICE_REWARD.shards, Math.max(0, BATTLE_DAILY_SHARD_CAP - shardsBefore)) : 0;
    const bossClear = firstClear && encounter.boss;
    const bonusCredits = bossClear ? BOSS_BONUS.credits : 0;
    const milestoneHeroId = bossClear && stage === 5 ? 'tomas' : bossClear && stage === 10 ? 'mira' : null;
    const milestoneOwned = milestoneHeroId ? await env.DB.prepare('SELECT 1 AS owned FROM collection WHERE player_id = ? AND hero_id = ?')
      .bind(playerId, milestoneHeroId).first<{ owned: number }>() : null;
    const bonusShards = (bossClear ? BOSS_BONUS.shards : 0) + (milestoneOwned ? 12 : 0);
    const rewardCredits = baseCredits + bonusCredits;
    const rewardShards = baseShards + bonusShards;
    const maxTeamHp = team.reduce((sum, unit) => sum + unit.maxHp, 0);
    const stars = report.won ? 1 + Number(report.rounds <= 5) + Number(report.remainingHp >= maxTeamHp * 0.6) : 0;
    const responseBody = {
      ...report,
      firstClear,
      practice,
      stars,
      rewardCredits,
      rewardShards,
      baseCredits,
      baseShards,
      bonusCredits,
      bonusShards,
      milestoneHeroId,
      milestoneDuplicate: Boolean(milestoneOwned),
      campaignCleared: firstClear ? stage : Number(player.campaign_cleared),
      cooldownSeconds: BATTLE_COOLDOWN_SECONDS,
      battleCreditsRemaining: Math.max(0, BATTLE_DAILY_CREDIT_CAP - creditsBefore - baseCredits),
      battleShardsRemaining: Math.max(0, BATTLE_DAILY_SHARD_CAP - shardsBefore - baseShards),
    };
    const gate = receiptGate(playerId, key, actionId);
    const afterUpdate: D1PreparedStatement[] = [];
    if (report.won) {
      afterUpdate.push(env.DB.prepare(`
        INSERT INTO stage_records (player_id, stage, best_stars, best_rounds, updated_at)
        SELECT ?, ?, ?, ?, ? WHERE ${gate.sql}
        ON CONFLICT(player_id, stage) DO UPDATE SET
          best_stars = MAX(best_stars, excluded.best_stars),
          best_rounds = MIN(best_rounds, excluded.best_rounds),
          updated_at = excluded.updated_at
      `).bind(playerId, stage, stars, report.rounds, Date.now(), ...gate.values));
    }
    if (milestoneHeroId && !milestoneOwned) {
      afterUpdate.push(env.DB.prepare(`
        INSERT OR IGNORE INTO collection (player_id, hero_id, level, roll_attack, roll_hp, roll_defense, acquired_at)
        SELECT ?, ?, 1, 0, 0, 0, ? WHERE ${gate.sql}
      `).bind(playerId, milestoneHeroId, Date.now(), ...gate.values));
    }
    if (milestoneHeroId) {
      afterUpdate.push(env.DB.prepare(`
        INSERT OR IGNORE INTO player_team (player_id, slot, hero_id)
        SELECT ?, (SELECT COALESCE(MAX(slot) + 1, 0) FROM player_team WHERE player_id = ?), ?
        WHERE ${gate.sql} AND (SELECT COUNT(*) FROM player_team WHERE player_id = ?) < 4
      `).bind(playerId, playerId, milestoneHeroId, ...gate.values, playerId));
    }
    const result = await commitAction(
      env.DB, player, key, 'battle', fingerprint, actionId, responseBody,
      `UPDATE players SET soft_balance = soft_balance + ?, shards = shards + ?, battle_wins = battle_wins + ?, campaign_cleared = CASE WHEN ? = 1 THEN ? ELSE campaign_cleared END, battle_reward_credits = CASE WHEN battle_reward_day = ? THEN battle_reward_credits + ? ELSE ? END, battle_reward_shards = CASE WHEN battle_reward_day = ? THEN battle_reward_shards + ? ELSE ? END, battle_reward_day = ?, last_battle_at = ?, revision = revision + 1 WHERE player_id = ? AND revision = ? AND campaign_cleared = ? AND last_battle_at = ? AND NOT EXISTS (SELECT 1 FROM action_receipts WHERE player_id = ? AND idempotency_key = ?)`,
      [rewardCredits, rewardShards, report.won ? 1 : 0, firstClear ? 1 : 0, stage, today, baseCredits, baseCredits, today, baseShards, baseShards, today, Date.now(), playerId, player.revision, player.campaign_cleared, player.last_battle_at, playerId, key],
      afterUpdate,
    );
    if (result === 'replay') return (await actionReplay(env.DB, playerId, key, 'battle', fingerprint) as Extract<Replay, { kind: 'replay' }>).response;
    if (result === 'key-conflict') throw new ApiError(409, 'That request key was already used for different data. Start a new action.');
    if (result === 'conflict') return conflictResponse('Another battle or reward changed your save. Refresh and try again.');
    return json(responseBody);
  }

  throw new ApiError(404, 'Unknown game action.');
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    if (url.pathname === '/api/stripe/webhook') {
      if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
      if (!(request.headers.get('content-type') || '').toLowerCase().includes('application/json')) return json({ error: 'Stripe webhook must use application/json.' }, 415);
      return await handleStripeWebhook(request, env);
    }
    let cookie: string | null = null;
    try {
      if (request.method === 'POST') assertOrigin(request);
      if (request.method !== 'GET' && request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
      if (request.method === 'GET' && url.pathname === '/api/catalog') return await routeApi(request, env, '');
      const actionPaths = ['/api/summon', '/api/daily', '/api/team', '/api/upgrade', '/api/battle', '/api/checkout'];
      if (request.method === 'GET' && url.pathname !== '/api/state') return json({ error: 'Unknown API route.' }, 404);
      if (request.method === 'POST' && !actionPaths.includes(url.pathname)) return json({ error: 'Unknown API route.' }, 404);
      const session = await sessionFor(request, env, request.method === 'GET' && url.pathname === '/api/state');
      cookie = session.cookie;
      const response = await routeApi(request, env, session.playerId);
      return withCookie(response, cookie);
    } catch (error) {
      if (error instanceof ApiError) return withCookie(json({ error: error.message, details: error.details }, error.status), cookie);
      const message = error instanceof Error ? error.message : 'Unknown server error.';
      const status = message.includes('SESSION_SECRET') ? 503 : 500;
      return withCookie(json({ error: status === 503 ? 'Game session security is not configured.' : 'The game could not complete that action.' }, status), cookie);
    }
  },
};

export { actionReplay, canonical, commitAction, getState, routeApi, STORE };
