import { beforeEach, describe, expect, it } from 'vitest';
import { env, SELF } from 'cloudflare:test';

const ORIGIN = 'https://astral-vault.test';
let guestCookie = '';
let idempotency = 0;

function nextKey() { idempotency += 1; return `test-action-${String(idempotency).padStart(8, '0')}`; }

async function reset() {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM action_receipts'),
    env.DB.prepare('DELETE FROM stage_records'),
    env.DB.prepare('DELETE FROM player_team'),
    env.DB.prepare('DELETE FROM collection'),
    env.DB.prepare('DELETE FROM players'),
    env.DB.prepare('DELETE FROM guest_bootstrap_limits'),
  ]);
}

async function guest() {
  const response = await SELF.fetch(`${ORIGIN}/api/state`, { headers: { 'cf-connecting-ip': '198.51.100.42' } });
  expect(response.status).toBe(200);
  const cookie = response.headers.get('set-cookie');
  expect(cookie).toContain('HttpOnly');
  expect(cookie).toContain('SameSite=Lax');
  expect(cookie).toContain('Secure');
  guestCookie = cookie!.split(';')[0]!;
  return response.json() as Promise<{ player: { credits: number; freePulls: number; totalPulls: number; shards: number }; collection: Array<{ id: string }>; team: string[]; campaign: { cleared: number; currentStage: number } }>;
}

async function get(path: string) {
  return SELF.fetch(`${ORIGIN}${path}`, { headers: { cookie: guestCookie } });
}

