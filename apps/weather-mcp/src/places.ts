export type PlaceCandidate = {
  id: string;
  name: string;
  administrativeArea: string;
  country: string;
  latitude: number;
  longitude: number;
  timeZone: string;
};

const PLACE_CATALOG: PlaceCandidate[] = [
  {
    id: "cn-beijing",
    name: "北京市",
    administrativeArea: "北京市",
    country: "中国",
    latitude: 39.9042,
    longitude: 116.4074,
    timeZone: "Asia/Shanghai",
  },
  {
    id: "us-springfield-il",
    name: "Springfield",
    administrativeArea: "Illinois",
    country: "美国",
    latitude: 39.7817,
    longitude: -89.6501,
    timeZone: "America/Chicago",
  },
  {
    id: "us-springfield-ma",
    name: "Springfield",
    administrativeArea: "Massachusetts",
    country: "美国",
    latitude: 42.1015,
    longitude: -72.5898,
    timeZone: "America/New_York",
  },
];

export function resolvePlaces(query: string): PlaceCandidate[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();

  if (normalizedQuery === "北京" || normalizedQuery === "北京市") {
    return PLACE_CATALOG.filter((place) => place.id === "cn-beijing");
  }

  if (normalizedQuery === "springfield") {
    return PLACE_CATALOG.filter((place) => place.name.toLocaleLowerCase() === "springfield");
  }

  return PLACE_CATALOG.filter((place) =>
    `${place.name} ${place.administrativeArea} ${place.country}`
      .toLocaleLowerCase()
      .includes(normalizedQuery),
  );
}
