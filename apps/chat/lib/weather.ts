import { isPlaceCandidate, type PlaceCandidate } from "./place";

export type WeatherFact = {
  place: PlaceCandidate;
  dataTime: string;
  dataTimeSource: "provider" | "retrieved";
  timeZone: string;
  temperatureC: number;
  feelsLikeC: number;
  condition: string;
  precipitationProbability?: number;
  precipitationMm?: number;
  precipitationType?: string;
  windDirection?: string;
  windSpeedMps?: number;
  source: string;
};

function isOptionalNumber(value: unknown): value is number | undefined {
  return value === undefined || typeof value === "number";
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === "string";
}

export function isWeatherFact(value: unknown): value is WeatherFact {
  if (!value || typeof value !== "object") {
    return false;
  }

  const fact = value as Partial<WeatherFact>;
  return (
    isPlaceCandidate(fact.place) &&
    typeof fact.dataTime === "string" &&
    (fact.dataTimeSource === "provider" || fact.dataTimeSource === "retrieved") &&
    typeof fact.timeZone === "string" &&
    typeof fact.temperatureC === "number" &&
    typeof fact.feelsLikeC === "number" &&
    typeof fact.condition === "string" &&
    isOptionalNumber(fact.precipitationProbability) &&
    isOptionalNumber(fact.precipitationMm) &&
    isOptionalString(fact.precipitationType) &&
    isOptionalString(fact.windDirection) &&
    isOptionalNumber(fact.windSpeedMps) &&
    typeof fact.source === "string"
  );
}
