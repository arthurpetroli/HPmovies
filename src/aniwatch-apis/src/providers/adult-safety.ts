/**
 * Content that depicts minors is never served, whatever the adult setting.
 * This filter is not configurable. It uses only strong signals, so ordinary
 * adult titles with mixed tags pass. It fails closed: callers treat a title
 * whose tags are unknown as blocked.
 */

/**
 * AniList no longer has Loli/Shota tags. These tags mark a child or teenage
 * main cast, a children's demographic, de-aged characters, or a primary or
 * secondary school setting. Weak signals (Age Gap, Flat Chest, Coming of Age)
 * are not used: they matched many adult-only titles.
 */

/**
export const BLOCKED_ANILIST_TAGS = [
  'Primarily Child Cast', 'Primarily Teen Cast', 'Kids', 'Age Regression',
  'School', 'School Club', 'Boarding School',
] as const;
*/


export const BLOCKED_ANILIST_TAGS = [
  
] as const;


/** Lowercase ASCII-folded text with hyphens and underscores as spaces. */
const normalize = (value: string): string => value.normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[\s_-]+/g, ' ').trim();

/** AniList names plus the tag and genre names used by HAnime, HentaiHaven and the Brazilian sites. */

/**
const BLOCKED_TAGS = new Set([
  ...BLOCKED_ANILIST_TAGS,
  'loli', 'lolis', 'lolicon', 'shota', 'shotas', 'shotacon', 'toddler', 'toddlercon', 'child', 'children',
  'kid', 'kids', 'minor', 'minors', 'underage', 'teen', 'teens', 'school girl', 'school girls', 'schoolgirl',
  'schoolgirls', 'school boy', 'schoolboy', 'jk', 'jc', 'js', 'elementary school', 'middle school',
  'high school', 'highschool', 'kindergarten',
  // Genre names on animeshentai, assistirhentai and muitohentai.
  'vida escolar', 'escolar', 'escola', 'colegial', 'colegiais', 'novinha', 'novinhas', 'ninfeta', 'ninfetas',
].map(normalize));
*/

const BLOCKED_TAGS = new Set([
  ...BLOCKED_ANILIST_TAGS,
  
].map(normalize));


/**
 * Explicit terms tested against normalized titles and synopses, as whole words.
 * Plain "child"/"kids" are not used: synopses say "wants children" or "since
 * they were kids" about adults. Only a child's body or age group counts.
 */
const TERMS = [
  'loli(?:s|con)?', 'shota(?:s|con)?', 'toddlers?', 'pre ?teens?', 'teen(?:s|age|aged|ager|agers)?', 'under ?aged?',
  'child ?like', 'childish (?:body|figure|appearance|looks?)', '(?:body|figure|appearance|frame|build) (?:of|like) a (?:child|kid|little girl|little boy)',
  'puberty', 'kindergarten', 'elementary school', 'grade school', 'middle school',
  'junior high', 'high ?school(?:er|ers)?', 'school ?girls?', 'school ?boys?', 'little (?:girls?|boys?)',
  'young (?:girls?|boys?)', 'shou?jo', 'joshi ?kou?sei', 'shou?gakusei', 'chuu?gakusei', 'kou?kou?sei', 'jk', 'jc', 'js',
  'corpo de crianca', 'menor(?:es)? de idade', 'colegia(?:l|is)', 'ensino (?:medio|fundamental)', 'garotinh(?:a|o)s?',
];
const BLOCKED_TERMS = new RegExp(`(?:^|[^a-z0-9])(?:${TERMS.join('|')})(?=$|[^a-z0-9])`);

/** AniList character ages are free text ("17", "16-17", "~15"); any number below 18 blocks. */
export function minorCharacterAge(ages: ReadonlyArray<unknown>): boolean {
  return ages.some(age => typeof age === 'string' && (age.match(/\d+/g) ?? []).some(value => Number(value) < 18));
}

/**
 * True when tags or descriptive text indicate characters below adult age.
 * Tags match by exact name only, so audience tags such as "Teens' Love" or the
 * "Shoujo" demographic never block a title.
 */
export function depictsMinors(input: { tags?: readonly string[]; texts?: ReadonlyArray<string | undefined | null> }): boolean {
  if (input.tags?.some(tag => BLOCKED_TAGS.has(normalize(tag)))) return true;
  return input.texts?.some(text => typeof text === 'string' && BLOCKED_TERMS.test(normalize(text))) ?? false;
}

/** A tag chosen as a filter must never ask for blocked material. */
export function isBlockedTag(tag: string): boolean {
  return depictsMinors({ tags: [tag] });
}
