"use client";

import { useEffect, useMemo, useState } from "react";

type JsonObject = Record<string, unknown>;

function isObject(v: unknown): v is JsonObject {
  return typeof v === "object" && v !== null;
}

function getErrorMessage(json: unknown, fallback: string): string {
  if (isObject(json) && "error" in json) {
    const e = json.error;
    if (typeof e === "string") return e;
  }
  return fallback;
}

function getDefectNo(json: unknown): string {
  if (!isObject(json) || !("defect" in json)) return "";
  const defect = json.defect;
  if (!isObject(defect) || !("defect_no" in defect)) return "";
  const dn = defect.defect_no;
  return typeof dn === "string" ? dn : "";
}

async function safeReadJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { error: text };
  }
}

export type MeterTarget = {
  equipmentId: string;
  equipmentName: string;
  runHoursFieldId: string;
  locationName: string | null;
};

export type ChillerPlantTarget =
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

function isChiller(x: ChillerPlantTarget): x is Extract<ChillerPlantTarget, { kind: "CHILLER" }> {
  return x.kind === "CHILLER";
}
function isChwSelect(x: ChillerPlantTarget | null): x is Extract<ChillerPlantTarget, { kind: "CHW_SELECT" }> {
  return !!x && x.kind === "CHW_SELECT";
}
function isSwSelect(x: ChillerPlantTarget | null): x is Extract<ChillerPlantTarget, { kind: "SW_SELECT" }> {
  return !!x && x.kind === "SW_SELECT";
}

type PowerSource = "SHORE" | "GENERATOR";

