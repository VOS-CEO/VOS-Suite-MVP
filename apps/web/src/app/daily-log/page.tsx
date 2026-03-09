import DailyLogClient from "./DailyLogClient";
import { headers } from "next/headers";

// ---------- Types ----------
type EquipmentItem = {
  id: string;
  display_name: string;
  equipment_type?: { code?: string | null } | null;
  location?: { name?: string | null } | null;
};

type TodayLog = {
  id: string;
  vessel_id: string;
  status: string;
  location_text?: string | null;
  notes?: string | null;
  submitted_at?: string | null;
  power_source?: "SHORE" | "GENERATOR" | string | null;
};

type MeterTarget = {
  equipmentId: string;
  equipmentName: string;
  runHoursFieldId: string;
  locationName: string | null;
};

type ChillerPlantTarget =
  | {
      kind: "CHILLER";
      equipmentId: string;
      equipmentName: string;
      locationName: string | null;
      fieldIds: { RUNNING: string | null; TEMP_SUPPLY: string | null; TEMP_RETURN: string | null };
    }
  | {
      kind: "CHW_SELECT" | "SW_SELECT";
      equipmentId: string;
      equipmentName: string;
      locationName: string | null;
      fieldIds: { SELECTED_PUMP: string | null };
    };

type PowerFieldIds = {
  BUS_VOLTAGE: string | null;
  BUS_FREQUENCY: string | null;
  LOAD_PCT: string | null;
};

type PowerTarget =
  | {
      kind: "DG";
      equipmentId: string;
      equipmentName: string;
      locationName: string | null;
      fieldIds: PowerFieldIds;
    }
  | {
      kind: "SHORE";
      equipmentId: string;
      equipmentName: string;
      locationName: string | null;
      fieldIds: PowerFieldIds;
    };

type PowerPanel = {
  targets: PowerTarget[];
  initialValuesByKey: Record<string, string>;
};

type UtilitiesPanel = {
  fwSystem: {
    equipmentId: string;
    equipmentName: string;
    locationName: string | null;
    fieldIds: { SELECTED_PUMP: string | null; FW_PRESSURE: string | null };
  } | null;
  circPump: {
    equipmentId: string;
    equipmentName: string;
    locationName: string | null;
    fieldIds: { RUNNING: string | null };
  } | null;
  boilers: Array<{
    equipmentId: string;
    equipmentName: string;
    locationName: string | null;
    fieldIds: { RUNNING: string | null; BOILER_TEMP: string | null };
  }>;
  initialValuesByKey: Record<string, string>;
};

// ---------- Helpers ----------
async function getBaseUrl(): Promise<string> {
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? "http";
  return `${proto}://${host}`;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(await res.text());
  return (await res.json()) as T;
}

async function getToday(baseUrl: string): Promise<{ log: TodayLog }> {
  return await getJson<{ log: TodayLog }>(`${baseUrl}/api/daily-logs/today`);
}

async function getEquipmentList(baseUrl: string, vesselId: string): Promise<EquipmentItem[]> {
  const url = new URL(`${baseUrl}/api/em/equipment`);
  url.searchParams.set("vesselId", vesselId);
  const json = await getJson<{ items: EquipmentItem[] }>(url.toString());
  return (json.items ?? []) as EquipmentItem[];
}

async function getFieldIds(baseUrl: string, equipmentId: string): Promise<Record<string, string>> {
  const res = await fetch(`${baseUrl}/api/em/equipment/${equipmentId}/fields`, { cache: "no-store" });
  if (!res.ok) throw new Error(await res.text());
  const json = await res.json();
  const fields = (json.items ?? []) as Array<{ field_id: string; code: string }>;
  const map: Record<string, string> = {};
  for (const f of fields) map[f.code] = f.field_id;
  return map;
}

async function getSavedReading(
  baseUrl: string,
  dailyLogId: string,
  equipmentId: string,
  fieldId: string
): Promise<{ num?: number; bool?: boolean; text?: string } | null> {
  const res = await fetch(
    `${baseUrl}/api/daily-logs/${dailyLogId}/meter-readings/one?equipmentId=${equipmentId}&fieldId=${fieldId}`,
    { cache: "no-store" }
  );
  if (!res.ok) return null;
  const json = await res.json();
  const v = json?.reading?.value;
  if (!v || typeof v !== "object") return null;
  return v as { num?: number; bool?: boolean; text?: string };
}

