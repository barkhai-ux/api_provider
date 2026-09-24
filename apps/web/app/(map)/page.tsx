import type { Metadata } from "next";
import { MapApp } from "@/components/map/map-app";
import { SiteHeader } from "@/components/site/site-header";

export const metadata: Metadata = {
  title: "Map",
  description: "Search places, look up addresses and plan routes in Mongolia.",
};

export default function MapPage() {
  return (
    <div className="flex h-dvh flex-col">
      <SiteHeader />
      <main id="main" className="relative min-h-0 flex-1">
        <MapApp />
      </main>
    </div>
  );
}
