export const dynamic = "force-dynamic";

import DailyLogClient from "./DailyLogClient";

async function getToday() {
  const res = await fetch("http://localhost:3000/api/daily-logs/today", { cache: "no-store" });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<{
    vessel: { id: string; name: string };
    log: { id: string; location_text?: string | null };
  }>;
}

async function getMainEngine(vesselId: string) {
  const res = await fetch(`http://localhost:3000/api/em/equipment?vesselId=${vesselId}`, { cache: "no-store" });
  if (!res.ok) throw new Error(await res.text());
  const json = await res.json();

  const items = (json.items ?? []) as Array<{
    id: string;
    display_name: string;
    equipment_type?: { code: string; name: string } | null;
  }>;

  const me = items.find((e) => (e.equipment_type?.code ?? "") === "MAIN_ENGINE");
  if (!me) throw new Error("No MAIN_ENGINE equipment found (seed missing?)");
  return me;
}

async function getRunHoursFieldId(equipmentId: string) {
  const res = await fetch(`http://localhost:3000/api/em/equipment/${equipmentId}/fields`, { cache: "no-store" });
  if (!res.ok) throw new Error(await res.text());
  const json = await res.json();

  // NOTE: your endpoint returns { equipment_id, items }
  const fields = (json.items ?? []) as Array<{ field_id: string; code: string }>;
  const run = fields.find((f) => f.code === "RUN_HOURS");
  if (!run) throw new Error("RUN_HOURS field not found for MAIN_ENGINE");
  return run.field_id;
}

export default async function DailyLogPage() {
  const { vessel, log } = await getToday();

  const me = await getMainEngine(vessel.id);
  const runHoursFieldId = await getRunHoursFieldId(me.id);

  return (
    <main className="p-6 space-y-4">
      <h1 className="text-2xl font-semibold">S06 — Daily Log</h1>
      <p className="text-sm text-gray-600">Vessel: {vessel.name}</p>

      <DailyLogClient
        dailyLogId={log.id}
        locationText={log.location_text ?? ""}
        mainEngine={{
          equipmentId: me.id,
          equipmentName: me.display_name,
          runHoursFieldId,
        }}
      />
    </main>
  );
}