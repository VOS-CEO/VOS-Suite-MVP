import Link from "next/link";
import { headers } from "next/headers";

export const dynamic = "force-dynamic";

type EqDetail = {
  id: string;
  display_name: string;
  criticality: string;
  active: boolean;
  manufacturer: string | null;
  model: string | null;
  serial_no: string | null;
  equipment_type?: { code: string; name: string; category: string } | null;
  equipment_system?: { id: string; name: string } | null;
  location?: { id: string; name: string } | null;
};

type FieldItem = {
  field_id: string;
  code: string;
  name: string;
  unit: string;
  input_type: string;
  group: string;
  sort_order: number;
  effective_log_enabled: boolean;
};

async function baseUrl() {
  const h = await headers();
  const host = h.get("host"); // localhost:3000
  const proto = h.get("x-forwarded-proto") ?? "http";
  return `${proto}://${host}`;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<T>;
}

export default async function EquipmentDetailPage({ params }: { params: { id: string } }) {
  const base = await baseUrl();

  const eq = await getJson<EqDetail>(`${base}/api/em/equipment/${params.id}`);
  const fieldsResp = await getJson<{ items: FieldItem[] }>(`${base}/api/em/equipment/${params.id}/fields`);

  // group fields
  const groups = new Map<string, FieldItem[]>();
  for (const f of fieldsResp.items) {
    const key = f.group || "General";
    groups.set(key, [...(groups.get(key) ?? []), f]);
  }

  return (
    <main className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{eq.display_name}</h1>
        <Link className="underline text-sm" href="/em/equipment">← Back to list</Link>
      </div>

      <div className="rounded border p-4 space-y-1 text-sm">
        <div><b>Type:</b> {eq.equipment_type?.name ?? eq.equipment_type?.code ?? "-"}</div>
        <div><b>System:</b> {eq.equipment_system?.name ?? "-"}</div>
        <div><b>Location:</b> {eq.location?.name ?? "-"}</div>
        <div><b>Criticality:</b> {eq.criticality}</div>
        <div><b>Manufacturer:</b> {eq.manufacturer ?? "-"}</div>
        <div><b>Model:</b> {eq.model ?? "-"}</div>
        <div><b>Serial:</b> {eq.serial_no ?? "-"}</div>
      </div>

      <div className="space-y-4">
        {[...groups.entries()].map(([group, items]) => (
          <section key={group} className="rounded border">
            <div className="bg-gray-50 px-3 py-2 font-medium">{group}</div>
            <div className="p-3 overflow-auto">
              <table className="min-w-full text-sm">
                <thead className="text-left">
                  <tr>
                    <th className="py-1 pr-3">Field</th>
                    <th className="py-1 pr-3">Unit</th>
                    <th className="py-1 pr-3">Log Enabled</th>
                  </tr>
                </thead>
                <tbody>
                  {items.sort((a, b) => a.sort_order - b.sort_order).map((f) => (
                    <tr key={f.field_id} className="border-t">
                      <td className="py-1 pr-3">{f.name}</td>
                      <td className="py-1 pr-3">{f.unit}</td>
                      <td className="py-1 pr-3">{f.effective_log_enabled ? "Yes" : "No"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}