import MemoryDashboard from "@/components/MemoryDashboard-runtime.mjs";

export default function MemoryPage() {
  return (
    <main className="h-full overflow-auto bg-black p-4 sm:p-6">
      <MemoryDashboard apiBase="/api/memory" />
    </main>
  );
}
