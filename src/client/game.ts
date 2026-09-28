import './game.css';
import type { CampaignStage, Island, Stance } from '../shared/campaign';
import type { BattleEvent } from '../shared/engine';

type Screen = 'adventure' | 'recruit' | 'crew' | 'supplies';
type Hero = {
  id: string; name: string; epithet: string; rarity: 3 | 4 | 5; element: string; role: string;
  skillId: string; skill: string; skillDescription: string; art: string;
};
type OwnedHero = Hero & { level: number; stats: { attack: number; hp: number; defense: number }; acquiredAt: number };
type Catalog = {
  heroes: Hero[]; odds: { 3: number; 4: number; 5: number };
  pity: { fiveStar: number; fourStarPlus: number }; summonCost: number;
  islands: Island[]; stages: CampaignStage[];
};
type GameState = {
  player: { credits: number; paidCurrency: number; shards: number; freePulls: number; pity5: number; pity4: number; totalPulls: number };
  collection: OwnedHero[]; team: string[];
  daily: { available: boolean; reward: { credits: number; shards: number }; nextResetUtc: string };
  campaign: { cleared: number; total: number; complete: boolean; currentStage: number; nextBoss: number | null; stars: number; records: Array<{ stage: number; stars: number; bestRounds: number }> };
  battle: { cooldownSeconds: number; rewardCreditsCap: number; rewardCreditsRemaining: number; rewardShardsCap: number; rewardShardsRemaining: number };
  store: { enabled: boolean; paidCurrency: string; message: string; bundles: Array<{ id: string; label: string; amount: number; price: string }> };
};
type SummonResponse = {
  count: number; freeUsed: number; creditsSpent: number; shardsEarned: number;
  results: Array<{ heroId: string; rarity: 3 | 4 | 5; duplicate: boolean; shards: number; guaranteed: string | null; stats: { attack: number; hp: number; defense: number } | null }>;
};
type BattleResponse = {
  won: boolean; stage: number; enemyName: string; enemyMaxHp: number; stance: Stance; countered: boolean;
  rounds: number; damageDealt: number; damageTaken: number; remainingHp: number;
  crew: Array<{ heroId: string; name: string; maxHp: number }>;
  events: BattleEvent[]; firstClear: boolean; practice: boolean; stars: number;
  rewardCredits: number; rewardShards: number; baseCredits: number; baseShards: number;
  bonusCredits: number; bonusShards: number; milestoneHeroId: string | null; milestoneDuplicate: boolean;
  campaignCleared: number;
};

const app = document.querySelector<HTMLElement>('#app')!;
const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const titleCase = (value: string) => value[0]!.toUpperCase() + value.slice(1);
const starText = (count: number) => '★'.repeat(count) + '☆'.repeat(3 - count);
let catalog: Catalog;
let state: GameState;
let screen: Screen = 'adventure';
let selectedStage = 1;
let stance: Stance = 'assault';
let selectedTeam: string[] = [];
let crewPageIndex = 0;
let reveal: { result: SummonResponse; phase: 'approach' | 'cards'; page: number; timer?: number } | null = null;
let battleReport: BattleResponse | null = null;
let battleStep = 0;
let battleTimer = 0;
let toastMessage = '';
let toastTimer = 0;
let busy = false;
let reconnectPending = false;

async function api<T>(path: string, body?: unknown): Promise<T> {
  const headers = new Headers();
  const init: RequestInit = { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', headers };
  let pendingStorageKey = '';
  if (body !== undefined) {
    headers.set('content-type', 'application/json');
    const canonical = (value: unknown): string => Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : value && typeof value === 'object' ? `{${Object.keys(value as object).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}` : JSON.stringify(value) ?? 'null';
    pendingStorageKey = `astral.pending:${path}:${canonical(body)}`;
    let requestKey = '';
    try { requestKey = sessionStorage.getItem(pendingStorageKey) || ''; } catch { /* session storage may be unavailable */ }
    if (!requestKey) {
      requestKey = crypto.randomUUID();
      try { sessionStorage.setItem(pendingStorageKey, requestKey); } catch { /* the current request still has its key */ }
    }
    headers.set('idempotency-key', requestKey);
    init.body = JSON.stringify(body);
  }
  const response = await fetch(path, init);
  let payload: T & { error?: string };
  try { payload = await response.json() as T & { error?: string }; }
  catch { throw new Error('The response was interrupted. Retry to safely recover the result.'); }
  if (pendingStorageKey && response.status < 500) {
    try { sessionStorage.removeItem(pendingStorageKey); } catch { /* ignore unavailable storage */ }
  }
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status}).`);
  return payload;
}

async function refreshState(): Promise<void> {
  state = await api<GameState>('/api/state');
  selectedTeam = [...state.team];
  selectedStage = Math.min(selectedStage, state.campaign.currentStage);
}

function heroById(id: string): Hero | undefined { return catalog.heroes.find((hero) => hero.id === id); }
function ownedById(id: string): OwnedHero | undefined { return state.collection.find((hero) => hero.id === id); }
function stageByNumber(number: number): CampaignStage { return catalog.stages[number - 1]!; }
function currentStage(): CampaignStage { return stageByNumber(selectedStage); }
function pageSize(): number { return matchMedia('(max-width: 700px)').matches ? 2 : 4; }
function revealPageSize(): number { return matchMedia('(max-width: 700px)').matches ? 2 : 5; }
function glyph(kind: string): string {
  const paths: Record<string, string> = {
    adventure: '<path d="M3 18 8 6l5 7 7-9M3 18l7-4 4 5 6-3"/><circle cx="8" cy="6" r="1.5"/>',
    recruit: '<path d="m12 2 2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5L12 2Z"/>',
    crew: '<circle cx="8" cy="8" r="3"/><path d="M2 21v-2a6 6 0 0 1 12 0v2M17 6a3 3 0 0 1 0 6m0 3a5 5 0 0 1 5 5v1"/>',
    supplies: '<rect x="4" y="7" width="16" height="14" rx="2"/><path d="M12 7v14M4 12h16M7 7l-2-3m12 3 2-3"/>',
    arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
    close: '<path d="M5 5l14 14M19 5 5 19"/>',
  };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[kind] || paths.adventure}</svg>`;
}

