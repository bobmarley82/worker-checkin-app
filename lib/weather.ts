import type { Json } from "@/types/database";

type JobWeatherLocation = {
  location_address: string | null;
  location_city: string | null;
  location_zip: string | null;
};

export type DailyWeatherSnapshot = {
  fetched_at: string;
  latitude: number;
  longitude: number;
  location_label: string;
  location_query: string;
  max_temperature_f: number | null;
  min_temperature_f: number | null;
  precipitation_inches: number | null;
  report_date: string;
  source: "open-meteo";
  weather_code: number | null;
  weather_summary: string;
  wind_speed_max_mph: number | null;
};

type GeocodingResponse = {
  results?: Array<{
    latitude: number;
    longitude: number;
    name?: string;
    admin1?: string;
    country?: string;
  }>;
};

type WeatherApiResponse = {
  daily?: {
    precipitation_sum?: Array<number | null>;
    temperature_2m_max?: Array<number | null>;
    temperature_2m_min?: Array<number | null>;
    time?: string[];
    weather_code?: Array<number | null>;
    wind_speed_10m_max?: Array<number | null>;
  };
};

function cleanValue(value: string | null | undefined) {
  return value?.trim() ?? "";
}

export function hasWeatherLocation(location: JobWeatherLocation) {
  return Boolean(
    cleanValue(location.location_address) &&
      cleanValue(location.location_city) &&
      cleanValue(location.location_zip)
  );
}

export function buildWeatherLocationQuery(location: JobWeatherLocation) {
  const parts = [
    cleanValue(location.location_address),
    cleanValue(location.location_city),
    cleanValue(location.location_zip),
  ].filter(Boolean);

  return parts.join(", ");
}

export function buildWeatherLocationLabel(location: JobWeatherLocation) {
  const query = buildWeatherLocationQuery(location);
  return query;
}

function getWeatherSummary(code: number | null) {
  switch (code) {
    case 0:
      return "Clear sky";
    case 1:
      return "Mainly clear";
    case 2:
      return "Partly cloudy";
    case 3:
      return "Overcast";
    case 45:
    case 48:
      return "Fog";
    case 51:
    case 53:
    case 55:
      return "Drizzle";
    case 56:
    case 57:
      return "Freezing drizzle";
    case 61:
    case 63:
    case 65:
      return "Rain";
    case 66:
    case 67:
      return "Freezing rain";
    case 71:
    case 73:
    case 75:
      return "Snow";
    case 77:
      return "Snow grains";
    case 80:
    case 81:
    case 82:
      return "Rain showers";
    case 85:
    case 86:
      return "Snow showers";
    case 95:
      return "Thunderstorm";
    case 96:
    case 99:
      return "Thunderstorm with hail";
    default:
      return "Weather unavailable";
  }
}

function roundNumber(value: number | null | undefined) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return null;
  }

  return Math.round(value * 100) / 100;
}

function isFutureDate(reportDate: string) {
  const today = new Date();
  const todayYmd = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate())
  )
    .toISOString()
    .slice(0, 10);

  return reportDate > todayYmd;
}

async function geocodeLocation(query: string) {
  const searchParams = new URLSearchParams({
    count: "1",
    countryCode: "US",
    format: "json",
    language: "en",
    name: query,
  });

  const response = await fetch(
    `https://geocoding-api.open-meteo.com/v1/search?${searchParams.toString()}`,
    {
      cache: "no-store",
    }
  );

  if (!response.ok) {
    throw new Error("Could not geocode the job location.");
  }

  const data = (await response.json()) as GeocodingResponse;
  const result = data.results?.[0];

  if (!result) {
    throw new Error("No weather location match was found for this job.");
  }

  return result;
}

function buildGeocodingQueries(location: JobWeatherLocation) {
  const zip = cleanValue(location.location_zip);
  const city = cleanValue(location.location_city);
  const address = cleanValue(location.location_address);

  return [
    zip,
    [city, zip].filter(Boolean).join(" "),
    [address, city, zip].filter(Boolean).join(", "),
    city,
  ].filter((value, index, values) => Boolean(value) && values.indexOf(value) === index);
}

