import { createContext, useContext, useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import {
  CalendarDays, Database, Dog as DogIcon, LayoutGrid, Route as RouteIcon,
  Settings as SettingsIcon, Upload, Footprints,
} from "lucide-react";
import clsx from "clsx";

import { ensureSeeded } from "@/db/repository";
import { todayISO } from "@/utils/dates";
import { useSettings } from "@/hooks/useData";

import Today from "@/pages/Today";
import Dogs from "@/pages/Dogs";
import DogProfile from "@/pages/DogProfile";
import Transportation from "@/pages/Transportation";
import WalkPlanner from "@/pages/WalkPlanner";
import FloorPlanner from "@/pages/FloorPlanner";
import DataImport from "@/pages/DataImport";
import SettingsPage from "@/pages/Settings";

/** The selected operating date is shared so it survives navigation. */
const DateCtx = createContext<{ date: string; setDate: (d: string) => void }>({
  date: todayISO(),
  setDate: () => {},
});

export const useOperatingDate = () => useContext(DateCtx);

const NAV = [
  { to: "/today", label: "Today", icon: CalendarDays },
  { to: "/dogs", label: "Dogs", icon: DogIcon },
  { to: "/transportation", label: "Transportation", icon: RouteIcon },
  { to: "/walks", label: "Walk Planner", icon: Footprints },
  { to: "/floors", label: "Floor Planner", icon: LayoutGrid },
  { to: "/import", label: "Data Import", icon: Upload },
  { to: "/settings", label: "Settings", icon: SettingsIcon },
];

export default function App() {
  const [date, setDate] = useState(todayISO());
  const [ready, setReady] = useState(false);
  const settings = useSettings();

  useEffect(() => {
    ensureSeeded().finally(() => setReady(true));
  }, []);

  if (!ready) {
    return (
      <div className="flex h-screen items-center justify-center text-ink-500">
        Opening local database…
      </div>
    );
  }

  return (
    <DateCtx.Provider value={{ date, setDate }}>
      <div className="flex min-h-screen">
        <aside className="sticky top-0 flex h-screen w-[228px] shrink-0 flex-col border-r border-ink-200 bg-white">
          <div className="flex flex-col items-center gap-2 border-b border-ink-200 px-4 py-5">
            <img
              src="/logo.png"
              alt="Doggie Retreat"
              className="w-[152px] max-w-full"
              width={400}
              height={268}
            />
            {/* Brand promise, set in the display face — one of the few places
                Playfair is appropriate inside operational software. */}
            <span className="text-center font-display text-[13px] leading-tight text-ink-500">
              Happy dogs, happy families.
            </span>
          </div>

          <nav className="flex flex-1 flex-col gap-1 p-3">
            {NAV.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                className={({ isActive }) =>
                  clsx(
                    "flex items-center gap-2.5 px-3 py-2.5 text-[13px] font-semibold",
                    isActive
                      ? "bg-brand-100 text-brand-600"
                      : "text-ink-700 hover:bg-brand-50 hover:text-brand-600"
                  )
                }
                style={{ borderRadius: 12 }}
              >
                <Icon size={16} strokeWidth={2} />
                {label}
              </NavLink>
            ))}
          </nav>

          <div className="border-t border-ink-200 px-4 py-3">
            <p className="text-[11px] font-semibold text-ink-700">
              {settings.demoDataLoaded ? "Demo dataset loaded" : "No dataset loaded"}
            </p>
            <p className="mt-1 text-[11px] leading-relaxed text-ink-400">
              <Database size={12} className="mb-0.5 mr-1 inline" />
              Data lives in this browser only and is not synced between devices.
            </p>
          </div>
        </aside>

        <main className="min-w-0 flex-1">
          <Routes>
            <Route path="/" element={<Navigate to="/today" replace />} />
            <Route path="/today" element={<Today />} />
            <Route path="/dogs" element={<Dogs />} />
            <Route path="/dogs/:id" element={<DogProfile />} />
            <Route path="/transportation" element={<Transportation />} />
            <Route path="/walks" element={<WalkPlanner />} />
            <Route path="/floors" element={<FloorPlanner />} />
            <Route path="/import" element={<DataImport />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/today" replace />} />
          </Routes>
        </main>
      </div>
    </DateCtx.Provider>
  );
}

export function PageShell({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto flex max-w-[1240px] flex-col gap-4 px-6 py-6">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-ink-200 pb-4">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-[22px] font-bold tracking-tight">{title}</h1>
          {description && <p className="text-[13px] text-ink-500">{description}</p>}
        </div>
        {actions}
      </header>
      {children}
    </div>
  );
}
