import type { HassEntity } from "home-assistant-js-websocket";
import type { PropertyValues } from "lit";
import { LitElement, css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
import { styleMap } from "lit/directives/style-map.js";
import memoizeOne from "memoize-one";
import { ensureEditorElements } from "../ha";
import { localizer } from "../localize";
import { STATES_OFF } from "../ha";
import { applyThemesOnElement } from "../apply-themes";
import { fireEvent } from "../ha";
import { stateColorCss } from "../ha";
import { UNAVAILABLE } from "../ha";
import { forwardHaptic } from "../ha";
import type { HomeAssistant } from "../ha";
import { toggleEntity } from "../ha";
import { findEntities } from "../ha";
import {
  currentAboveMax,
  TOTAL_DIGITS,
  formatLcdValue,
  formatTotalValue,
  lcdPrecision,
  toBaseUnit,
  voltageLevel,
} from "../format-lcd-value";
import { hasConfigChanged } from "../ha";
import "../components/din-rail-button";
import "../components/seven-segment";
import type {
  LovelaceCard,
  LovelaceCardEditor,
  LovelaceGridOptions,
} from "../ha";
import {
  DIN_RAIL_SWITCH_DOMAINS,
  LCD_DIGITS,
  READINGS,
  findDeviceReadings,
  findRatingEntity,
  formatRating,
  lcdBacklight,
  readRating,
  shownReadings,
} from "./din-rail-switch-card";
import type { ReadingKey } from "./din-rail-switch-card";
import type { DinRailPanelCardConfig, DinRailPanelModuleConfig } from "./types";

export const DIN_RAIL_PANEL_MAX_COLUMNS = 12;
export const DIN_RAIL_PANEL_MAX_RAILS = 3;

// The meter of the board. Each display aggregates the readings of the
// modules, unless the card sets an entity for it (`override`).
const TOTALS = [
  {
    key: "power_entity",
    override: "total_power_entity",
    show: "show_total_power",
    unit: "W",
    average: false,
    label: "total_power",
    entityLabel: "total_power",
  },
  {
    key: "current_entity",
    override: "total_current_entity",
    show: "show_total_current",
    unit: "A",
    average: false,
    label: "total_current",
    entityLabel: "total_current",
  },
  {
    key: "voltage_entity",
    override: "total_voltage_entity",
    show: "show_total_voltage",
    unit: "V",
    average: true,
    label: "average_voltage",
    entityLabel: "voltage",
  },
] as const;

const STUB_MODULES = 4;

// The zoom shown beside a module under the mouse, like a spyglass: its scale
// and its gap to the module and the edges of the window, in pixels
const ZOOM_SCALE = 2.5;
const ZOOM_GAP = 12;

interface Zoom {
  module: DinRailPanelModuleConfig;
  left: number;
  top: number;
  width: number;
}

/**
 * The CSS color of a `title_color`: a theme color like the color pickers of
 * Home Assistant give (red, primary, light-blue), falling back to the name
 * as a CSS color, or any other CSS color as it is (#c00, rgb(...)).
 */
const titleColor = (color: string | undefined): string | undefined => {
  if (!color || color === "none") {
    return undefined;
  }
  return /^[a-z][a-z-]*$/.test(color)
    ? `var(--${color}-color, ${color})`
    : color;
};

// The head of a Pozidriv screw, as on the cover of a distribution board: a
// cross with straight, square ended arms, and the 4 thin ticks of Pozidriv
// between them, starting outside the cross (Phillips has none)
const SCREW_HEAD = html`
  <svg class="screw" viewBox="-10 -10 20 20" aria-hidden="true">
    <circle class="screw-head" r="9.5"></circle>
    <g class="screw-slot">
      <rect x="-1.4" y="-5.4" width="2.8" height="10.8" rx="0.2"></rect>
      <rect x="-5.4" y="-1.4" width="10.8" height="2.8" rx="0.2"></rect>
      <path
        d="M2.5 2.5 L5.8 5.8 M-2.5 2.5 L-5.8 5.8 M2.5 -2.5 L5.8 -5.8 M-2.5 -2.5 L-5.8 -5.8"
      ></path>
    </g>
  </svg>
`;

@customElement("din-rail-panel-card")
export class DinRailPanelCard extends LitElement implements LovelaceCard {
  public static async getConfigElement(): Promise<LovelaceCardEditor> {
    await ensureEditorElements();
    return document.createElement("din-rail-panel-card-editor");
  }

  public static getStubConfig(
    hass: HomeAssistant,
    entities: string[],
    entitiesFallback: string[]
  ): DinRailPanelCardConfig {
    const switches = findEntities(
      hass,
      STUB_MODULES,
      entities,
      entitiesFallback,
      DIN_RAIL_SWITCH_DOMAINS
    );
    return {
      type: "custom:din-rail-panel-card",
      columns: DIN_RAIL_PANEL_MAX_COLUMNS,
      modules: switches.map((entity) => ({
        entity,
        ...findDeviceReadings(hass, entity),
      })),
    };
  }

  @property({ attribute: false }) public hass?: HomeAssistant;

  @state() private _config?: DinRailPanelCardConfig;

  @state() private _zoom?: Zoom;

  private get _columns(): number {
    return Math.min(
      DIN_RAIL_PANEL_MAX_COLUMNS,
      Math.max(
        1,
        Math.round(this._config?.columns ?? DIN_RAIL_PANEL_MAX_COLUMNS)
      )
    );
  }

  public getCardSize(): number {
    return this._rails(this._config?.modules ?? [], this._columns).length * 3;
  }

  public getGridOptions(): LovelaceGridOptions {
    return {
      columns: "full",
      rows: "auto",
      min_columns: 12,
    };
  }

  public setConfig(config: DinRailPanelCardConfig): void {
    if (!Array.isArray(config.modules)) {
      throw new Error("Specify the modules of the panel");
    }
    const columns = Math.min(
      DIN_RAIL_PANEL_MAX_COLUMNS,
      Math.max(1, Math.round(config.columns ?? DIN_RAIL_PANEL_MAX_COLUMNS))
    );
    if (config.modules.length > columns * DIN_RAIL_PANEL_MAX_RAILS) {
      throw new Error(
        `A panel holds at most ${DIN_RAIL_PANEL_MAX_RAILS} rails of ${columns} modules`
      );
    }
    this._config = config;
  }

  private _rails = memoizeOne(
    (modules: DinRailPanelModuleConfig[], columns: number) => {
      const rails: DinRailPanelModuleConfig[][] = [];
      for (let i = 0; i < modules.length; i += columns) {
        rails.push(modules.slice(i, i + columns));
      }
      return rails.length ? rails : [[]];
    }
  );

  private _entityIds = memoizeOne((modules: DinRailPanelModuleConfig[]) =>
    modules.flatMap((module) =>
      [module.entity, ...READINGS.map(({ key }) => module[key])].filter(
        (id): id is string => Boolean(id)
      )
    )
  );

  // The rating entity of each module, by switch: its own, else the one
  // found for the switch
  private _ratingEntities = memoizeOne(
    (
      modules: DinRailPanelModuleConfig[],
      entities: HomeAssistant["entities"]
    ): Record<string, string> =>
      Object.fromEntries(
        modules
          .filter((module) => module.entity)
          .map((module) => [
            module.entity,
            module.rating_entity || findRatingEntity(entities, module.entity),
          ])
      )
  );

  /** The rating of the breaker of a module in amperes, when it reports one. */
  private _rating(module: DinRailPanelModuleConfig): number | undefined {
    if (!module.entity) {
      return undefined;
    }
    const entityId = this._ratingEntities(
      this._config!.modules,
      this.hass!.entities
    )[module.entity];
    return readRating(this.hass!, entityId);
  }

  // Show a display row only when a module of the panel uses it, so every
  // module of the panel lines up
  // The readings turned on for the board that some module has a sensor for
  private _shownReadings = memoizeOne(
    (config: DinRailPanelCardConfig, modules: DinRailPanelModuleConfig[]) =>
      shownReadings(config).filter(({ key }) =>
        modules.some((module) => module[key])
      )
  );

  protected shouldUpdate(changedProps: PropertyValues): boolean {
    if (!this._config) {
      return false;
    }
    if (hasConfigChanged(this, changedProps) || changedProps.has("_zoom")) {
      return true;
    }
    const oldHass = changedProps.get("hass") as HomeAssistant | undefined;
    if (!oldHass || !this.hass) {
      return changedProps.has("hass");
    }
    return [
      ...this._entityIds(this._config.modules),
      ...Object.values(
        this._ratingEntities(this._config.modules, this.hass.entities)
      ),
      ...TOTALS.map(({ override }) => this._config![override]).filter(
        (id): id is string => Boolean(id)
      ),
    ].some(
      (entityId) =>
        oldHass.states[entityId] !== this.hass!.states[entityId] ||
        oldHass.entities[entityId] !== this.hass!.entities[entityId]
    );
  }

  protected updated(changedProps: PropertyValues): void {
    super.updated(changedProps);
    if (!this._config || !this.hass) {
      return;
    }
    // In the top layer, so the card cannot clip it
    const zoom = this.shadowRoot!.querySelector<HTMLElement>(".zoom");
    if (zoom && !zoom.matches(":popover-open")) {
      zoom.showPopover?.();
    }
    const oldHass = changedProps.get("hass") as HomeAssistant | undefined;
    const oldConfig = changedProps.get("_config") as
      DinRailPanelCardConfig | undefined;
    if (
      !oldHass ||
      !oldConfig ||
      oldHass.themes !== this.hass.themes ||
      oldConfig.theme !== this._config.theme
    ) {
      applyThemesOnElement(this, this.hass.themes, this._config.theme);
    }
  }

  protected render() {
    if (!this._config || !this.hass) {
      return nothing;
    }
    const columns = this._columns;
    const rails = this._rails(this._config.modules, columns);
    const readings = this._shownReadings(this._config, this._config.modules);

    return html`
      <ha-card>
        <div
          class="enclosure"
          style=${styleMap({
            "--columns": String(columns),
            "--title-color": titleColor(this._config.title_color),
          })}
        >
          ${["top-left", "top-right", "bottom-left", "bottom-right"].map(
            (corner) =>
              html`<span class="corner ${corner}">${SCREW_HEAD}</span>`
          )}
          ${
            this._config.title
              ? html`<h2 class="title">${this._config.title}</h2>`
              : nothing
          }
          ${this._config.show_totals !== false ? this._renderTotals() : nothing}
          ${rails.map(
            (rail) => html`
              <div class="rail">
                ${rail.map((module) => this._renderModule(module, readings))}
                ${Array.from(
                  { length: columns - rail.length },
                  () => html`<div class="cell"><div class="blank"></div></div>`
                )}
              </div>
            `
          )}
          ${this._zoom ? this._renderZoom(this._zoom, readings) : nothing}
        </div>
      </ha-card>
    `;
  }

  // A larger copy of the module, drawn at its size rather than scaled, so it
  // stays sharp. It lets the mouse through to the module under it.
  private _renderZoom(
    zoom: Zoom,
    readings: ReturnType<typeof this._shownReadings>
  ) {
    return html`
      <div
        class="zoom"
        popover="manual"
        aria-hidden="true"
        style=${styleMap({
          left: `${zoom.left}px`,
          top: `${zoom.top}px`,
          width: `${zoom.width}px`,
        })}
      >
        ${this._renderModule(zoom.module, readings, true)}
      </div>
    `;
  }

  // Beside the module, so it does not cover what the mouse points at, and
  // toward the middle of the board, so it stays on the screen: on the right
  // for the left 60% of the board, on the left for the right 40%. The other
  // side when it does not fit.
  private _zoomIn(ev: PointerEvent, module: DinRailPanelModuleConfig) {
    if (ev.pointerType !== "mouse" || this._config!.zoom_on_hover === false) {
      return;
    }
    const cell = ev.currentTarget as HTMLElement;
    // Only over the name and the displays, not over the switch
    const upper = cell.querySelector(".lcds") ?? cell.querySelector(".label");
    if (!upper || ev.clientY > upper.getBoundingClientRect().bottom) {
      if (this._zoom) {
        this._zoomOut();
      }
      return;
    }
    if (this._zoom?.module === module) {
      return;
    }
    const rect = cell.getBoundingClientRect();
    const board = cell.closest(".enclosure")!.getBoundingClientRect();
    const width = rect.width * ZOOM_SCALE;
    const height = rect.height * ZOOM_SCALE;
    const position = (rect.left + rect.width / 2 - board.left) / board.width;
    const leftSide = rect.left - ZOOM_GAP - width;
    const rightSide = rect.right + ZOOM_GAP;
    const fitsLeft = leftSide >= ZOOM_GAP;
    const fitsRight = rightSide + width <= window.innerWidth - ZOOM_GAP;
    const onLeft =
      position > 0.6 ? fitsLeft || !fitsRight : !fitsRight && fitsLeft;
    const left = onLeft ? Math.max(ZOOM_GAP, leftSide) : rightSide;
    const top = Math.max(
      ZOOM_GAP,
      Math.min(
        rect.top + (rect.height - height) / 2,
        window.innerHeight - height - ZOOM_GAP
      )
    );
    this._zoom = { module, left, top, width };
  }

  private _zoomOut() {
    this._zoom = undefined;
  }

  /**
   * Sum of the readings of `key` in `unit` (W, A, V), and how many sensors
   * gave one. A sensor shared by several modules counts once, as it measures
   * them together.
   */
  private _aggregate(key: ReadingKey, unit: string) {
    const entityIds = new Set(
      this._config!.modules.map((module) => module[key]).filter(Boolean)
    );
    let sum = 0;
    let count = 0;
    for (const entityId of entityIds) {
      const stateObj = this.hass!.states[entityId!];
      const reading = stateObj
        ? toBaseUnit(
            Number(stateObj.state),
            stateObj.attributes.unit_of_measurement
          )
        : undefined;
      if (reading?.unit === unit) {
        sum += reading.value;
        count++;
      }
    }
    return { sum, count, used: entityIds.size > 0 };
  }

  /**
   * The value of a total display: the reading of its own entity when one is
   * set (a main meter, say), else the aggregate of the modules. Undefined
   * when neither is there, which hides the display.
   */
  private _total(
    total: (typeof TOTALS)[number]
  ): { value: number; entityId?: string } | undefined {
    const entityId = this._config![total.override];
    if (entityId) {
      const stateObj = this.hass!.states[entityId];
      const reading = stateObj
        ? toBaseUnit(
            Number(stateObj.state),
            stateObj.attributes.unit_of_measurement
          )
        : undefined;
      return {
        value: reading?.unit === total.unit ? reading.value : NaN,
        entityId,
      };
    }
    const { sum, count, used } = this._aggregate(total.key, total.unit);
    if (!used) {
      return undefined;
    }
    if (!count) {
      return { value: NaN };
    }
    return { value: total.average ? sum / count : sum };
  }

  private _renderTotals() {
    // Each total has its own switch, whatever the modules show
    const totals = TOTALS.filter(
      ({ show }) => this._config![show] !== false
    ).map((total) => ({ total, shown: this._total(total) }));
    if (totals.every(({ shown }) => !shown)) {
      return nothing;
    }
    return html`
      <div class="totals">
        <span class="totals-title">
          ${localizer(this.hass!)(
            "ui.panel.lovelace.cards.din-rail-panel.totals"
          )}
        </span>
        <div class="lcds">
          ${totals.map(({ total, shown }) =>
            shown
              ? this._renderTotal(total, shown.value, shown.entityId)
              : nothing
          )}
        </div>
      </div>
    `;
  }

  private _renderTotal(
    total: (typeof TOTALS)[number],
    value: number,
    entityId?: string
  ) {
    const { digits, unit } = formatTotalValue(
      value,
      total.unit,
      lcdPrecision(this._config!.precision)
    );
    const size = TOTAL_DIGITS[total.unit];
    // Its own entity shows one reading, not an average
    const labelText = localizer(this.hass!)(
      `ui.panel.lovelace.cards.din-rail-panel.${
        entityId ? total.entityLabel : total.label
      }`
    );
    const level =
      total.unit === "V"
        ? voltageLevel(
            value,
            "V",
            this._config!.voltage_low,
            this._config!.voltage_high
          )
        : undefined;
    const display = html`
      <span class=${classMap({ lcd: true, [level ?? ""]: !!level })}>
        <din-rail-seven-segment
          class="lcd-digits"
          style=${styleMap({ "--digits": size })}
          .value=${digits}
          .digits=${size}
        ></din-rail-seven-segment>
        <span class="lcd-unit">
          <span>${unit}</span>
          ${
            total.unit === "W"
              ? html`<span class="unit-sizer" aria-hidden="true">kW</span>`
              : nothing
          }
        </span>
      </span>
    `;
    const ariaLabel = `${labelText}: ${digits} ${unit}`;
    return entityId
      ? html`
          <button
            class="lcd-bezel"
            data-entity-id=${entityId}
            @click=${this._showMoreInfo}
            aria-label=${ariaLabel}
            title=${ariaLabel}
          >
            ${display}
          </button>
        `
      : html`
          <div
            class="lcd-bezel"
            role="img"
            aria-label=${ariaLabel}
            title=${ariaLabel}
          >
            ${display}
          </div>
        `;
  }

  private _renderModule(
    module: DinRailPanelModuleConfig,
    readings: ReturnType<typeof this._shownReadings>,
    zoomed = false
  ) {
    const stateObj = module.entity
      ? (this.hass!.states[module.entity] as HassEntity | undefined)
      : undefined;
    const isOn = stateObj ? !STATES_OFF.includes(stateObj.state) : false;
    // All modules of a panel have the same switch
    const button = this._config!.switch_style === "button";
    const unavailable = !stateObj || stateObj.state === UNAVAILABLE;
    const name = stateObj
      ? this.hass!.formatEntityName(stateObj, module.name)
      : module.name || module.entity || "";
    const stateLabel = stateObj
      ? this.hass!.formatEntityState(stateObj)
      : localizer(this.hass!)("state.default.unavailable");
    // The rating of the breaker, printed on it, is the max current unless
    // the module sets one
    const rating = this._rating(module);
    const ratingLabel =
      rating !== undefined
        ? html`<span class="rating">${formatRating(rating)}</span>`
        : nothing;

    return html`
      <div
        class="cell"
        @pointermove=${
          zoomed ? undefined : (ev: PointerEvent) => this._zoomIn(ev, module)
        }
        @pointerleave=${zoomed ? undefined : this._zoomOut}
      >
        <div
          class=${classMap({ module: true, on: isOn, unavailable })}
          style=${styleMap({
            "--active-color": stateObj ? stateColorCss(stateObj) : undefined,
          })}
        >
          <button
            class="label"
            data-entity-id=${module.entity}
            .disabled=${!stateObj}
            @click=${this._showMoreInfo}
            title=${name}
          >
            ${name}
          </button>
          ${
            readings.length
              ? html`
                  <div class="lcds ${this._voltageLevel(module) ?? ""}">
                    ${readings.map(({ key }) =>
                      this._renderLcd(
                        module[key],
                        key === "current_entity"
                          ? (module.max_current ?? rating)
                          : undefined
                      )
                    )}
                  </div>
                `
              : nothing
          }
          ${
            button
              ? html`
                  <div class="breaker">
                    ${ratingLabel}
                    <din-rail-button
                      data-entity-id=${module.entity}
                      .on=${isOn}
                      .disabled=${unavailable}
                      .label=${`${name}: ${stateLabel}`}
                      @click=${this._toggle}
                    ></din-rail-button>
                  </div>
                `
              : html`
                  <div class="breaker">
                    ${ratingLabel}
                    <button
                      class="slot"
                      role="switch"
                      aria-checked=${isOn ? "true" : "false"}
                      aria-label=${name}
                      title=${stateLabel}
                      data-entity-id=${module.entity}
                      .disabled=${unavailable}
                      @click=${this._toggle}
                    >
                      <span class="slot-label on-label">ON</span>
                      <span class="slot-label off-label">OFF</span>
                      <span class="lever">${isOn ? "ON" : "OFF"}</span>
                    </button>
                  </div>
                  <span class="flag"></span>
                `
          }
        </div>
      </div>
    `;
  }

  // The backlight of a module's displays: gray below the low voltage, red
  // above the high one
  private _voltageLevel(module: DinRailPanelModuleConfig) {
    const stateObj = module.voltage_entity
      ? this.hass!.states[module.voltage_entity]
      : undefined;
    return stateObj
      ? voltageLevel(
          Number(stateObj.state),
          stateObj.attributes.unit_of_measurement,
          this._config!.voltage_low,
          this._config!.voltage_high
        )
      : undefined;
  }

  /** `maxCurrent`: the display turns red above it (the current display). */
  private _renderLcd(entityId: string | undefined, maxCurrent?: number) {
    if (!entityId) {
      // An unused display stays dark, so the modules of a rail line up
      return html`
        <span class="lcd-bezel">
          <span class="lcd">
            <din-rail-seven-segment
              class="lcd-digits"
              .digits=${LCD_DIGITS}
            ></din-rail-seven-segment>
            <span class="lcd-unit"></span>
          </span>
        </span>
      `;
    }
    const stateObj = this.hass!.states[entityId] as HassEntity | undefined;
    const lcd = formatLcdValue(
      stateObj ? Number(stateObj.state) : NaN,
      stateObj?.attributes.unit_of_measurement,
      LCD_DIGITS,
      lcdPrecision(this._config!.precision)
    );
    const valueText = stateObj
      ? this.hass!.formatEntityState(stateObj)
      : localizer(this.hass!)("state.default.unavailable");
    const label = stateObj
      ? this.hass!.formatEntityName(stateObj, undefined)
      : entityId;
    return html`
      <button
        class="lcd-bezel"
        data-entity-id=${entityId}
        @click=${this._showMoreInfo}
        aria-label=${`${label}: ${valueText}`}
        title=${`${label}: ${valueText}`}
      >
        <span
          class=${classMap({
            lcd: true,
            alarm:
              !!stateObj &&
              currentAboveMax(
                Number(stateObj.state),
                stateObj.attributes.unit_of_measurement,
                maxCurrent
              ),
          })}
        >
          <din-rail-seven-segment
            class="lcd-digits"
            .value=${lcd.digits}
            .digits=${LCD_DIGITS}
          ></din-rail-seven-segment>
          <span class="lcd-unit">${lcd.unit}</span>
        </span>
      </button>
    `;
  }

  private _toggle(ev: Event): void {
    const entityId = (ev.currentTarget as HTMLElement).dataset.entityId;
    if (!entityId || !this.hass?.states[entityId]) {
      return;
    }
    forwardHaptic(this, "light");
    toggleEntity(this.hass, entityId);
  }

  private _showMoreInfo(ev: Event): void {
    const entityId = (ev.currentTarget as HTMLElement).dataset.entityId;
    if (entityId) {
      fireEvent(this, "hass-more-info", { entityId });
    }
  }

  /*
   * Every module is drawn on a grid of 69 units wide, the unit (--u) being a
   * 69th of the module width, so a module scales with the card. Modules stop
   * growing at 63px wide.
   *
   * Module height: padding 4 + label 14 + gap 4 + displays 3 x 24 + gaps
   * 2 x 2 + gap 4 + rating 9 + 18 + 9 + gap 1 + switch + padding 6.
   * The rating has a font of 18 units, with half its font size above and
   * below it. The button switch is a circle as wide as the rating ("10A"),
   * 32 units; the DIN switch is a slot as wide, 40 units high.
   * Display width: digits 42 + gap 2 + unit 11 + padding 4 + bezel 4 = 63
   * units, all the width inside the module.
   */
  static styles = css`
    ha-card {
      height: 100%;
      box-sizing: border-box;
      overflow: hidden;
    }
    button {
      font: inherit;
      color: inherit;
      background: none;
      border: none;
      padding: 0;
      margin: 0;
      cursor: pointer;
    }
    button:disabled {
      cursor: default;
    }
    button:focus-visible {
      outline: 2px solid var(--primary-color);
      outline-offset: 1px;
    }

    /* The distribution board: a plastic cover held by a Pozidriv screw in each
       corner */
    .enclosure {
      --module-max-width: 63px;
      --rail-padding: 10px;
      --module-gap: 2px;
      /* Room for the screws: 18px in from the edges, 21px wide */
      --box-padding: 46px;
      --box-color: color-mix(
        in srgb,
        var(--ha-card-background, var(--card-background-color, #fff)) 93%,
        #808080
      );
      position: relative;
      box-sizing: border-box;
      max-width: calc(
        var(--columns) * var(--module-max-width) + (var(--columns) - 1) *
          var(--module-gap) + 2 * var(--rail-padding) + 2 * var(--box-padding)
      );
      width: calc(100% - 2 * var(--ha-space-4));
      margin: var(--ha-space-1) auto var(--ha-space-4);
      padding: var(--box-padding);
      display: flex;
      flex-direction: column;
      gap: var(--ha-space-3);
      border-radius: 14px;
      border: 1px solid rgba(0, 0, 0, 0.22);
      background: var(--box-color);
      box-shadow:
        0 2px 5px rgba(0, 0, 0, 0.25),
        inset 0 1px 0 rgba(255, 255, 255, 0.4),
        inset 0 0 0 5px rgba(0, 0, 0, 0.025);
    }
    /* The name of the box, engraved in the cover: dark on its top edge,
       light on its bottom edge, like a groove catching the light */
    .title {
      margin: calc(-0.5 * var(--box-padding) + 4px) 28px 0;
      color: var(--title-color, var(--secondary-text-color));
      font-size: var(--ha-font-size-xl, 20px);
      font-weight: var(--ha-font-weight-bold, 600);
      line-height: 1.2;
      letter-spacing: 0.04em;
      text-align: center;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      text-shadow:
        0 1px 0 rgba(255, 255, 255, 0.55),
        0 -1px 0 rgba(0, 0, 0, 0.35);
    }
    .corner {
      position: absolute;
      /* A PZ2 head, 5mm (at the scale of an 18mm module) in from the
         corner along each edge */
      width: 21px;
      height: 21px;
      --corner-offset: 18px;
    }
    .corner.top-left {
      top: var(--corner-offset);
      left: var(--corner-offset);
    }
    .corner.top-right {
      top: var(--corner-offset);
      right: var(--corner-offset);
      transform: rotate(20deg);
    }
    .corner.bottom-left {
      bottom: var(--corner-offset);
      left: var(--corner-offset);
      transform: rotate(-35deg);
    }
    .corner.bottom-right {
      bottom: var(--corner-offset);
      right: var(--corner-offset);
      transform: rotate(10deg);
    }
    .screw {
      display: block;
      width: 100%;
      height: 100%;
      overflow: visible;
      filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.35));
    }
    .screw-head {
      fill: #c9c9c9;
      stroke: #8f8f8f;
      stroke-width: 0.8;
    }
    .screw-slot rect {
      fill: #4a4a4a;
    }
    .screw-slot path {
      stroke: #555;
      stroke-width: 0.8;
      stroke-linecap: round;
    }
    /* A rail: modules clipped on a metal DIN rail */
    .rail {
      position: relative;
      display: grid;
      grid-template-columns: repeat(var(--columns), minmax(0, 1fr));
      gap: var(--module-gap);
      padding: var(--ha-space-2) var(--rail-padding);
      border-radius: var(--ha-border-radius-md, 8px);
      background: var(--secondary-background-color);
      box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.2);
    }
    .rail::before {
      content: "";
      position: absolute;
      left: 2px;
      right: 2px;
      top: 50%;
      height: 24px;
      transform: translateY(-50%);
      border-radius: 2px;
      background: linear-gradient(#d6d6d6, #9c9c9c 45%, #8a8a8a 55%, #c4c4c4);
    }
    .cell {
      position: relative;
      container-type: inline-size;
      min-width: 0;
    }
    .zoom {
      position: fixed;
      inset: auto;
      margin: 0;
      padding: 0;
      border: none;
      background: none;
      overflow: visible;
      pointer-events: none;
      color: inherit;
      animation: zoom-in 120ms ease-out;
    }
    .zoom .module {
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
    }
    @keyframes zoom-in {
      from {
        opacity: 0;
        transform: scale(0.9);
      }
    }
    .blank {
      height: 100%;
      box-sizing: border-box;
      border-radius: 3px;
      border: 1px solid var(--divider-color);
      background: var(--ha-color-fill-neutral-quiet-resting, #e8e8e8);
      opacity: 0.6;
    }

    /* A module, drawn like a single pole DIN rail switch */
    .module {
      --u: calc(100cqi / 69);
      --module-color: var(--ha-color-fill-neutral-quiet-resting, #e8e8e8);
      --active-color: var(--state-active-color);
      position: relative;
      height: 100%;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: calc(4 * var(--u));
      padding: calc(4 * var(--u)) calc(3 * var(--u)) calc(6 * var(--u));
      border-radius: calc(3 * var(--u));
      border: 1px solid var(--divider-color);
      background: var(--module-color);
    }
    .module.unavailable {
      opacity: 0.5;
    }
    .label {
      width: 100%;
      font-size: calc(11 * var(--u));
      line-height: calc(14 * var(--u));
      font-weight: var(--ha-font-weight-medium);
      text-align: center;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .lcds {
      align-self: stretch;
      display: flex;
      flex-direction: column;
      gap: calc(2 * var(--u));
    }
    /* The meter of the whole box: a section engraved in the enclosure,
       its title cut into the border, with 3 displays and no labels */
    .totals {
      --digit-height: 22px;
      position: relative;
      box-sizing: border-box;
      margin-top: 6px;
      padding: 14px var(--ha-space-3) var(--ha-space-2);
      border-radius: 6px;
      border: 1px solid rgba(0, 0, 0, 0.28);
      box-shadow:
        1px 1px 0 rgba(255, 255, 255, 0.35),
        inset 1px 1px 0 rgba(255, 255, 255, 0.35);
    }
    .totals-title {
      position: absolute;
      top: 0;
      left: 50%;
      transform: translate(-50%, -50%);
      padding: 0 6px;
      background: var(--box-color);
      color: var(--secondary-text-color);
      font-size: 11px;
      font-weight: bold;
      line-height: 1;
      letter-spacing: 0.12em;
      text-transform: uppercase;
      white-space: nowrap;
      text-shadow:
        0 1px 0 rgba(255, 255, 255, 0.35),
        0 -1px 0 rgba(0, 0, 0, 0.25);
    }
    .totals .lcds {
      flex-direction: row;
      flex-wrap: wrap;
      justify-content: center;
      gap: var(--ha-space-2);
    }
    .totals .lcd-bezel {
      padding: 3px;
      border-radius: 5px;
    }
    .totals .lcd {
      gap: 5px;
      padding: 5px 7px;
      border-radius: 3px;
    }
    /* A digit is 27 of 36 units wide, plus 2 units of margin */
    .totals .lcd-digits {
      height: var(--digit-height);
      width: calc(var(--digit-height) * (var(--digits) * 27 + 2) / 36);
    }
    /* The unit is as high as the digits: its capital fills the line, whose
       height is the cap height of the font (0.711 em in Roboto) */
    .totals .lcd-unit {
      width: auto;
      height: var(--digit-height);
      font-family: var(--ha-font-family-body, Roboto, sans-serif);
      font-size: calc(var(--digit-height) / 0.711);
      font-weight: var(--ha-font-weight-medium, 500);
      line-height: var(--digit-height);
      overflow: visible;
      /* The unit and its sizer share a cell, so W takes the room of kW and
         the display does not change width when it switches */
      display: grid;
    }
    .totals .lcd-unit > span {
      grid-area: 1 / 1;
    }
    .totals .unit-sizer {
      visibility: hidden;
    }
    .lcd-bezel {
      display: flex;
      padding: calc(2 * var(--u));
      border-radius: calc(3 * var(--u));
      background: linear-gradient(#4a4a4a, #2a2a2a);
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.15);
    }
    ${lcdBacklight}
    .lcd {
      --seven-segment-on-color: var(--lcd-ink);
      --seven-segment-off-color: var(--lcd-ink-off);
      flex: 1;
      min-width: 0;
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: calc(3 * var(--u));
      padding: calc(2 * var(--u)) calc(3 * var(--u));
      border-radius: calc(1.5 * var(--u));
      background: var(--lcd-backlight);
      box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.45);
      color: var(--lcd-ink);
      font-family: var(--ha-font-family-code, monospace);
    }
    /* 4 digits of 27 by 36 units, plus 2 units of margin */
    .lcd-digits {
      flex: none;
      height: calc(13 * var(--u));
      width: calc(13 * var(--u) * 110 / 36);
    }
    .lcd-unit {
      flex: none;
      width: calc(19 * var(--u));
      font-size: calc(8 * var(--u));
      font-weight: bold;
      line-height: 1;
      text-align: start;
      white-space: nowrap;
    }

    /* The displays of a module: digits of 42 by 13.75 units, 24 units high */
    .module .lcd {
      gap: calc(2 * var(--u));
      padding: calc(3 * var(--u)) calc(2 * var(--u));
    }
    .module .lcd-digits {
      height: calc(42 * var(--u) * 36 / 110);
      width: calc(42 * var(--u));
    }
    .module .lcd-unit {
      width: calc(11 * var(--u));
    }

    .breaker {
      margin-top: auto;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--u);
    }
    /* The rating, printed on the breaker like on a real one */
    .rating {
      font-size: calc(18 * var(--u));
      font-weight: var(--ha-font-weight-bold);
      line-height: 1;
      margin: 0.5em 0;
      letter-spacing: 0.02em;
      color: var(--secondary-text-color);
    }
    din-rail-button {
      /* Round; the stand-by symbol is 3/4 of its 24px icon box, so a box
         as wide as the button makes the symbol 75% of it */
      --button-height: calc(32 * var(--u));
      --button-width: var(--button-height);
      --button-icon-size: var(--button-height);
    }
    .slot {
      position: relative;
      width: calc(32 * var(--u));
      height: calc(40 * var(--u));
      border-radius: calc(3 * var(--u));
      background: #262626;
    }
    .lever {
      position: absolute;
      left: calc(3 * var(--u));
      right: calc(3 * var(--u));
      height: calc(18 * var(--u));
      top: calc(100% - 21 * var(--u));
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: calc(2 * var(--u));
      background: var(--red-color, #f44336);
      color: #fff;
      font-size: calc(10 * var(--u));
      font-weight: var(--ha-font-weight-bold, 700);
      letter-spacing: 0.04em;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.4);
      transition: top 150ms ease-in-out;
    }
    .module.on .lever {
      background: var(--green-color, #4caf50);
      top: calc(3 * var(--u));
    }
    /* The states printed in the slot; the lever hides the one it is at,
       so the slot shows the other */
    .slot-label {
      position: absolute;
      left: 0;
      right: 0;
      /* The black left by the lever: 40 - 3 - 18 units */
      height: calc(19 * var(--u));
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: calc(10 * var(--u));
      font-weight: 400;
      letter-spacing: 0.08em;
    }
    .on-label {
      top: 0;
      color: color-mix(in srgb, var(--green-color, #4caf50) 75%, #fff);
    }
    .off-label {
      bottom: 0;
      color: color-mix(in srgb, var(--red-color, #f44336) 75%, #fff);
    }
    .flag {
      position: absolute;
      bottom: calc(5 * var(--u));
      right: calc(5 * var(--u));
      width: calc(6 * var(--u));
      height: calc(6 * var(--u));
      border-radius: 50%;
      background: var(--state-inactive-color, var(--disabled-color));
    }
    .module.on .flag {
      background: var(--active-color);
      box-shadow: 0 0 calc(4 * var(--u)) var(--active-color);
    }
    @media (prefers-reduced-motion: reduce) {
      .lever {
        transition: none;
      }
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    "din-rail-panel-card": DinRailPanelCard;
  }
}
