export type Rarity = 3 | 4 | 5;
export type Element = 'Lunar' | 'Solar' | 'Verdant' | 'Umbral' | 'Tidal' | 'Aether';
export type Role = 'Vanguard' | 'Warden' | 'Arcanist' | 'Ranger' | 'Support' | 'Striker';

export interface Hero {
  id: string;
  name: string;
  epithet: string;
  rarity: Rarity;
  element: Element;
  role: Role;
  skillId: string;
  attack: number;
  hp: number;
  defense: number;
  skill: string;
  skillDescription: string;
  art: string;
}

export const HEROES: Hero[] = [
  {
    id: 'selene', name: 'Selene', epithet: 'Keeper of the Far Moon', rarity: 5,
    element: 'Lunar', role: 'Warden', attack: 104, hp: 1020, defense: 82,
    skillId: 'moonlit-aegis', skill: 'Moonlit Aegis', skillDescription: 'Takes 25% less damage from each enemy strike that hits her.', art: '/art/featured.png',
  },
  {
    id: 'kael', name: 'Kael Rowanveil', epithet: 'Jade Observatory', rarity: 5,
    element: 'Verdant', role: 'Vanguard', attack: 113, hp: 930, defense: 67,
    skillId: 'verdant-line', skill: 'Verdant Line', skillDescription: 'Ignores 45% of enemy defence with each spear strike.', art: '/art/kael-rowanveil.png',
  },
  {
    id: 'ione', name: 'Ione Sunward', epithet: 'The Last Equation', rarity: 5,
    element: 'Solar', role: 'Arcanist', attack: 118, hp: 870, defense: 59,
    skillId: 'perihelion', skill: 'Perihelion', skillDescription: 'Every third round, releases a strike with 70% more force.', art: '/art/ione-sunward.png',
  },
  {
    id: 'nox', name: 'Nox Vesper', epithet: 'Quiet Between Stars', rarity: 5,
    element: 'Umbral', role: 'Ranger', attack: 110, hp: 900, defense: 63,
    skillId: 'black-comet', skill: 'Black Comet', skillDescription: 'Every shot deals 18% extra damage and ignores part of enemy defence.', art: '/art/nox-vesper.png',
  },
  {
    id: 'mira', name: 'Mira Qiao', epithet: 'Tideglass Cartographer', rarity: 4,
    element: 'Tidal', role: 'Support', attack: 86, hp: 940, defense: 76,
    skillId: 'low-tide-map', skill: 'Low-Tide Map', skillDescription: 'After the first enemy strike, restores up to 22% health to the most wounded ally.', art: '/art/mira-qiao.png',
  },
  {
    id: 'tomas', name: 'Tomas Venn', epithet: 'Signal at Dawn', rarity: 4,
    element: 'Aether', role: 'Striker', attack: 91, hp: 900, defense: 68,
    skillId: 'beacon-thrust', skill: 'Beacon Thrust', skillDescription: 'Adds 35 damage to the opening strike.', art: '/art/tomas-venn.png',
  },
  {
    id: 'pax', name: 'Pax Juniper', epithet: 'Courier of Small Moons', rarity: 3,
    element: 'Verdant', role: 'Support', attack: 69, hp: 860, defense: 71,
    skillId: 'patch-kit', skill: 'Patch Kit', skillDescription: 'Once per battle, restores up to 12% of Pax’s maximum health to the most wounded ally.', art: '/art/pax-juniper.png',
  },
  {
    id: 'eda', name: 'Eda Sol', epithet: 'Archive After Hours', rarity: 3,
    element: 'Solar', role: 'Warden', attack: 73, hp: 920, defense: 74,
    skillId: 'quiet-index', skill: 'Quiet Index', skillDescription: 'Exposes a weak point, adding 12 damage to each ally’s opening strike.', art: '/art/eda-sol.png',
  },
];

export const HERO_BY_ID = new Map(HEROES.map((hero) => [hero.id, hero]));
export const PULL_ODDS = { 5: 2, 4: 18, 3: 80 } as const;
export const PITY = { fiveStar: 50, fourStarPlus: 10 } as const;
export const SUMMON_COST = 100;
export const STARTING_FREE_PULLS = 3;
export const DAILY_REWARD = { credits: 200, shards: 10 } as const;