function pageIntro(kicker: string, title: string, note: string): string {
  return `<header class="page-intro"><div><p class="kicker">${escapeHtml(kicker)}</p><h1>${escapeHtml(title)}</h1></div><p>${escapeHtml(note)}</p></header>`;
}

function adventurePage(): string {
  const stage = currentStage();
  const island = catalog.islands[stage.island]!;
  const islandStart = stage.island * 5 + 1;
  const recordMap = new Map(state.campaign.records.map((record) => [record.stage, record]));
  const replay = stage.number <= state.campaign.cleared;
  const boss = state.campaign.nextBoss;
  const bossHeroId = boss === 5 ? 'tomas' : boss === 10 ? 'mira' : null;
  const bossHero = bossHeroId
    ? state.collection.some((hero) => hero.id === bossHeroId)
      ? `${heroById(bossHeroId)?.name} rescued · +12 bonus Shards`
      : `${heroById(bossHeroId)?.name} joins your crew`
    : '200 Credits + 20 Shards';
  const baseCredits = Math.min(replay ? 35 : 75 + Math.min(stage.number - 1, 10) * 5, state.battle.rewardCreditsRemaining);
  const baseShards = Math.min(replay ? 2 : 8, state.battle.rewardShardsRemaining);
  const bossNote = stage.boss && !replay
    ? ` Boss rescue bonus: +200 Credits + 20 Shards${stage.number === 5 || stage.number === 10 ? `; ${state.collection.some((hero) => hero.id === (stage.number === 5 ? 'tomas' : 'mira')) ? '+12 Shards if already rescued.' : 'a new crew member joins.'}` : '.'}`
    : '';
  const rewardNote = replay
    ? `Practice clear: +${baseCredits} Credits + ${baseShards} Shards at today’s remaining limits.`
    : `First clear: +${baseCredits} Credits + ${baseShards} Shards at today’s remaining limits.${bossNote}`;
  const team = state.team.map((id) => ownedById(id)).filter((hero): hero is OwnedHero => Boolean(hero));
  return `<section class="page adventure-page" style="--island-color:${island.color}">
    ${pageIntro('STAR ISLAND RESCUE · 4 ISLANDS / 20 STAGES', state.campaign.complete ? 'The islands are home.' : 'Bring the islands home.', state.campaign.complete ? 'Replay a route to improve its stars, or try a new crew.' : 'Scout the signal, choose a tactic, and clear the route ahead.')}
    <div class="journey-bar"><div class="journey-islands">${catalog.islands.map((item, index) => {
      const cleared = Math.min(5, Math.max(0, state.campaign.cleared - index * 5));
      const available = index * 5 + 1 <= state.campaign.currentStage;
      return `<button class="island-tab ${index === stage.island ? 'active' : ''}" data-island="${index}" ${available ? '' : 'disabled'}><span class="island-orb" style="--orb:${item.color}"></span><span>${escapeHtml(item.name)}</span><small>${cleared}/5</small></button>`;
    }).join('')}</div><div class="stage-track" aria-label="Island stages">${Array.from({ length: 5 }, (_, index) => {
      const number = islandStart + index;
      const record = recordMap.get(number);
      const available = number <= state.campaign.currentStage;
      return `<button class="stage-chip ${selectedStage === number ? 'active' : ''} ${record ? 'cleared' : ''}" data-stage="${number}" ${available ? '' : 'disabled'} aria-label="Stage ${number}${record ? `, ${record.stars} stars` : ''}"><b>${number}</b>${record ? `<small>${starText(record.stars)}</small>` : `<small>${index === 4 ? 'BOSS' : 'ROUTE'}</small>`}</button>`;
    }).join('')}</div></div>
    <div class="adventure-board"><article class="encounter-card"><div class="encounter-top"><div><p class="kicker">${escapeHtml(island.name)} · ${stage.boss ? 'ISLAND BOSS' : `STAGE ${stage.number} / 20`}</p><h2>${escapeHtml(stage.name)}</h2></div><span class="encounter-badge">${replay ? 'PRACTICE' : 'NEW ROUTE'}</span></div>
      <div class="encounter-main"><div class="battle-scene kind-${stage.kind}"><span class="scene-stars"></span><span class="scene-planet"></span><span class="enemy-shape"><i class="enemy-eye eye-left"></i><i class="enemy-eye eye-right"></i></span><span class="scene-floor"></span><div class="enemy-name"><small>ENEMY SIGNAL</small><b>${escapeHtml(stage.enemy)}</b></div></div>
      <div class="tactic-side"><div class="enemy-tell"><span class="signal-icon">!</span><div><b>${stage.intent === 'charge' ? 'Charging beam' : stage.intent === 'heavy' ? 'Heavy strike' : 'Armoured shell'}</b><p>${escapeHtml(stage.tell)}</p></div></div>
        <p class="choice-label">CHOOSE YOUR TACTIC <span>COUNTER: ${titleCase(stage.counter)}</span></p><div class="stance-row" role="group" aria-label="Battle tactic">${(['assault', 'guard', 'break'] as Stance[]).map((option) => `<button class="stance-card ${stance === option ? 'selected' : ''}" data-stance="${option}" aria-pressed="${stance === option}"><b>${titleCase(option)}</b><small>${option === 'assault' ? 'Strike first' : option === 'guard' ? 'Take less damage' : 'Pierce armour'}</small>${stage.counter === option ? '<i>BEST</i>' : ''}</button>`).join('')}</div>
        <button class="primary-button fight-button" data-action="battle" ${busy || reconnectPending || team.length === 0 || state.battle.cooldownSeconds > 0 ? 'disabled' : ''}>${reconnectPending ? 'Reconnecting…' : team.length ? state.battle.cooldownSeconds > 0 ? `Crew ready in ${state.battle.cooldownSeconds}s` : `Fight stage ${stage.number}` : 'Choose a crew first'} ${glyph('arrow')}</button><p class="fight-note">${rewardNote}</p>
      </div></div></article>
      <aside class="adventure-side"><div class="quick-steps"><b>HOW TO PLAY</b><span>1 Scout the tell</span><span>2 Pick its counter</span><span>3 Fight and rescue</span></div><div class="crew-peek"><div class="side-heading"><span>YOUR CREW</span><button data-nav="crew">Edit crew ${glyph('arrow')}</button></div><div class="crew-faces">${team.map((hero) => `<div class="crew-face"><img src="${escapeHtml(hero.art)}" alt=""><b>${escapeHtml(hero.name.split(' ')[0])}</b><small>Lv ${hero.level}</small></div>`).join('')}${Array.from({ length: Math.max(0, 4 - team.length) }, () => '<div class="crew-face empty">+</div>').join('')}</div></div><div class="boss-goal"><span>NEXT ISLAND GOAL</span><b>${boss ? `Stage ${boss}: ${escapeHtml(stageByNumber(boss).enemy)}` : 'All four beacons restored'}</b><p>${boss ? bossHero : `You have ${state.campaign.stars} of 60 possible stars. Replay to improve your best score.`}</p></div><div class="currency-help"><span><b>Credits</b> recruit at 100 per pull</span><span><b>Shards</b> level up your crew</span></div></aside></div>
  </section>`;
}

