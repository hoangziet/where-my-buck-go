import { Sidebar } from "./Sidebar";
import { MobileTabBar } from "./MobileTabBar";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-stretch">
      <Sidebar />
      <div className="flex-1 min-w-0 flex flex-col">{children}</div>
      <MobileTabBar />
    </div>
  );
}
