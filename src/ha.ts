// What the cards use of Home Assistant: the parts of its `hass` object and
// card API, and small helpers adapted from the Home Assistant frontend
// (https://github.com/home-assistant/frontend, Apache License 2.0).
import type {
  HassConfig,
  HassEntities,
  HassEntity,
} from "home-assistant-js-websocket";
import { STATE_NOT_RUNNING } from "home-assistant-js-websocket";
import type { PropertyValues } from "lit";
import {
  any,
  boolean,
  object,
  optional,
  string,
  union,
  array,
} from "superstruct";

// --- Types --------------------------------------------------------------------

export type LocalizeFunc = (
  key: string,
  values?: Record<string, string | number | undefined>
) => string;

export interface EntityRegistryDisplayEntry {
  entity_id: string;
  device_id?: string;
  [key: string]: unknown;
}

export interface Themes {
  darkMode?: boolean;
  themes?: Record<string, Record<string, unknown>>;
  [key: string]: unknown;
}

export interface HomeAssistant {
  states: HassEntities;
  entities: Record<string, EntityRegistryDisplayEntry>;
  devices: Record<string, unknown>;
  config: HassConfig;
  themes: Themes;
  language: string;
  locale: unknown;
  connected: boolean;
  localize: LocalizeFunc;
  callService(
    domain: string,
    service: string,
    serviceData?: Record<string, unknown>
  ): Promise<unknown>;
  formatEntityState(stateObj: HassEntity, state?: string): string;
  formatEntityName(stateObj: HassEntity, name: unknown): string;
}

/** A part of the name of an entity, like its device or area name. */
export type EntityNameItem =
  | { type: "entity" | "device" | "area" | "floor" }
  | { type: "text"; text: string };

export interface LovelaceCardConfig {
  index?: number;
  view_index?: number;
  type: string;
  [key: string]: any;
}

export interface LovelaceGridOptions {
  columns?: number | "full";
  rows?: number | "auto";
  max_columns?: number;
  min_columns?: number;
  min_rows?: number;
  max_rows?: number;
}

export interface LovelaceCard extends HTMLElement {
  hass?: HomeAssistant;
  getCardSize(): number | Promise<number>;
  getGridOptions?(): LovelaceGridOptions;
  setConfig(config: LovelaceCardConfig): void;
}

export interface LovelaceCardEditor extends HTMLElement {
  hass?: HomeAssistant;
  setConfig(config: LovelaceCardConfig): void;
}

/** A field of ha-form, the form element of Home Assistant. */
export interface HaFormSchema {
  name: string;
  type?: string;
  required?: boolean;
  selector?: unknown;
  context?: Record<string, string>;
  schema?: readonly HaFormSchema[];
}

/** The fields of a form, with those of its grids. */
export type SchemaUnion<
  SchemaArray extends readonly HaFormSchema[],
  Schema = SchemaArray[number],
> = Schema extends { schema: readonly HaFormSchema[] }
  ? SchemaUnion<Schema["schema"]> | Schema
  : Schema;

// --- Config structs -------------------------------------------------------------

export const baseLovelaceCardConfig = object({
  type: string(),
  view_layout: any(),
  layout_options: any(),
  grid_options: any(),
  visibility: any(),
  disabled: optional(boolean()),
});

// A name: a text, or the parts of the name of an entity
export const entityNameStruct = union([string(), any(), array(any())]);

// --- Entities -------------------------------------------------------------------

export const STATES_OFF = ["closed", "locked", "off"];
export const UNAVAILABLE = "unavailable";

export const computeDomain = (entityId: string): string =>
  entityId.substring(0, entityId.indexOf("."));

export const computeObjectId = (entityId: string): string =>
  entityId.substring(entityId.indexOf(".") + 1);

/**
 * The color of an entity in its state, from the state color variables of
 * Home Assistant, like its own cards.
 */