// ---------- Builders ----------
async function buildRunHoursTargets(
  baseUrl: string,
  dailyLogId: string,
  equipment: EquipmentItem[],
  typeCode: string
): Promise<{ targets: MeterTarget[]; initialHoursByEquipmentId: Record<string, number | null> }> {
  const rows = equipment
    .filter((e) => (e.equipment_type?.code ?? "") === typeCode)
    .sort((a, b) => a.display_name.localeCompare(b.display_name));

  const initialHoursByEquipmentId: Record<string, number | null> = {};
  const targets: MeterTarget[] = [];

  for (const eq of rows) {
    const fields = await getFieldIds(baseUrl, eq.id);
    const runHoursFieldId = fields["RUN_HOURS"];
    if (!runHoursFieldId) continue;

    targets.push({
      equipmentId: eq.id,
      equipmentName: eq.display_name,
      runHoursFieldId,
      locationName: eq.location?.name ?? null,
    });

    const v = await getSavedReading(baseUrl, dailyLogId, eq.id, runHoursFieldId);
    initialHoursByEquipmentId[eq.id] = typeof v?.num === "number" ? v.num : null;
  }

  return { targets, initialHoursByEquipmentId };
}

async function buildChillerPlantTargets(
  baseUrl: string,
  dailyLogId: string,
  equipment: EquipmentItem[]
): Promise<{
  chillers: ChillerPlantTarget[];
  chwPumps: ChillerPlantTarget | null;
  swPumps: ChillerPlantTarget | null;
  initialValuesByKey: Record<string, string>;
}> {
  const isChiller = (e: EquipmentItem) => (e.equipment_type?.code ?? "") === "CHILLER";
  const isChwSel = (e: EquipmentItem) => (e.equipment_type?.code ?? "") === "CHW_PUMP";
  const isSwSel = (e: EquipmentItem) => (e.equipment_type?.code ?? "") === "SW_PUMP";

  const chillersRaw = equipment.filter(isChiller).sort((a, b) => a.display_name.localeCompare(b.display_name));
  const chwRaw = equipment.filter(isChwSel)[0] ?? null;
  const swRaw = equipment.filter(isSwSel)[0] ?? null;

  const initialValuesByKey: Record<string, string> = {};

  const chillers: ChillerPlantTarget[] = await Promise.all(
    chillersRaw.map(async (eq) => {
      const fields = await getFieldIds(baseUrl, eq.id);
      const running = fields["RUNNING"] ?? null;
      const ts = fields["TEMP_SUPPLY"] ?? null;
      const tr = fields["TEMP_RETURN"] ?? null;

      const t: ChillerPlantTarget = {
        equipmentId: eq.id,
        equipmentName: eq.display_name,
        locationName: eq.location?.name ?? null,
        kind: "CHILLER",
        fieldIds: { RUNNING: running, TEMP_SUPPLY: ts, TEMP_RETURN: tr },
      };

      if (running) {
        const v = await getSavedReading(baseUrl, dailyLogId, eq.id, running);
        initialValuesByKey[`${eq.id}:${running}`] = typeof v?.bool === "boolean" ? (v.bool ? "true" : "false") : "false";
      }
      if (ts) {
        const v = await getSavedReading(baseUrl, dailyLogId, eq.id, ts);
        initialValuesByKey[`${eq.id}:${ts}`] = typeof v?.num === "number" ? String(v.num) : "";
      }
      if (tr) {
        const v = await getSavedReading(baseUrl, dailyLogId, eq.id, tr);
        initialValuesByKey[`${eq.id}:${tr}`] = typeof v?.num === "number" ? String(v.num) : "";
      }

      return t;
    })
  );

  const buildSelector = async (eq: EquipmentItem | null, kind: "CHW_SELECT" | "SW_SELECT") => {
    if (!eq) return null;
    const fields = await getFieldIds(baseUrl, eq.id);
    const sel = fields["SELECTED_PUMP"] ?? null;
    const t: ChillerPlantTarget = {
      equipmentId: eq.id,
      equipmentName: eq.display_name,
      locationName: eq.location?.name ?? null,
      kind,
      fieldIds: { SELECTED_PUMP: sel },
    };
    if (sel) {
      const v = await getSavedReading(baseUrl, dailyLogId, eq.id, sel);
      initialValuesByKey[`${eq.id}:${sel}`] = typeof v?.text === "string" ? v.text : "1";
    }
    return t;
  };

  const chwPumps = await buildSelector(chwRaw, "CHW_SELECT");
  const swPumps = await buildSelector(swRaw, "SW_SELECT");

  return { chillers, chwPumps, swPumps, initialValuesByKey };
}

