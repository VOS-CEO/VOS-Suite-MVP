import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

type TabCode = "MAIN" | "AHUS" | "BILGES" | "TANKS" | "ORB" | "RUNNING_LOG";
type ActionCode = "VIEW" | "OK";

const VALID_TABS: TabCode[] = ["MAIN", "AHUS", "BILGES", "TANKS", "ORB", "RUNNING_LOG"];

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function asUpperString(v: unknown): string | null {
  return typeof v === "string" ? v.toUpperCase() : null;
}

function isTabCode(v: string): v is TabCode {
  return (VALID_TABS as string[]).includes(v);
}

function isActionCode(v: string): v is ActionCode {
  return v === "VIEW" || v === "OK";
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: dailyLogId } = await ctx.params;

  // Parse JSON safely
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body. Expected { tab_code: string, action: 'VIEW' | 'OK' }" },
      { status: 400 }
    );
  }

  if (!isObject(body)) {
    return NextResponse.json(
      { error: "Bad request body. Expected a JSON object." },
      { status: 400 }
    );
  }

  const tabRaw = asUpperString(body.tab_code);
  const actionRaw = asUpperString(body.action);

  if (!tabRaw || !isTabCode(tabRaw)) {
    return NextResponse.json(
      { error: `Bad tab_code. Must be one of: ${VALID_TABS.join(", ")}`, received: body.tab_code ?? null },
      { status: 400 }
    );
  }

  if (!actionRaw || !isActionCode(actionRaw)) {
    return NextResponse.json(
      { error: "Bad action. Must be 'VIEW' or 'OK'", received: body.action ?? null },
      { status: 400 }
    );
  }

  // MAIN doesn't need persistence; allow without error
  if (tabRaw === "MAIN") {
    return NextResponse.json({ ok: true, item: { tab_code: "MAIN", viewed_at: null, ok_at: null } });
  }

  const sb = await supabaseServer();
  const now = new Date().toISOString();

  const patch: { daily_log_id: string; tab_code: TabCode; viewed_at?: string; ok_at?: string } = {
    daily_log_id: dailyLogId,
    tab_code: tabRaw,
  };

  if (actionRaw === "VIEW") {
    patch.viewed_at = now;
  } else {
    // OK implies VIEW
    patch.viewed_at = now;
    patch.ok_at = now;
  }

  const { data, error } = await sb
    .from("daily_log_tab_state")
    .upsert(patch, { onConflict: "daily_log_id,tab_code" })
    .select("tab_code, viewed_at, ok_at")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, item: data });
}