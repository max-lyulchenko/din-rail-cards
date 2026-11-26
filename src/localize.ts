// Translations of the cards. Their strings have the keys they would have in
// Home Assistant; other keys (like "state.default.unavailable") come from
// Home Assistant itself.
import type { HomeAssistant, LocalizeFunc } from "./ha";
import en from "./translations/en.json";

type Strings = Record<string, string>;

const flatten = (object: object, prefix = "", out: Strings = {}): Strings => {
  for (const [key, value] of Object.entries(object)) {
    const name = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") {
      out[name] = value;
    } else {
      flatten(value, name, out);
    }
  }
  return out;
};

const LANGUAGES: Record<string, Strings> = {
  en: flatten(en),
};

const format = (
  text: string,
  values?: Record<string, string | number | undefined>
) =>
  values
    ? text.replace(/\{(\w+)\}/g, (match, name) =>
        values[name] !== undefined ? String(values[name]) : match
      )
    : text;

const localizers = new WeakMap<LocalizeFunc, LocalizeFunc>();

/**
 * A localize function for the cards: their own strings in the language of
 * Home Assistant (English when they have no translation), else Home
 * Assistant's.
 */
export const localizer = (hass: HomeAssistant): LocalizeFunc => {
  let localize = localizers.get(hass.localize);
  if (!localize) {
    const strings = LANGUAGES[hass.language?.split("-")[0]] ?? LANGUAGES.en;
    localize = (key, values) => {
      const text = strings[key] ?? LANGUAGES.en[key];
      return text !== undefined
        ? format(text, values)
        : hass.localize(key, values);
    };
    localizers.set(hass.localize, localize);
  }
  return localize;
};
