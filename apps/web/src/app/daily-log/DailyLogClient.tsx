"use client";

import { useState } from "react";

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

export default function DailyLogClient({
  dailyLogId,
  locationText,
  mainEngine,
}: {
  dailyLogId: string;
  locationText: string;
  mainEngine: { equipmentId: string; equipmentName: string; runHoursFieldId: string };
}) {
  // shared UI state
  const [saving, setSaving] = useState(false);

  // Main Engine hours (Official meters MVP)
  const [meHours, setMeHours] = useState("");
  const [meOk, setMeOk] = useState<string | null>(null);
  const [meErr, setMeErr] = useState<string | null>(null);

  async function saveMainEngineHours() {
    setMeErr(null);
    setMeOk(null);

    const n = Number(meHours);
    if (Number.isNaN(n)) {
      setMeErr("Please enter a number for hours.");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/daily-logs/${dailyLogId}/meter-readings/one`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          equipmentId: mainEngine.equipmentId,
          fieldId: mainEngine.runHoursFieldId,
          hours: n,
        }),
      });

      const json: unknown = await res.json();
      if (!res.ok) throw new Error(getErrorMessage(json, "Failed to save hours"));

      setMeOk("Saved");
    } catch (e: unknown) {
      setMeErr(e instanceof Error ? e.message : "Failed to save hours");
    } finally {
      setSaving(false);
    }
  }

  // Quick Defect Capture
  const [title, setTitle] = useState("");
  const [ok, setOk] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function createDefect() {
    setErr(null);
    setOk(null);

    const t = title.trim();
    if (!t) {
      setErr("Please enter a defect title.");
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
      setOk(defectNo || "Created");
      setTitle("");
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed to create defect");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Official meters (MVP: Main Engine hours only) */}
      <section className="rounded border p-4 space-y-3">
        <h2 className="text-lg font-semibold">Official meters (MVP)</h2>

        <div className="grid gap-3 md:grid-cols-3 items-end">
          <div className="md:col-span-2">
            <p className="text-sm text-gray-700">{mainEngine.equipmentName} — RUN_HOURS</p>
            <input
              className="mt-1 w-full rounded border p-2"
              value={meHours}
              disabled={saving}
              onChange={(e) => setMeHours(e.target.value)}
              placeholder="e.g., 1234.5"
              inputMode="decimal"
            />
          </div>

          <button
            className="rounded bg-black px-4 py-2 text-white disabled:opacity-50"
            disabled={saving}
            onClick={saveMainEngineHours}
          >
            Save hours
          </button>
        </div>

        {meOk && <p className="text-sm rounded bg-green-50 border border-green-200 p-2">{meOk}</p>}
        {meErr && <p className="text-sm rounded bg-red-50 border border-red-200 p-2">{meErr}</p>}
      </section>

      {/* Quick defect capture */}
      <section className="rounded border p-4 space-y-3">
        <h2 className="text-lg font-semibold">Quick defect capture</h2>

        <label className="text-sm block">
          Defect title
          <input
            className="mt-1 w-full rounded border p-2"
            value={title}
            disabled={saving}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g., Port DG seawater pump leak"
          />
        </label>

        <button
          className="rounded bg-black px-4 py-2 text-white disabled:opacity-50"
          disabled={saving}
          onClick={createDefect}
        >
          Create defect
        </button>

        {ok && (
          <p className="text-sm rounded bg-green-50 border border-green-200 p-2">
            Created defect <b>{ok}</b>
          </p>
        )}
        {err && <p className="text-sm rounded bg-red-50 border border-red-200 p-2">{err}</p>}
      </section>
    </div>
  );
}