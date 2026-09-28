import { describe, expect, it } from 'vitest';
import { HEROES, HERO_BY_ID } from '../src/shared/catalog';
import { campaignStage } from '../src/shared/campaign';
import { deriveStats, resolveBattle, rollRarity, rollStats, simulateSummons, type BattleUnit, type RandomSource } from '../src/shared/engine';

function random(unitValue = 0.5, integerValue = 0): RandomSource {
  return {
    unit: () => unitValue,
    integer: (maxExclusive) => integerValue % maxExclusive,
  };
}

describe('summon rules', () => {
  it('guarantees a five-star on pull 50', () => {
    expect(rollRarity(49, 0, random()).guaranteed).toBe('five');
    expect(rollRarity(49, 0, random())).toMatchObject({ rarity: 5, pity5: 0, pity4: 0 });
  });

  it('guarantees four-star or better on the tenth non-4+ pull', () => {
    expect(rollRarity(0, 8, random(0.5))).toMatchObject({ rarity: 3, pity4: 9, guaranteed: null });
    expect(rollRarity(0, 9, random(0.5))).toMatchObject({ rarity: 4, pity4: 0, guaranteed: 'four' });
  });

  it('keeps 5-star pity precedence and labels a random five-star as a four-plus guarantee', () => {
    expect(rollRarity(49, 9, random(0.5)).guaranteed).toBe('five');
    expect(rollRarity(0, 9, random(0.01))).toMatchObject({ rarity: 5, guaranteed: 'four', pity5: 0, pity4: 0 });
  });

  it('uses the published base-rate boundaries', () => {
    expect(rollRarity(0, 0, random(0.019)).rarity).toBe(5);
    expect(rollRarity(0, 0, random(0.02)).rarity).toBe(4);
    expect(rollRarity(0, 0, random(0.2)).rarity).toBe(3);
  });

  it('rolls individualized stats and converts duplicate copies into rarity-based shards', () => {
    const selene = HERO_BY_ID.get('selene')!;
    expect(rollStats(selene, random(0.5, 12))).toMatchObject({ rollAttack: 7, rollHp: 7, rollDefense: 7 });
    const simulation = simulateSummons(HEROES, 1, 49, 0, new Map([['selene', { heroId: 'selene', level: 1, rollAttack: 0, rollHp: 0, rollDefense: 0 }]]), random(0.5, 0));
    expect(simulation.results[0]).toMatchObject({ hero: selene, duplicate: true, shards: 40 });
    expect(simulation.shardsEarned).toBe(40);
    expect(simulation.newCards).toHaveLength(0);
  });
});

