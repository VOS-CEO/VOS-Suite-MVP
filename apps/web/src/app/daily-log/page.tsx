export const dynamic = "force-dynamic";

import DailyLogClient from "./DailyLogClient";
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
    log: { id: string; location_text?: string | null };
  }>;
}

type EquipmentItem = {
  id: string;
  display_name: string;
  equipment_type?: { code: string; name: string } | null;
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

  // Your endpoint returns: { equipment_id, items }
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

export default async function DailyLogPage() {
  const baseUrl = await getBaseUrl();

  const { vessel, log } = await getToday(baseUrl);
  const equipment = await getEquipmentList(baseUrl, vessel.id);

  const mainEngine = equipment.find((e) => (e.equipment_type?.code ?? "") === "MAIN_ENGINE");
  if (!mainEngine) throw new Error("No MAIN_ENGINE equipment found (seed missing?)");

  const dieselGen = equipment.find((e) => (e.equipment_type?.code ?? "") === "DIESEL_GENERATOR");
  if (!dieselGen) throw new Error("No DIESEL_GENERATOR equipment found (seed missing?)");

  const [meRunHoursFieldId, dgRunHoursFieldId] = await Promise.all([
    getRunHoursFieldId(baseUrl, mainEngine.id),
    getRunHoursFieldId(baseUrl, dieselGen.id),
  ]);

  const [initialMainEngineHours, initialDieselGenHours] = await Promise.all([
    getSavedHours(baseUrl, log.id, mainEngine.id, meRunHoursFieldId),
    getSavedHours(baseUrl, log.id, dieselGen.id, dgRunHoursFieldId),
  ]);

  return (
    <main className="p-6 space-y-4">
      <h1 className="text-2xl font-semibold">S06 — Daily Log</h1>
      <p className="text-sm text-gray-600">Vessel: {vessel.name}</p>

      <DailyLogClient
        dailyLogId={log.id}
        locationText={log.location_text ?? ""}
        mainEngine={{
          equipmentId: mainEngine.id,
          equipmentName: mainEngine.display_name,
          runHoursFieldId: meRunHoursFieldId,
        }}
        dieselGen={{
          equipmentId: dieselGen.id,
          equipmentName: dieselGen.display_name,
          runHoursFieldId: dgRunHoursFieldId,
        }}
        initialMainEngineHours={initialMainEngineHours}
        initialDieselGenHours={initialDieselGenHours}
      />
    </main>
  );
}