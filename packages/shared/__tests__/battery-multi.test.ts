import { describe, expect, test } from "vitest";

import {
  getBatteryInState,
  getBatteryOutState,
  getBatteryStateOfCharge,
  getBatteryUnitStates,
  hasMultipleBatteries,
} from "../src/states/raw/battery";

const makeHass = (states: Record<string, string>) =>
  ({
    states: Object.fromEntries(
      Object.entries(states).map(([id, state]) => [
        id,
        {
          entity_id: id,
          state,
          attributes: { unit_of_measurement: id.includes("soc") ? "%" : "W" },
        },
      ])
    ),
  }) as any;

const makeConfig = (battery: Record<string, unknown>) => ({ entities: { battery } }) as any;

describe("multiple batteries", () => {
  test("single battery config keeps the legacy behavior", () => {
    const config = makeConfig({ entity: "sensor.b1", state_of_charge: "sensor.b1_soc" });
    const hass = makeHass({ "sensor.b1": "-300", "sensor.b1_soc": "55" });

    expect(hasMultipleBatteries(config)).toBe(false);
    expect(getBatteryInState(hass, config)).toBe(300);
    expect(getBatteryOutState(hass, config)).toBe(0);
    expect(getBatteryStateOfCharge(hass, config)).toBe(55);
  });

  test("units without an entity are ignored", () => {
    const config = makeConfig({ entity: "sensor.b1", batteries: [{ name: "broken" }, null] });
    expect(hasMultipleBatteries(config)).toBe(false);
  });

  test("power of all units is summed", () => {
    const config = makeConfig({
      entity: "sensor.b1",
      batteries: [{ entity: "sensor.b2" }],
    });
    // positive = discharging, negative = charging (default sign convention)
    const discharging = makeHass({ "sensor.b1": "400", "sensor.b2": "250" });
    expect(hasMultipleBatteries(config)).toBe(true);
    expect(getBatteryOutState(discharging, config)).toBe(650);
    expect(getBatteryInState(discharging, config)).toBe(0);

    const charging = makeHass({ "sensor.b1": "-400", "sensor.b2": "-250" });
    expect(getBatteryInState(charging, config)).toBe(650);
    expect(getBatteryOutState(charging, config)).toBe(0);
  });

  test("charging and discharging units are netted", () => {
    const config = makeConfig({ entity: "sensor.b1", batteries: [{ entity: "sensor.b2" }] });
    const hass = makeHass({ "sensor.b1": "500", "sensor.b2": "-200" });
    expect(getBatteryOutState(hass, config)).toBe(300);
    expect(getBatteryInState(hass, config)).toBe(0);
  });

  test("invert_state falls back to the main battery and can be overridden per unit", () => {
    const hass = makeHass({ "sensor.b1": "-100", "sensor.b2": "-100", "sensor.b3": "-100" });

    const inherited = makeConfig({
      entity: "sensor.b1",
      invert_state: true,
      batteries: [{ entity: "sensor.b2" }],
    });
    // inverted: negative = discharging
    expect(getBatteryOutState(hass, inherited)).toBe(200);

    const overridden = makeConfig({
      entity: "sensor.b1",
      invert_state: true,
      batteries: [{ entity: "sensor.b3", invert_state: false }],
    });
    expect(getBatteryOutState(hass, overridden)).toBe(0);
    expect(getBatteryInState(hass, overridden)).toBe(0); // +100 out of b1 cancelled by -100 into b3
  });

  test("split consumption/production entities are supported per unit", () => {
    const config = makeConfig({
      entity: "sensor.b1",
      batteries: [{ entity: { consumption: "sensor.b2_out", production: "sensor.b2_in" } }],
    });
    const hass = makeHass({ "sensor.b1": "-100", "sensor.b2_out": "0", "sensor.b2_in": "300" });
    expect(getBatteryInState(hass, config)).toBe(400);
  });

  test("state of charge is averaged without capacities", () => {
    const config = makeConfig({
      entity: "sensor.b1",
      state_of_charge: "sensor.b1_soc",
      batteries: [{ entity: "sensor.b2", state_of_charge: "sensor.b2_soc" }],
    });
    const hass = makeHass({
      "sensor.b1": "0",
      "sensor.b2": "0",
      "sensor.b1_soc": "80",
      "sensor.b2_soc": "40",
    });
    expect(getBatteryStateOfCharge(hass, config)).toBe(60);
  });

  test("state of charge is weighted by capacity when known for all units", () => {
    const config = makeConfig({
      entity: "sensor.b1",
      state_of_charge: "sensor.b1_soc",
      capacity: 10,
      batteries: [{ entity: "sensor.b2", state_of_charge: "sensor.b2_soc", capacity: 5 }],
    });
    const hass = makeHass({
      "sensor.b1": "0",
      "sensor.b2": "0",
      "sensor.b1_soc": "90",
      "sensor.b2_soc": "30",
    });
    expect(getBatteryStateOfCharge(hass, config)).toBeCloseTo(70);
  });

  test("units without state of charge are skipped, none gives null", () => {
    const config = makeConfig({
      entity: "sensor.b1",
      batteries: [{ entity: "sensor.b2", state_of_charge: "sensor.b2_soc" }],
    });
    const hass = makeHass({ "sensor.b1": "0", "sensor.b2": "0", "sensor.b2_soc": "42" });
    expect(getBatteryStateOfCharge(hass, config)).toBe(42);

    const noSoc = makeConfig({ entity: "sensor.b1", batteries: [{ entity: "sensor.b2" }] });
    expect(getBatteryStateOfCharge(hass, noSoc)).toBeNull();
  });

  test("getBatteryUnitStates lists every unit with its own values", () => {
    const config = makeConfig({
      entity: "sensor.b1",
      name: "Main",
      state_of_charge: "sensor.b1_soc",
      batteries: [{ entity: "sensor.b2", name: "Garage" }],
    });
    const hass = makeHass({ "sensor.b1": "-120", "sensor.b2": "80", "sensor.b1_soc": "10" });
    const units = getBatteryUnitStates(hass, config);

    expect(units).toHaveLength(2);
    expect(units[0]).toMatchObject({
      isMain: true,
      name: "Main",
      toBattery: 120,
      fromBattery: 0,
      stateOfCharge: 10,
      clickEntity: "sensor.b1_soc",
    });
    expect(units[1]).toMatchObject({
      isMain: false,
      name: "Garage",
      toBattery: 0,
      fromBattery: 80,
      stateOfCharge: null,
      clickEntity: "sensor.b2",
    });
  });
});
