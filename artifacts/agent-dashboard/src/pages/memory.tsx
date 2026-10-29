import MemoryDashboard from "@/components/MemoryDashboard-runtime.mjs";
import "./memory.css";

export default function MemoryPage() {
  return (
    <main className="memory-page h-full overflow-auto bg-black p-4 sm:p-6">
      <MemoryDashboard apiBase="/api/memory" adminToken="session-authenticated" />
    </main>
  );
}