async function fetchWeatherSnapshot(
  latitude: number,
  longitude: number,
  reportDate: string
) {
  const searchParams = new URLSearchParams({
    daily:
      "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max",
    end_date: reportDate,
    latitude: latitude.toString(),
    longitude: longitude.toString(),
    precipitation_unit: "inch",
    start_date: reportDate,
    temperature_unit: "fahrenheit",
    timezone: "auto",
    wind_speed_unit: "mph",
  });

  const baseUrl = isFutureDate(reportDate)
    ? "https://api.open-meteo.com/v1/forecast"
    : "https://archive-api.open-meteo.com/v1/archive";

  const response = await fetch(`${baseUrl}?${searchParams.toString()}`, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Could not load weather data for this report date.");
  }

  const data = (await response.json()) as WeatherApiResponse;
  const daily = data.daily;

  if (!daily || !daily.time?.length) {
    throw new Error("Weather data was not returned for this report date.");
  }

  return {
    maxTemperatureF: roundNumber(daily.temperature_2m_max?.[0]),
    minTemperatureF: roundNumber(daily.temperature_2m_min?.[0]),
    precipitationInches: roundNumber(daily.precipitation_sum?.[0]),
    weatherCode:
      typeof daily.weather_code?.[0] === "number" ? daily.weather_code[0] : null,
    windSpeedMaxMph: roundNumber(daily.wind_speed_10m_max?.[0]),
  };
}

export async function getDailyWeatherForJob(
  location: JobWeatherLocation,
  reportDate: string
) {
  if (!hasWeatherLocation(location)) {
    return {
      error:
        "Add a full address, city, and ZIP code on the job page to collect weather for this report.",
      snapshot: null as DailyWeatherSnapshot | null,
    };
  }

  try {
    const locationQuery = buildWeatherLocationQuery(location);
    const geocodingQueries = buildGeocodingQueries(location);

    let geocoded: Awaited<ReturnType<typeof geocodeLocation>> | null = null;

    for (const query of geocodingQueries) {
      try {
        geocoded = await geocodeLocation(query);
        break;
      } catch {
      }
    }

    if (!geocoded) {
      throw new Error(
        "No weather location match was found for this job. Check the job city and ZIP code."
      );
    }

    const snapshot = await fetchWeatherSnapshot(
      geocoded.latitude,
      geocoded.longitude,
      reportDate
    );

    return {
      error: null,
      snapshot: {
        fetched_at: new Date().toISOString(),
        latitude: geocoded.latitude,
        longitude: geocoded.longitude,
        location_label:
          buildWeatherLocationLabel(location) ||
          [
            geocoded.name ?? "",
            geocoded.admin1 ?? "",
            geocoded.country ?? "",
          ]
            .filter(Boolean)
            .join(", "),
        location_query: locationQuery,
        max_temperature_f: snapshot.maxTemperatureF,
        min_temperature_f: snapshot.minTemperatureF,
        precipitation_inches: snapshot.precipitationInches,
        report_date: reportDate,
        source: "open-meteo",
        weather_code: snapshot.weatherCode,
        weather_summary: getWeatherSummary(snapshot.weatherCode),
        wind_speed_max_mph: snapshot.windSpeedMaxMph,
      } satisfies DailyWeatherSnapshot,
    };
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Weather could not be loaded right now.",
      snapshot: null as DailyWeatherSnapshot | null,
    };
  }
}

export function parseDailyWeatherSnapshot(value: Json | null | undefined) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null as DailyWeatherSnapshot | null;
  }

  const candidate = value as Record<string, unknown>;

  if (
    candidate.source !== "open-meteo" ||
    typeof candidate.report_date !== "string" ||
    typeof candidate.location_label !== "string" ||
    typeof candidate.location_query !== "string" ||
    typeof candidate.weather_summary !== "string" ||
    typeof candidate.fetched_at !== "string" ||
    typeof candidate.latitude !== "number" ||
    typeof candidate.longitude !== "number"
  ) {
    return null;
  }

  return {
    fetched_at: candidate.fetched_at,
    latitude: candidate.latitude,
    location_label: candidate.location_label,
    location_query: candidate.location_query,
    longitude: candidate.longitude,
    max_temperature_f:
      typeof candidate.max_temperature_f === "number"
        ? candidate.max_temperature_f
        : null,
    min_temperature_f:
      typeof candidate.min_temperature_f === "number"
        ? candidate.min_temperature_f
        : null,
    precipitation_inches:
      typeof candidate.precipitation_inches === "number"
        ? candidate.precipitation_inches
        : null,
    report_date: candidate.report_date,
    source: "open-meteo",
    weather_code:
      typeof candidate.weather_code === "number" ? candidate.weather_code : null,
    weather_summary: candidate.weather_summary,
    wind_speed_max_mph:
      typeof candidate.wind_speed_max_mph === "number"
        ? candidate.wind_speed_max_mph
        : null,
  };
}