async function post(path: string, body: unknown, key = nextKey(), cookie = guestCookie, origin = ORIGIN) {
  return SELF.fetch(`${ORIGIN}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin, cookie, 'idempotency-key': key },
    body: JSON.stringify(body),
  });
}

async function playerRow() {
  return env.DB.prepare('SELECT * FROM players WHERE player_id = ?').bind(guestCookie.split('.')[0]!.split('=')[1]!).first<Record<string, number | string>>();
}

function playerId() { return guestCookie.split('.')[0]!.split('=')[1]!; }

async function setTeam(ids: string[], level = 1) {
  const id = playerId();
  await env.DB.prepare('DELETE FROM player_team WHERE player_id = ?').bind(id).run();
  await env.DB.batch(ids.map((heroId) => env.DB.prepare('INSERT OR IGNORE INTO collection (player_id, hero_id, level, roll_attack, roll_hp, roll_defense, acquired_at) VALUES (?, ?, ?, 0, 0, 0, ?)').bind(id, heroId, level, Date.now())));
  await env.DB.batch(ids.map((heroId) => env.DB.prepare('UPDATE collection SET level = ? WHERE player_id = ? AND hero_id = ?').bind(level, id, heroId)));
  await env.DB.batch(ids.map((heroId, slot) => env.DB.prepare('INSERT INTO player_team (player_id, slot, hero_id) VALUES (?, ?, ?)').bind(id, slot, heroId)));
}

beforeEach(async () => {
  await reset();
  guestCookie = '';
});

describe('authoritative guest API', () => {
  it('serves the catalog without creating guest rows', async () => {
    const response = await SELF.fetch(`${ORIGIN}/api/catalog`);
    expect(response.status).toBe(200);
    expect((await response.json() as { heroes: unknown[] }).heroes).toHaveLength(8);
    const rows = await env.DB.prepare('SELECT COUNT(*) AS count FROM players').first<{ count: number }>();
    expect(rows?.count).toBe(0);
  });

  it('limits cookie-less guest creation to ten requests per hashed IP and UTC hour', async () => {
    const address = '198.51.100.43';
    const firstTen = await Promise.all(Array.from({ length: 10 }, () => SELF.fetch(`${ORIGIN}/api/state`, { headers: { 'cf-connecting-ip': address } })));
    expect(firstTen.map((response) => response.status)).toEqual(Array(10).fill(200));
    const blocked = await SELF.fetch(`${ORIGIN}/api/state`, { headers: { 'cf-connecting-ip': address } });
    expect(blocked.status).toBe(429);
    const players = await env.DB.prepare('SELECT COUNT(*) AS count FROM players').first<{ count: number }>();
    const requests = await env.DB.prepare('SELECT SUM(requests) AS count FROM guest_bootstrap_limits').first<{ count: number }>();
    expect(players?.count).toBe(10);
    expect(requests?.count).toBe(10);
  });

  it('does not create a guest for unknown routes', async () => {
    const getUnknown = await SELF.fetch(`${ORIGIN}/api/no-such-route`, { headers: { 'cf-connecting-ip': '198.51.100.44' } });
    const postUnknown = await SELF.fetch(`${ORIGIN}/api/no-such-route`, {
      method: 'POST', headers: { origin: ORIGIN, 'cf-connecting-ip': '198.51.100.44', 'content-type': 'application/json' }, body: '{}',
    });
    expect(getUnknown.status).toBe(404);
    expect(postUnknown.status).toBe(404);
    const players = await env.DB.prepare('SELECT COUNT(*) AS count FROM players').first<{ count: number }>();
    expect(players?.count).toBe(0);
  });

  it('creates a signed HttpOnly guest cookie and persists free summons in D1', async () => {
    const current = await guest();
    expect(current.player).toMatchObject({ credits: 0, freePulls: 3, totalPulls: 0 });
    expect(current.collection.map((hero) => hero.id).sort()).toEqual(['eda', 'pax']);
    expect(current.team).toEqual(['pax', 'eda']);
    expect(current.campaign).toMatchObject({ cleared: 0, currentStage: 1 });
    const key = nextKey();
    const response = await post('/api/summon', { count: 1 }, key);
    expect(response.status).toBe(200);
    expect((await response.json() as { freeUsed: number }).freeUsed).toBe(1);
    const after = await get('/api/state').then((result) => result.json()) as typeof current;
    expect(after.player.freePulls).toBe(2);
    expect(after.player.totalPulls).toBe(1);
    expect(after.collection.length).toBeGreaterThanOrEqual(2);
  });

  it('replays the same idempotent summon with identical output and rejects a changed body', async () => {
    await guest();
    const key = nextKey();
    const first = await post('/api/summon', { count: 1 }, key);
    const firstBody = await first.json();
    const retries = await Promise.all(Array.from({ length: 4 }, () => post('/api/summon', { count: 1 }, key)));
    expect(retries.map((response) => response.status)).toEqual([200, 200, 200, 200]);
    expect(await Promise.all(retries.map((response) => response.json()))).toEqual([firstBody, firstBody, firstBody, firstBody]);
    expect((await playerRow())?.total_pulls).toBe(1);
    const changed = await post('/api/summon', { count: 10 }, key);
    expect(changed.status).toBe(409);
    expect((await playerRow())?.total_pulls).toBe(1);
  });

  it('rejects unknown fields and an unaffordable ten-pull without changing balances', async () => {
    await guest();
    const injected = await post('/api/summon', { count: 1, credits: 1_000_000 });
    expect(injected.status).toBe(400);
    const unaffordable = await post('/api/summon', { count: 10 });
    expect(unaffordable.status).toBe(402);
    const row = await playerRow();
    expect(row?.soft_balance).toBe(0);
    expect(row?.free_pulls).toBe(3);
    expect(row?.total_pulls).toBe(0);
  });

  it('serializes concurrent distinct spends and cannot overspend', async () => {
    await guest();
    await env.DB.prepare('UPDATE players SET free_pulls = 0, soft_balance = 100 WHERE player_id = ?').bind(guestCookie.split('.')[0]!.split('=')[1]!).run();
    const responses = await Promise.all([
      post('/api/summon', { count: 1 }, nextKey()),
      post('/api/summon', { count: 1 }, nextKey()),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 402]);
    const row = await playerRow();
    expect(row?.soft_balance).toBe(0);
    expect(row?.total_pulls).toBe(1);
  });

  it('uses free pulls first, then earned credits, then paid Astral Credits at the same summon cost', async () => {
    await guest();
    const playerId = guestCookie.split('.')[0]!.split('=')[1]!;
    await env.DB.prepare('UPDATE players SET free_pulls = 0, soft_balance = 60, paid_balance = 40 WHERE player_id = ?').bind(playerId).run();
    const response = await post('/api/summon', { count: 1 });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ creditsSpent: 100, softCreditsSpent: 60, paidCreditsSpent: 40 });
    const row = await playerRow();
    expect(row?.soft_balance).toBe(0);
    expect(row?.paid_balance).toBe(0);
    expect(row?.total_pulls).toBe(1);
  });

  it('allows one daily claim under concurrency and pays only the fixed reward', async () => {
    await guest();
    const results = await Promise.all([
      post('/api/daily', {}, nextKey()),
      post('/api/daily', {}, nextKey()),
    ]);
    expect(results.map((response) => response.status).sort()).toEqual([200, 409]);
    const row = await playerRow();
    expect(row?.soft_balance).toBe(200);
    expect(row?.shards).toBe(10);
    expect(row?.last_daily).toBe(new Date().toISOString().slice(0, 10));
  });

  it('checks same-origin actions, owned team membership, and ignores no tampered fields', async () => {
    await guest();
    expect((await post('/api/daily', {}, nextKey(), guestCookie, 'https://attacker.invalid')).status).toBe(403);
    expect((await post('/api/team', { heroIds: ['nox'] })).status).toBe(400);
    expect((await post('/api/team', { heroIds: [], credits: 5 })).status).toBe(400);
    expect((await post('/api/upgrade', { heroId: 'selene', level: 10 })).status).toBe(400);
  });

  it('limits anonymous session creation to the state route and rejects missing action keys', async () => {
    await guest();
    const noKey = await SELF.fetch(`${ORIGIN}/api/daily`, { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json', cookie: guestCookie }, body: '{}' });
    expect(noKey.status).toBe(400);
    const before = await env.DB.prepare('SELECT COUNT(*) AS count FROM players').first<{ count: number }>();
    await SELF.fetch(`${ORIGIN}/api/catalog`);
    const after = await env.DB.prepare('SELECT COUNT(*) AS count FROM players').first<{ count: number }>();
    expect(after?.count).toBe(before?.count);
  });

  it('starts the rescue with a ready crew, strict tactic choices, and authoritative battle events', async () => {
    await guest();
    expect((await post('/api/battle', {})).status).toBe(400);
    expect((await post('/api/battle', { stage: 2, stance: 'assault' })).status).toBe(400);
    expect((await post('/api/battle', { stage: 1, stance: 'free-win' })).status).toBe(400);
    const result = await post('/api/battle', { stage: 1, stance: 'assault' });
    expect(result.status).toBe(200);
    const report = await result.json() as { won: boolean; firstClear: boolean; campaignCleared: number; rewardCredits: number; rewardShards: number; events: Array<{ kind: string; enemyHpAfter: number; crewHpAfter: Record<string, number> }> };
    expect(report).toMatchObject({ won: true, firstClear: true, campaignCleared: 1, rewardCredits: 75, rewardShards: 8 });
    expect(report.events.length).toBeGreaterThan(2);
    expect(report.events.at(-1)).toMatchObject({ kind: 'victory', enemyHpAfter: 0 });
    expect(report.events[0]?.crewHpAfter).toHaveProperty('pax');
    expect(report.events[0]?.crewHpAfter).toHaveProperty('eda');
    expect((await post('/api/battle', { stage: 2, stance: 'break' })).status).toBe(429);
    const state = await get('/api/state').then((response) => response.json()) as { campaign: { cleared: number; records: Array<{ stage: number; stars: number }> }; player: { credits: number; shards: number } };
    expect(state.campaign.cleared).toBe(1);
    expect(state.campaign.records).toMatchObject([{ stage: 1 }]);
    expect(state.player).toMatchObject({ credits: 75, shards: 8 });
  });

  it('caps ordinary battle supplies and gives smaller practice rewards without advancing the story', async () => {
    await guest();
    const today = new Date().toISOString().slice(0, 10);
    await env.DB.prepare('UPDATE players SET campaign_cleared = 1, battle_reward_day = ?, battle_reward_credits = 490, battle_reward_shards = 119 WHERE player_id = ?').bind(today, playerId()).run();
    const first = await post('/api/battle', { stage: 1, stance: 'assault' });
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ won: true, practice: true, firstClear: false, rewardCredits: 10, rewardShards: 1, battleCreditsRemaining: 0, battleShardsRemaining: 0, campaignCleared: 1 });
    await env.DB.prepare('UPDATE players SET last_battle_at = 0 WHERE player_id = ?').bind(playerId()).run();
    const second = await post('/api/battle', { stage: 1, stance: 'assault' });
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ won: true, practice: true, rewardCredits: 0, rewardShards: 0, campaignCleared: 1 });
    expect(await playerRow()).toMatchObject({ soft_balance: 10, shards: 1, battle_reward_credits: 500, battle_reward_shards: 120, campaign_cleared: 1 });
  });

  it('pays a boss first clear once under concurrency, grants Tomas, and never repeats the milestone on practice', async () => {
    await guest();
    await env.DB.prepare('UPDATE players SET campaign_cleared = 4 WHERE player_id = ?').bind(playerId()).run();
    const body = { stage: 5, stance: 'break' };
    const keys = [nextKey(), nextKey()];
    const responses = await Promise.all(keys.map((key) => post('/api/battle', body, key)));
    expect(responses.filter((response) => response.status === 200)).toHaveLength(1);
    expect(responses.filter((response) => response.status !== 200).every((response) => response.status === 409 || response.status === 429)).toBe(true);
    const winner = responses.find((response) => response.status === 200)!;
    const winnerIndex = responses.indexOf(winner);
    const first = await winner.json();
    expect(first).toMatchObject({ won: true, firstClear: true, campaignCleared: 5, bonusCredits: 200, bonusShards: 20, milestoneHeroId: 'tomas', milestoneDuplicate: false, rewardCredits: 295, rewardShards: 28 });
    const replay = await post('/api/battle', body, keys[winnerIndex]);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toEqual(first);
    expect(await playerRow()).toMatchObject({ campaign_cleared: 5, soft_balance: 295, shards: 28 });
    const roster = await get('/api/state').then((response) => response.json()) as { collection: Array<{ id: string }>; team: string[]; campaign: { records: Array<{ stage: number }> } };
    expect(roster.collection.filter((hero) => hero.id === 'tomas')).toHaveLength(1);
    expect(roster.team).toContain('tomas');
    expect(roster.campaign.records).toContainEqual(expect.objectContaining({ stage: 5 }));
    await env.DB.prepare('UPDATE players SET last_battle_at = 0 WHERE player_id = ?').bind(playerId()).run();
    const practice = await post('/api/battle', body);
    expect(practice.status).toBe(200);
    expect(await practice.json()).toMatchObject({ won: true, practice: true, firstClear: false, bonusCredits: 0, bonusShards: 0, milestoneHeroId: null, rewardCredits: 35, rewardShards: 2, campaignCleared: 5 });
  });

  it('converts an already-owned boss recruit to shards and resets daily battle limits at UTC midnight', async () => {
    await guest();
    await setTeam(['pax', 'eda', 'tomas', 'mira'], 3);
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    await env.DB.prepare('UPDATE players SET campaign_cleared = 9, battle_reward_day = ?, battle_reward_credits = 500, battle_reward_shards = 120 WHERE player_id = ?').bind(yesterday, playerId()).run();
    const result = await post('/api/battle', { stage: 10, stance: 'guard' });
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ won: true, firstClear: true, campaignCleared: 10, bonusCredits: 200, bonusShards: 32, milestoneHeroId: 'mira', milestoneDuplicate: true });
    const row = await playerRow();
    expect(row?.battle_reward_credits).toBe(120);
    expect(row?.battle_reward_shards).toBe(8);
    const state = await get('/api/state').then((response) => response.json()) as { battle: { rewardCreditsRemaining: number; rewardShardsRemaining: number }; collection: Array<{ id: string }> };
    expect(state.battle).toMatchObject({ rewardCreditsRemaining: 380, rewardShardsRemaining: 112 });
    expect(state.collection.filter((hero) => hero.id === 'mira')).toHaveLength(1);
  });
});
