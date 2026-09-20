export type PlaceCandidate = {
  id: string;
  name: string;
  administrativeArea: string;
  country: string;
  latitude: number;
  longitude: number;
  timeZone: string;
};

export function formatPlace(candidate: PlaceCandidate): string {
  return `${candidate.name}, ${candidate.administrativeArea}, ${candidate.country}`;
}

export function isPlaceCandidate(value: unknown): value is PlaceCandidate {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.administrativeArea === "string" &&
    typeof candidate.country === "string" &&
    typeof candidate.latitude === "number" &&
    typeof candidate.longitude === "number" &&
    typeof candidate.timeZone === "string"
  );
}
