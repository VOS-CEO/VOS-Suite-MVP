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

export type MeterTarget = {
  equipmentId: string;
  equipmentName: string;
  runHoursFieldId: string;
  locationName: string | null; // NEW: used for Port/Center/Stbd layout
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

// Step 4: ORB requirement logic comes later
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

export default function DailyLogClient({
  dailyLogId,
  status: initialStatus,
  locationText: initialLocationText,
  weatherText: initialWeatherText,
  notes: initialNotes,
  submittedAt,
  mainEngines,
  dieselGens,
  initialHoursByEquipmentId,
}: {
  dailyLogId: string;
  status?: string | null;
  locationText: string;
  weatherText: string;
  notes: string;
  submittedAt: string | null;
  mainEngines: MeterTarget[];
  dieselGens: MeterTarget[];
  initialHoursByEquipmentId: Record<string, number | null>;
}) {
  const allTargets = useMemo(() => [...mainEngines, ...dieselGens], [mainEngines, dieselGens]);

  const [activeTab, setActiveTab] = useState<TabCode>("MAIN");

  // Header (operational context)
  const [status, setStatus] = useState<string>(String(initialStatus ?? "dock"));
  const [locationText, setLocationText] = useState<string>(initialLocationText ?? "");
  const [weatherText, setWeatherText] = useState<string>(initialWeatherText ?? "");
  const [notes, setNotes] = useState<string>(initialNotes ?? "");

  const headerLocked = !!submittedAt;

  const [headerOk, setHeaderOk] = useState<string | null>(null);
  const [headerErr, setHeaderErr] = useState<string | null>(null);

  // Tab state (viewed/ok)
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

  // Hours input state per equipment
  const [hoursById, setHoursById] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const t of allTargets) {
      const v = initialHoursByEquipmentId[t.equipmentId];
      init[t.equipmentId] = typeof v === "number" ? String(v) : "";
    }
    return init;
  });

  // Row feedback per equipment
  const [okById, setOkById] = useState<Record<string, string | null>>({});
  const [errById, setErrById] = useState<Record<string, string | null>>({});

  // Quick defect capture
  const [defectTitle, setDefectTitle] = useState("");
  const [defectOk, setDefectOk] = useState<string | null>(null);
  const [defectErr, setDefectErr] = useState<string | null>(null);

  // Submit feedback
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
      const json: unknown = await res.json();
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
    setTabState((s) => {
      const prev = s[tab_code] ?? { viewed: false, ok: false };
      if (tab_code === "MAIN") return s;
      if (action === "VIEW") return { ...s, [tab_code]: { ...prev, viewed: true } };
      return { ...s, [tab_code]: { viewed: true, ok: true } };
    });

    try {
      const res = await fetch(`/api/daily-logs/${dailyLogId}/tab-state/mark`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tab_code, action }),
      });
      const json: unknown = await res.json();
      if (!res.ok) throw new Error(getErrorMessage(json, "Failed to update tab state"));
    } catch {
      await refreshTabState();
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
        body: JSON.stringify({
          status: s,
          location_text: locationText || null,
          weather_text: weatherText || null,
          notes: notes || null,
        }),
      });

      const json: unknown = await res.json();
      if (!res.ok) throw new Error(getErrorMessage(json, "Failed to save header"));

      const nextStatus =
        isObject(json) && isObject(json.log) && typeof json.log.status === "string" ? json.log.status : s;
      setStatus(nextStatus);

      setHeaderOk("Header saved");
    } catch (e: unknown) {
      setHeaderErr(e instanceof Error ? e.message : "Failed to save header");
    } finally {
      setSaving(false);
    }
  }

  async function saveRunHours(target: MeterTarget) {
    setOkById((m) => ({ ...m, [target.equipmentId]: null }));
    setErrById((m) => ({ ...m, [target.equipmentId]: null }));

    const hoursStr = (hoursById[target.equipmentId] ?? "").trim();
    const n = Number(hoursStr);
    if (hoursStr === "" || Number.isNaN(n)) {
      setErrById((m) => ({ ...m, [target.equipmentId]: "Please enter a valid number for hours." }));
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/daily-logs/${dailyLogId}/meter-readings/one`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          equipmentId: target.equipmentId,
          fieldId: target.runHoursFieldId,
          hours: n,
        }),
      });

      const json: unknown = await res.json();
      if (!res.ok) throw new Error(getErrorMessage(json, "Failed to save hours"));

      setOkById((m) => ({ ...m, [target.equipmentId]: "Saved" }));
    } catch (e: unknown) {
      setErrById((m) => ({
        ...m,
        [target.equipmentId]: e instanceof Error ? e.message : "Failed to save hours",
      }));
    } finally {
      setSaving(false);
    }
  }

  function RunHoursList({ items }: { items: MeterTarget[] }) {
    if (!items.length) {
      return <p className="text-sm text-gray-500">None</p>;
    }
    return (
      <div className="space-y-3">
        {items.map((t) => (
          <div key={t.equipmentId} className="rounded border p-3">
            <div className="grid gap-3 md:grid-cols-3 items-end">
              <div className="md:col-span-2">
                <p className="text-sm text-gray-700">{t.equipmentName} — RUN_HOURS</p>
                <p className="text-xs text-gray-500">Location: {t.locationName ?? "Unknown"}</p>
                <input
                  className="mt-1 w-full rounded border p-2"
                  value={hoursById[t.equipmentId] ?? ""}
                  disabled={saving || headerLocked}
                  onChange={(e) => setHoursById((m) => ({ ...m, [t.equipmentId]: e.target.value }))}
                  placeholder="e.g., 1234.5"
                  inputMode="decimal"
                />
              </div>

              <button
                className="rounded bg-black px-4 py-2 text-white disabled:opacity-50"
                disabled={saving || headerLocked}
                onClick={() => saveRunHours(t)}
                type="button"
              >
                Save hours
              </button>
            </div>

            {okById[t.equipmentId] && (
              <p className="mt-2 text-sm rounded bg-green-50 border border-green-200 p-2">
                {okById[t.equipmentId]}
              </p>
            )}
            {errById[t.equipmentId] && (
              <p className="mt-2 text-sm rounded bg-red-50 border border-red-200 p-2">
                {errById[t.equipmentId]}
              </p>
            )}
          </div>
        ))}
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
        body: JSON.stringify({
          dailyLogId,
          title: t,
          location_text: locationText || null,
        }),
      });

      const json: unknown = await res.json();
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
      const res = await fetch(`/api/daily-logs/${dailyLogId}/submit`, { method: "POST" });
      const json: unknown = await res.json();
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

    const badge =
      ind.kind === "ok"
        ? "text-green-700"
        : ind.kind === "warn"
        ? "text-amber-700"
        : "text-blue-700";

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
              Status: <b>{status}</b> • Requirement:{" "}
              {ind.kind === "na" ? "Not required today" : tabState[code]?.ok ? "OK complete" : "Needs OK"}
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

  // Group equipment by location side
  const mePort = mainEngines.filter((t) => sideFromLocationName(t.locationName) === "PORT");
  const meCenter = mainEngines.filter((t) => sideFromLocationName(t.locationName) === "CENTER");
  const meStbd = mainEngines.filter((t) => sideFromLocationName(t.locationName) === "STBD");

  const dgPort = dieselGens.filter((t) => sideFromLocationName(t.locationName) === "PORT");
  const dgCenter = dieselGens.filter((t) => sideFromLocationName(t.locationName) === "CENTER");
  const dgStbd = dieselGens.filter((t) => sideFromLocationName(t.locationName) === "STBD");

  return (
    <div className="space-y-6">
      {/* Tabs */}
      <div className="flex flex-wrap gap-2 items-center">
        {TABS.map((t) => (
          <TabButton key={t.code} code={t.code} label={t.label} />
        ))}
        <div className="ml-auto flex items-center gap-2">
          {tabStateLoading ? <span className="text-sm text-gray-600">Loading tab state…</span> : null}
          {tabStateError ? <span className="text-sm text-red-600">{tabStateError}</span> : null}
        </div>
      </div>

      {/* Main tab: Operational context + submit */}
      {activeTab === "MAIN" ? (
        <section className="rounded border p-4 space-y-3">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="space-y-2">
              <h2 className="text-lg font-semibold">Daily Log — Operational Context</h2>

              <div className="grid gap-3 md:grid-cols-4">
                <label className="text-sm block">
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
                    placeholder="e.g., Palma de Mallorca"
                  />
                </label>

                <label className="text-sm block md:col-span-2">
                  Weather
                  <input
                    className="mt-1 w-full rounded border p-2"
                    value={weatherText}
                    disabled={saving || headerLocked}
                    onChange={(e) => setWeatherText(e.target.value)}
                    placeholder="e.g., NW 15kt, slight seas"
                  />
                </label>

                <div className="md:col-span-2 flex items-end">
                  <button
                    className="w-full rounded bg-black px-4 py-2 text-white disabled:opacity-50"
                    disabled={saving || headerLocked}
                    onClick={saveHeader}
                    type="button"
                  >
                    Save header
                  </button>
                </div>

                <label className="text-sm block md:col-span-4">
                  Notes
                  <textarea
                    className="mt-1 w-full rounded border p-2"
                    value={notes}
                    disabled={saving || headerLocked}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={4}
                    placeholder="Anything the engineer wants noted for today…"
                  />
                </label>
              </div>

              {headerOk ? (
                <p className="text-sm rounded bg-green-50 border border-green-200 p-2">{headerOk}</p>
              ) : null}
              {headerErr ? (
                <p className="text-sm rounded bg-red-50 border border-red-200 p-2">{headerErr}</p>
              ) : null}

              <p className="text-sm text-gray-600">
                Running Log required today: <b>{runningLogRequired ? "YES" : "NO"}</b>
              </p>
            </div>

            <div className="min-w-[260px]">
              <button
                className="w-full rounded bg-black px-4 py-2 text-white disabled:opacity-50"
                disabled={saving || headerLocked || submitBlocked.length > 0}
                onClick={submitDailyLog}
                type="button"
              >
                Submit Daily Log
              </button>

              {headerLocked ? (
                <p className="mt-2 text-sm rounded bg-blue-50 border border-blue-200 p-2">
                  This Daily Log is submitted and locked.
                </p>
              ) : submitBlocked.length ? (
                <p className="mt-2 text-sm rounded bg-amber-50 border border-amber-200 p-2">
                  Missing OK: <b>{submitBlocked.join(", ")}</b>
                </p>
              ) : (
                <p className="mt-2 text-sm text-gray-600">All required tabs OK’d — ready to submit.</p>
              )}

              {submitOk ? (
                <p className="mt-2 text-sm rounded bg-green-50 border border-green-200 p-2">{submitOk}</p>
              ) : null}
              {submitErr ? (
                <p className="mt-2 text-sm rounded bg-red-50 border border-red-200 p-2">{submitErr}</p>
              ) : null}
            </div>
          </div>
        </section>
      ) : null}

      {/* Main tab: Engine Room Layout */}
      {activeTab === "MAIN" ? (
        <section className="rounded border p-4 space-y-4">
          <h2 className="text-lg font-semibold">Engine Room Layout</h2>
          <p className="text-sm text-gray-600">
            Equipment is placed by location (ER - Port / ER - Center / ER - Stbd).
          </p>

          <div className="grid gap-4 md:grid-cols-3">
            {/* PORT */}
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

            {/* CENTER */}
            <div className="space-y-4">
              <h3 className="text-base font-semibold">Center</h3>

              <div className="rounded border p-3 space-y-2">
                <h4 className="text-sm font-semibold">Chiller Plant (Center-Top)</h4>
                <p className="text-sm text-gray-600">
                  Placeholder. Next step: seed 4 chillers + pumps and render water temps + toggles here.
                </p>
              </div>

              <div className="rounded border p-3 space-y-2">
                <h4 className="text-sm font-semibold">Center equipment (run-hours)</h4>
                {[...meCenter, ...dgCenter].length ? <RunHoursList items={[...meCenter, ...dgCenter]} /> : <p className="text-sm text-gray-500">None</p>}
              </div>
            </div>

            {/* STBD */}
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
            </div>
          </div>
        </section>
      ) : null}

      {/* Placeholder tabs */}
      {activeTab === "AHUS" ? (
        <TabShell code="AHUS" title="AHUs">
          <p className="text-sm text-gray-700">Placeholder: up to 50 AHUs with Working/Tagged Out + Setpoint + Ambient temp.</p>
        </TabShell>
      ) : null}

      {activeTab === "BILGES" ? (
        <TabShell code="BILGES" title="Bilges">
          <p className="text-sm text-gray-700">Placeholder: 4–12 bilge zones with Wet/Dry + Dirty/Clean toggle pairs.</p>
        </TabShell>
      ) : null}

      {activeTab === "TANKS" ? (
        <TabShell code="TANKS" title="Tanks">
          <p className="text-sm text-gray-700">Placeholder: Fresh/Black/Grey + optional combined Grey/Black + Diesel onboard, all with L/gal.</p>
        </TabShell>
      ) : null}

      {activeTab === "ORB" ? (
        <TabShell code="ORB" title="Oil Record Book (ORB)">
          <p className="text-sm text-gray-700">Placeholder: ORB entries required when fuel/oil/bilge events occur (trigger logic later).</p>
        </TabShell>
      ) : null}

      {activeTab === "RUNNING_LOG" ? (
        <TabShell code="RUNNING_LOG" title="Running Log">
          <p className="text-sm text-gray-700">Required only when status is underway or anchor.</p>
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
            placeholder="e.g., Port DG seawater pump leak"
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
        {defectErr ? (
          <p className="text-sm rounded bg-red-50 border border-red-200 p-2">{defectErr}</p>
        ) : null}
      </section>
    </div>
  );
}