/**
 * Experiment switch for the compressed model copies in /public/models-opt/ (made by scripts/optimize-all-models.mjs).
 * The originals in /public/models/ are untouched; flip USE_OPTIMIZED_MODELS to false to go back to them.
 * Files that are not in the list below always load from /models/.
 */
export const USE_OPTIMIZED_MODELS = true;

const OPTIMIZED = new Set([
  "sf90.glb",
  "ferrari_f599.glb",
  "porsche_panamera.glb",
  "corvette_stingray.glb",
  "nissan_silvia_s15.glb",
  "examples/cyberpunk_sci_fi_building.glb",
  "examples/futuristic_low_poly_building.glb",
  "examples/modern_night_building.glb",
  "examples/game_ready_city_buildings.glb",
  "examples/realistic_chicago_buildings.glb",
  "examples/asian_themed_low_poly_night_city_buildings.glb",
  "examples/neon_row.glb",
  "examples/linkedin.glb",
  "examples/ricoh_printer.glb",
  "examples/low_poly_tire_fixed.glb",
  "examples/simple_collection_of_low_poly_street_lights.glb",
]);

/** "/models/foo.glb" -> "/models-opt/foo.glb" when an optimized copy exists and the switch is on. */
export function modelUrl(url: string): string {
  if (!USE_OPTIMIZED_MODELS || !url.startsWith("/models/")) return url;
  const rel = url.slice("/models/".length);
  return OPTIMIZED.has(rel) ? "/models-opt/" + rel : url;
}
