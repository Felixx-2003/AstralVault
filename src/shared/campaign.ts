export type Stance = 'assault' | 'guard' | 'break';
export type EnemyIntent = 'charge' | 'heavy' | 'armor';

export interface Island {
  id: string;
  name: string;
  color: string;
  goal: string;
}

export interface CampaignStage {
  number: number;
  island: number;
  name: string;
  enemy: string;
  kind: 'sprite' | 'crab' | 'golem' | 'moth' | 'boss';
  intent: EnemyIntent;
  tell: string;
  counter: Stance;
  boss: boolean;
}

export const CAMPAIGN_ISLANDS: Island[] = [
  { id: 'lantern', name: 'Lantern Atoll', color: '#ffce79', goal: 'Relight the first rescue beacon.' },
  { id: 'verdant', name: 'Verdant Reach', color: '#96d7aa', goal: 'Free the gardens beneath the clouds.' },
  { id: 'tideglass', name: 'Tideglass Isle', color: '#87cde4', goal: 'Open the route across the silver sea.' },
  { id: 'dawn', name: 'Crown of Dawn', color: '#d4a7ff', goal: 'Bring the lost islands home.' },
];

const ENCOUNTERS: Array<[string, string, CampaignStage['kind'], EnemyIntent]> = [
  ['The dim crossing', 'Glow Sprite', 'sprite', 'charge'],
  ['Shells in the starlight', 'Moon Crab', 'crab', 'armor'],
  ['A heavy shadow', 'Drift Golem', 'golem', 'heavy'],
  ['The lantern path', 'Comet Moth', 'moth', 'charge'],
  ['Beacon keeper', 'Lantern Guardian', 'boss', 'armor'],
  ['Garden signal', 'Petal Sprite', 'sprite', 'charge'],
  ['Thorn passage', 'Bramble Crab', 'crab', 'armor'],
  ['Fallen observatory', 'Moss Golem', 'golem', 'heavy'],
  ['A path through leaves', 'Violet Moth', 'moth', 'charge'],
  ['Heart of the reach', 'Bloom Guardian', 'boss', 'heavy'],
  ['Silver shoreline', 'Tide Sprite', 'sprite', 'charge'],
  ['A shell of glass', 'Glass Crab', 'crab', 'armor'],
  ['The deep bridge', 'Reef Golem', 'golem', 'heavy'],
  ['Waves of light', 'Pearl Moth', 'moth', 'charge'],
  ['The sea gate', 'Tide Guardian', 'boss', 'armor'],
  ['First light', 'Dawn Sprite', 'sprite', 'charge'],
  ['The golden shell', 'Sun Crab', 'crab', 'armor'],
  ['The final ascent', 'Crown Golem', 'golem', 'heavy'],
  ['Above the clouds', 'Aurora Moth', 'moth', 'charge'],
  ['The last beacon', 'Dawn Guardian', 'boss', 'heavy'],
];

const INTENT_HELP: Record<EnemyIntent, { tell: string; counter: Stance }> = {
  charge: { tell: 'Charging a bright beam. Assault interrupts it and hits harder.', counter: 'assault' },
  heavy: { tell: 'A heavy strike is coming. Guard softens the blow and answers back.', counter: 'guard' },
  armor: { tell: 'Its shell is closed. Break pierces the armour and opens a weak point.', counter: 'break' },
};

export const CAMPAIGN_STAGES: CampaignStage[] = ENCOUNTERS.map(([name, enemy, kind, intent], index) => ({
  number: index + 1,
  island: Math.floor(index / 5),
  name,
  enemy,
  kind,
  intent,
  tell: INTENT_HELP[intent].tell,
  counter: INTENT_HELP[intent].counter,
  boss: (index + 1) % 5 === 0,
}));

export const CAMPAIGN_LENGTH = CAMPAIGN_STAGES.length;
export const BATTLE_DAILY_CREDIT_CAP = 500;
export const BATTLE_DAILY_SHARD_CAP = 120;
export const BOSS_BONUS = { credits: 200, shards: 20 } as const;
export const PRACTICE_REWARD = { credits: 35, shards: 2 } as const;

export function campaignStage(number: number): CampaignStage {
  if (!Number.isInteger(number) || number < 1 || number > CAMPAIGN_LENGTH) throw new RangeError('Choose a stage from 1 to 20.');
  return CAMPAIGN_STAGES[number - 1]!;
}
