import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

export async function GET(req: Request) {
  const sb = supabaseServer();
  const url = new URL(req.url);
  const vesselId = url.searchParams.get("vesselId");

  if (!vesselId) {
    return NextResponse.json({ error: "vesselId is required" }, { status: 400 });
  }

  const { data, error } = await sb
    .from("equipment_instance")
    .select(
      `
      id,
      display_name,
      location_id,
      equipment_type:equipment_type ( code, name, category ),
      location:location ( id, name, parent_location_id )
    `
    )
    .eq("vessel_id", vesselId)
    .order("display_name", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: data ?? [] });
}