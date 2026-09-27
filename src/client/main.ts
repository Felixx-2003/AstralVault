import './style.css';

type Rarity = 3 | 4 | 5;
type Hero = {
  id: string; name: string; epithet: string; rarity: Rarity; element: string; role: string;
  attack: number; hp: number; defense: number; skill: string; skillDescription: string; art: string;
};
type OwnedHero = Hero & { level: number; stats: { attack: number; hp: number; defense: number }; acquiredAt: number };
type Catalog = {
  heroes: Hero[]; odds: { 3: number; 4: number; 5: number };
  pity: { fiveStar: number; fourStarPlus: number }; summonCost: number;
  startingFreePulls: number; dailyReward: { credits: number; shards: number };
};
type GameState = {
  player: { credits: number; paidCurrency: number; shards: number; freePulls: number; pity5: number; pity4: number; totalPulls: number; revision: number; battleWins: number; lastDaily: string | null };
  collection: OwnedHero[]; team: string[];
  daily: { available: boolean; reward: { credits: number; shards: number }; nextResetUtc: string };
  battle: { cooldownSeconds: number; stage: number; rewardCreditsEarned: number; rewardCreditsCap: number; rewardCreditsRemaining: number };
  store: { enabled: boolean; paidCurrency: string; message: string; bundles: Array<{ id: string; label: string; amount: number; price: string }> };
};
type SummonResponse = {
  count: number; freeUsed: number; creditsSpent: number; pity5: number; pity4: number; shardsEarned: number;
  results: Array<{ heroId: string; rarity: Rarity; duplicate: boolean; shards: number; guaranteed: 'five' | 'four' | null; stats: { attack: number; hp: number; defense: number } | null }>;
};

const app = document.querySelector<HTMLElement>('#app')!;
let catalog: Catalog;
let state: GameState;
let screen = 'summon';
let collectionFilter = 'all';
let selectedTeam: string[] = [];
let reveal: { result: SummonResponse; visible: number; complete: boolean; phase: 'approach' | 'cards'; timer?: number } | null = null;
let battleReport: { won: boolean; stage: number; rounds: number; rewardCredits: number; rewardShards: number; damageDealt: number; log?: string[] } | null = null;
let toastTimer = 0;
let busy = false;
let toastMessage = '';
let detailFocusReturn: HTMLElement | null = null;

const rarityName = (rarity: number) => `${rarity}★`;
const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const rarityWord = (rarity: number) => rarity === 5 ? 'Legendary' : rarity === 4 ? 'Epic' : 'Standard';
const ownedById = () => new Map(state.collection.map((hero) => [hero.id, hero]));
const heroById = (id: string) => catalog.heroes.find((hero) => hero.id === id);