async function buildPowerTargets(
  baseUrl: string,
  dailyLogId: string,
  equipment: EquipmentItem[]
): Promise<PowerPanel> {
  const isDG = (e: EquipmentItem) => (e.equipment_type?.code ?? "") === "DIESEL_GENERATOR";
  const isShore = (e: EquipmentItem) => (e.equipment_type?.code ?? "") === "SHORE_POWER";

  const dgRaw = equipment.filter(isDG).sort((a, b) => a.display_name.localeCompare(b.display_name));
  const shoreRaw = equipment.filter(isShore).sort((a, b) => a.display_name.localeCompare(b.display_name));

  const initialValuesByKey: Record<string, string> = {};

  const buildOne = async (eq: EquipmentItem, kind: "DG" | "SHORE"): Promise<PowerTarget> => {
    const fields = await getFieldIds(baseUrl, eq.id);

    const vId = fields["BUS_VOLTAGE"] ?? null;
    const fId = fields["BUS_FREQUENCY"] ?? null;
    const lId = fields["LOAD_PCT"] ?? null;

    const t: PowerTarget = {
      kind,
      equipmentId: eq.id,
      equipmentName: eq.display_name,
      locationName: eq.location?.name ?? null,
      fieldIds: { BUS_VOLTAGE: vId, BUS_FREQUENCY: fId, LOAD_PCT: lId },
    };

    const preloadNum = async (fieldId: string) => {
      const v = await getSavedReading(baseUrl, dailyLogId, eq.id, fieldId);
      initialValuesByKey[`${eq.id}:${fieldId}`] = typeof v?.num === "number" ? String(v.num) : "";
    };

    if (vId) await preloadNum(vId);
    if (fId) await preloadNum(fId);
    if (lId) await preloadNum(lId);

    return t;
  };

  const dgTargets = await Promise.all(dgRaw.map((eq) => buildOne(eq, "DG")));
  const shoreTargets = await Promise.all(shoreRaw.map((eq) => buildOne(eq, "SHORE")));

  return { targets: [...dgTargets, ...shoreTargets], initialValuesByKey };
}