function recruitPage(): string {
  const featured = heroById('selene')!;
  const oneCost = Math.max(0, (1 - state.player.freePulls) * catalog.summonCost);
  const tenCost = Math.max(0, (10 - state.player.freePulls) * catalog.summonCost);
  const available = state.player.credits + state.player.paidCurrency;
  return `<section class="page recruit-page">${pageIntro('MEET THE CREW', 'Recruit new friends.', 'Free pulls are used first. After that, each recruit costs 100 earned Credits; duplicates become upgrade Shards.')}
    <div class="recruit-layout"><div class="recruit-art"><img src="${escapeHtml(featured.art)}" alt="Selene, an astronaut in the star archive"><div><p class="kicker">THE ORIGINAL CREW</p><h2>Who will answer<br>your signal?</h2><p>Eight characters, each with a useful field skill. Featured art has no boosted odds.</p></div></div><div class="recruit-panel"><p class="kicker">RECRUITMENT SIGNAL</p><h2>${state.player.freePulls} free ${state.player.freePulls === 1 ? 'pull' : 'pulls'} ready</h2><p>Find a new teammate, or earn Shards from a duplicate. Your starter crew can finish the story without lucky pulls.</p><div class="recruit-actions"><button class="primary-button" data-action="summon-one" ${busy || reconnectPending || oneCost > available ? 'disabled' : ''}>Recruit 1 <small>${oneCost ? `${oneCost} Credits` : 'FREE'}</small>${glyph('arrow')}</button><button class="secondary-button" data-action="summon-ten" ${busy || reconnectPending || tenCost > available ? 'disabled' : ''}>Recruit 10 <small>${tenCost ? `${tenCost} Credits` : 'FREE'}</small>${glyph('arrow')}</button></div><div class="pity-box"><span>4★ or higher within <b>${10 - state.player.pity4}</b> pulls</span><span>5★ within <b>${50 - state.player.pity5}</b> pulls</span></div></div></div>
    <div class="odds-panel"><b>Published odds</b><span>5★ ${catalog.odds[5]}%</span><span>4★ ${catalog.odds[4]}%</span><span>3★ ${catalog.odds[3]}%</span><p>Every character in the same rarity has equal odds. Guarantees carry across single and ten pulls.</p></div>
  </section>`;
}

