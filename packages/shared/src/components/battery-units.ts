import { type BatteryUnitState } from "@flixlix-cards/shared/states/raw/battery";
import { type CardMainContext, type FlowCardPlusConfig } from "@flixlix-cards/shared/types";
import { displayValue } from "@flixlix-cards/shared/utils/display-value";
import { html, nothing } from "lit";

const iconForStateOfCharge = (soc: number | null): string => {
  if (soc === null) return "mdi:battery";
  if (soc <= 16) return "mdi:battery-outline";
  if (soc <= 44) return "mdi:battery-low";
  if (soc <= 72) return "mdi:battery-medium";
  return "mdi:battery-high";
};

/**
 * Compact overview of every battery unit. It is rendered below the flow diagram
 * (outside of the absolutely positioned flow lines), so it never affects the line geometry.
 * It is only rendered when more than one battery is configured.
 */
export const batteryUnitsElement = (
  main: CardMainContext,
  config: FlowCardPlusConfig,
  { units, fallbackName }: { units: BatteryUnitState[]; fallbackName: string }
) => {
  if (units.length < 2) return nothing;

  const batteryConfig = config.entities.battery;
  const disableEntityClick = config.clickable_entities === false;
  const socUnit = batteryConfig?.state_of_charge_unit ?? "%";
  const socWhiteSpace = batteryConfig?.state_of_charge_unit_white_space ?? true;
  const socDecimals = batteryConfig?.state_of_charge_decimals || 0;

  return html`<div class="battery-units">
    ${units.map((unit) => {
      const net = (unit.toBattery ?? 0) - (unit.fromBattery ?? 0);
      const direction = net > 0 ? "in" : net < 0 ? "out" : "idle";
      const name = unit.name || `${fallbackName} ${unit.index + 1}`;
      return html`<div
        class="battery-unit ${disableEntityClick ? "pointer-events-none" : ""}"
        @click=${(e: MouseEvent) => main.onEntityClick(e, unit, unit.clickEntity)}
        @dblclick=${(e: MouseEvent) => main.onEntityDoubleClick(e, unit, unit.clickEntity)}
        @pointerdown=${(e: PointerEvent) => main.onEntityPointerDown(e, unit, unit.clickEntity)}
        @pointerup=${(e: PointerEvent) => main.onEntityPointerUp(e)}
        @pointercancel=${(e: PointerEvent) => main.onEntityPointerUp(e)}
      >
        <ha-ripple .disabled=${disableEntityClick}></ha-ripple>
        <ha-icon
          class="battery-unit-icon"
          .icon=${unit.icon ?? iconForStateOfCharge(unit.stateOfCharge)}
        ></ha-icon>
        <span class="battery-unit-name">${name}</span>
        ${unit.stateOfCharge !== null && batteryConfig?.show_state_of_charge !== false
          ? html`<span class="battery-unit-soc"
              >${displayValue(main.hass, config, unit.stateOfCharge, {
                unit: socUnit,
                unitWhiteSpace: socWhiteSpace,
                decimals: socDecimals,
                accept_negative: true,
              })}</span
            >`
          : nothing}
        <span class="battery-unit-power battery-unit-${direction}">
          ${direction === "idle"
            ? nothing
            : html`<ha-icon
                class="small"
                .icon=${direction === "in" ? "mdi:arrow-down" : "mdi:arrow-up"}
              ></ha-icon>`}${displayValue(main.hass, config, Math.abs(net), {
            unit: batteryConfig?.unit_of_measurement,
            unitWhiteSpace: batteryConfig?.unit_white_space,
          })}
        </span>
      </div>`;
    })}
  </div>`;
};