async function buildUtilitiesPanel(
  baseUrl: string,
  dailyLogId: string,
  equipment: EquipmentItem[]
): Promise<UtilitiesPanel> {
  const initialValuesByKey: Record<string, string> = {};

  const fwEq = equipment.find((e) => (e.equipment_type?.code ?? "") === "FRESH_WATER_PUMPS") ?? null;
  const circEq = equipment.find((e) => (e.equipment_type?.code ?? "") === "HOT_WATER_CIRC_PUMP") ?? null;
  const boilerEqs = equipment
    .filter((e) => (e.equipment_type?.code ?? "") === "BOILER")
    .sort((a, b) => a.display_name.localeCompare(b.display_name));

  const fwSystem = fwEq
    ? await (async () => {
        const fields = await getFieldIds(baseUrl, fwEq.id);
        const sel = fields["SELECTED_PUMP"] ?? null;
        const pr = fields["FW_PRESSURE"] ?? null;

        if (sel) {
          const v = await getSavedReading(baseUrl, dailyLogId, fwEq.id, sel);
          initialValuesByKey[`${fwEq.id}:${sel}`] = typeof v?.text === "string" ? v.text : "NONE";
        }
        if (pr) {
          const v = await getSavedReading(baseUrl, dailyLogId, fwEq.id, pr);
          initialValuesByKey[`${fwEq.id}:${pr}`] = typeof v?.num === "number" ? String(v.num) : "";
        }

        return {
          equipmentId: fwEq.id,
          equipmentName: fwEq.display_name,
          locationName: fwEq.location?.name ?? null,
          fieldIds: { SELECTED_PUMP: sel, FW_PRESSURE: pr },
        };
      })()
    : null;

  const circPump = circEq
    ? await (async () => {
        const fields = await getFieldIds(baseUrl, circEq.id);
        const run = fields["RUNNING"] ?? null;

        if (run) {
          const v = await getSavedReading(baseUrl, dailyLogId, circEq.id, run);
          initialValuesByKey[`${circEq.id}:${run}`] = typeof v?.bool === "boolean" ? (v.bool ? "true" : "false") : "false";
        }

        return {
          equipmentId: circEq.id,
          equipmentName: circEq.display_name,
          locationName: circEq.location?.name ?? null,
          fieldIds: { RUNNING: run },
        };
      })()
    : null;

  const boilers = await Promise.all(
    boilerEqs.map(async (eq) => {
      const fields = await getFieldIds(baseUrl, eq.id);
      const run = fields["RUNNING"] ?? null;
      const tmp = fields["BOILER_TEMP"] ?? null;

      if (run) {
        const v = await getSavedReading(baseUrl, dailyLogId, eq.id, run);
        initialValuesByKey[`${eq.id}:${run}`] = typeof v?.bool === "boolean" ? (v.bool ? "true" : "false") : "false";
      }
      if (tmp) {
        const v = await getSavedReading(baseUrl, dailyLogId, eq.id, tmp);
        initialValuesByKey[`${eq.id}:${tmp}`] = typeof v?.num === "number" ? String(v.num) : "";
      }

      return {
        equipmentId: eq.id,
        equipmentName: eq.display_name,
        locationName: eq.location?.name ?? null,
        fieldIds: { RUNNING: run, BOILER_TEMP: tmp },
      };
    })
  );

  return { fwSystem, circPump, boilers, initialValuesByKey };
}

// ---------- Page ----------
export default async function DailyLogPage() {
  const baseUrl = await getBaseUrl();

  const { log } = await getToday(baseUrl);
  const vesselId = log.vessel_id;

  const equipment = await getEquipmentList(baseUrl, vesselId);

  const [
    { targets: mainEngines, initialHoursByEquipmentId: meHours },
    { targets: dieselGens, initialHoursByEquipmentId: dgHours },
    chillerPlant,
    powerPanel,
    utilitiesPanel,
  ] = await Promise.all([
    buildRunHoursTargets(baseUrl, log.id, equipment, "MAIN_ENGINE"),
    buildRunHoursTargets(baseUrl, log.id, equipment, "DIESEL_GENERATOR"),
    buildChillerPlantTargets(baseUrl, log.id, equipment),
    buildPowerTargets(baseUrl, log.id, equipment),
    buildUtilitiesPanel(baseUrl, log.id, equipment),
  ]);

  const initialHoursByEquipmentId: Record<string, number | null> = { ...meHours, ...dgHours };

  return (
    <main className="p-6 space-y-4">
      <h1 className="text-2xl font-semibold">S06 — Daily Log</h1>
      <p className="text-sm text-gray-600">Vessel: {vesselId}</p>

      <DailyLogClient
        dailyLogId={log.id}
        status={log.status}
        locationText={log.location_text ?? ""}
        powerSource={log.power_source === "GENERATOR" ? "GENERATOR" : "SHORE"}
        notes={log.notes ?? ""}
        submittedAt={log.submitted_at ?? null}
        mainEngines={mainEngines}
        dieselGens={dieselGens}
        initialHoursByEquipmentId={initialHoursByEquipmentId}
        chillerPlant={chillerPlant}
        powerPanel={powerPanel}
        utilitiesPanel={utilitiesPanel}
      />
    </main>
  );
}