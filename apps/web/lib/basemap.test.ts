import { afterEach, describe, expect, it, vi } from "vitest";
import { isEsriVectorTileStyle, resolveMapStyle } from "./basemap";

const STYLE_URL =
  "https://basemaps.arcgis.com/arcgis/rest/services/World_Basemap_v2/VectorTileServer/resources/styles/root.json";
const ROOT = "https://basemaps.arcgis.com/arcgis/rest/services/World_Basemap_v2/VectorTileServer/";

afterEach(() => vi.unstubAllGlobals());

describe("basemap styles", () => {
  it("recognizes ArcGIS vector tile styles", () => {
    expect(isEsriVectorTileStyle(STYLE_URL)).toBe(true);
    expect(isEsriVectorTileStyle("https://tiles.example.com/styles/light.json")).toBe(false);
  });

  it("passes other style URLs through unchanged", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await resolveMapStyle("https://tiles.example.com/styles/light.json")).toBe(
      "https://tiles.example.com/styles/light.json",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rewrites relative ArcGIS URLs to absolute ones MapLibre can load", async () => {
    const responses: Record<string, unknown> = {
      [STYLE_URL]: {
        version: 8,
        sources: { esri: { type: "vector", url: "../../" } },
        sprite: "../sprites/sprite",
        glyphs: "../fonts/{fontstack}/{range}.pbf",
        layers: [{ id: "background", type: "background" }],
      },
      [`${ROOT}?f=json`]: { maxLOD: 16, copyrightText: "Sources: Esri, TomTom" },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => new Response(JSON.stringify(responses[url]), { status: 200 })),
    );
    const style = await resolveMapStyle(STYLE_URL);
    expect(typeof style).toBe("object");
    if (typeof style === "string") return;
    expect(style.sources.esri).toEqual({
      type: "vector",
      tiles: [`${ROOT}tile/{z}/{y}/{x}.pbf`],
      maxzoom: 16,
      attribution: "Sources: Esri, TomTom",
    });
    expect(style.sprite).toBe(`${ROOT}resources/sprites/sprite`);
    expect(style.glyphs).toBe(`${ROOT}resources/fonts/{fontstack}/{range}.pbf`);
    expect(style.layers).toHaveLength(1);
  });

  it("fails loudly when the style cannot be fetched", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 503 })));
    await expect(resolveMapStyle(STYLE_URL)).rejects.toThrow("HTTP 503");
  });
});