async function api<T>(path: string, body?: unknown): Promise<T> {
  const headers = new Headers();
  const init: RequestInit = { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', headers };
  let pendingStorageKey = '';
  if (body !== undefined) {
    headers.set('content-type', 'application/json');
    const canonical = (value: unknown): string => Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : value && typeof value === 'object' ? `{${Object.keys(value as object).sort().map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}` : JSON.stringify(value) ?? 'null';
    pendingStorageKey = `astral.pending:${path}:${canonical(body)}`;
    let requestKey = '';
    try { requestKey = sessionStorage.getItem(pendingStorageKey) || ''; } catch { /* private browsing may disable session storage */ }
    if (!requestKey) {
      requestKey = crypto.randomUUID();
      try { sessionStorage.setItem(pendingStorageKey, requestKey); } catch { /* the request remains safe for this attempt */ }
    }
    headers.set('idempotency-key', requestKey);
    init.body = JSON.stringify(body);
  }
  const response = await fetch(path, init);
  let payload: T & { error?: string };
  try { payload = await response.json() as T & { error?: string }; }
  catch { throw new Error('The response was interrupted. Retry this action to safely recover its result.'); }
  if (pendingStorageKey && response.status < 500) {
    try { sessionStorage.removeItem(pendingStorageKey); } catch { /* ignore unavailable session storage */ }
  }
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status}).`);
  return payload;
}

async function refreshState() {
  state = await api<GameState>('/api/state');
  if (screen === 'team') selectedTeam = [...state.team];
}

function icon(kind: string): string {
  const paths: Record<string, string> = {
    summon: '<path d="M12 2.5 14.2 9l6.3 2.1-6.3 2.2-2.2 6.2-2.1-6.2-6.3-2.2L9.9 9 12 2.5Z"/><path d="m19 16 .8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8L19 16Z"/>',
    collection: '<path d="M4 4h6v7H4zM14 4h6v7h-6zM4 15h6v5H4zM14 15h6v5h-6z"/>',
    team: '<path d="M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM17 10a2.5 2.5 0 1 0 0-5M3 19v-1.2A4.8 4.8 0 0 1 7.8 13h2.4a4.8 4.8 0 0 1 4.8 4.8V19H3ZM16 13.4a4.2 4.2 0 0 1 5 4.1V19h-3"/>',
    journey: '<path d="M4 20 9 5l6 8 5-10M4 20l7-5 4 4 5-3"/><circle cx="9" cy="5" r="1.5"/><circle cx="20" cy="3" r="1.5"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    lock: '<rect x="4" y="10" width="16" height="11" rx="1"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    star: '<path d="m12 3 2.7 5.5 6 .9-4.3 4.2 1 5.9-5.4-2.8-5.4 2.8 1-5.9L3.3 9.4l6-.9L12 3Z"/>',
  };
  return `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${paths[kind] || paths.star}</svg>`;
}

function cardMarkup(hero: Hero, owned?: OwnedHero, options: { result?: SummonResponse['results'][number]; index?: number; selectable?: boolean; selected?: boolean; detail?: boolean } = {}) {
  const { result, index = 0, selectable = false, selected = false, detail = false } = options;
  const label = result?.duplicate ? 'DUPLICATE' : result?.guaranteed ? 'GUARANTEED' : '';
  const resultClass = result ? `reveal-card reveal-wait ${reveal && index < reveal.visible ? 'is-shown' : ''}` : '';
  const selectClass = selectable ? ' is-selectable' : '';
  const detailable = Boolean(owned) && !selectable && !result && !detail;
  const stats = owned?.stats || result?.stats || (!owned && !result ? { attack: hero.attack, hp: hero.hp, defense: hero.defense } : null);
  return `<article class="unit-card rarity-${hero.rarity}${owned ? ' is-owned' : ' is-locked'}${resultClass}${selectClass}${selected ? ' is-selected' : ''}" ${selectable ? `data-select-hero="${escapeHtml(hero.id)}" tabindex="0" role="button" aria-pressed="${selected}"` : detailable ? `data-detail-hero="${escapeHtml(hero.id)}" tabindex="0" role="button" aria-haspopup="dialog" aria-label="View ${escapeHtml(hero.name)} details"` : ''} style="--card-art:url('${escapeHtml(hero.art)}')">
    <div class="unit-art"><img src="${escapeHtml(hero.art)}" alt="" loading="lazy" onerror="this.hidden=true"><span class="art-sigil">${escapeHtml(hero.name.slice(0, 1))}</span><span class="rarity-pips" aria-label="${rarityName(hero.rarity)}">${'◆'.repeat(hero.rarity)}</span>${!owned && !result ? '<span class="unseen-tag">UNSEEN</span>' : ''}${label ? `<span class="result-tag">${escapeHtml(label)}</span>` : ''}${owned ? `<span class="level-tag">Lv. ${owned.level}</span>` : ''}</div>
    <div class="unit-copy"><p class="unit-element">${escapeHtml(hero.element)} <i></i> ${escapeHtml(hero.role)}</p><h3 ${detail ? 'id="detail-title"' : ''}>${escapeHtml(hero.name)}</h3><p class="unit-epithet">${escapeHtml(hero.epithet)}</p>
    ${!owned && !result ? '<small class="base-stat-caption">BASE VALUES · SUMMON STATS VARY</small>' : ''}${stats ? `<div class="unit-stats ${!owned && !result ? 'is-base' : ''}"><span><b>${stats.attack}</b><small>ATK</small></span><span><b>${stats.hp}</b><small>HP</small></span><span><b>${stats.defense}</b><small>DEF</small></span></div>` : ''}
    ${result?.duplicate ? `<div class="dupe-reward">+${result.shards} shards</div>` : ''}
    ${owned && !selectable ? `<p class="unit-skill"><b>${escapeHtml(hero.skill)}</b><span>${escapeHtml(hero.skillDescription)}</span></p>` : ''}
    </div>
  </article>`;
}

function pageHeading(kicker: string, title: string, detail: string) {
  return `<header class="page-heading"><p class="eyebrow">${escapeHtml(kicker)}</p><h1>${title}</h1><p>${escapeHtml(detail)}</p></header>`;
}

function summonPage() {
  const selene = heroById('selene')!;
  const tenCreditCost = Math.max(0, (10 - state.player.freePulls) * catalog.summonCost);
  const oneCreditCost = Math.max(0, (1 - state.player.freePulls) * catalog.summonCost);
  return `<section class="screen summon-screen">
    <div class="summon-hero" style="--hero-art:url('${escapeHtml(selene.art)}')">
      <div class="hero-art-wash"></div><div class="orbit orbit-a"></div><div class="orbit orbit-b"></div>
      <div class="summon-copy"><p class="eyebrow"><span class="eyebrow-mark"></span> CELESTIAL INDEX <span class="eyebrow-tail">/ STANDARD RECORD</span></p><p class="banner-overline">FEATURED ARCHIVE ENTRY</p><h1>Find your<br><em>place among stars.</em></h1><p class="banner-description">A quiet signal crosses the dark. Answer it, and meet the crew waiting beyond the map.</p><div class="featured-unit"><span class="featured-stars">★★★★★</span><b>Selene</b><span>Keeper of the Far Moon</span></div><div class="banner-footnote">Featured artwork · standard summon rates apply</div></div>
      <div class="banner-coordinate">INDEX 01 <span>·</span> LUNAR SECTOR</div>
      <div class="banner-rail"><span>ASTRAL ARCHIVE</span><i></i><span>FILE 0001—A</span></div>
    </div>
    <div class="summon-controls">
    <div class="summon-control-heading"><div><p class="eyebrow">RESONANCE TERMINAL</p><h2>Summon a memory</h2></div><div class="pity-readout"><span>5★ WITHIN</span><b>${50 - state.player.pity5}<small> PULLS</small></b></div></div>
      <div class="summon-buttons"><button class="button button-light summon-button" data-action="summon-one" ${busy ? 'disabled' : ''}><span class="button-symbol">${icon('summon')}</span><span class="button-copy"><b>Summon ×1</b><small>${oneCreditCost === 0 ? 'One free pull' : `${oneCreditCost} Astral Credits`}</small></span><span class="button-arrow">${icon('arrow')}</span></button><button class="button button-gold summon-button" data-action="summon-ten" ${busy ? 'disabled' : ''}><span class="button-symbol">${icon('summon')}</span><span class="button-copy"><b>Summon ×10</b><small>${tenCreditCost === 0 ? 'All free pulls' : `${tenCreditCost} Astral Credits${state.player.freePulls ? ' · free pulls first' : ''}`}</small></span><span class="button-arrow">${icon('arrow')}</span></button></div>
      <div class="summon-note"><span class="free-pull-count"><b>${state.player.freePulls}</b> FREE</span><span>${catalog.summonCost} credits per pull after free summons</span><span class="note-separator"></span><span>4★+ within ${10 - state.player.pity4} pulls</span></div>
    </div>
    <div class="rate-strip"><span class="eyebrow">PUBLISHED RATES</span><div><b>5★</b><strong>2%</strong></div><div><b>4★</b><strong>18%</strong></div><div><b>3★</b><strong>80%</strong></div><p>A 5★ arrives by the 50th pull. Every ten pulls includes a 4★ or better when the first nine contain none; a 5★ guarantee takes precedence. All four 5★ characters have equal odds.</p></div>
  </section>`;
}

function collectionPage() {
  const owned = ownedById();
  const visible = catalog.heroes.filter((hero) => {
    if (collectionFilter === 'owned') return owned.has(hero.id);
    if (collectionFilter === 'unowned') return !owned.has(hero.id);
    if (collectionFilter === '5' || collectionFilter === '4' || collectionFilter === '3') return hero.rarity === Number(collectionFilter);
    return true;
  });
  const filters = [['all', 'All'], ['owned', 'Recorded'], ['unowned', 'Unseen'], ['5', '5★'], ['4', '4★'], ['3', '3★']];
  return `<section class="screen collection-screen">${pageHeading('THE CELESTIAL INDEX', 'A crew takes shape.', `${state.collection.length} of ${catalog.heroes.length} records recovered · duplicates become shards for field upgrades.`)}
    <div class="collection-toolbar"><div class="filter-row" role="group" aria-label="Filter collection">${filters.map(([id, label]) => `<button class="filter-chip ${collectionFilter === id ? 'is-active' : ''}" data-filter="${id}" aria-pressed="${collectionFilter === id}">${label}</button>`).join('')}</div><div class="collection-count"><span>${String(state.collection.length).padStart(2, '0')}</span><small> / ${String(catalog.heroes.length).padStart(2, '0')} LOGGED</small></div></div>
    ${visible.length ? `<div class="collection-grid">${visible.map((hero) => cardMarkup(hero, owned.get(hero.id))).join('')}</div>` : '<div class="empty-state"><span class="empty-mark">◇</span><h2>No records in this view</h2><p>Adjust the archive filter to bring other entries into view.</p></div>'}
  </section>`;
}

function teamPage() {
  const owned = ownedById();
  const team = selectedTeam.slice(0, 4);
  const available = state.collection;
  return `<section class="screen team-screen">${pageHeading('FIELD CONFIGURATION', 'Make a team.', 'Choose up to four characters. Their strengths and signature techniques shape each encounter.')}
    <div class="team-layout"><article class="team-board"><div class="board-heading"><div><p class="eyebrow">ACTIVE FORMATION</p><h2>Expedition team</h2></div><span class="team-limit">${team.length} <i>/ 4</i></span></div><div class="team-slots">${Array.from({ length: 4 }, (_, i) => {
      const hero = heroById(team[i] || '');
      const card = hero && owned.get(hero.id);
      return card ? `<div class="team-slot is-filled rarity-${hero!.rarity}"><div class="slot-art" style="--slot-art:url('${escapeHtml(hero!.art)}')"><img src="${escapeHtml(hero!.art)}" alt="" onerror="this.hidden=true"></div><div class="slot-info"><small>POSITION 0${i + 1}</small><b>${escapeHtml(hero!.name)}</b><span>ATK ${card.stats.attack} · HP ${card.stats.hp}</span></div><button class="remove-slot" data-remove-team="${escapeHtml(hero!.id)}" aria-label="Remove ${escapeHtml(hero!.name)}">${icon('close')}</button></div>` : `<div class="team-slot is-empty"><span class="slot-number">0${i + 1}</span><span>OPEN FORMATION SLOT</span><span class="empty-diamond">◇</span></div>`;
    }).join('')}</div><button class="button button-light save-team" data-action="save-team" ${busy ? 'disabled' : ''}>Save formation <span>${icon('arrow')}</span></button></article>
    <aside class="team-side"><p class="eyebrow">FIELD NOTE</p><h2>Build around<br>their strengths.</h2><p>Attack sets each strike. Defence reduces incoming force. Health keeps a character on the line. Every character’s signature technique can turn a close encounter.</p><div class="formula"><span>BASE STRIKE</span><code>max(5, ATK − 40% FOE DEF)</code></div><div class="formula"><span>BASE GUARD</span><code>max(6, FOE ATK − 55% DEF)</code></div><div class="field-reward"><span>ON A CLEAR</span><b>Up to 75 <small>credits</small></b></div></aside></div>
    <div class="picker-heading"><div><p class="eyebrow">YOUR RECORDED CHARACTERS</p><h2>Add to formation</h2></div><span>${available.length} READY</span></div>
    ${available.length ? `<div class="team-picker">${available.map((hero) => cardMarkup(hero, hero, { selectable: true, selected: team.includes(hero.id) })).join('')}</div>` : '<div class="empty-state small"><span class="empty-mark">◇</span><h2>Your first signal is waiting</h2><p>Use a free summon to find a character for your first formation.</p><button class="button button-light" data-nav="summon">Open the summon terminal</button></div>'}
  </section>`;
}

function missionsPage() {
  const today = new Date().toISOString().slice(0, 10);
  const dailyReady = state.daily.available;
  const cooldown = state.battle.cooldownSeconds;
  return `<section class="screen missions-screen">${pageHeading('SUPPLY & OPERATIONS', 'Keep the signal alive.', 'Daily supplies and repeatable field operations keep your free summons moving.')}
    <div class="operations-grid"><article class="operation-card daily-card"><div class="operation-top"><span class="operation-index">01 / DAILY</span><span class="operation-status ${dailyReady ? 'is-ready' : 'is-done'}">${dailyReady ? 'READY TO CLAIM' : 'CLAIMED TODAY'}</span></div><div class="operation-symbol daily-symbol">${icon('star')}</div><p class="eyebrow">ARCHIVE PROVISION</p><h2>Daily signal</h2><p>Check in once each UTC day to collect a supply packet.</p><div class="reward-row"><span>+${state.daily.reward.credits}<small> credits</small></span><span>+${state.daily.reward.shards}<small> shards</small></span></div><button class="button ${dailyReady ? 'button-light' : 'button-muted'} full-button" data-action="claim-daily" ${!dailyReady || busy ? 'disabled' : ''}>${dailyReady ? 'Claim daily supply' : 'Collected'} <span>${icon(dailyReady ? 'arrow' : 'check')}</span></button><small class="micro-note">Resets at 00:00 UTC · ${escapeHtml(today)}</small></article>
    <article class="operation-card battle-card"><div class="operation-top"><span class="operation-index">02 / FIELD</span><span class="operation-status ${cooldown === 0 ? 'is-ready' : ''}">${cooldown === 0 ? 'CREW READY' : `RECOVERY ${cooldown}s`}</span></div><div class="operation-symbol battle-symbol">${icon('journey')}</div><p class="eyebrow">ORBITAL OUTSKIRTS · SECTOR ${String(state.battle.stage).padStart(2, '0')}</p><h2>Chart the outskirts</h2><p>Take your formation into a measured, turn-based encounter. Clear the route to earn field supplies.</p><div class="reward-row"><span>Up to 125<small> credits on clear</small></span><span>+4<small> shards on clear</small></span></div><button class="button button-gold full-button" data-action="battle" ${busy || cooldown > 0 || state.team.length === 0 ? 'disabled' : ''}>${state.team.length === 0 ? 'Assign a team first' : cooldown ? `Recovering · ${cooldown}s` : 'Begin encounter'} <span>${icon('arrow')}</span></button><small class="micro-note">${state.battle.rewardCreditsRemaining.toLocaleString()} of ${state.battle.rewardCreditsCap.toLocaleString()} daily battle credits remain. Cleared battles continue to grant shards after the credit limit; a failed attempt grants nothing.</small></article>
    <article class="operation-card store-card"><div class="operation-top"><span class="operation-index">03 / STORE</span><span class="operation-status is-locked">NOT CONFIGURED</span></div><div class="operation-symbol store-symbol">${icon('lock')}</div><p class="eyebrow">PAID ASTRAL CREDITS</p><h2>Supply exchange</h2><p>${escapeHtml(state.store.message)}</p><div class="store-bundles">${state.store.bundles.map((bundle) => `<div class="store-bundle"><div><b>${escapeHtml(bundle.label)}</b><small>${bundle.amount.toLocaleString()} Paid Astral Credits</small></div><button disabled aria-label="${escapeHtml(bundle.label)} unavailable">${escapeHtml(bundle.price)}</button></div>`).join('')}</div><div class="store-footnote">No checkout is connected. These controls cannot charge you.</div></article></div>
    <div class="shards-panel"><div class="shard-glyph">✧</div><div><p class="eyebrow">DUPLICATE EXCHANGE</p><h2>Turn shards into better records.</h2><p>Duplicates add shards. Use them in the Index to strengthen an owned character and raise their field stats.</p></div><button class="text-link" data-nav="collection">View collection ${icon('arrow')}</button></div>
  </section>`;
}

function revealModal() {
  const current = reveal;
  if (!current) return '';
  const allShown = current.visible >= current.result.results.length && current.phase === 'cards';
  const duplicateCount = current.result.results.filter((item) => item.duplicate).length;
  if (current.phase === 'approach') {
    return `<div class="modal-backdrop reveal-backdrop cinematic-backdrop"><section class="transit-modal" role="dialog" aria-modal="true" aria-label="Summon animation"><div class="transit-topline"><span class="eyebrow">CELESTIAL INDEX · DEEP SPACE TRANSIT</span><span>${current.result.count === 10 ? 'TENFOLD RESONANCE' : 'SINGLE RESONANCE'}</span></div><div class="transit-scene"><div class="transit-stars">${Array.from({ length: 28 }, (_, i) => `<i style="--star-i:${i}"></i>`).join('')}</div><div class="transit-orbit orbit-one"></div><div class="transit-orbit orbit-two"></div><div class="transit-gate"><i></i><b>◇</b></div><div class="transit-streak"></div><div class="transit-caption"><span>ARRIVAL WINDOW</span><h2>Crossing the quiet.</h2><p>Follow the signal into the archive.</p></div><div class="transit-sector">COORDINATES LOCKED <i></i> SIGNAL FOUND</div></div><div class="transit-progress"><span></span></div><div class="transit-footer"><span>THE RESULT IS WAITING IN YOUR ARCHIVE</span><button class="skip-button" data-action="skip-reveal">Skip animation ${icon('arrow')}</button></div></section></div>`;
  }
  return `<div class="modal-backdrop reveal-backdrop"><section class="reveal-modal" role="dialog" aria-modal="true" aria-labelledby="reveal-title"><div class="modal-topline"><p class="eyebrow">${allShown ? 'RESONANCE COMPLETE' : 'SIGNAL SYNCHRONISING'}</p><button class="icon-button" data-action="close-reveal" aria-label="Close reveal">${icon('close')}</button></div><div class="reveal-header"><div><p class="eyebrow">ARCHIVE ENTRY · ${String(current.result.count).padStart(2, '0')} PULL${current.result.count === 1 ? '' : 'S'}</p><h2 id="reveal-title">${allShown ? 'A new constellation.' : 'The archive answers.'}</h2><p>${allShown ? `${current.result.results.length - duplicateCount} new ${current.result.results.length - duplicateCount === 1 ? 'record' : 'records'} · ${duplicateCount} duplicate${duplicateCount === 1 ? '' : 's'} · +${current.result.shardsEarned} shards` : 'Skip the sequence at any time; your results will be the same.'}</p></div><div class="reveal-progress"><span style="--progress:${current.result.results.length ? current.visible / current.result.results.length * 100 : 0}%"></span></div></div><div class="reveal-grid ${current.result.count === 1 ? 'single-reveal' : ''}">${current.result.results.map((result, index) => {
    const hero = heroById(result.heroId)!;
    return index < current.visible ? cardMarkup(hero, undefined, { result, index }) : `<div class="reveal-placeholder"><span>${String(index + 1).padStart(2, '0')}</span><i></i><small>SYNCING</small></div>`;
  }).join('')}</div><div class="reveal-footer"><span class="reveal-cost">${current.result.freeUsed} free · ${current.result.creditsSpent} credits</span>${allShown ? `<button class="button button-light" data-action="close-reveal">Continue to archive <span>${icon('arrow')}</span></button>` : `<button class="skip-button" data-action="skip-reveal">Skip reveal ${icon('arrow')}</button>`}</div></section></div>`;
}

function battleModal() {
  if (!battleReport) return '';
  const report = battleReport;
  const logs = report.log || [];
  return `<div class="modal-backdrop battle-backdrop"><section class="battle-report" role="dialog" aria-modal="true" aria-labelledby="battle-title"><div class="battle-report-top"><p class="eyebrow">ORBITAL OUTSKIRTS · SECTOR ${String(report.stage).padStart(2, '0')}</p><button class="icon-button" data-action="close-battle" aria-label="Close battle report">${icon('close')}</button></div><div class="battle-report-heading ${report.won ? 'is-victory' : 'is-retreat'}"><span class="battle-emblem">${report.won ? '◇' : '△'}</span><div><p class="eyebrow">${report.won ? 'ROUTE CLEARED' : 'FORMATION WITHDREW'}</p><h2 id="battle-title">${report.won ? 'A clear signal.' : 'The route holds.'}</h2><p>${report.rounds} rounds · ${report.damageDealt} damage dealt</p></div></div><div class="battle-rewards"><span><b>+${report.rewardCredits}</b><small>ASTRAL CREDITS</small></span><span><b>+${report.rewardShards}</b><small>STAR SHARDS</small></span><span><b>${report.rounds}</b><small>ROUNDS</small></span></div><div class="battle-log"><p class="eyebrow">ENCOUNTER LOG</p>${logs.slice(0, 8).map((line) => `<span>${escapeHtml(line)}</span>`).join('')}</div>${report.won ? '' : '<p class="battle-retry-note">No supplies were spent or earned. Adjust the team and try again after recovery.</p>'}<button class="button button-light full-button" data-action="close-battle">Return to operations <span>${icon('arrow')}</span></button></section></div>`;
}

function shell() {
  const navItems = [
    ['summon', 'Summon', 'summon'], ['collection', 'Index', 'collection'], ['team', 'Team', 'team'], ['missions', 'Operations', 'journey'],
  ];
  const page = screen === 'collection' ? collectionPage() : screen === 'team' ? teamPage() : screen === 'missions' ? missionsPage() : summonPage();
  return `<div class="app-frame"><aside class="sidebar"><a class="brand" href="#summon" data-nav="summon"><span class="brand-symbol"><i></i><b>AV</b></span><span class="brand-name">ASTRAL<br><b>VAULT</b></span></a><div class="sidebar-rule"></div><p class="nav-label">ARCHIVE</p><nav class="primary-nav" aria-label="Game sections">${navItems.map(([id, label, glyph]) => `<button class="nav-item ${screen === id ? 'is-active' : ''}" data-nav="${id}" aria-current="${screen === id ? 'page' : 'false'}"><span class="nav-icon">${icon(glyph)}</span><span>${label}</span><i class="nav-active-mark"></i></button>`).join('')}</nav><div class="sidebar-bottom"><div class="archive-status"><span class="status-dot"></span><span>ARCHIVE CONNECTED</span></div><div class="archive-version">CELESTIAL INDEX <span>VER. 1.0</span></div><div class="archive-footer">A personal archive,<br>kept close.</div></div></aside>
