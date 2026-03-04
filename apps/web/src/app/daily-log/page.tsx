export const dynamic = "force-dynamic";

import DailyLogClient, { MeterTarget } from "./DailyLogClient";
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

async function getRunHoursFieldId(baseUrl: string, equipmentId: string): Promise<string> {
  const res = await fetch(`${baseUrl}/api/em/equipment/${equipmentId}/fields`, { cache: "no-store" });
  if (!res.ok) throw new Error(await res.text());
  const json = await res.json();

  const fields = (json.items ?? []) as Array<{ field_id: string; code: string }>;
  const run = fields.find((f) => f.code === "RUN_HOURS");
  if (!run) throw new Error(`RUN_HOURS field not found for equipment ${equipmentId}`);
  return run.field_id;
}

async function getSavedHours(
  baseUrl: string,
  dailyLogId: string,
  equipmentId: string,
  fieldId: string
): Promise<number | null> {
  const res = await fetch(
    `${baseUrl}/api/daily-logs/${dailyLogId}/meter-readings/one?equipmentId=${equipmentId}&fieldId=${fieldId}`,
    { cache: "no-store" }
  );

  if (!res.ok) return null;

  const json = await res.json();
  const v = json?.reading?.value?.num;
  return typeof v === "number" ? v : null;
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
    items.map(async (eq) => ({
      equipmentId: eq.id,
      equipmentName: eq.display_name,
      runHoursFieldId: await getRunHoursFieldId(baseUrl, eq.id),
      locationName: eq.location?.name ?? null,
    }))
  );

  const entries = await Promise.all(
    targets.map(async (t) => {
      const v = await getSavedHours(baseUrl, dailyLogId, t.equipmentId, t.runHoursFieldId);
      return [t.equipmentId, v] as const;
    })
  );

  return { targets, initialHoursByEquipmentId: Object.fromEntries(entries) as Record<string, number | null> };
}

export default async function DailyLogPage() {
  const baseUrl = await getBaseUrl();

  const { vessel, log } = await getToday(baseUrl);
  const equipment = await getEquipmentList(baseUrl, vessel.id);

  const [
    { targets: mainEngines, initialHoursByEquipmentId: meHours },
    { targets: dieselGens, initialHoursByEquipmentId: dgHours },
  ] = await Promise.all([
    buildRunHoursTargets(baseUrl, log.id, equipment, "MAIN_ENGINE"),
    buildRunHoursTargets(baseUrl, log.id, equipment, "DIESEL_GENERATOR"),
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
      />
    </main>
  );
}