function crewPage(): string {
  const owned = new Map(state.collection.map((hero) => [hero.id, hero]));
  const heroes = [...catalog.heroes].sort((a, b) => Number(owned.has(b.id)) - Number(owned.has(a.id)) || b.rarity - a.rarity);
  const size = pageSize();
  const pageCount = Math.ceil(heroes.length / size);
  crewPageIndex = Math.min(crewPageIndex, pageCount - 1);
  const visible = heroes.slice(crewPageIndex * size, (crewPageIndex + 1) * size);
  const dirty = selectedTeam.join('|') !== state.team.join('|');
  return `<section class="page crew-page">${pageIntro('YOUR RESCUE CREW', 'Build a brave team.', 'Choose up to four friends. Spend Shards to raise their level and improve attack, health, and defence.')}
    <div class="team-strip"><div class="team-slots">${Array.from({ length: 4 }, (_, index) => {
      const hero = owned.get(selectedTeam[index] || '');
      return hero ? `<div class="team-member"><img src="${escapeHtml(hero.art)}" alt=""><span><b>${escapeHtml(hero.name)}</b><small>Lv ${hero.level} · ${escapeHtml(hero.role)}</small></span><button data-remove-team="${escapeHtml(hero.id)}" aria-label="Remove ${escapeHtml(hero.name)}">${glyph('close')}</button></div>` : `<div class="team-member empty"><span>+ Open slot</span></div>`;
    }).join('')}</div><button class="secondary-button save-team" data-action="save-team" ${busy || reconnectPending || !dirty || selectedTeam.length === 0 ? 'disabled' : ''}>${dirty ? 'Save crew' : 'Crew saved'} ${glyph('arrow')}</button></div>
<div class="roster-title"><div><b>Character index</b><span>${state.collection.length} of ${catalog.heroes.length} found</span></div><div class="pager"><button data-page="crew-prev" ${crewPageIndex === 0 ? 'disabled' : ''} aria-label="Previous characters">‹</button><span>${crewPageIndex + 1} / ${pageCount}</span><button data-page="crew-next" ${crewPageIndex + 1 >= pageCount ? 'disabled' : ''} aria-label="Next characters">›</button></div></div>
    <div class="roster-grid">${visible.map((hero) => {
      const card = owned.get(hero.id);
      if (!card) return `<article class="roster-card locked"><div class="roster-art"><img src="${escapeHtml(hero.art)}" alt=""></div><div class="roster-info"><small>${hero.rarity}★ · ${escapeHtml(hero.role)}</small><h3>${escapeHtml(hero.name)}</h3><p><b>${escapeHtml(hero.skill)}</b>: ${escapeHtml(hero.skillDescription)}</p></div></article>`;
      const cost = 12 + card.level * 8;
      return `<article class="roster-card"><div class="roster-art"><img src="${escapeHtml(hero.art)}" alt=""></div><div class="roster-info"><small>${hero.rarity}★ · ${escapeHtml(hero.role)} · Lv ${card.level}</small><h3>${escapeHtml(hero.name)}</h3><p>${escapeHtml(hero.skill)}: ${escapeHtml(hero.skillDescription)}</p><div class="card-stats"><span>ATK <b>${card.stats.attack}</b></span><span>HP <b>${card.stats.hp}</b></span><span>DEF <b>${card.stats.defense}</b></span></div><div class="card-actions"><button data-team-hero="${escapeHtml(hero.id)}" aria-pressed="${selectedTeam.includes(hero.id)}">${selectedTeam.includes(hero.id) ? '✓ In crew' : '+ Add to crew'}</button><button data-upgrade="${escapeHtml(hero.id)}" ${busy || reconnectPending || card.level >= 10 || state.player.shards < cost ? 'disabled' : ''}>${card.level >= 10 ? 'Max level' : `↑ ${cost} Shards`}</button></div><small class="upgrade-effect">Upgrade: +8 ATK · +72 HP · +5 DEF</small></div></article>`;
    }).join('')}</div>
  </section>`;
}

