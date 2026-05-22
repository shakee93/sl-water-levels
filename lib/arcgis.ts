const SERVICES = "https://services3.arcgis.com/J7ZFXmR8rSmQ3FGf/arcgis/rest/services";

export type Station = {
  basin: string;
  station: string;
};

export type Reading = {
  ts: number;
  water_level: number | null;
  rain_fall: number | null;
};

export type StationData = {
  station: string;
  basin: string;
  thresholds: { alert: number | null; minor: number | null; major: number | null };
  readings: Reading[];
  latest: Reading | null;
};

async function arcgis<T>(path: string, params: Record<string, string>): Promise<T> {
  const url = new URL(`${SERVICES}/${path}`);
  url.searchParams.set("f", "json");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const r = await fetch(url.toString(), { next: { revalidate: 60 } });
  if (!r.ok) throw new Error(`ArcGIS ${path} -> ${r.status}`);
  return r.json();
}

export async function fetchStations(): Promise<Station[]> {
  const data = await arcgis<{ features: { attributes: Station }[] }>(
    "hydrostations/FeatureServer/0/query",
    {
      where: "1=1",
      outFields: "basin,station",
      returnGeometry: "false",
      orderByFields: "basin ASC, station ASC",
      resultRecordCount: "2000",
    },
  );
  const seen = new Set<string>();
  return data.features
    .map((f) => ({
      basin: (f.attributes.basin || "").trim(),
      station: (f.attributes.station || "").trim(),
    }))
    .filter((s) => {
      if (!s.station) return false;
      const k = `${s.basin}|${s.station}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
}

export async function fetchStationData(stationName: string, days = 4): Promise<StationData> {
  type Raw = {
    gauge: string;
    basin: string;
    water_level: number | null;
    rain_fall: number | null;
    CreationDate: number;
    alertpull: number | null;
    minorpull: number | null;
    majorpull: number | null;
  };

  const data = await arcgis<{ features: { attributes: Raw }[] }>(
    "gauges_2_view/FeatureServer/0/query",
    {
      where: `gauge='${stationName.replace(/'/g, "''")}'`,
      outFields: "gauge,basin,water_level,rain_fall,CreationDate,alertpull,minorpull,majorpull",
      orderByFields: "CreationDate DESC",
      resultRecordCount: "2000",
      returnGeometry: "false",
    },
  );

  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const rows = data.features
    .map((f) => f.attributes)
    .filter((a) => a.CreationDate >= cutoff)
    .sort((a, b) => a.CreationDate - b.CreationDate);

  const latestRaw = data.features[0]?.attributes ?? null;

  return {
    station: stationName,
    basin: latestRaw?.basin?.trim() ?? "",
    thresholds: {
      alert: latestRaw?.alertpull ?? null,
      minor: latestRaw?.minorpull ?? null,
      major: latestRaw?.majorpull ?? null,
    },
    readings: rows.map((a) => ({
      ts: a.CreationDate,
      water_level: a.water_level,
      rain_fall: a.rain_fall,
    })),
    latest: latestRaw
      ? { ts: latestRaw.CreationDate, water_level: latestRaw.water_level, rain_fall: latestRaw.rain_fall }
      : null,
  };
}

export function statusFor(level: number | null, t: StationData["thresholds"]) {
  if (level == null) return { label: "No data", tone: "neutral" as const };
  if (t.major != null && level >= t.major) return { label: "Major flood", tone: "red" as const };
  if (t.minor != null && level >= t.minor) return { label: "Minor flood", tone: "orange" as const };
  if (t.alert != null && level >= t.alert) return { label: "Alert", tone: "yellow" as const };
  return { label: "Normal", tone: "green" as const };
}
