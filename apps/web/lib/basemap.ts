import type { StyleSpecification } from "maplibre-gl";

/**
 * Basemap style loading.
 *
 * ArcGIS vector tile basemaps (…/VectorTileServer/resources/styles/root.json)
 * publish Mapbox-style JSON with URLs relative to the style file and a source
 * pointing at the VectorTileServer root rather than TileJSON. MapLibre cannot
 * load those directly, so they are fetched and rewritten to absolute URLs.
 * Any other style URL is handed to MapLibre unchanged.
 */

const ESRI_STYLE = /\/VectorTileServer\/resources\/styles\/[^/]+\.json(\?.*)?$/i;
const DEFAULT_ESRI_MAX_ZOOM = 16;
export const ESRI_ATTRIBUTION = "Powered by Esri";

type VectorTileServerInfo = { maxLOD?: number; copyrightText?: string };

export function isEsriVectorTileStyle(url: string): boolean {
  return ESRI_STYLE.test(url);
}

function absolute(relative: string, base: string): string {
  // Keep MapLibre placeholders such as {fontstack} unescaped.
  return decodeURI(new URL(relative, base).href);
}

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Basemap request failed (HTTP ${response.status})`);
  return (await response.json()) as T;
}

export async function loadEsriVectorTileStyle(styleUrl: string, signal?: AbortSignal): Promise<StyleSpecification> {
  const style = await fetchJson<StyleSpecification>(styleUrl, signal);
  const sources: StyleSpecification["sources"] = {};
  for (const [id, source] of Object.entries(style.sources)) {
    if (source.type === "vector" && "url" in source && typeof source.url === "string") {
      const root = absolute(source.url, styleUrl).replace(/\/?$/, "/");
      const info = await fetchJson<VectorTileServerInfo>(`${root}?f=json`, signal).catch(
        () => ({}) as VectorTileServerInfo,
      );
      const rest = { ...source };
      delete rest.url;
      sources[id] = {
        ...rest,
        tiles: [`${root}tile/{z}/{y}/{x}.pbf`],
        maxzoom: info.maxLOD ?? DEFAULT_ESRI_MAX_ZOOM,
        attribution: info.copyrightText,
      };
    } else {
      sources[id] = source;
    }
  }
  return {
    ...style,
    sources,
    sprite: typeof style.sprite === "string" ? absolute(style.sprite, styleUrl) : style.sprite,
    glyphs: style.glyphs ? absolute(style.glyphs, styleUrl) : style.glyphs,
  };
}

/** A style MapLibre can load: the URL itself, or a rewritten ArcGIS style. */
export async function resolveMapStyle(
  styleUrl: string,
  signal?: AbortSignal,
): Promise<string | StyleSpecification> {
  return isEsriVectorTileStyle(styleUrl) ? loadEsriVectorTileStyle(styleUrl, signal) : styleUrl;
}