function suppliesPage(): string {
  return `<section class="page supplies-page">${pageIntro('DAILY SUPPLIES', 'Keep the rescue moving.', 'Claim a free daily packet. Battles and island bosses also give everything needed to finish the story.')}
    <div class="supplies-grid"><article class="supply-card daily-supply"><span class="supply-symbol">✦</span><p class="kicker">ONCE EACH UTC DAY</p><h2>Daily supply</h2><p>A small boost for your next rescue route.</p><div class="supply-amount"><span>+${state.daily.reward.credits} <small>Credits</small></span><span>+${state.daily.reward.shards} <small>Shards</small></span></div><button class="primary-button" data-action="daily" ${busy || reconnectPending || !state.daily.available ? 'disabled' : ''}>${state.daily.available ? 'Claim supplies' : 'Claimed today'} ${glyph('arrow')}</button></article>
      <article class="supply-card economy-card"><p class="kicker">WHAT THE CURRENCIES DO</p><h2>Earn. Improve. Continue.</h2><div class="currency-explain"><span class="currency-emblem">◇</span><div><b>Astral Credits</b><p>Earn from battles, bosses, and your daily claim. Spend 100 to recruit one character.</p></div></div><div class="currency-explain"><span class="currency-emblem">✧</span><div><b>Star Shards</b><p>Earn from battles, bosses, duplicates, and your daily claim. Spend them to level up crew members.</p></div></div><p class="daily-limit">Today’s battle supplies left: ${state.battle.rewardCreditsRemaining}/${state.battle.rewardCreditsCap} Credits · ${state.battle.rewardShardsRemaining}/${state.battle.rewardShardsCap} Shards. One-time boss bonuses are separate.</p></article>
      <article class="supply-card shop-card"><p class="kicker">OPTIONAL SHOP</p><h2>No checkout yet.</h2><p>${escapeHtml(state.store.message)}</p><div class="shop-preview">${state.store.bundles.slice(0, 3).map((bundle) => `<span>${escapeHtml(bundle.label)} <b>${escapeHtml(bundle.price)}</b></span>`).join('')}</div><small>Paid Credits: ${state.player.paidCurrency}. All recruits use the same published odds.</small></article></div>
  </section>`;
}

function revealModal(): string {
  if (!reveal) return '';
  if (reveal.phase === 'approach') return `<div class="overlay"><section class="arrival-modal" role="dialog" aria-modal="true" aria-label="Recruitment signal"><span class="arrival-star">✦</span><p class="kicker">A SIGNAL IS ANSWERING</p><h2>New friends ahead.</h2><p>Your cards are already saved.</p><button class="secondary-button" data-action="skip-reveal">Show recruits now ${glyph('arrow')}</button></section></div>`;
  const size = revealPageSize();
  const pages = Math.ceil(reveal.result.results.length / size);
  reveal.page = Math.min(reveal.page, pages - 1);
  const visible = reveal.result.results.slice(reveal.page * size, (reveal.page + 1) * size);
  return `<div class="overlay"><section class="reveal-dialog" role="dialog" aria-modal="true" aria-labelledby="reveal-title"><div class="dialog-head"><div><p class="kicker">RECRUITMENT COMPLETE</p><h2 id="reveal-title">${reveal.result.count === 1 ? 'A signal answered.' : 'Your new signals.'}</h2></div><button class="icon-button" data-action="close-reveal" aria-label="Close recruitment">${glyph('close')}</button></div><p class="reveal-summary">${reveal.result.freeUsed} free pulls · ${reveal.result.creditsSpent} Credits spent · +${reveal.result.shardsEarned} duplicate Shards</p><div class="recruit-results">${visible.map((result) => {
    const hero = heroById(result.heroId)!;
    return `<article class="result-card rarity-${hero.rarity}"><div class="result-art"><img src="${escapeHtml(hero.art)}" alt=""><span>${hero.rarity}★</span></div><div class="result-copy"><small>${result.duplicate ? `DUPLICATE · +${result.shards} SHARDS` : result.guaranteed ? 'GUARANTEED RECRUIT' : 'NEW RECRUIT'}</small><b>${escapeHtml(hero.name)}</b><span>${escapeHtml(hero.role)} · ${escapeHtml(hero.element)}</span></div></article>`;
  }).join('')}</div><div class="dialog-footer"><div class="pager"><button data-page="reveal-prev" ${reveal.page === 0 ? 'disabled' : ''} aria-label="Previous recruits">‹</button><span>${reveal.page + 1} / ${pages}</span><button data-page="reveal-next" ${reveal.page + 1 >= pages ? 'disabled' : ''} aria-label="Next recruits">›</button></div><button class="primary-button" data-action="close-reveal">Continue to crew ${glyph('arrow')}</button></div></section></div>`;
}