<main class="main-column"><header class="topbar"><div class="mobile-brand"><span class="brand-symbol small"><i></i><b>AV</b></span><b>ASTRAL VAULT</b></div><div class="breadcrumb"><span>ARCHIVE</span><i>/</i><b>${screen === 'summon' ? 'RESONANCE TERMINAL' : screen === 'collection' ? 'CELESTIAL INDEX' : screen === 'team' ? 'FIELD CONFIGURATION' : 'SUPPLY & OPERATIONS'}</b></div><div class="resource-cluster"><div class="resource"><span class="resource-icon credit-icon">◇</span><span><b>${state.player.credits.toLocaleString()}</b><small>ASTRAL CREDITS</small></span><i></i></div><div class="resource"><span class="resource-icon shard-icon">✧</span><span><b>${state.player.shards.toLocaleString()}</b><small>STAR SHARDS</small></span><i></i></div><div class="resource premium-resource"><span class="resource-icon">✧</span><span><b>${state.player.paidCurrency.toLocaleString()}</b><small>PAID ASTRAL</small></span></div></div></header><div class="content-area">${page}</div><footer class="mobile-footer"><span>ASTRAL VAULT</span><span>GUEST ARCHIVE · PROGRESS SAVED</span></footer></main>
    <nav class="mobile-nav" aria-label="Game sections">${navItems.map(([id, label, glyph]) => `<button class="mobile-nav-item ${screen === id ? 'is-active' : ''}" data-nav="${id}" aria-current="${screen === id ? 'page' : 'false'}"><span>${icon(glyph)}</span><small>${label}</small></button>`).join('')}</nav>
    ${revealModal()}${battleModal()}${toastMessage ? `<div class="toast" role="status">${escapeHtml(toastMessage)}</div>` : ''}
  </div>`;
}

function render() { app.innerHTML = shell(); }

function toast(message: string) {
  toastMessage = message;
  render();
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { toastMessage = ''; render(); }, 3200);
}

async function withBusy<T>(fn: () => Promise<T>): Promise<T | undefined> {
  if (busy) return;
  busy = true;
  render();
  try { return await fn(); }
  catch (error) { toast(error instanceof Error ? error.message : 'The archive could not complete that action.'); }
  finally { busy = false; render(); }
  return undefined;
}

function beginReveal(result: SummonResponse) {
  reveal = { result, visible: 0, complete: false, phase: 'approach' };
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reducedMotion) { reveal.phase = 'cards'; reveal.visible = result.results.length; reveal.complete = true; }
  render();
  if (reveal.phase === 'approach') {
    reveal.timer = window.setTimeout(() => {
      if (!reveal) return;
      reveal.phase = 'cards';
      render();
      reveal.timer = window.setTimeout(step, 360);
    }, 1750);
    document.querySelector<HTMLElement>('[data-action="skip-reveal"]')?.focus();
  } else {
    document.querySelector<HTMLElement>('[data-action="close-reveal"]')?.focus();
  }
  function step() {
    if (!reveal) return;
    reveal.visible += 1;
    if (reveal.visible >= reveal.result.results.length) reveal.complete = true;
    render();
    if (!reveal.complete) reveal.timer = window.setTimeout(step, 520);
    else document.querySelector<HTMLElement>('[data-action="close-reveal"]')?.focus();
  }
}

function closeReveal() {
  if (reveal?.timer) window.clearTimeout(reveal.timer);
  reveal = null;
  void refreshState().then(render);
  render();
}

async function summon(count: 1 | 10) {
  const result = await withBusy(() => api<SummonResponse>('/api/summon', { count }));
  if (result) beginReveal(result);
}

async function claimDaily() {
  const result = await withBusy(() => api<{ credits: number; shards: number }>('/api/daily', {}));
  if (!result) return;
  await refreshState();
  toast(`Daily supply claimed · +${result.credits} credits · +${result.shards} shards`);
}

async function saveTeam() {
  const response = await withBusy(() => api<{ team: string[] }>('/api/team', { heroIds: selectedTeam }));
  if (!response) return;
  await refreshState();
  toast('Formation saved to the archive.');
}

async function upgrade(heroId: string) {
  const response = await withBusy(() => api<{ level: number }>('/api/upgrade', { heroId }));
  if (!response) return;
  await refreshState();
  toast(`${heroById(heroId)?.name || 'Character'} strengthened to level ${response.level}.`);
}

async function battle() {
  const response = await withBusy(() => api<{ won: boolean; stage: number; rounds: number; rewardCredits: number; rewardShards: number; damageDealt: number; log: string[] }>('/api/battle', {}));
  if (!response) return;
  await refreshState();
  battleReport = response;
  render();
  document.querySelector<HTMLElement>('[data-action="close-battle"]')?.focus();
}

function openDetail(heroId: string) {
  if (document.querySelector('.unit-detail-backdrop')) return;
  const hero = state.collection.find((item) => item.id === heroId);
  if (!hero) return;
  detailFocusReturn = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const cost = 12 + hero.level * 8;
  const upgradeButton = `<button class="button button-light full-button" data-action="upgrade" data-hero="${escapeHtml(hero.id)}" ${busy || hero.level >= 10 || state.player.shards < cost ? 'disabled' : ''}>${hero.level >= 10 ? 'Maximum level reached' : `Upgrade · ${cost} shards`} <span>${icon('arrow')}</span></button>`;
  const modal = document.createElement('div');
  modal.className = 'modal-backdrop unit-detail-backdrop';
  modal.innerHTML = `<section class="unit-detail-modal" role="dialog" aria-modal="true" aria-labelledby="detail-title"><button class="icon-button detail-close" aria-label="Close details">${icon('close')}</button>${cardMarkup(hero, hero, { detail: true })}<div class="detail-upgrade"><p class="eyebrow">FIELD IMPROVEMENT</p><p>Spend shards to increase attack, health and defence.</p>${upgradeButton}</div></section>`;
  document.body.appendChild(modal);
  modal.addEventListener('click', (event) => {
    if (event.target === modal || (event.target as HTMLElement).closest('.detail-close')) closeDetail();
  });
  modal.querySelector<HTMLElement>('.detail-close')?.focus();
}

function closeDetail() {
  document.querySelector('.unit-detail-backdrop')?.remove();
  detailFocusReturn?.focus();
  detailFocusReturn = null;
}

document.addEventListener('click', (event) => {
  const target = event.target as HTMLElement;
  const nav = target.closest<HTMLElement>('[data-nav]');
  if (nav) {
    screen = nav.dataset.nav || 'summon';
    if (screen === 'team') selectedTeam = [...state.team];
    render();
    return;
  }
  const filter = target.closest<HTMLElement>('[data-filter]');
  if (filter) { collectionFilter = filter.dataset.filter || 'all'; render(); return; }
  const remove = target.closest<HTMLElement>('[data-remove-team]');
  if (remove) { selectedTeam = selectedTeam.filter((id) => id !== remove.dataset.removeTeam); render(); return; }
  const select = target.closest<HTMLElement>('[data-select-hero]');
  if (select) {
    const id = select.dataset.selectHero!;
    selectedTeam = selectedTeam.includes(id) ? selectedTeam.filter((item) => item !== id) : selectedTeam.length < 4 ? [...selectedTeam, id] : [...selectedTeam.slice(1), id];
    render();
    return;
  }
  const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
  if (!action) return;
  if (action === 'summon-one') void summon(1);
  if (action === 'summon-ten') void summon(10);
  if (action === 'claim-daily') void claimDaily();
  if (action === 'save-team') void saveTeam();
  if (action === 'battle') void battle();
  if (action === 'skip-reveal' && reveal) { if (reveal.timer) clearTimeout(reveal.timer); reveal.phase = 'cards'; reveal.visible = reveal.result.results.length; reveal.complete = true; render(); document.querySelector<HTMLElement>('[data-action="close-reveal"]')?.focus(); }
  if (action === 'close-reveal') closeReveal();
  if (action === 'close-battle') { battleReport = null; render(); }
});

app.addEventListener('click', (event) => {
  const card = (event.target as HTMLElement).closest<HTMLElement>('[data-detail-hero]');
  if (!card) return;
  openDetail(card.dataset.detailHero || '');
});

document.addEventListener('click', (event) => {
  const upgradeButton = (event.target as HTMLElement).closest<HTMLElement>('[data-action="upgrade"]');
  if (!upgradeButton) return;
  const heroId = upgradeButton.dataset.hero;
  closeDetail();
  if (heroId) void upgrade(heroId);
});

document.addEventListener('keydown', (event) => {
  const target = event.target as HTMLElement;
  if ((event.key === 'Enter' || event.key === ' ') && target.matches('[data-select-hero]')) {
    event.preventDefault();
    target.click();
  }
  if ((event.key === 'Enter' || event.key === ' ') && target.matches('[data-detail-hero]')) {
    event.preventDefault();
    target.click();
  }
  if (event.key === 'Escape') {
    if (document.querySelector('.unit-detail-backdrop')) closeDetail();
    else if (reveal) closeReveal();
    else if (battleReport) { battleReport = null; render(); }
  }
  const dialog = document.querySelector<HTMLElement>('.unit-detail-modal, .transit-modal, .reveal-modal, .battle-report');
  if (event.key === 'Tab' && dialog) {
    const items = [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')].filter((item) => !item.hidden);
    if (!items.length) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
});

async function start() {
  try {
    [catalog, state] = await Promise.all([api<Catalog>('/api/catalog'), api<GameState>('/api/state')]);
    selectedTeam = [...state.team];
    render();
  } catch (error) {
    app.innerHTML = `<main class="fatal"><span class="brand-symbol"><i></i><b>AV</b></span><p class="eyebrow">ARCHIVE CONNECTION</p><h1>The archive is unavailable.</h1><p>${escapeHtml(error instanceof Error ? error.message : 'Refresh after the local game server has started.')}</p><button class="button button-light" onclick="location.reload()">Reconnect</button><small>Start the Cloudflare Worker with <code>npm run dev</code>.</small></main>`;
  }
}

void start();

window.setInterval(() => {
  if (!state || state.battle.cooldownSeconds <= 0) return;
  state.battle.cooldownSeconds -= 1;
  if (screen === 'missions') render();
}, 1000);
