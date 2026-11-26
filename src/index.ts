// The DIN rail cards for Home Assistant:
// - custom:din-rail-switch-card, a breaker with its power, current and voltage
// - custom:din-rail-panel-card, a distribution board of up to 3 rails
import { restoreDefine } from "./guard-define";
import { DinRailSwitchCard } from "./cards/din-rail-switch-card";
import "./cards/din-rail-panel-card";
import "./editors/din-rail-switch-card-editor";
import "./editors/din-rail-panel-card-editor";
import { localizer } from "./localize";

restoreDefine();

declare const DIN_RAIL_VERSION: string;

interface CustomCardEntry {
  type: string;
  name: string;
  description: string;
  preview?: boolean;
  documentationURL?: string;
}

const windowWithCards = window as unknown as {
  customCards?: CustomCardEntry[];
};

// The card picker of Home Assistant lists them by their English names, as
// there is no hass to localize with yet
const english = localizer({
  language: "en",
  localize: () => "",
} as unknown as Parameters<typeof localizer>[0]);

const DOCS = "https://github.com/max-lyulchenko/din-rail-cards";

if (
  !windowWithCards.customCards?.some(
    (card) => card.type === "din-rail-switch-card"
  )
) {
  windowWithCards.customCards ??= [];
  windowWithCards.customCards.push(
    {
      type: "din-rail-switch-card",
      name: english("ui.panel.lovelace.editor.card.din-rail-switch.name"),
      description: english(
        "ui.panel.lovelace.editor.card.din-rail-switch.description"
      ),
      preview: true,
      documentationURL: DOCS,
    },
    {
      type: "din-rail-panel-card",
      name: english("ui.panel.lovelace.editor.card.din-rail-panel.name"),
      description: english(
        "ui.panel.lovelace.editor.card.din-rail-panel.description"
      ),
      preview: true,
      documentationURL: DOCS,
    }
  );
}

// eslint-disable-next-line no-console
console.info(
  `%c DIN-RAIL-CARDS %c ${DIN_RAIL_VERSION} `,
  "color: white; background: #0b6b3a; font-weight: 700",
  "color: #0b6b3a; background: white; font-weight: 700"
);

export { DinRailSwitchCard };
