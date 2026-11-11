/**
 * Interface language. The Chinese text written in the source is the message key
 * (gettext style): Chinese needs no dictionary, other languages register one that
 * maps the Chinese text to their own. A missing entry falls back to the Chinese,
 * so an untranslated string never disappears.
 *
 * The backend never registers a dictionary, so shared code that calls `t()` keeps
 * producing Chinese there; only the renderer follows the user's choice.
 */
export const LANGUAGES = [
  ['zh-CN', '中文', '简体中文'],
  ['en', 'English', 'English'],
] as const;
export type Language = typeof LANGUAGES[number][0];
export const DEFAULT_LANGUAGE: Language = 'zh-CN';
export const LANGUAGE_STORAGE_KEY = 'hivelab.language';
export const parseLanguage = (value: unknown): Language => value === 'en' ? 'en' : DEFAULT_LANGUAGE;

export type MessageArg = string | number | bigint | boolean | null | undefined;
type Catalog = Readonly<Record<string, string>>;

const CJK = /[㐀-鿿豈-﫿]/;
const PLACEHOLDER = /\{(\d)\}/g;
const catalogs = new Map<Language, Catalog>();
let language: Language = DEFAULT_LANGUAGE;
const listeners = new Set<() => void>();
/** Dynamic text (backend notices, saved labels) resolved through placeholder entries; cleared per language. */
let dynamicCache = new Map<string, string | null>();
let patterns: Array<{ regex: RegExp; template: string; order: number[] }> | undefined;
const DYNAMIC_CACHE_LIMIT = 4000;

export function registerMessages(target: Language, messages: Catalog) {
  catalogs.set(target, { ...catalogs.get(target), ...messages });
  if (target === language) resetCaches();
}
export const getLanguage = () => language;
export function setLanguage(next: Language) {
  const parsed = parseLanguage(next);
  if (parsed === language) return;
  language = parsed;
  resetCaches();
  for (const listener of [...listeners]) listener();
}
export function subscribeLanguage(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
function resetCaches() { dynamicCache = new Map(); patterns = undefined; }

/** Fill `{0}`…`{9}`; an English entry may write `{0|item|items}` for a count-dependent noun. */
export function format(template: string, args: readonly MessageArg[]): string {
  if (!args.length) return template;
  return template
    .replace(/\{(\d)\|([^|}]*)\|([^}]*)\}/g, (_, index: string, one: string, many: string) => Number(args[Number(index)]) === 1 ? one : many)
    .replace(PLACEHOLDER, (whole, index: string) => {
      const value = args[Number(index)];
      return Number(index) < args.length ? String(value) : whole;
    });
}

/** Translate one message written in Chinese. Surrounding whitespace is kept as written. */
export function t(text: string, ...args: MessageArg[]): string {
  if (language === DEFAULT_LANGUAGE || typeof text !== 'string' || !CJK.test(text)) return format(text, args);
  const catalog = catalogs.get(language);
  if (!catalog) return format(text, args);
  const start = text.length - text.trimStart().length, end = text.trimEnd().length;
  const core = text.slice(start, end);
  const found = catalog[core];
  if (found !== undefined) return text.slice(0, start) + format(found, args) + text.slice(end);
  if (args.length) return format(text, args);
  const dynamic = translateDynamic(core, catalog);
  return dynamic === null ? text : text.slice(0, start) + dynamic + text.slice(end);
}

/**
 * Display-boundary translation for text that arrives as data (backend notices, catalog
 * entries, saved labels): only a whole-string match of a known phrase is replaced, so a
 * user's own words are never rewritten piecemeal.
 */
export function translateExact(text: string): string {
  if (language === DEFAULT_LANGUAGE || !CJK.test(text)) return text;
  const catalog = catalogs.get(language);
  if (!catalog) return text;
  const start = text.length - text.trimStart().length, end = text.trimEnd().length;
  const found = catalog[text.slice(start, end)];
  return found === undefined || /\{\d/.test(found) ? text : text.slice(0, start) + found + text.slice(end);
}
export const isDefaultLanguage = () => language === DEFAULT_LANGUAGE;

/** Whether the current language has its own entry for this text (used by tests and the coverage check). */
export const hasMessage = (text: string, target: Language = language) => target === DEFAULT_LANGUAGE || catalogs.get(target)?.[text.trim()] !== undefined;

/**
 * A finished sentence such as "已保存 3 个文件": match it against the entries that carry
 * placeholders ("已保存 {0} 个文件") so text assembled elsewhere still translates.
 */
function translateDynamic(text: string, catalog: Catalog): string | null {
  const cached = dynamicCache.get(text);
  if (cached !== undefined) return cached;
  patterns ??= Object.keys(catalog).filter(key => /\{\d\}/.test(key) && CJK.test(key)).map(key => {
    const order: number[] = [];
    const source = key.split(/(\{\d\})/).map(part => {
      const match = /^\{(\d)\}$/.exec(part);
      if (!match) return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      order.push(Number(match[1]));
      return '([\\s\\S]+?)';
    }).join('');
    return { regex: new RegExp('^' + source + '$'), template: catalog[key], order };
  }).sort((a, b) => b.regex.source.length - a.regex.source.length);
  let result: string | null = null;
  for (const pattern of patterns) {
    const match = pattern.regex.exec(text);
    if (!match) continue;
    const args: string[] = [];
    pattern.order.forEach((index, position) => { args[index] = translateFragment(match[position + 1], catalog); });
    result = format(pattern.template, args);
    break;
  }
  if (dynamicCache.size >= DYNAMIC_CACHE_LIMIT) dynamicCache.clear();
  dynamicCache.set(text, result);
  return result;
}
/** A captured fragment may itself be a known phrase (a status word inside a sentence). */
const translateFragment = (fragment: string, catalog: Catalog) => catalog[fragment.trim()] ?? fragment;