describe('deterministic combat', () => {
  const unit = (heroId: string, name: string, attack: number, defense: number, skillId?: string, hp = 1000): BattleUnit => ({
    heroId, name, attack, defense, hp, maxHp: hp, ...(skillId ? { skillId } : {}),
  });
  const ownedUnit = (id: string, level: number): BattleUnit => {
    const hero = HERO_BY_ID.get(id)!;
    const stats = deriveStats(hero, { heroId: id, level, rollAttack: 0, rollHp: 0, rollDefense: 0 });
    return { heroId: id, name: hero.name, ...stats, maxHp: stats.hp, skillId: hero.skillId };
  };

  it('makes the telegraphed counter and upgrades decisive at the final guardian', () => {
    const crew = ['pax', 'eda', 'tomas', 'mira'].map((id) => ownedUnit(id, 3));
    const correct = resolveBattle(crew, 20, 'guard');
    const wrong = resolveBattle(crew, 20, 'assault');
    const underlevelled = resolveBattle(['pax', 'eda', 'tomas', 'mira'].map((id) => ownedUnit(id, 1)), 20, 'guard');
    expect(correct).toMatchObject({ won: true, countered: true, stance: 'guard', stage: 20 });
    expect(wrong).toMatchObject({ won: false, countered: false });
    expect(underlevelled.won).toBe(false);
    expect(correct.damageTaken).toBeLessThan(wrong.damageTaken);
  });

  it('records real health after each event and clamps damage to remaining health', () => {
    const weak = resolveBattle([unit('weak', 'Weak', 1, 0, undefined, 10)], 3, 'assault');
    const strike = weak.events.find((event) => event.kind === 'enemy')!;
    expect(strike.amount).toBe(10);
    expect(strike.crewHpAfter.weak).toBe(0);
    expect(weak.damageTaken).toBe(10);
    expect(weak.events.at(-1)?.kind).toBe('defeat');
  });

  it('applies Eda’s opening buff to each ally and Pax’s heal based on Pax’s own maximum health', () => {
    const ally = unit('ally', 'Ally', 70, 0, undefined, 2000);
    const pax = unit('pax', 'Pax', 70, 0, 'patch-kit', 1000);
    const eda = unit('eda', 'Eda', 70, 0, 'quiet-index', 1000);
    const withEda = resolveBattle([ally, eda], 1, 'assault');
    const withoutEda = resolveBattle([ally, { ...eda, skillId: undefined }], 1, 'assault');
    expect(withEda.events[0]!.amount).toBeGreaterThan(withoutEda.events[0]!.amount);
    expect(withEda.events[1]!.amount).toBeGreaterThan(withoutEda.events[1]!.amount);
    const healed = resolveBattle([ally, pax], 3, 'assault');
    expect(healed.events.find((event) => event.kind === 'heal')).toMatchObject({ actor: 'Pax', target: 'Ally', amount: 120 });
  });

  it('keeps signature passives and victory rewards server-calculated', () => {
    const plain = resolveBattle([unit('plain', 'Plain', 90, 60)], 2, 'assault');
    const kael = resolveBattle([unit('kael', 'Kael', 90, 60, 'verdant-line')], 2, 'assault');
    const tomas = resolveBattle([unit('tomas', 'Tomas', 90, 60, 'beacon-thrust')], 2, 'assault');
    expect(kael.events[0]!.amount).toBeGreaterThan(plain.events[0]!.amount);
    expect(tomas.events[0]!.amount).toBeGreaterThan(plain.events[0]!.amount);
    const clear = resolveBattle(['pax', 'eda'].map((id) => ownedUnit(id, 1)), 1, 'assault');
    expect(clear).toMatchObject({ won: true, rewardCredits: 75, rewardShards: 8 });
    expect(resolveBattle([unit('weak', 'Weak', 1, 0, undefined, 10)], 1, 'assault')).toMatchObject({ won: false, rewardCredits: 0, rewardShards: 0 });
  });

  it('has a free, no-draw route through all 20 stages with earned upgrades and guaranteed recruits', () => {
    const levels = new Map<string, number>([['pax', 1], ['eda', 1]]);
    let shards = 10;
    let dailyBattleShards = 0;
    for (let stage = 1; stage <= 20; stage += 1) {
      const crew = () => [...levels].map(([id, level]) => ownedUnit(id, level));
      let report = resolveBattle(crew(), stage, campaignStage(stage).counter);
      while (!report.won) {
        const affordable = [...levels].sort((a, b) => a[1] - b[1]).find(([, level]) => shards >= 12 + level * 8);
        expect(affordable, `stage ${stage} needs an affordable upgrade`).toBeDefined();
        const [id, level] = affordable!;
        shards -= 12 + level * 8;
        levels.set(id, level + 1);
        report = resolveBattle(crew(), stage, campaignStage(stage).counter);
      }
      const battleShards = Math.min(8, 120 - dailyBattleShards);
      dailyBattleShards += battleShards;
      shards += battleShards;
      if (stage % 5 === 0) shards += 20;
      if (stage === 5) levels.set('tomas', 1);
      if (stage === 10) levels.set('mira', 1);
    }
    expect(levels.size).toBe(4);
    expect(shards).toBeGreaterThanOrEqual(0);
  });
});
