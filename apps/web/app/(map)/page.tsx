import type { Metadata } from "next";
import { MapApp } from "@/components/map/map-app";

export const metadata: Metadata = {
  title: "Map",
  description: "Search places, look up addresses and plan routes in Mongolia.",
};

export default function MapPage() {
  return (
    <main id="main">
      <MapApp />
    </main>
  );
}