function battleModal(): string {
  if (!battleReport) return '';
  const report = battleReport;
  const stage = stageByNumber(report.stage);
  const finished = battleStep >= report.events.length;
  const event = battleStep > 0 ? report.events[battleStep - 1] : null;
  const enemyHp = event ? event.enemyHpAfter : report.enemyMaxHp;
  const hp = event?.crewHpAfter || Object.fromEntries(report.crew.map((member) => [member.heroId, member.maxHp]));
  const action = report.won ? report.firstClear && report.stage < state.campaign.total ? 'scout-next' : 'close-battle' : report.countered ? 'improve-crew' : 'change-tactic';
  const actionLabel = report.won ? report.firstClear && report.stage < state.campaign.total ? 'Scout next stage' : 'Back to island' : report.countered ? 'Improve your crew' : `Choose ${titleCase(stage.counter)}`;
  return `<div class="overlay"><section class="battle-dialog" role="dialog" aria-modal="true" aria-labelledby="battle-title"><div class="dialog-head"><div><p class="kicker">${escapeHtml(catalog.islands[stage.island]!.name)} · STAGE ${stage.number}</p><h2 id="battle-title">${finished ? report.won ? 'Island route cleared!' : 'The crew fell back.' : `Facing ${escapeHtml(report.enemyName)}`}</h2></div><button class="icon-button" data-action="close-battle" aria-label="Close battle">${glyph('close')}</button></div><div class="battle-arena"><div class="battle-enemy kind-${stage.kind}"><div class="battle-enemy-shape"><i></i><i></i></div><b>${escapeHtml(report.enemyName)}</b><div class="health-bar"><span style="width:${Math.max(0, enemyHp / report.enemyMaxHp * 100)}%"></span></div><small>${enemyHp} / ${report.enemyMaxHp} HP</small></div><div class="battle-vs">⚔</div><div class="battle-crew">${report.crew.map((member) => {
    const hero = heroById(member.heroId)!;
    const current = hp[member.heroId] || 0;
    return `<div class="battle-unit ${current === 0 ? 'down' : ''}"><img src="${escapeHtml(hero.art)}" alt=""><span><b>${escapeHtml(member.name)}</b><small>${current} / ${member.maxHp} HP</small><i class="health-bar"><i style="width:${Math.max(0, current / member.maxHp * 100)}%"></i></i></span></div>`;
  }).join('')}</div></div><div class="battle-caption ${event?.kind || ''}"><span>${finished ? report.won ? 'VICTORY' : 'RETRY THE ROUTE' : `ROUND ${event?.round || 1} · ${titleCase(report.stance)}`}</span><p>${escapeHtml(event?.text || `Your crew takes position. ${titleCase(report.stance)} is ready.`)}</p></div>
    ${finished ? `<div class="battle-result"><div class="result-stars" aria-label="${report.stars} of 3 stars">${report.won ? starText(report.stars) : '☆☆☆'}</div><div class="battle-prizes"><span><b>+${report.rewardCredits}</b> Credits</span><span><b>+${report.rewardShards}</b> Shards</span>${report.milestoneHeroId ? `<span><b>${escapeHtml(heroById(report.milestoneHeroId)?.name || '')}</b> ${report.milestoneDuplicate ? 'duplicate · +12 Shards' : 'unlocked in your roster'}</span>` : ''}</div><p>${report.won ? report.firstClear ? `Stage ${report.stage} rescued${stage.boss ? ' · one-time boss bonus included' : ''}. Best score is saved.` : 'Practice complete. Your best stars are saved.' : report.countered ? 'No currency lost. Your tactic was right; level up or change your formation.' : `No currency lost. ${escapeHtml(stage.tell)}`}</p></div>` : `<div class="battle-progress"><span style="width:${battleStep / report.events.length * 100}%"></span></div>`}
    <div class="dialog-footer"><span>${finished ? report.countered ? 'Your tactic answered the enemy signal.' : `Tip: ${titleCase(stage.counter)} counters this enemy.` : `${battleStep} / ${report.events.length} moments`}</span>${finished ? `<button class="primary-button" data-action="${action}">${actionLabel} ${glyph('arrow')}</button>` : `<button class="secondary-button" data-action="skip-battle">Skip to result ${glyph('arrow')}</button>`}</div></section></div>`;
}

