import type { Hero, Rarity } from './catalog';

export interface RandomSource {
  unit(): number;
  integer(maxExclusive: number): number;
}

export const secureRandom: RandomSource = {
  unit() {
    const words = new Uint32Array(1);
    crypto.getRandomValues(words);
    return words[0]! / 0x1_0000_0000;
  },
  integer(maxExclusive: number) {
    if (!Number.isSafeInteger(maxExclusive) || maxExclusive < 1 || maxExclusive > 0x1_0000_0000) {
      throw new RangeError('Random integer bound must be from 1 to 2^32.');
    }
    const range = 0x1_0000_0000;
    const ceiling = Math.floor(range / maxExclusive) * maxExclusive;
    const words = new Uint32Array(1);
    let value: number;
    do {
      crypto.getRandomValues(words);
      value = words[0]!;
    } while (value >= ceiling);
    return value % maxExclusive;
  },
};

export interface OwnedCard {
  heroId: string;
  level: number;
  rollAttack: number;
  rollHp: number;
  rollDefense: number;
}

export interface CardStats {
  attack: number;
  hp: number;
  defense: number;
}

export function deriveStats(hero: Hero, owned: OwnedCard): CardStats {
  const growth = Math.max(0, owned.level - 1);
  return {
    attack: Math.round(hero.attack * (1 + owned.rollAttack / 100) + growth * 8),
    hp: Math.round(hero.hp * (1 + owned.rollHp / 100) + growth * 72),
    defense: Math.round(hero.defense * (1 + owned.rollDefense / 100) + growth * 5),
  };
}

export function rollStats(hero: Hero, random: RandomSource = secureRandom): OwnedCard {
  return {
    heroId: hero.id,
    level: 1,
    rollAttack: random.integer(13) - 5,
    rollHp: random.integer(13) - 5,
    rollDefense: random.integer(13) - 5,
  };
}

export function rollRarity(
  pity5: number,
  pity4: number,
  random: RandomSource = secureRandom,
): { rarity: Rarity; pity5: number; pity4: number; guaranteed: 'five' | 'four' | null } {
  if (pity5 >= 49) return { rarity: 5, pity5: 0, pity4: 0, guaranteed: 'five' };
  if (pity4 >= 9) {
    const rarity: Rarity = random.unit() < 0.02 ? 5 : 4;
    return { rarity, pity5: rarity === 5 ? 0 : pity5 + 1, pity4: 0, guaranteed: 'four' };
  }
  const roll = random.unit();
  const rarity: Rarity = roll < 0.02 ? 5 : roll < 0.20 ? 4 : 3;
  return {
    rarity,
    pity5: rarity === 5 ? 0 : pity5 + 1,
    pity4: rarity >= 4 ? 0 : pity4 + 1,
    guaranteed: null,
  };
}

export interface SummonResult {
  hero: Hero;
  rarity: Rarity;
  duplicate: boolean;
  shards: number;
  guaranteed: 'five' | 'four' | null;
  stats: CardStats | null;
  rolled: OwnedCard | null;
}

export interface SummonSimulation {
  results: SummonResult[];
  newCards: OwnedCard[];
  pity5: number;
  pity4: number;
  shardsEarned: number;
}

export function simulateSummons(
  heroes: Hero[],
  count: number,
  pity5: number,
  pity4: number,
  owned: Map<string, OwnedCard>,
  random: RandomSource = secureRandom,
): SummonSimulation {
  if (count !== 1 && count !== 10) throw new RangeError('A summon must contain one or ten pulls.');
  const results: SummonResult[] = [];
  const newCards: OwnedCard[] = [];
  const present = new Set(owned.keys());
  let shardsEarned = 0;
  let currentPity5 = pity5;
  let currentPity4 = pity4;

  for (let i = 0; i < count; i += 1) {
    const rolledRarity = rollRarity(currentPity5, currentPity4, random);
    currentPity5 = rolledRarity.pity5;
    currentPity4 = rolledRarity.pity4;
    const pool = heroes.filter((hero) => hero.rarity === rolledRarity.rarity);
    if (pool.length === 0) throw new Error(`The ${rolledRarity.rarity}-star pool is empty.`);
    const hero = pool[random.integer(pool.length)]!;
    const duplicate = present.has(hero.id);
    if (duplicate) {
      const shards = hero.rarity === 5 ? 40 : hero.rarity === 4 ? 12 : 3;
      shardsEarned += shards;
      results.push({ hero, rarity: hero.rarity, duplicate: true, shards, guaranteed: rolledRarity.guaranteed, stats: null, rolled: null });
      continue;
    }
    present.add(hero.id);
    const rolled = rollStats(hero, random);
    newCards.push(rolled);
    results.push({ hero, rarity: hero.rarity, duplicate: false, shards: 0, guaranteed: rolledRarity.guaranteed, stats: deriveStats(hero, rolled), rolled });
  }
  return { results, newCards, pity5: currentPity5, pity4: currentPity4, shardsEarned };
}

