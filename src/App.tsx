import { createContext, useContext, useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import {
  CalendarDays, Database, Dog as DogIcon, LayoutGrid, Menu, Route as RouteIcon,
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
  { to: "/today", label: "Home", icon: CalendarDays },
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
  const [navOpen, setNavOpen] = useState(false);
  const [dbError, setDbError] = useState<string | null>(null);
  const settings = useSettings();
  const location = useLocation();

  useEffect(() => {
    // IndexedDB can be unavailable outright — private windows, blocked storage,
    // exhausted quota. Previously this threw into a blank screen.
    ensureSeeded()
      .catch((e) => setDbError(String(e?.message ?? e)))
      .finally(() => setReady(true));
  }, []);

  // Close the drawer whenever the route changes.
  useEffect(() => setNavOpen(false), [location.pathname]);

  if (dbError) {
    return (
      <div className="flex min-h-screen items-start justify-center p-6">
        <div className="card mt-12 max-w-[560px] p-6">
          <h1 className="text-[19px] font-bold tracking-tight">Local storage isn't available</h1>
          <p className="mt-2 text-[13.5px] leading-relaxed text-ink-600">
            Doggie Retreat stores its data in this browser, and the browser refused access.
            This usually means a private window, blocked site data, or a full disk.
          </p>
          <p className="mt-2 rounded bg-ink-100 px-3 py-2 font-mono text-[11.5px] text-ink-700">
            {dbError}
          </p>
          <button className="btn btn-primary mt-3" onClick={() => window.location.reload()}>
            Try again
          </button>
        </div>
      </div>
    );
  }

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
        {/* Mobile top bar. The sidebar used to take 47% of a phone screen, so
            below lg it becomes an off-canvas drawer and the content gets the
            whole viewport. */}
        <header className="fixed inset-x-0 top-0 z-40 flex h-14 items-center gap-3 border-b border-ink-200 bg-white px-3 lg:hidden">
          <button
            onClick={() => setNavOpen(true)}
            aria-label="Open navigation"
            aria-expanded={navOpen}
            className="flex h-11 w-11 items-center justify-center rounded-[12px] border border-ink-200 text-ink-700"
          >
            <Menu size={20} />
          </button>
          <img src="/logo.png" alt="Doggie Retreat" className="h-9 w-auto" width={400} height={268} />
          <span className="ml-auto truncate text-[12px] font-semibold text-ink-500">
            {NAV.find((n) => location.hash.startsWith(`#${n.to}`))?.label ?? "Home"}
          </span>
        </header>

        {navOpen && (
          <button
            className="fixed inset-0 z-40 bg-ink-900/40 lg:hidden"
            aria-label="Close navigation"
            onClick={() => setNavOpen(false)}
          />
        )}

        <aside
          className={clsx(
            "z-50 flex w-[228px] shrink-0 flex-col border-r border-ink-200 bg-white",
            "fixed inset-y-0 left-0 transition-transform lg:sticky lg:top-0 lg:h-screen",
            // max-lg: so the off-canvas transform only exists below the
            // breakpoint. Pairing -translate-x-full with lg:translate-x-0 left
            // both utilities setting --tw-translate-x, and the desktop override
            // lost — the sidebar stayed off-screen at 1280px.
            !navOpen && "max-lg:-translate-x-full"
          )}
        >
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
                onClick={() => setNavOpen(false)}
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

        <main className="min-w-0 flex-1 pt-14 lg:pt-0">
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
    <div className="mx-auto flex max-w-[1240px] flex-col gap-4 px-4 py-5 sm:px-6 sm:py-6">
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