function shell(): string {
  const nav: Array<[Screen, string]> = [['adventure', 'Adventure'], ['recruit', 'Recruit'], ['crew', 'Crew'], ['supplies', 'Supplies']];
  const page = screen === 'adventure' ? adventurePage() : screen === 'recruit' ? recruitPage() : screen === 'crew' ? crewPage() : suppliesPage();
  return `<div class="game"><aside class="sidebar"><div class="brand-mark">✦</div><div class="brand-name">ASTRAL VAULT <small>STAR ISLAND RESCUE</small></div><nav aria-label="Game sections">${nav.map(([id, label]) => `<button data-nav="${id}" class="${screen === id ? 'active' : ''}" aria-current="${screen === id ? 'page' : 'false'}">${glyph(id)}<span>${label}</span></button>`).join('')}</nav><div class="sidebar-foot"><span>✦</span><p>Four islands.<br>One brave crew.<br>A sky to bring home.</p></div></aside><main class="main-column"><header class="topbar"><div class="mobile-brand">✦ <span>ASTRAL VAULT</span></div><div class="top-label">${screen.toUpperCase()} <small>STAR ISLAND RESCUE</small></div><div class="balances"><div title="Earn Credits from battles and supplies; spend 100 to recruit one character"><span>◇</span><b>${state.player.credits.toLocaleString()}</b><small>Credits</small></div><div title="Earn Shards from battles and duplicates; spend them to level up crew"><span>✧</span><b>${state.player.shards.toLocaleString()}</b><small>Shards</small></div></div></header><div class="viewport-content">${page}</div></main><nav class="mobile-nav" aria-label="Game sections">${nav.map(([id, label]) => `<button data-nav="${id}" class="${screen === id ? 'active' : ''}" aria-current="${screen === id ? 'page' : 'false'}">${glyph(id)}<span>${label}</span></button>`).join('')}</nav>${revealModal()}${battleModal()}${toastMessage ? `<div class="toast" role="status">${escapeHtml(toastMessage)}</div>` : ''}</div>`;
}

function render(): void {
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const focusSelector = active?.dataset.action ? `[data-action="${active.dataset.action}"]` : active?.dataset.nav ? `[data-nav="${active.dataset.nav}"]` : '';
  app.innerHTML = shell();
  if (focusSelector) app.querySelector<HTMLElement>(focusSelector)?.focus({ preventScroll: true });
}

function toast(message: string): void {
  toastMessage = message;
  render();
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { toastMessage = ''; render(); }, 3300);
}

async function withBusy<T>(fn: () => Promise<T>): Promise<T | undefined> {
  if (busy) return;
  if (reconnectPending) { toast('Your save is reconnecting. Refresh this page if it does not recover.'); return; }
  busy = true;
  render();
  try {
    const result = await fn();
    try { await refreshState(); }
    catch {
      reconnectPending = true;
      clearTimeout(toastTimer);
      toastMessage = 'Your action was saved. Reconnecting to update balances…';
      window.setTimeout(() => {
        void refreshState().then(() => { reconnectPending = false; toastMessage = ''; render(); }).catch(() => {
          toastMessage = 'Your action was saved. Refresh this page to update balances.';
          render();
        });
      }, 1800);
    }
    return result;
  }
  catch (error) { toast(error instanceof Error ? error.message : 'That action could not finish.'); }
  finally { busy = false; render(); }
  return undefined;
}

async function fight(): Promise<void> {
  if (busy || reconnectPending) return;
  battleReport = null;
  const response = await withBusy(() => api<BattleResponse>('/api/battle', { stage: selectedStage, stance }));
  if (!response) return;
  battleReport = response;
  battleStep = 0;
  render();
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { battleStep = response.events.length; render(); return; }
  const delay = Math.max(110, Math.min(350, Math.floor(4400 / response.events.length)));
  clearInterval(battleTimer);
  battleTimer = window.setInterval(() => {
    if (!battleReport) { clearInterval(battleTimer); return; }
    battleStep += 1;
    render();
    if (battleStep >= battleReport.events.length) {
      clearInterval(battleTimer);
      app.querySelector<HTMLElement>('.battle-dialog .dialog-footer button')?.focus();
    }
  }, delay);
  app.querySelector<HTMLElement>('[data-action="skip-battle"]')?.focus();
}

function closeBattle(): void { clearInterval(battleTimer); battleReport = null; render(); }

function leaveBattle(destination: 'next' | 'counter' | 'crew'): void {
  if (!battleReport) return;
  const stage = battleReport.stage;
  clearInterval(battleTimer);
  battleReport = null;
  if (destination === 'next') { selectedStage = Math.min(state.campaign.total, stage + 1); stance = 'assault'; }
  if (destination === 'counter') { selectedStage = stage; stance = stageByNumber(stage).counter; }
  screen = destination === 'crew' ? 'crew' : 'adventure';
  render();
}

async function recruit(count: 1 | 10): Promise<void> {
  const result = await withBusy(() => api<SummonResponse>('/api/summon', { count }));
  if (!result) return;
  reveal = { result, phase: 'approach', page: 0 };
  render();
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { reveal.phase = 'cards'; render(); return; }
  reveal.timer = window.setTimeout(() => { if (reveal) { reveal.phase = 'cards'; render(); app.querySelector<HTMLElement>('[data-action="close-reveal"]')?.focus(); } }, 1150);
  app.querySelector<HTMLElement>('[data-action="skip-reveal"]')?.focus();
}

async function claimDaily(): Promise<void> {
  const result = await withBusy(() => api<{ credits: number; shards: number }>('/api/daily', {}));
  if (!result) return;
  if (!reconnectPending) toast(`Daily supply claimed: +${result.credits} Credits, +${result.shards} Shards.`);
}

async function saveTeam(): Promise<void> {
  const result = await withBusy(() => api('/api/team', { heroIds: selectedTeam }));
  if (!result) return;
  if (!reconnectPending) toast('Crew saved. Your new formation is ready.');
}