export interface BattleUnit extends CardStats {
  heroId: string;
  name: string;
  maxHp: number;
  skillId?: string;
}

export interface BattleReport {
  won: boolean;
  stage: number;
  rounds: number;
  enemyHp: number;
  enemyMaxHp: number;
  damageDealt: number;
  damageTaken: number;
  remainingHp: number;
  rewardCredits: number;
  rewardShards: number;
  log: string[];
}

export function resolveBattle(team: BattleUnit[], winsBefore: number): BattleReport {
  if (team.length < 1 || team.length > 4) throw new RangeError('A battle team must contain one to four units.');
  const stage = Math.max(1, winsBefore + 1);
  const enemyMaxHp = 440 + Math.min(stage - 1, 12) * 52;
  const enemyDefense = 18 + Math.min(12, Math.floor((stage - 1) / 3)) * 2;
  const enemyAttack = 42 + Math.min(stage - 1, 12) * 3;
  const living = team.map((unit) => ({ ...unit, currentHp: unit.hp, skillUsed: false }));
  let enemyHp = enemyMaxHp;
  let damageDealt = 0;
  let damageTaken = 0;
  let rounds = 0;
  const log: string[] = [];

  while (enemyHp > 0 && living.some((unit) => unit.currentHp > 0) && rounds < 8) {
    rounds += 1;
    for (const unit of living) {
      if (enemyHp <= 0) break;
      if (unit.currentHp <= 0) continue;
      let attack = unit.attack;
      let targetDefense = enemyDefense;
      if (unit.skillId === 'verdant-line') targetDefense = Math.floor(enemyDefense * 0.55);
      if (unit.skillId === 'black-comet') { attack = Math.round(attack * 1.18); targetDefense = Math.floor(enemyDefense * 0.75); }
      if (unit.skillId === 'perihelion' && rounds % 3 === 0) attack = Math.round(attack * 1.7);
      if (unit.skillId === 'beacon-thrust' && rounds === 1) attack += 35;
      if (unit.skillId === 'quiet-index' && rounds === 1) attack += 12;
      const damage = Math.max(5, attack - Math.floor(targetDefense * 0.4));
      const dealt = Math.min(enemyHp, damage);
      enemyHp = Math.max(0, enemyHp - dealt);
      damageDealt += dealt;
      log.push(`${unit.name} deals ${dealt} damage.`);
    }
    if (enemyHp <= 0) {
      log.push(`The enemy is defeated in round ${rounds}.`);
      break;
    }
    const target = living.find((unit) => unit.currentHp > 0);
    if (!target) break;
    let damage = Math.max(6, enemyAttack - Math.floor(target.defense * 0.55));
    if (target.skillId === 'moonlit-aegis') damage = Math.max(4, Math.floor(damage * 0.75));
    target.currentHp = Math.max(0, target.currentHp - damage);
    damageTaken += damage;
    log.push(`The enemy strikes ${target.name} for ${damage}.`);
    const mechanic = living.find((unit) => unit.skillId === 'patch-kit' && unit.currentHp > 0);
    if (mechanic && !mechanic.skillUsed) {
      const mostWounded = living.filter((unit) => unit.currentHp > 0).sort((a, b) => (a.currentHp / a.maxHp) - (b.currentHp / b.maxHp))[0];
      if (mostWounded && mostWounded.currentHp < mostWounded.maxHp) {
        const restored = Math.min(mostWounded.maxHp - mostWounded.currentHp, Math.ceil(mechanic.maxHp * 0.12));
        mostWounded.currentHp += restored;
        mechanic.skillUsed = true;
        log.push(`Pax restores ${restored} health with Patch Kit.`);
      }
    }
    const cartographer = living.find((unit) => unit.skillId === 'low-tide-map' && unit.currentHp > 0);
    if (cartographer && !cartographer.skillUsed) {
      const mostWounded = living.filter((unit) => unit.currentHp > 0).sort((a, b) => (a.currentHp / a.maxHp) - (b.currentHp / b.maxHp))[0];
      if (mostWounded) {
        const restored = Math.min(mostWounded.maxHp - mostWounded.currentHp, Math.ceil(mostWounded.maxHp * 0.22));
        if (restored > 0) {
          mostWounded.currentHp += restored;
          cartographer.skillUsed = true;
          log.push(`Mira restores ${restored} health with Low-Tide Map.`);
        }
      }
    }
  }

  const won = enemyHp <= 0;
  const remainingHp = living.reduce((total, unit) => total + unit.currentHp, 0);
  return {
    won, stage, rounds, enemyHp, enemyMaxHp, damageDealt, damageTaken, remainingHp,
    rewardCredits: won ? 75 + Math.min(stage - 1, 10) * 5 : 0,
    rewardShards: won ? 4 : 0,
    log,
  };
}
