import DashboardClient from "./dashboard-client";

export default function Home() {
  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      {/* Header */}
      <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        <div className="mx-auto flex h-14 max-w-2xl items-center px-6">
          <div className="flex items-center gap-2">
            <span className="text-xl">🏠</span>
            <h1 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">
              IoT Device Control
            </h1>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="py-6">
        <DashboardClient />
      </main>
    </div>
  );
}