export const stateColorCss = (stateObj: HassEntity): string => {
  if (stateObj.state === UNAVAILABLE) {
    return "var(--state-unavailable-color)";
  }
  const domain = computeDomain(stateObj.entity_id);
  const active =
    !STATES_OFF.includes(stateObj.state) && stateObj.state !== "unknown";
  const stateKey = stateObj.state.toLowerCase().replace(/[^a-z0-9]+/g, "_");
  const activeKey = active ? "active" : "inactive";
  const deviceClass = stateObj.attributes.device_class;
  const properties = [
    ...(deviceClass
      ? [`--state-${domain}-${deviceClass}-${stateKey}-color`]
      : []),
    `--state-${domain}-${stateKey}-color`,
    `--state-${domain}-${activeKey}-color`,
    `--state-${activeKey}-color`,
  ];
  return properties.reduceRight(
    (fallback, name) => `var(${name}${fallback ? `, ${fallback}` : ""})`,
    ""
  );
};

/** Turn a switch, an input boolean or a light on or off. */
export const toggleEntity = (hass: HomeAssistant, entityId: string) => {
  const turnOn = STATES_OFF.includes(hass.states[entityId].state);
  return hass.callService(
    computeDomain(entityId),
    turnOn ? "turn_on" : "turn_off",
    {
      entity_id: entityId,
    }
  );
};

/**
 * Up to `maxEntities` of `entities`, else of `entitiesFallback`, in the
 * domains `includeDomains`: the entities of a new card.
 */
export const findEntities = (
  _hass: HomeAssistant,
  maxEntities: number,
  entities: string[],
  entitiesFallback: string[],
  includeDomains?: string[]
): string[] => {
  const matches = (entityId: string) =>
    !includeDomains?.length || includeDomains.includes(computeDomain(entityId));
  const found = entities.filter(matches).slice(0, maxEntities);
  for (const entityId of entitiesFallback) {
    if (found.length >= maxEntities) {
      break;
    }
    if (matches(entityId) && !found.includes(entityId)) {
      found.push(entityId);
    }
  }
  return found;
};

export const createEntityNotFoundWarning = (
  localize: LocalizeFunc,
  config: HassConfig
) =>
  config.state !== STATE_NOT_RUNNING
    ? localize("ui.card.common.entity_not_found")
    : localize("ui.panel.lovelace.warning.starting");

// --- Elements -------------------------------------------------------------------

/** Whether a card needs an update for a change of its config or of `hass`. */
export const hasConfigChanged = (
  element: { hass?: HomeAssistant },
  changedProps: PropertyValues
): boolean => {
  if (changedProps.has("_config")) {
    return true;
  }
  if (!changedProps.has("hass")) {
    return false;
  }
  const oldHass = changedProps.get("hass") as HomeAssistant | undefined;
  const hass = element.hass;
  return (
    !oldHass ||
    !hass ||
    oldHass.connected !== hass.connected ||
    oldHass.themes !== hass.themes ||
    oldHass.locale !== hass.locale ||
    oldHass.localize !== hass.localize ||
    oldHass.formatEntityState !== hass.formatEntityState ||
    oldHass.formatEntityName !== hass.formatEntityName ||
    oldHass.config.state !== hass.config.state
  );
};

export const fireEvent = (
  node: HTMLElement | Window,
  type: string,
  detail?: unknown
): Event => {
  const event = new Event(type, {
    bubbles: true,
    cancelable: false,
    composed: true,
  });
  (event as any).detail = detail ?? {};
  node.dispatchEvent(event);
  return event;
};

/** Ask the app of Home Assistant to vibrate, as its own controls do. */
export const forwardHaptic = (node: HTMLElement, hapticType: string) => {
  fireEvent(node, "haptic", hapticType);
};

/**
 * The editors use elements that Home Assistant loads on demand, such as
 * ha-form. Loading the editor of a built-in card makes sure they are there.
 */
export const ensureEditorElements = async () => {
  if (
    customElements.get("ha-form") &&
    customElements.get("ha-expansion-panel")
  ) {
    return;
  }
  const helpers = await (window as any).loadCardHelpers?.();
  const tile = helpers?.createCardElement({ type: "tile" });
  await tile?.constructor?.getConfigElement?.();
};
