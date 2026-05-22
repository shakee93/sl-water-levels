const SERVICES = "https://services3.arcgis.com/J7ZFXmR8rSmQ3FGf/arcgis/rest/services";

export type Station = {
  basin: string;
  station: string;
  latitude: number;
  longitude: number;
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
      outFields: "basin,station,latitude,longitude",
      returnGeometry: "false",
      orderByFields: "basin ASC, station ASC",
      resultRecordCount: "2000",
    },
  );
  const seen = new Set<string>();
  type Raw = { basin?: string; station?: string; latitude?: number; longitude?: number };
  return (data.features as { attributes: Raw }[])
    .map((f) => ({
      basin: (f.attributes.basin || "").trim(),
      station: (f.attributes.station || "").trim(),
      latitude: Number(f.attributes.latitude),
      longitude: Number(f.attributes.longitude),
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

export type BasinStation = {
  station: string;
  basin: string;
  latitude: number;
  longitude: number;
  latest: Reading | null;
  prior: Reading | null;
  thresholds: { alert: number | null; minor: number | null; major: number | null };
  trend24h: Reading[];
};

export async function fetchBasinSnapshot(basinName: string): Promise<BasinStation[]> {
  const stationsRes = await arcgis<{
    features: { attributes: { station: string; basin: string; latitude: number; longitude: number } }[];
  }>("hydrostations/FeatureServer/0/query", {
    where: `basin LIKE '${basinName.replace(/'/g, "''")}%'`,
    outFields: "station,basin,latitude,longitude",
    returnGeometry: "false",
    resultRecordCount: "200",
  });

  const stationList = stationsRes.features
    .map((f) => ({
      station: (f.attributes.station || "").trim(),
      basin: (f.attributes.basin || "").trim(),
      latitude: f.attributes.latitude,
      longitude: f.attributes.longitude,
    }))
    .filter((s) => s.station);

  if (stationList.length === 0) return [];

  const inList = stationList
    .map((s) => `'${s.station.replace(/'/g, "''")}'`)
    .join(",");

  type Raw = {
    gauge: string;
    water_level: number | null;
    rain_fall: number | null;
    CreationDate: number;
    alertpull: number | null;
    minorpull: number | null;
    majorpull: number | null;
  };

  const readingsRes = await arcgis<{ features: { attributes: Raw }[] }>(
    "gauges_2_view/FeatureServer/0/query",
    {
      where: `gauge IN (${inList})`,
      outFields: "gauge,water_level,rain_fall,CreationDate,alertpull,minorpull,majorpull",
      orderByFields: "CreationDate DESC",
      resultRecordCount: "4000",
      returnGeometry: "false",
    },
  );

  const cutoff24h = Date.now() - 24 * 60 * 60 * 1000;
  const cutoff3hLow = Date.now() - 4 * 60 * 60 * 1000;
  const cutoff3hHigh = Date.now() - 2 * 60 * 60 * 1000;

  const byStation = new Map<string, Raw[]>();
  for (const f of readingsRes.features) {
    const k = f.attributes.gauge;
    if (!byStation.has(k)) byStation.set(k, []);
    byStation.get(k)!.push(f.attributes);
  }

  return stationList.map((s) => {
    const rows = byStation.get(s.station) ?? [];
    const sorted24 = rows.filter((r) => r.CreationDate >= cutoff24h).sort((a, b) => a.CreationDate - b.CreationDate);
    const latest = rows[0] ?? null;
    const prior = rows.find((r) => r.CreationDate >= cutoff3hLow && r.CreationDate <= cutoff3hHigh) ?? null;

    return {
      station: s.station,
      basin: s.basin,
      latitude: s.latitude,
      longitude: s.longitude,
      latest: latest
        ? { ts: latest.CreationDate, water_level: latest.water_level, rain_fall: latest.rain_fall }
        : null,
      prior: prior
        ? { ts: prior.CreationDate, water_level: prior.water_level, rain_fall: prior.rain_fall }
        : null,
      thresholds: {
        alert: latest?.alertpull ?? null,
        minor: latest?.minorpull ?? null,
        major: latest?.majorpull ?? null,
      },
      trend24h: sorted24.map((r) => ({
        ts: r.CreationDate,
        water_level: r.water_level,
        rain_fall: r.rain_fall,
      })),
    };
  });
}

export function statusFor(level: number | null, t: StationData["thresholds"]) {
  if (level == null) return { label: "No data", tone: "neutral" as const };
  if (t.major != null && level >= t.major) return { label: "Major flood", tone: "red" as const };
  if (t.minor != null && level >= t.minor) return { label: "Minor flood", tone: "orange" as const };
  if (t.alert != null && level >= t.alert) return { label: "Alert", tone: "yellow" as const };
  return { label: "Normal", tone: "green" as const };
}
