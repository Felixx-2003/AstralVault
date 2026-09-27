import { describe, expect, it } from 'vitest';
import { HEROES, HERO_BY_ID } from '../src/shared/catalog';
import { resolveBattle, rollRarity, rollStats, simulateSummons, type BattleUnit, type RandomSource } from '../src/shared/engine';

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
  const unit = (heroId: string, name: string, attack: number, defense: number, skillId?: string): BattleUnit => ({
    heroId, name, attack, defense, hp: 1000, maxHp: 1000, ...(skillId ? { skillId } : {}),
  });

  it('applies guard, armour penetration, opening damage, and scheduled burst passives', () => {
    const plain = resolveBattle([unit('plain', 'Plain', 90, 60)], 0);
    const selene = resolveBattle([unit('selene', 'Selene', 90, 60, 'moonlit-aegis')], 0);
    const kael = resolveBattle([unit('kael', 'Kael', 90, 60, 'verdant-line')], 0);
    const tomas = resolveBattle([unit('tomas', 'Tomas', 90, 60, 'beacon-thrust')], 0);
    expect(selene.damageTaken).toBeLessThan(plain.damageTaken);
    expect(Number(kael.log[0]?.match(/deals (\d+)/)?.[1])).toBeGreaterThan(Number(plain.log[0]?.match(/deals (\d+)/)?.[1]));
    expect(Number(tomas.log[0]?.match(/deals (\d+)/)?.[1])).toBeGreaterThan(Number(plain.log[0]?.match(/deals (\d+)/)?.[1]));
  });

  it('uses deterministic battle rounds and only grants resources for a clear', () => {
    const team = [
      unit('selene', 'Selene', 104, 82, 'moonlit-aegis'),
      unit('kael', 'Kael', 113, 67, 'verdant-line'),
      unit('ione', 'Ione', 118, 59, 'perihelion'),
      unit('nox', 'Nox', 110, 63, 'black-comet'),
    ];
    const first = resolveBattle(team, 0);
    expect(first).toMatchObject({ won: true, stage: 1, rounds: 1, rewardCredits: 75, rewardShards: 4 });
    expect(resolveBattle([unit('low-power', 'Low Power', 1, 0)], 0)).toMatchObject({ won: false, rewardCredits: 0, rewardShards: 0 });
  });

  it('exposes every character skill as a battle effect', () => {
    expect(HEROES.map((hero) => hero.skillId)).toEqual([
      'moonlit-aegis', 'verdant-line', 'perihelion', 'black-comet', 'low-tide-map', 'beacon-thrust', 'patch-kit', 'quiet-index',
    ]);
    const mira = resolveBattle([unit('mira', 'Mira', 45, 0, 'low-tide-map')], 0);
    const pax = resolveBattle([unit('pax', 'Pax', 45, 0, 'patch-kit')], 0);
    const eda = resolveBattle([unit('eda', 'Eda', 45, 0, 'quiet-index')], 0);
    expect(mira.log.filter((line) => line.includes('Mira restores'))).toHaveLength(1);
    expect(pax.log.filter((line) => line.includes('Pax restores'))).toHaveLength(1);
    expect(eda.log[0]).toContain('Eda deals 50');
  });
});