async function upgrade(id: string): Promise<void> {
  const draftTeam = [...selectedTeam];
  const hadDraft = selectedTeam.join('|') !== state.team.join('|');
  const result = await withBusy(() => api<{ level: number }>('/api/upgrade', { heroId: id }));
  if (!result) return;
  if (hadDraft) selectedTeam = draftTeam;
  if (!reconnectPending) toast(`${heroById(id)?.name || 'Crew member'} reached level ${result.level}.`);
  else render();
}

app.addEventListener('click', (event) => {
  const target = event.target as HTMLElement;
  const nav = target.closest<HTMLElement>('[data-nav]');
  if (nav) { screen = nav.dataset.nav as Screen; render(); return; }
  const islandButton = target.closest<HTMLElement>('[data-island]');
  if (islandButton) {
    const index = Number(islandButton.dataset.island);
    selectedStage = Math.min(state.campaign.currentStage, index * 5 + 1);
    stance = 'assault'; render(); return;
  }
  const stageButton = target.closest<HTMLElement>('[data-stage]');
  if (stageButton) { selectedStage = Number(stageButton.dataset.stage); stance = 'assault'; render(); return; }
  const stanceButton = target.closest<HTMLElement>('[data-stance]');
  if (stanceButton) { stance = stanceButton.dataset.stance as Stance; render(); return; }
  const pageButton = target.closest<HTMLElement>('[data-page]');
  if (pageButton) {
    if (pageButton.dataset.page === 'crew-prev') crewPageIndex -= 1;
    if (pageButton.dataset.page === 'crew-next') crewPageIndex += 1;
    if (reveal && pageButton.dataset.page === 'reveal-prev') reveal.page -= 1;
    if (reveal && pageButton.dataset.page === 'reveal-next') reveal.page += 1;
    render(); return;
  }
  const teamButton = target.closest<HTMLElement>('[data-team-hero]');
  if (teamButton) {
    const id = teamButton.dataset.teamHero!;
    selectedTeam = selectedTeam.includes(id) ? selectedTeam.filter((item) => item !== id) : selectedTeam.length < 4 ? [...selectedTeam, id] : selectedTeam;
    if (selectedTeam.length === 4 && !selectedTeam.includes(id)) toast('Your crew has four members. Remove one first.');
    else render();
    return;
  }
  const removeButton = target.closest<HTMLElement>('[data-remove-team]');
  if (removeButton) { selectedTeam = selectedTeam.filter((id) => id !== removeButton.dataset.removeTeam); render(); return; }
  const upgradeButton = target.closest<HTMLElement>('[data-upgrade]');
  if (upgradeButton) { void upgrade(upgradeButton.dataset.upgrade!); return; }
  const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
  if (action === 'battle') void fight();
  if (action === 'summon-one') void recruit(1);
  if (action === 'summon-ten') void recruit(10);
  if (action === 'daily') void claimDaily();
  if (action === 'save-team') void saveTeam();
  if (action === 'skip-reveal' && reveal) { clearTimeout(reveal.timer); reveal.phase = 'cards'; render(); }
  if (action === 'close-reveal') { if (reveal?.timer) clearTimeout(reveal.timer); reveal = null; screen = 'crew'; render(); }
  if (action === 'skip-battle' && battleReport) { clearInterval(battleTimer); battleStep = battleReport.events.length; render(); }
  if (action === 'close-battle') closeBattle();
  if (action === 'scout-next') leaveBattle('next');
  if (action === 'change-tactic') leaveBattle('counter');
  if (action === 'improve-crew') leaveBattle('crew');
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (reveal) { if (reveal.timer) clearTimeout(reveal.timer); reveal = null; render(); }
    else if (battleReport) closeBattle();
  }
  if (event.key !== 'Tab') return;
  const dialog = app.querySelector<HTMLElement>('.overlay section');
  if (!dialog) return;
  const controls = [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]), [href]')];
  if (!controls.length) return;
  const first = controls[0]!;
  const last = controls[controls.length - 1]!;
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
});

async function start(): Promise<void> {
  try {
    [catalog, state] = await Promise.all([api<Catalog>('/api/catalog'), api<GameState>('/api/state')]);
    selectedTeam = [...state.team];
    selectedStage = state.campaign.currentStage;
    render();
  } catch (error) {
    app.innerHTML = `<main class="boot-error"><span>✦</span><h1>The star trail is quiet.</h1><p>${escapeHtml(error instanceof Error ? error.message : 'Try again in a moment.')}</p><button onclick="location.reload()">Reconnect</button></main>`;
  }
}

window.addEventListener('resize', () => { if (state) render(); });
window.setInterval(() => {
  if (!state || state.battle.cooldownSeconds <= 0) return;
  state.battle.cooldownSeconds -= 1;
  if (screen === 'adventure' && !battleReport && !reveal) render();
}, 1000);
void start();