type PowerPanel = {
  targets: Array<{
    kind: "DG" | "SHORE";
    equipmentId: string;
    equipmentName: string;
    locationName: string | null;
    fieldIds: { BUS_VOLTAGE: string | null; BUS_FREQUENCY: string | null; LOAD_PCT: string | null };
  }>;
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

type TabCode = "MAIN" | "AHUS" | "BILGES" | "TANKS" | "ORB" | "RUNNING_LOG";

const TABS: Array<{ code: TabCode; label: string }> = [
  { code: "MAIN", label: "Main" },
  { code: "AHUS", label: "AHUs" },
  { code: "BILGES", label: "Bilges" },
  { code: "TANKS", label: "Tanks" },
  { code: "ORB", label: "Oil Record Book" },
  { code: "RUNNING_LOG", label: "Running Log" },
];

function requiresRunningLog(status: string | null | undefined) {
  const s = String(status ?? "").toLowerCase();
  return s === "underway" || s === "anchor";
}
function requiresORB() {
  return false;
}

type TabStateRow = { tab_code: TabCode; viewed_at: string | null; ok_at: string | null };

function sideFromLocationName(name: string | null): "PORT" | "CENTER" | "STBD" {
  const n = String(name ?? "").toLowerCase();
  if (n.includes("er - port") || n.includes(" port")) return "PORT";
  if (n.includes("er - stbd") || n.includes("stbd") || n.includes("starboard")) return "STBD";
  if (n.includes("er - center") || n.includes("centre") || n.includes("center")) return "CENTER";
  if (n.includes("engine room")) return "CENTER";
  return "CENTER";
}

type MeterValue = { num?: number; bool?: boolean; text?: string };

export default function DailyLogClient({
  dailyLogId,
  status: initialStatus,
  locationText: initialLocationText,
  powerSource: initialPowerSource,
  notes: initialNotes,
  submittedAt,
  mainEngines,
  dieselGens,
  initialHoursByEquipmentId,
  chillerPlant,
  powerPanel,
  utilitiesPanel,
}: {
  dailyLogId: string;
  status?: string | null;
  locationText: string;
  powerSource: PowerSource;
  notes: string;
  submittedAt: string | null;
  mainEngines: MeterTarget[];
  dieselGens: MeterTarget[];
  initialHoursByEquipmentId: Record<string, number | null>;
  chillerPlant: {
    chillers: ChillerPlantTarget[];
    chwPumps: ChillerPlantTarget | null;
    swPumps: ChillerPlantTarget | null;
    initialValuesByKey: Record<string, string>;
  };
  powerPanel: PowerPanel;
  utilitiesPanel: UtilitiesPanel;
}) {
  const allTargets = useMemo(() => [...mainEngines, ...dieselGens], [mainEngines, dieselGens]);
  const [activeTab, setActiveTab] = useState<TabCode>("MAIN");

  // Operational Context
  const [status, setStatus] = useState<string>(String(initialStatus ?? "dock"));
  const [locationText, setLocationText] = useState<string>(initialLocationText ?? "");
  const [powerSource, setPowerSource] = useState<PowerSource>(initialPowerSource === "GENERATOR" ? "GENERATOR" : "SHORE");

  // Notes at bottom
  const [notes, setNotes] = useState<string>(initialNotes ?? "");

  const headerLocked = !!submittedAt;

  // Header feedback (Operational Context + Notes)
  const [headerOk, setHeaderOk] = useState<string | null>(null);
  const [headerErr, setHeaderErr] = useState<string | null>(null);

  // Engine Room feedback
  const [engineOk, setEngineOk] = useState<string | null>(null);
  const [engineErr, setEngineErr] = useState<string | null>(null);

  // Tabs state
  const [tabState, setTabState] = useState<Record<TabCode, { viewed: boolean; ok: boolean }>>({
    MAIN: { viewed: true, ok: true },
    AHUS: { viewed: false, ok: false },
    BILGES: { viewed: false, ok: false },
    TANKS: { viewed: false, ok: false },
    ORB: { viewed: false, ok: false },
    RUNNING_LOG: { viewed: false, ok: false },
  });
  const [tabStateLoading, setTabStateLoading] = useState(false);
  const [tabStateError, setTabStateError] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);

  // ME/DG hours values (no per-card save)
  const [hoursById, setHoursById] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const t of allTargets) {
      const v = initialHoursByEquipmentId[t.equipmentId];
      init[t.equipmentId] = typeof v === "number" ? String(v) : "";
    }
    return init;
  });

  // Chiller plant values
  const [cpValues, setCpValues] = useState<Record<string, string>>(() => ({ ...chillerPlant.initialValuesByKey }));

  // Power values
  const [powerValues, setPowerValues] = useState<Record<string, string>>(() => ({ ...powerPanel.initialValuesByKey }));

  // Utilities values
  const [utilValues, setUtilValues] = useState<Record<string, string>>(() => ({ ...utilitiesPanel.initialValuesByKey }));

  // Power “running” checkboxes (per instance)
  const [activePowerEquipIds, setActivePowerEquipIds] = useState<string[]>([]);

  // Defects
  const [defectTitle, setDefectTitle] = useState("");
  const [defectOk, setDefectOk] = useState<string | null>(null);
  const [defectErr, setDefectErr] = useState<string | null>(null);

  // Submit
  const [submitOk, setSubmitOk] = useState<string | null>(null);
  const [submitErr, setSubmitErr] = useState<string | null>(null);

  const runningLogRequired = requiresRunningLog(status);
  const orbRequired = requiresORB();

  const submitBlocked = useMemo(() => {
    const missing: TabCode[] = [];
    if (!tabState.AHUS.ok) missing.push("AHUS");
    if (!tabState.BILGES.ok) missing.push("BILGES");
    if (!tabState.TANKS.ok) missing.push("TANKS");
    if (orbRequired && !tabState.ORB.ok) missing.push("ORB");
    if (runningLogRequired && !tabState.RUNNING_LOG.ok) missing.push("RUNNING_LOG");
    return missing;
  }, [tabState, orbRequired, runningLogRequired]);

  function tabIndicator(code: TabCode): { text: string; kind: "ok" | "warn" | "na" } {
    if (code === "MAIN") return { text: "✅", kind: "ok" };
    if (code === "ORB" && !orbRequired) return { text: "🟦", kind: "na" };
    if (code === "RUNNING_LOG" && !runningLogRequired) return { text: "🟦", kind: "na" };
    return tabState[code].ok ? { text: "✅", kind: "ok" } : { text: "⚠️", kind: "warn" };
  }

  async function refreshTabState() {
    setTabStateLoading(true);
    setTabStateError(null);
    try {
      const res = await fetch(`/api/daily-logs/${dailyLogId}/tab-state`, { cache: "no-store" });
      const json: unknown = await safeReadJson(res);
      if (!res.ok) throw new Error(getErrorMessage(json, "Failed to load tab state"));

      const rows = (isObject(json) && Array.isArray(json.items) ? (json.items as TabStateRow[]) : []) ?? [];
      const next: Record<TabCode, { viewed: boolean; ok: boolean }> = {
        MAIN: { viewed: true, ok: true },
        AHUS: { viewed: false, ok: false },
        BILGES: { viewed: false, ok: false },
        TANKS: { viewed: false, ok: false },
        ORB: { viewed: false, ok: false },
        RUNNING_LOG: { viewed: false, ok: false },
      };

      for (const r of rows) {
        const code = String(r.tab_code).toUpperCase() as TabCode;
        if (!(code in next)) continue;
        next[code] = { viewed: !!r.viewed_at, ok: !!r.ok_at };
      }
      setTabState(next);
    } catch (e: unknown) {
      setTabStateError(e instanceof Error ? e.message : "Failed to load tab state");
    } finally {
      setTabStateLoading(false);
    }
  }

  async function markTab(tab_code: TabCode, action: "VIEW" | "OK") {
    if (tab_code === "MAIN") return;

    setTabStateError(null);
    setTabStateLoading(true);

    try {
      const res = await fetch(`/api/daily-logs/${dailyLogId}/tab-state/mark`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({ tab_code, action }),
      });

      const json: unknown = await safeReadJson(res);
      if (!res.ok) throw new Error(getErrorMessage(json, "Failed to update tab state"));

      setTabState((s) => {
        const prev = s[tab_code] ?? { viewed: false, ok: false };
        if (action === "VIEW") return { ...s, [tab_code]: { ...prev, viewed: true } };
        return { ...s, [tab_code]: { viewed: true, ok: true } };
      });

      await refreshTabState();
    } catch (e: unknown) {
      setTabStateError(e instanceof Error ? e.message : "Failed to update tab state");
      await refreshTabState();
    } finally {
      setTabStateLoading(false);
    }
  }

  useEffect(() => {
    refreshTabState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dailyLogId]);

  useEffect(() => {
    if (activeTab === "MAIN") return;
    void markTab(activeTab, "VIEW");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  async function saveHeader() {
    setHeaderErr(null);
    setHeaderOk(null);
    setEngineErr(null);
    setEngineOk(null);

    if (headerLocked) {
      setHeaderErr("Daily Log is already submitted; header is locked.");
      return;
    }

    const s = String(status || "dock").toLowerCase().trim();
    const allowed = new Set(["dock", "underway", "anchor", "shipyard"]);
    if (!allowed.has(s)) {
      setHeaderErr("Invalid status. Use dock, underway, anchor, or shipyard.");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/daily-logs/${dailyLogId}/header`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          status: s,
          location_text: locationText || null,
          notes: notes || null,
          power_source: powerSource,
        }),
      });

      const json: unknown = await safeReadJson(res);
      if (!res.ok) throw new Error(getErrorMessage(json, "Failed to save operational context"));

      if (isObject(json) && "log" in json && isObject(json.log)) {
        const log = json.log as Record<string, unknown>;
        if (typeof log.status === "string") setStatus(log.status);
        if (typeof log.location_text === "string" || log.location_text === null) {
          setLocationText((log.location_text as string | null) ?? "");
        }
        if (typeof log.notes === "string" || log.notes === null) {
          setNotes((log.notes as string | null) ?? "");
        }
        if (typeof log.power_source === "string") {
          const ps = log.power_source.toUpperCase();
          setPowerSource(ps === "GENERATOR" ? "GENERATOR" : "SHORE");
        }
      }

      setHeaderOk("Saved");
    } catch (e: unknown) {
      setHeaderErr(e instanceof Error ? e.message : "Failed to save operational context");
    } finally {
      setSaving(false);
    }
  }

  async function postMeterReading(equipmentId: string, fieldId: string, value: MeterValue, unit?: string | null) {
    const res = await fetch(`/api/daily-logs/${dailyLogId}/meter-readings/one`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ equipmentId, fieldId, value, unit: unit ?? null }),
    });
    const json: unknown = await safeReadJson(res);
    if (!res.ok) throw new Error(getErrorMessage(json, "Failed to save reading"));
  }

  async function postHours(equipmentId: string, fieldId: string, hours: number) {
    const res = await fetch(`/api/daily-logs/${dailyLogId}/meter-readings/one`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({ equipmentId, fieldId, hours }), // legacy support
    });
    const json: unknown = await safeReadJson(res);
    if (!res.ok) throw new Error(getErrorMessage(json, "Failed to save hours"));
  }

  async function saveEngineRoom() {
    setEngineErr(null);
    setEngineOk(null);
    setHeaderErr(null);
    setHeaderOk(null);

    if (headerLocked) {
      setEngineErr("Daily Log is already submitted; Engine Room is locked.");
      return;
    }

    setSaving(true);
    try {
      // 1) ME + DG hours (all non-empty)
      for (const t of allTargets) {
        const raw = (hoursById[t.equipmentId] ?? "").trim();
        if (!raw) continue;
        const n = Number(raw);
        if (Number.isNaN(n)) continue;
        await postHours(t.equipmentId, t.runHoursFieldId, n);
      }

      // 2) Power panel (only ticked sources, and only current source kind)
      const visibleKind = powerSource === "GENERATOR" ? "DG" : "SHORE";
      const visible = (powerPanel.targets ?? []).filter((t) => t.kind === visibleKind);
      const runningSet = new Set(activePowerEquipIds);

      for (const t of visible) {
        if (!runningSet.has(t.equipmentId)) continue;

        const saveNumIf = async (fid: string, unit: string | null) => {
          const key = `${t.equipmentId}:${fid}`;
          const raw = (powerValues[key] ?? "").trim();
          if (!raw) return;
          const n = Number(raw);
          if (Number.isNaN(n)) return;
          await postMeterReading(t.equipmentId, fid, { num: n }, unit);
        };

        if (t.fieldIds.BUS_VOLTAGE) await saveNumIf(t.fieldIds.BUS_VOLTAGE, "V");
        if (t.fieldIds.BUS_FREQUENCY) await saveNumIf(t.fieldIds.BUS_FREQUENCY, "Hz");
        if (t.fieldIds.LOAD_PCT) await saveNumIf(t.fieldIds.LOAD_PCT, "pct");
      }

      // 3) Chiller selectors
      const chw = chillerPlant.chwPumps;
      const sw = chillerPlant.swPumps;

      if (chw && chw.kind === "CHW_SELECT" && chw.fieldIds.SELECTED_PUMP) {
        const fid = chw.fieldIds.SELECTED_PUMP;
        const key = `${chw.equipmentId}:${fid}`;
        const v = String(cpValues[key] ?? "1");
        await postMeterReading(chw.equipmentId, fid, { text: v }, null);
      }
      if (sw && sw.kind === "SW_SELECT" && sw.fieldIds.SELECTED_PUMP) {
        const fid = sw.fieldIds.SELECTED_PUMP;
        const key = `${sw.equipmentId}:${fid}`;
        const v = String(cpValues[key] ?? "1");
        await postMeterReading(sw.equipmentId, fid, { text: v }, null);
      }

      // 4) Chillers (running + temps)
      for (const c of (chillerPlant.chillers ?? []).filter(isChiller)) {
        const runId = c.fieldIds.RUNNING;
        const tsId = c.fieldIds.TEMP_SUPPLY;
        const trId = c.fieldIds.TEMP_RETURN;

        if (runId) {
          const k = `${c.equipmentId}:${runId}`;
          const b = (cpValues[k] ?? "false") === "true";
          await postMeterReading(c.equipmentId, runId, { bool: b }, null);
        }

        const saveTempIf = async (fid: string) => {
          const k = `${c.equipmentId}:${fid}`;
          const raw = (cpValues[k] ?? "").trim();
          if (!raw) return;
          const n = Number(raw);
          if (Number.isNaN(n)) return;
          await postMeterReading(c.equipmentId, fid, { num: n }, "C");
        };

        if (tsId) await saveTempIf(tsId);
        if (trId) await saveTempIf(trId);
      }

      // 5) Fresh water system (SELECTED_PUMP + FW_PRESSURE)
      const fw = utilitiesPanel.fwSystem;
      if (fw) {
        const selId = fw.fieldIds.SELECTED_PUMP;
        const prId = fw.fieldIds.FW_PRESSURE;

        if (selId) {
          const k = `${fw.equipmentId}:${selId}`;
          const v = String(utilValues[k] ?? "NONE");
          await postMeterReading(fw.equipmentId, selId, { text: v }, null);
        }
        if (prId) {
          const k = `${fw.equipmentId}:${prId}`;
          const raw = String(utilValues[k] ?? "").trim();
          if (raw) {
            const n = Number(raw);
            if (!Number.isNaN(n)) await postMeterReading(fw.equipmentId, prId, { num: n }, "bar");
          }
        }
      }

      // 6) Circ pump RUNNING
      const circ = utilitiesPanel.circPump;
      if (circ && circ.fieldIds.RUNNING) {
        const fid = circ.fieldIds.RUNNING;
        const k = `${circ.equipmentId}:${fid}`;
        const b = (utilValues[k] ?? "false") === "true";
        await postMeterReading(circ.equipmentId, fid, { bool: b }, null);
      }

      // 7) Boilers (RUNNING always; TEMP only if running)
      for (const b of utilitiesPanel.boilers ?? []) {
        const runId = b.fieldIds.RUNNING;
        const tmpId = b.fieldIds.BOILER_TEMP;

        let running = false;
        if (runId) {
          const k = `${b.equipmentId}:${runId}`;
          running = (utilValues[k] ?? "false") === "true";
          await postMeterReading(b.equipmentId, runId, { bool: running }, null);
        }

        if (running && tmpId) {
          const k = `${b.equipmentId}:${tmpId}`;
          const raw = String(utilValues[k] ?? "").trim();
          if (raw) {
            const n = Number(raw);
            if (!Number.isNaN(n)) await postMeterReading(b.equipmentId, tmpId, { num: n }, "C");
          }
        }
      }

      setEngineOk("Engine Room saved");
    } catch (e: unknown) {
      setEngineErr(e instanceof Error ? e.message : "Engine Room save failed");
    } finally {
      setSaving(false);
    }
  }

  function RunHoursList({ items }: { items: MeterTarget[] }) {
    if (!items.length) return <p className="text-sm text-gray-500">None</p>;
    return (
      <div className="space-y-3">
        {items.map((t) => (
          <div key={t.equipmentId} className="rounded border p-3">
            <p className="text-sm text-gray-700">{t.equipmentName} — RUN_HOURS</p>
            <p className="text-xs text-gray-500">Location: {t.locationName ?? "Unknown"}</p>
            <input
              className="mt-2 w-full rounded border p-2"
              value={hoursById[t.equipmentId] ?? ""}
              disabled={saving || headerLocked}
              onChange={(e) => setHoursById((m) => ({ ...m, [t.equipmentId]: e.target.value }))}
              inputMode="decimal"
              placeholder="Hours"
            />
          </div>
        ))}
      </div>
    );
  }

  function PowerCard() {
    const visibleKind = powerSource === "GENERATOR" ? "DG" : "SHORE";
    const visible = (powerPanel.targets ?? []).filter((t) => t.kind === visibleKind);

    if (!visible.length) {
      return (
        <div className="rounded border p-3 space-y-2">
          <h4 className="text-sm font-semibold">Power</h4>
          <p className="text-sm text-gray-600">
            No {visibleKind === "DG" ? "diesel generators" : "shore power"} configured.
          </p>
        </div>
      );
    }

    const isRunning = (id: string) => activePowerEquipIds.includes(id);
    const toggleRunning = (id: string) =>
      setActivePowerEquipIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

    const renderInput = (t: (typeof visible)[number], label: string, fieldId: string | null, unitHint?: string) => {
      if (!fieldId) return <p className="text-sm text-gray-600">{label}: not configured</p>;
      const key = `${t.equipmentId}:${fieldId}`;
      const val = powerValues[key] ?? "";
      const enabled = isRunning(t.equipmentId);

      return (
        <label className="text-sm block">
          {label}
          {unitHint ? ` (${unitHint})` : ""}
          <input
            className="mt-1 w-full rounded border p-2 disabled:bg-gray-50"
            value={val}
            disabled={saving || headerLocked || !enabled}
            onChange={(e) => setPowerValues((m) => ({ ...m, [key]: e.target.value }))}
            inputMode="decimal"
          />
        </label>
      );
    };

    return (
      <div className="rounded border p-3 space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold">Power</h4>
          <p className="text-xs text-gray-600">
            Source: <b>{powerSource === "GENERATOR" ? "Generators" : "Shore"}</b> • tick which are running
          </p>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          {visible.map((t) => {
            const running = isRunning(t.equipmentId);

            return (
              <div key={t.equipmentId} className="rounded border p-3 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold">{t.equipmentName}</div>
                    <p className="text-xs text-gray-500">Location: {t.locationName ?? "Unknown"}</p>
                  </div>

                  <label className="flex items-center gap-2 text-sm select-none">
                    <input
                      type="checkbox"
                      checked={running}
                      onChange={() => toggleRunning(t.equipmentId)}
                      disabled={saving || headerLocked}
                      aria-label="Running"
                      title="Running"
                      className="h-4 w-4"
                    />
                  </label>
                </div>

                {renderInput(t, "Bus Voltage", t.fieldIds.BUS_VOLTAGE, "V")}
                {renderInput(t, "Bus Frequency", t.fieldIds.BUS_FREQUENCY, "Hz")}
                {renderInput(t, "Load %", t.fieldIds.LOAD_PCT, "%")}

                {!running ? <p className="text-xs text-gray-500">Tick the box to enable entry.</p> : null}
              </div>
            );
          })}
        </div>

        <p className="text-xs text-gray-500">Saved via “Save Engine Room”.</p>
      </div>
    );
  }

  function FreshWaterSystemCard() {
    const fw = utilitiesPanel.fwSystem;
    if (!fw) return null;

    const selId = fw.fieldIds.SELECTED_PUMP;
    const prId = fw.fieldIds.FW_PRESSURE;

    const selKey = selId ? `${fw.equipmentId}:${selId}` : null;
    const prKey = prId ? `${fw.equipmentId}:${prId}` : null;

    const selVal = selKey ? utilValues[selKey] ?? "NONE" : "NONE";
    const pump1 = selVal === "1" || selVal === "BOTH";
    const pump2 = selVal === "2" || selVal === "BOTH";

    const setPumps = (p1: boolean, p2: boolean) => {
      let next = "NONE";
      if (p1 && p2) next = "BOTH";
      else if (p1) next = "1";
      else if (p2) next = "2";
      if (selKey) setUtilValues((m) => ({ ...m, [selKey]: next }));
    };

    const pressureVal = prKey ? utilValues[prKey] ?? "" : "";

    return (
      <div className="rounded border p-3 space-y-3">
        <div className="text-sm font-semibold">{fw.equipmentName}</div>
        <p className="text-xs text-gray-500">Location: {fw.locationName ?? "Unknown"}</p>

        <div className="rounded border p-3 space-y-2">
          <div className="text-sm font-semibold">Pumps running</div>
          <div className="flex gap-6 items-center">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                disabled={saving || headerLocked || !selKey}
                checked={pump1}
                onChange={(e) => setPumps(e.target.checked, pump2)}
              />
              Pump 1
            </label>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                disabled={saving || headerLocked || !selKey}
                checked={pump2}
                onChange={(e) => setPumps(pump1, e.target.checked)}
              />
              Pump 2
            </label>
          </div>
          {!selKey ? <p className="text-xs text-gray-500">SELECTED_PUMP not configured.</p> : null}
        </div>

        <label className="text-sm block">
          System Pressure (bar)
          <input
            className="mt-1 w-full rounded border p-2"
            value={pressureVal}
            disabled={saving || headerLocked || !prKey}
            onChange={(e) => prKey && setUtilValues((m) => ({ ...m, [prKey]: e.target.value }))}
            inputMode="decimal"
            placeholder="e.g., 3.2"
          />
        </label>
        {!prKey ? <p className="text-xs text-gray-500">FW_PRESSURE not configured.</p> : null}

        <div className="rounded border p-3 text-sm">
          <div className="flex items-center justify-between">
            <span className="font-semibold">Fresh Water Level</span>
            <span className="text-gray-600">— %</span>
          </div>
          <p className="text-xs text-gray-500 mt-1">Will link from Tanks tab once built.</p>
        </div>

        <p className="text-xs text-gray-500">Saved via “Save Engine Room”.</p>
      </div>
    );
  }

  function CircPumpCard() {
    const c = utilitiesPanel.circPump;
    if (!c) return null;

    const runId = c.fieldIds.RUNNING;
    const runKey = runId ? `${c.equipmentId}:${runId}` : null;
    const checked = runKey ? (utilValues[runKey] ?? "false") === "true" : false;

    return (
      <div className="rounded border p-3 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-semibold">{c.equipmentName}</div>
            <p className="text-xs text-gray-500">Location: {c.locationName ?? "Unknown"}</p>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              disabled={saving || headerLocked || !runKey}
              checked={checked}
              onChange={(e) => runKey && setUtilValues((m) => ({ ...m, [runKey]: e.target.checked ? "true" : "false" }))}
              aria-label="On/Off"
              title="On/Off"
            />
          </label>
        </div>

        {!runKey ? <p className="text-xs text-gray-500">RUNNING not configured.</p> : null}
        <p className="text-xs text-gray-500">Saved via “Save Engine Room”.</p>
      </div>
    );
  }

  function BoilersBlock() {
    const boilers = utilitiesPanel.boilers ?? [];
    if (!boilers.length) return null;

    return (
      <div className="rounded border p-3 space-y-3">
        <div className="text-sm font-semibold">Boilers</div>

        <div className="space-y-3">
          {boilers.map((b) => {
            const runId = b.fieldIds.RUNNING;
            const tmpId = b.fieldIds.BOILER_TEMP;

            const runKey = runId ? `${b.equipmentId}:${runId}` : null;
            const tmpKey = tmpId ? `${b.equipmentId}:${tmpId}` : null;

            const running = runKey ? (utilValues[runKey] ?? "false") === "true" : false;
            const tempVal = tmpKey ? utilValues[tmpKey] ?? "" : "";

            return (
              <div key={b.equipmentId} className="rounded border p-3 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold">{b.equipmentName}</div>
                    <p className="text-xs text-gray-500">Location: {b.locationName ?? "Unknown"}</p>
                  </div>

                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      disabled={saving || headerLocked || !runKey}
                      checked={running}
                      onChange={(e) => runKey && setUtilValues((m) => ({ ...m, [runKey]: e.target.checked ? "true" : "false" }))}
                      aria-label="On/Off"
                      title="On/Off"
                    />
                  </label>
                </div>

                <label className="text-sm block">
                  Boiler Temp (°C)
                  <input
                    className="mt-1 w-full rounded border p-2 disabled:bg-gray-50"
                    value={tempVal}
                    disabled={saving || headerLocked || !tmpKey || !running}
                    onChange={(e) => tmpKey && setUtilValues((m) => ({ ...m, [tmpKey]: e.target.value }))}
                    inputMode="decimal"
                    placeholder="e.g., 60"
                  />
                </label>

                {!tmpKey ? <p className="text-xs text-gray-500">BOILER_TEMP not configured.</p> : null}
                <p className="text-xs text-gray-500">Saved via “Save Engine Room”.</p>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  function ChillerPlantCard() {
    const chillers = (chillerPlant.chillers ?? []).filter(isChiller);
    const chw = isChwSelect(chillerPlant.chwPumps) ? chillerPlant.chwPumps : null;
    const sw = isSwSelect(chillerPlant.swPumps) ? chillerPlant.swPumps : null;

    const renderSelector = (sel: Extract<ChillerPlantTarget, { kind: "CHW_SELECT" | "SW_SELECT" }>) => {
      const fieldId = sel.fieldIds.SELECTED_PUMP;
      if (!fieldId) {
        return <div className="rounded border p-3 text-sm text-gray-600">{sel.equipmentName}: SELECTED_PUMP not configured</div>;
      }
      const key = `${sel.equipmentId}:${fieldId}`;
      const value = cpValues[key] ?? "1";

      return (
        <div className="rounded border p-3 space-y-2">
          <div className="text-sm font-semibold">{sel.equipmentName}</div>
          <select
            className="w-full rounded border p-2"
            disabled={saving || headerLocked}
            value={value}
            onChange={(e) => setCpValues((m) => ({ ...m, [key]: e.target.value }))}
          >
            <option value="1">1</option>
            <option value="2">2</option>
          </select>
        </div>
      );
    };

    return (
      <div className="rounded border p-3 space-y-4">
        <h4 className="text-sm font-semibold">Chiller Plant (Center-Top)</h4>

        <div className="grid gap-3 md:grid-cols-2">
          {chw ? renderSelector(chw) : <div className="rounded border p-3 text-sm text-gray-600">CHW selector not found.</div>}
          {sw ? renderSelector(sw) : <div className="rounded border p-3 text-sm text-gray-600">SW selector not found.</div>}
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          {chillers.map((c) => {
            const runningId = c.fieldIds.RUNNING;
            const tsId = c.fieldIds.TEMP_SUPPLY;
            const trId = c.fieldIds.TEMP_RETURN;

            const keyRun = runningId ? `${c.equipmentId}:${runningId}` : null;
            const keyTs = tsId ? `${c.equipmentId}:${tsId}` : null;
            const keyTr = trId ? `${c.equipmentId}:${trId}` : null;

            const runningVal = keyRun ? cpValues[keyRun] ?? "false" : "false";

            return (
              <div key={c.equipmentId} className="rounded border p-3 space-y-2">
                <div className="text-sm font-semibold">{c.equipmentName}</div>

                {runningId && keyRun ? (
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      disabled={saving || headerLocked}
                      checked={runningVal === "true"}
                      onChange={(e) => setCpValues((m) => ({ ...m, [keyRun]: e.target.checked ? "true" : "false" }))}
                    />
                    On
                  </label>
                ) : (
                  <p className="text-sm text-gray-600">RUNNING not configured.</p>
                )}

                <div className="grid gap-2 md:grid-cols-2">
                  <label className="text-sm block">
                    Supply °C
                    <input
                      className="mt-1 w-full rounded border p-2"
                      disabled={saving || headerLocked}
                      value={keyTs ? cpValues[keyTs] ?? "" : ""}
                      onChange={(e) => keyTs && setCpValues((m) => ({ ...m, [keyTs]: e.target.value }))}
                      inputMode="decimal"
                      placeholder="e.g., 7.0"
                    />
                  </label>

                  <label className="text-sm block">
                    Return °C
                    <input
                      className="mt-1 w-full rounded border p-2"
                      disabled={saving || headerLocked}
                      value={keyTr ? cpValues[keyTr] ?? "" : ""}
                      onChange={(e) => keyTr && setCpValues((m) => ({ ...m, [keyTr]: e.target.value }))}
                      inputMode="decimal"
                      placeholder="e.g., 12.0"
                    />
                  </label>
                </div>
              </div>
            );
          })}
        </div>

        <p className="text-xs text-gray-500">Saved via “Save Engine Room”.</p>
      </div>
    );
  }

  async function createDefect() {
    setDefectErr(null);
    setDefectOk(null);

    const t = defectTitle.trim();
    if (!t) {
      setDefectErr("Please enter a defect title.");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/defects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          dailyLogId,
          title: t,
          location_text: locationText || null,
        }),
      });

      const json: unknown = await safeReadJson(res);
      if (!res.ok) throw new Error(getErrorMessage(json, "Failed to create defect"));

      const defectNo = getDefectNo(json);
      setDefectOk(defectNo || "Created");
      setDefectTitle("");
    } catch (e: unknown) {
      setDefectErr(e instanceof Error ? e.message : "Failed to create defect");
    } finally {
      setSaving(false);
    }
  }

  async function submitDailyLog() {
    setSubmitErr(null);
    setSubmitOk(null);

    if (headerLocked) {
      setSubmitErr("Already submitted.");
      return;
    }

    if (submitBlocked.length) {
      setSubmitErr(`Cannot submit. Missing OK: ${submitBlocked.join(", ")}`);
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/daily-logs/${dailyLogId}/submit`, { method: "POST", cache: "no-store" });
      const json: unknown = await safeReadJson(res);
      if (!res.ok) throw new Error(getErrorMessage(json, "Failed to submit daily log"));
      setSubmitOk("Submitted");
    } catch (e: unknown) {
      setSubmitErr(e instanceof Error ? e.message : "Failed to submit daily log");
    } finally {
      setSaving(false);
    }
  }

  function TabButton({ code, label }: { code: TabCode; label: string }) {
    const ind = tabIndicator(code);
    const isActive = activeTab === code;

    const base =
      "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm " +
      (isActive ? "bg-black text-white" : "bg-white");

    const badge = ind.kind === "ok" ? "text-green-700" : ind.kind === "warn" ? "text-amber-700" : "text-blue-700";

    return (
      <button className={base} onClick={() => setActiveTab(code)} type="button">
        <span>{label}</span>
        <span className={badge}>{ind.text}</span>
      </button>
    );
  }

  function TabShell({ code, title, children }: { code: TabCode; title: string; children: React.ReactNode }) {
    const ind = tabIndicator(code);

    return (
      <section className="rounded border p-4 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-lg font-semibold">{title}</h2>
            <p className="text-sm text-gray-600">
              Status: <b>{status}</b> • Requirement: {ind.kind === "na" ? "Not required today" : tabState[code]?.ok ? "OK complete" : "Needs OK"}
            </p>
          </div>

          {code !== "MAIN" && ind.kind !== "na" ? (
            <button
              className="rounded bg-black px-4 py-2 text-white disabled:opacity-50"
              disabled={saving || headerLocked}
              onClick={() => markTab(code, "OK")}
              type="button"
            >
              Mark OK
            </button>
          ) : null}
        </div>

        {children}
      </section>
    );
  }

  const mePort = mainEngines.filter((t) => sideFromLocationName(t.locationName) === "PORT");
  const meCenter = mainEngines.filter((t) => sideFromLocationName(t.locationName) === "CENTER");
  const meStbd = mainEngines.filter((t) => sideFromLocationName(t.locationName) === "STBD");

  const dgPort = dieselGens.filter((t) => sideFromLocationName(t.locationName) === "PORT");
  const dgCenter = dieselGens.filter((t) => sideFromLocationName(t.locationName) === "CENTER");
  const dgStbd = dieselGens.filter((t) => sideFromLocationName(t.locationName) === "STBD");

  const canSubmit = !saving && !headerLocked && submitBlocked.length === 0;

  return (
    <div className="space-y-6">
      {/* Tabs row + Submit button */}
      <div className="flex flex-wrap gap-2 items-center">
        {TABS.map((t) => (
          <TabButton key={t.code} code={t.code} label={t.label} />
        ))}

        <div className="ml-auto flex items-center gap-2">
          {tabStateLoading ? <span className="text-sm text-gray-600">Loading tab state…</span> : null}
          {tabStateError ? <span className="text-sm text-red-600">{tabStateError}</span> : null}

          <button
            className="rounded bg-black px-4 py-2 text-white disabled:opacity-50"
            disabled={!canSubmit}
            onClick={submitDailyLog}
            type="button"
            title={submitBlocked.length ? `Missing OK: ${submitBlocked.join(", ")}` : ""}
          >
            Submit Daily Log
          </button>
        </div>
      </div>

      {/* Gating banner */}
      {activeTab === "MAIN" ? (
        <div>
          {headerLocked ? (
            <p className="text-sm rounded bg-blue-50 border border-blue-200 p-2">This Daily Log is submitted and locked.</p>
          ) : submitBlocked.length ? (
            <p className="text-sm rounded bg-amber-50 border border-amber-200 p-2">
              Missing OK: <b>{submitBlocked.join(", ")}</b>
            </p>
          ) : (
            <p className="text-sm text-gray-600">All required tabs OK’d — ready to submit.</p>
          )}

          {submitOk ? <p className="mt-2 text-sm rounded bg-green-50 border border-green-200 p-2">{submitOk}</p> : null}
          {submitErr ? <p className="mt-2 text-sm rounded bg-red-50 border border-red-200 p-2">{submitErr}</p> : null}
        </div>
      ) : null}

      {/* Operational Context */}
      {activeTab === "MAIN" ? (
        <section className="rounded border p-4 space-y-3">
          <h2 className="text-lg font-semibold">Daily Log — Operational Context</h2>

          <div className="grid gap-3 md:grid-cols-6">
            <label className="text-sm block md:col-span-2">
              Status
              <select
                className="mt-1 w-full rounded border p-2"
                value={status}
                disabled={saving || headerLocked}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="dock">dock</option>
                <option value="underway">underway</option>
                <option value="anchor">anchor</option>
                <option value="shipyard">shipyard</option>
              </select>
            </label>

            <label className="text-sm block md:col-span-3">
              Location
              <input
                className="mt-1 w-full rounded border p-2"
                value={locationText}
                disabled={saving || headerLocked}
                onChange={(e) => setLocationText(e.target.value)}
              />
            </label>

            <label className="text-sm block md:col-span-1">
              Power
              <select
                className="mt-1 w-full rounded border p-2"
                value={powerSource}
                disabled={saving || headerLocked}
                onChange={(e) => setPowerSource(e.target.value as PowerSource)}
              >
                <option value="SHORE">Shore</option>
                <option value="GENERATOR">Generator</option>
              </select>
            </label>

            <div className="md:col-span-6 flex items-end">
              <button
                className="w-full rounded bg-black px-4 py-2 text-white disabled:opacity-50"
                disabled={saving || headerLocked}
                onClick={saveHeader}
                type="button"
              >
                Save Operational Context
              </button>
            </div>
          </div>

          {headerOk ? <p className="text-sm rounded bg-green-50 border border-green-200 p-2">{headerOk}</p> : null}
          {headerErr ? <p className="text-sm rounded bg-red-50 border border-red-200 p-2">{headerErr}</p> : null}

          <p className="text-sm text-gray-600">
            Running Log required today: <b>{requiresRunningLog(status) ? "YES" : "NO"}</b>
          </p>
        </section>
      ) : null}

      {/* Engine room layout */}
      {activeTab === "MAIN" ? (
        <section className="rounded border p-4 space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <h2 className="text-lg font-semibold">Engine Room Layout</h2>

            <button
              className="rounded bg-black px-4 py-2 text-white disabled:opacity-50"
              disabled={saving || headerLocked}
              onClick={saveEngineRoom}
              type="button"
            >
              Save Engine Room
            </button>
          </div>

          {engineOk ? <p className="text-sm rounded bg-green-50 border border-green-200 p-2">{engineOk}</p> : null}
          {engineErr ? <p className="text-sm rounded bg-red-50 border border-red-200 p-2">{engineErr}</p> : null}

          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-4">
              <h3 className="text-base font-semibold">Port</h3>
              <div className="rounded border p-3 space-y-2">
                <h4 className="text-sm font-semibold">Main Engines</h4>
                <RunHoursList items={mePort} />
              </div>
              <div className="rounded border p-3 space-y-2">
                <h4 className="text-sm font-semibold">Generators</h4>
                <RunHoursList items={dgPort} />
              </div>
            </div>

            <div className="space-y-4">
              <h3 className="text-base font-semibold">Center</h3>
              <PowerCard />
              <ChillerPlantCard />
              <div className="rounded border p-3 space-y-2">
                <h4 className="text-sm font-semibold">Center equipment (run-hours)</h4>
                {[...meCenter, ...dgCenter].length ? <RunHoursList items={[...meCenter, ...dgCenter]} /> : <p className="text-sm text-gray-500">None</p>}
              </div>
            </div>

            <div className="space-y-4">
              <h3 className="text-base font-semibold">Starboard</h3>

              <div className="rounded border p-3 space-y-2">
                <h4 className="text-sm font-semibold">Main Engines</h4>
                <RunHoursList items={meStbd} />
              </div>

              <div className="rounded border p-3 space-y-2">
                <h4 className="text-sm font-semibold">Generators</h4>
                <RunHoursList items={dgStbd} />
              </div>

              <div className="rounded border p-3 space-y-3">
                <h4 className="text-sm font-semibold">Fresh / Hot Water</h4>
                <FreshWaterSystemCard />
                <CircPumpCard />
                <BoilersBlock />
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {/* Placeholder tabs */}
      {activeTab === "AHUS" ? (
        <TabShell code="AHUS" title="AHUs">
          <p className="text-sm text-gray-700">Placeholder</p>
        </TabShell>
      ) : null}
      {activeTab === "BILGES" ? (
        <TabShell code="BILGES" title="Bilges">
          <p className="text-sm text-gray-700">Placeholder</p>
        </TabShell>
      ) : null}
      {activeTab === "TANKS" ? (
        <TabShell code="TANKS" title="Tanks">
          <p className="text-sm text-gray-700">Placeholder</p>
        </TabShell>
      ) : null}
      {activeTab === "ORB" ? (
        <TabShell code="ORB" title="Oil Record Book (ORB)">
          <p className="text-sm text-gray-700">Placeholder</p>
        </TabShell>
      ) : null}
      {activeTab === "RUNNING_LOG" ? (
        <TabShell code="RUNNING_LOG" title="Running Log">
          <p className="text-sm text-gray-700">Placeholder</p>
        </TabShell>
      ) : null}

      {/* Quick defect capture */}
      <section className="rounded border p-4 space-y-3">
        <h2 className="text-lg font-semibold">Quick defect capture</h2>

        <label className="text-sm block">
          Defect title
          <input
            className="mt-1 w-full rounded border p-2"
            value={defectTitle}
            disabled={saving || headerLocked}
            onChange={(e) => setDefectTitle(e.target.value)}
          />
        </label>

        <button
          className="rounded bg-black px-4 py-2 text-white disabled:opacity-50"
          disabled={saving || headerLocked}
          onClick={createDefect}
          type="button"
        >
          Create defect
        </button>

        {defectOk ? (
          <p className="text-sm rounded bg-green-50 border border-green-200 p-2">
            Created defect <b>{defectOk}</b>
          </p>
        ) : null}
        {defectErr ? <p className="text-sm rounded bg-red-50 border border-red-200 p-2">{defectErr}</p> : null}
      </section>

      {/* Notes moved here (after defects) */}
      <section className="rounded border p-4 space-y-3">
        <h2 className="text-lg font-semibold">Daily Log Notes</h2>

        <label className="text-sm block">
          Notes for this log (anything not covered above)
          <textarea
            className="mt-1 w-full rounded border p-2"
            value={notes}
            disabled={saving || headerLocked}
            onChange={(e) => setNotes(e.target.value)}
            rows={5}
            placeholder="Engineer notes / observations / follow-ups..."
          />
        </label>

        <button
          className="rounded bg-black px-4 py-2 text-white disabled:opacity-50"
          disabled={saving || headerLocked}
          onClick={saveHeader}
          type="button"
        >
          Save Notes
        </button>

        {headerOk ? <p className="text-sm rounded bg-green-50 border border-green-200 p-2">{headerOk}</p> : null}
        {headerErr ? <p className="text-sm rounded bg-red-50 border border-red-200 p-2">{headerErr}</p> : null}
      </section>
    </div>
  );
}