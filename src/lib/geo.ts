// Geofence maths for camera check-in (Section 5). The server decides; the phone only sends data.

const EARTH_RADIUS_M = 6_371_008.8; // mean Earth radius

const rad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in metres between two lat/lng points (Haversine formula). */
export function haversineMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** A GPS fix worse than this is rejected (Section 5). */
export const MAX_GPS_ACCURACY_M = 100;
