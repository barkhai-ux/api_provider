/** Example response bodies shown in the documentation. */

function json(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export const GEOCODE_RESPONSE = json({
  query: "Sukhbaatar",
  results: [
    {
      id: "loc_3f2a9c1d8e7b6a50",
      name: "Sukhbaatar District",
      address: "7-р хороо, Сүхбаатар, Mongolia",
      latitude: 47.92662,
      longitude: 106.929681,
      type: "poi",
    },
    {
      id: "loc_9b1e4d7c2a6f3e81",
      name: "Sukhbaatar District General Hospital",
      address: "11-р хороо, Сүхбаатар, Mongolia",
      latitude: 47.931345,
      longitude: 106.928361,
      type: "poi",
    },
  ],
  count: 2,
});

export const GEOCODE_EMPTY_RESPONSE = json({ query: "Nowhere Street", results: [], count: 0 });

export const REVERSE_GEOCODE_RESPONSE = json({
  location: { latitude: 47.9184, longitude: 106.9177 },
  address: {
    formatted: "Сүхбаатарын талбай, 6-р хороо, Сүхбаатар, Mongolia",
    name: "Сүхбаатарын талбай",
    house_number: null,
    street: null,
    neighborhood: "6-р хороо",
    district: "Сүхбаатар",
    city: null,
    country: "Mongolia",
  },
  match_type: "place",
  distance_meters: 49.1,
});

export const ROUTE_RESPONSE = json({
  route: {
    distance_meters: 4200,
    duration_seconds: 620,
    geometry: {
      type: "LineString",
      coordinates: [
        [106.9177, 47.9184],
        [106.9176, 47.918],
        [106.911, 47.918],
        [106.9057, 47.918],
        [106.9057, 47.922],
      ],
    },
  },
  mode: "driving",
  waypoints: [
    {
      input: { latitude: 47.9184, longitude: 106.9177 },
      location: { latitude: 47.9184, longitude: 106.9176 },
      snap_distance_meters: 7.6,
      name: "Chingis Avenue",
    },
    {
      input: { latitude: 47.922, longitude: 106.9057 },
      location: { latitude: 47.922, longitude: 106.9057 },
      snap_distance_meters: 0.4,
      name: "Seoul Street",
    },
  ],
});

export function errorBody(code: string, message: string, details?: Record<string, unknown>): string {
  return json({ error: details ? { code, message, details } : { code, message } });
}
