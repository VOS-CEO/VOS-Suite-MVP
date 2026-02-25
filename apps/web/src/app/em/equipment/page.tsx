import Link from "next/link";

export const dynamic = "force-dynamic";

type EquipmentItem = {
  id: string;
  display_name: string;
  criticality: string;
  active: boolean;
  equipment_type?: { code: string; name: string; category: string } | null;
  equipment_system?: { name: string } | null;
  location?: { name: string } | null;
};

async function getCurrentVessel() {
  const res = await fetch("http://localhost:3000/api/vessels/current", { cache: "no-store" });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<{ id: string; name: string }>;
}

async function getEquipment(vesselId: string) {
  const res = await fetch(`http://localhost:3000/api/em/equipment?vesselId=${vesselId}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(await res.text());
  const json = await res.json();
  return json.items as EquipmentItem[];
}

export default async function EquipmentPage() {
  const vessel = await getCurrentVessel();
  const items = await getEquipment(vessel.id);

  return (
    <main className="p-6 space-y-4">
      <h1 className="text-2xl font-semibold">S11 — Equipment (E&M)</h1>
      <p className="text-sm text-gray-600">Vessel: {vessel.name}</p>

      <div className="overflow-auto rounded border">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-left">
            <tr>
              <th className="p-2">Name</th>
              <th className="p-2">Type</th>
              <th className="p-2">System</th>
              <th className="p-2">Location</th>
              <th className="p-2">Criticality</th>
              <th className="p-2">Active</th>
            </tr>
          </thead>
          <tbody>
            {items.map((x) => (
              <tr key={x.id} className="border-t">
    <td className="p-2">
  {x.id ? (
    <Link className="underline" href={`/em/equipment/${x.id}`}>
      {x.display_name}
    </Link>
  ) : (
    <span className="text-red-600">Missing ID</span>
  )}
</td>
                <td className="p-2">{x.equipment_type?.name ?? x.equipment_type?.code ?? "-"}</td>
                <td className="p-2">{x.equipment_system?.name ?? "-"}</td>
                <td className="p-2">{x.location?.name ?? "-"}</td>
                <td className="p-2">{x.criticality}</td>
                <td className="p-2">{x.active ? "Yes" : "No"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}