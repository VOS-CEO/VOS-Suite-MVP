import { NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabaseServer";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const isUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);

  if (!id || !isUuid) {
    return NextResponse.json({ error: "Invalid equipment id" }, { status: 400 });
  }

  const sb = supabaseServer();
  // (leave the existing Supabase query exactly as-is below)
  const { data, error } = await sb
    .from("equipment_instance")
    .select(`
      id, vessel_id, type_id, display_name, manufacturer, model, serial_no,
      criticality, operational_state, maintenance_state, active,
      equipment_type:equipment_type ( code, name, category ),
      equipment_system:equipment_system ( id, name ),
      location:location ( id, name )
    `)
    .eq("id", id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(data);
}
