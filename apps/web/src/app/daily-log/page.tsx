export const dynamic = "force-dynamic";

import DailyLogClient, { MeterTarget, ChillerPlantTarget } from "./DailyLogClient";
import { headers } from "next/headers";

async function getBaseUrl() {
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? "http";
  return `${proto}://${host}`;
}

async function getToday(baseUrl: string) {
  const res = await fetch(`${baseUrl}/api/daily-logs/today`, { cache: "no-store" });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<{
    vessel: { id: string; name: string };
    log: {
      id: string;
      status: string;
      location_text?: string | null;
      weather_text?: string | null;
      notes?: string | null;
      submitted_at?: string | null;
    };
  }>;
}

type EquipmentItem = {
  id: string;
  display_name: string;
  equipment_type?: { code: string; name: string } | null;
  location?: { id: string; name: string; parent_location_id?: string | null } | null;
};

async function getEquipmentList(baseUrl: string, vesselId: string): Promise<EquipmentItem[]> {
  const res = await fetch(`${baseUrl}/api/em/equipment?vesselId=${vesselId}`, { cache: "no-store" });
  if (!res.ok) throw new Error(await res.text());
  const json = await res.json();
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

async function buildRunHoursTargets(
  baseUrl: string,
  dailyLogId: string,
  equipment: EquipmentItem[],
  typeCode: "MAIN_ENGINE" | "DIESEL_GENERATOR"
): Promise<{ targets: MeterTarget[]; initialHoursByEquipmentId: Record<string, number | null> }> {
  const items = equipment
    .filter((e) => (e.equipment_type?.code ?? "") === typeCode)
    .sort((a, b) => a.display_name.localeCompare(b.display_name));

  if (items.length === 0) throw new Error(`No ${typeCode} equipment found (seed missing?)`);

  const targets: MeterTarget[] = await Promise.all(
    items.map(async (eq) => {
      const fields = await getFieldIds(baseUrl, eq.id);
      const runHoursFieldId = fields["RUN_HOURS"];
      if (!runHoursFieldId) throw new Error(`RUN_HOURS field not found for ${eq.display_name}`);
      return {
        equipmentId: eq.id,
        equipmentName: eq.display_name,
        runHoursFieldId,
        locationName: eq.location?.name ?? null,
      };
    })
  );

  const entries = await Promise.all(
    targets.map(async (t) => {
      const v = await getSavedReading(baseUrl, dailyLogId, t.equipmentId, t.runHoursFieldId);
      const num = typeof v?.num === "number" ? v.num : null;
      return [t.equipmentId, num] as const;
    })
  );

  return { targets, initialHoursByEquipmentId: Object.fromEntries(entries) as Record<string, number | null> };
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

      // preload readings
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

export default async function DailyLogPage() {
  const baseUrl = await getBaseUrl();

  const { vessel, log } = await getToday(baseUrl);
  const equipment = await getEquipmentList(baseUrl, vessel.id);

  const [
    { targets: mainEngines, initialHoursByEquipmentId: meHours },
    { targets: dieselGens, initialHoursByEquipmentId: dgHours },
    chillerPlant,
  ] = await Promise.all([
    buildRunHoursTargets(baseUrl, log.id, equipment, "MAIN_ENGINE"),
    buildRunHoursTargets(baseUrl, log.id, equipment, "DIESEL_GENERATOR"),
    buildChillerPlantTargets(baseUrl, log.id, equipment),
  ]);

  const initialHoursByEquipmentId: Record<string, number | null> = { ...meHours, ...dgHours };

  return (
    <main className="p-6 space-y-4">
      <h1 className="text-2xl font-semibold">S06 — Daily Log</h1>
      <p className="text-sm text-gray-600">Vessel: {vessel.name}</p>

      <DailyLogClient
        dailyLogId={log.id}
        status={log.status ?? "dock"}
        locationText={log.location_text ?? ""}
        weatherText={log.weather_text ?? ""}
        notes={log.notes ?? ""}
        submittedAt={log.submitted_at ?? null}
        mainEngines={mainEngines}
        dieselGens={dieselGens}
        initialHoursByEquipmentId={initialHoursByEquipmentId}
        chillerPlant={chillerPlant}
      />
    </main>
  );
}