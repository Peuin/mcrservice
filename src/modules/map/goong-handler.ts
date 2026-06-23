// @ts-nocheck
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { env } from "../../config/env.js";
import { type PortedRequest } from "../../shared/handler-runtime.js";

type Json = Record<string, unknown>;

function runBackgroundTask(task: Promise<unknown>) {
  void task.catch((error) => console.error("[goong-place-search] background task failed", error));
}

  
  // Goong Place API (Supabase secrets only — không dùng cho bản đồ):
  //   GOONG_PLACE_API_KEY (hoặc GOONG_API_KEY)
  // Goong Map tiles — chỉ trong Flutter `.env`:
  //   GOONG_MAP_API_KEY (hoặc GOONG_MAP_TILE_KEY)

  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  };

  type Json = Record<string, unknown>;

  type PlaceRow = {
    id: string;
    name: string;
    address: string | null;
    category?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    lat?: number | null;
    lng?: number | null;
    vietmap_ref_id?: string | null;
    provider?: string | null;
  };

  

  function createSupabaseClient() {
    const supabaseUrl = env.SUPABASE_URL;
    const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY ||
      env.SUPABASE_SECRET_KEY;

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error("Thiếu SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY.");
    }

    return createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  async function fetchExpandedSuggestions({
    apiKey,
    queries,
    limit,
    nearLat,
    nearLng,
  }: {
    apiKey: string;
    queries: string[];
    limit: number;
    nearLat: number | null;
    nearLng: number | null;
  }) {
    const seenRefIds = new Set<string>();
    const mergedSuggestions: Json[] = [];

    for (const query of queries) {
      if (mergedSuggestions.length >= limit) break;

      const autocompleteItems = await fetchSuggestions({
        apiKey,
        query,
        limit,
        nearLat,
        nearLng,
      }).catch(() => []);

      for (const item of autocompleteItems) {
        const key = suggestionDedupeKey(item);
        if (key && !seenRefIds.has(key)) {
          seenRefIds.add(key);
          mergedSuggestions.push(item);
        }
        if (mergedSuggestions.length >= limit) break;
      }
    }

    return mergedSuggestions;
  }

  function getGoongPlaceKey() {
    return stringValue(
      env.GOONG_PLACE_API_KEY ?? env.GOONG_API_KEY,
    ) || null;
  }

  function isClientError(message: string) {
    const text = message.toLowerCase();
    return text.includes("thiếu") && text.includes("supabase");
  }

  async function safeSearchLocalPlaces(
    supabase: ReturnType<typeof createSupabaseClient>,
    query: string,
    limit: number,
    nearLat: number | null = null,
    nearLng: number | null = null,
  ) {
    try {
      return {
        places: await searchLocalPlaces(supabase, query, limit, nearLat, nearLng),
        error: null,
      };
    } catch (error) {
      const message = errorMessage(error);
      console.error("goong-place-search local DB failed", message);
      return { places: [] as PlaceRow[], error: message };
    }
  }

  async function searchLocalPlaces(
    supabase: ReturnType<typeof createSupabaseClient>,
    query: string,
    limit: number,
    nearLat: number | null = null,
    nearLng: number | null = null,
  ) {
    const rpcResult = await supabase.schema("core").rpc("search_places", {
      p_query: query,
      p_limit: hasValidNear(nearLat, nearLng) ? Math.max(limit * 4, 40) : limit,
    });
    if (!rpcResult.error) {
      return rankLocalPlaces(normalizePlaceRows(rpcResult.data), nearLat, nearLng)
        .slice(0, limit);
    }
    console.error("search_places rpc failed, fallback to ilike", rpcResult.error);

    const selectColumns =
      "id,name,address,lat,lng,latitude,longitude,category,vietmap_ref_id,provider";
    const fallbackColumns = "id,name,address";
    const localLimit = hasValidNear(nearLat, nearLng)
      ? Math.max(limit * 4, 40)
      : limit;

    if (!query) {
      const result = await supabase
        .schema("core")
        .from("places")
        .select(selectColumns)
        .order("updated_at", { ascending: false })
        .limit(localLimit);
      if (result.error && isMissingColumnError(result.error)) {
        const fallback = await supabase
          .schema("core")
          .from("places")
          .select(fallbackColumns)
          .order("name", { ascending: true })
          .limit(localLimit);
        if (fallback.error) throw fallback.error;
        return rankLocalPlaces(normalizePlaceRows(fallback.data), nearLat, nearLng)
          .slice(0, limit);
      }
      const { data, error } = result;
      if (error) throw error;
      return rankLocalPlaces(normalizePlaceRows(data), nearLat, nearLng)
        .slice(0, limit);
    }

    const pattern = `%${query.replace(/[(),]/g, " ").trim()}%`;
    const result = await supabase
      .schema("core")
      .from("places")
      .select(selectColumns)
      .or(`name.ilike.${pattern},address.ilike.${pattern}`)
      .order("updated_at", { ascending: false })
      .limit(localLimit);
    if (result.error && isMissingColumnError(result.error)) {
      const fallback = await supabase
        .schema("core")
        .from("places")
        .select(fallbackColumns)
        .or(`name.ilike.${pattern},address.ilike.${pattern}`)
        .order("name", { ascending: true })
        .limit(localLimit);
      if (fallback.error) throw fallback.error;
      return rankLocalPlaces(normalizePlaceRows(fallback.data), nearLat, nearLng)
        .slice(0, limit);
    }

    const { data, error } = result;
    if (error) throw error;
    return rankLocalPlaces(normalizePlaceRows(data), nearLat, nearLng)
      .slice(0, limit);
  }

  async function searchNearbyLocalPlaces(
    supabase: ReturnType<typeof createSupabaseClient>,
    nearLat: number,
    nearLng: number,
    limit: number,
  ) {
    const selectColumns =
      "id,name,address,lat,lng,latitude,longitude,category,vietmap_ref_id,provider";
    const { data, error } = await supabase
      .schema("core")
      .from("places")
      .select(selectColumns)
      .not("latitude", "is", null)
      .not("longitude", "is", null)
      .limit(Math.max(limit * 4, 40));

    if (error) {
      console.error("nearby local places failed", error);
      return [] as PlaceRow[];
    }

    return normalizePlaceRows(data)
      .filter(hasPlaceCoordinates)
      .map((place) => ({
        place,
        distance: distanceKm(
          nearLat,
          nearLng,
          numberValue(place.latitude ?? place.lat) ?? nearLat,
          numberValue(place.longitude ?? place.lng) ?? nearLng,
        ),
      }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, limit)
      .map((item) => item.place);
  }

  function rankLocalPlaces(
    places: PlaceRow[],
    nearLat: number | null,
    nearLng: number | null,
  ) {
    if (!hasValidNear(nearLat, nearLng)) {
      return places;
    }

    return [...places].sort((a, b) => {
      const aDistance = placeDistanceKm(a, nearLat!, nearLng!);
      const bDistance = placeDistanceKm(b, nearLat!, nearLng!);
      return aDistance - bDistance;
    });
  }

  function placeDistanceKm(place: PlaceRow, nearLat: number, nearLng: number) {
    const lat = numberValue(place.latitude ?? place.lat);
    const lng = numberValue(place.longitude ?? place.lng);
    if (!isValidCoordinatePair(lat, lng)) {
      return Number.POSITIVE_INFINITY;
    }
    return distanceKm(nearLat, nearLng, lat, lng);
  }

  async function saveReversePlace(
    supabase: ReturnType<typeof createSupabaseClient>,
    item: Json,
    nearLat: number,
    nearLng: number,
  ) {
    const refId = stringValue(item.ref_id ?? item.refId ?? item.refid);
    const fallbackName = firstString(item.name, item.display, item.address);
    const fallbackAddress = firstString(item.address, item.display) || "Việt Nam";

    if (!fallbackName) return null;

    const coords = extractCoordinates(item);
    const lat = coords.lat ?? nearLat;
    const lng = coords.lng ?? nearLng;

    if (!isValidCoordinatePair(lat, lng)) {
      return null; // Enforce: All places inserted into DB must have coordinates!
    }

    return await upsertPlace(supabase, {
      name: fallbackName,
      address: fallbackAddress,
      lat,
      lng,
      refId: refId || generatedRefId(fallbackName, fallbackAddress, lat, lng),
      category: "other",
    });
  }

  async function saveNearbyPlace(
    supabase: ReturnType<typeof createSupabaseClient>,
    goongKey: string,
    item: Json,
    nearLat: number,
    nearLng: number,
  ) {
    const saved = await saveSuggestedPlace(supabase, goongKey, item, "nearby");
    if (saved) return saved;
    return await saveReversePlace(supabase, item, nearLat, nearLng);
  }

  async function saveSuggestedPlace(
    supabase: ReturnType<typeof createSupabaseClient>,
    goongKey: string,
    suggestion: Json,
    category = "other",
  ) {
    const refId = stringValue(
      suggestion.place_id ??
        suggestion.ref_id ??
        suggestion.refId ??
        suggestion.refid,
    );
    const fallbackName = firstString(
      suggestion.name,
      suggestion.display,
      suggestion.address,
    );
    const fallbackAddress = firstString(
      suggestion.address,
      suggestion.display,
    ) || "Việt Nam";

    if (!fallbackName) return null;

    // Check if coordinates already exist in suggestion, bypassing place detail fetch!
    const sugCoords = extractCoordinates(suggestion);
    const hasCoords = isValidCoordinatePair(sugCoords.lat, sugCoords.lng);
    const detail = (refId && !hasCoords)
      ? await fetchPlaceDetail(goongKey, refId)
      : {};

    const detailCoords = extractCoordinates(detail);
    const lat = detailCoords.lat ?? sugCoords.lat;
    const lng = detailCoords.lng ?? sugCoords.lng;

    if (!isValidCoordinatePair(lat, lng)) {
      return null; // Enforce: All places inserted into DB must have coordinates!
    }

    return await upsertPlace(supabase, {
      name: firstString(detail.name, detail.display, fallbackName),
      address: displayAddress(detail, fallbackAddress),
      lat,
      lng,
      refId: refId || generatedRefId(fallbackName, fallbackAddress, lat, lng),
      category,
    });
  }

  function suggestionDedupeKey(item: Json) {
    const refId = stringValue(
      item.place_id ?? item.ref_id ?? item.refId ?? item.refid,
    );
    if (refId) return `ref:${refId}`;

    const name = firstString(item.name, item.display, item.address);
    if (!name) return "";

    const address = firstString(item.address, item.display);
    const coords = extractCoordinates(item);
    return generatedRefId(name, address, coords.lat, coords.lng);
  }

  async function fetchNearbyPlaces({
    apiKey,
    lat,
    lng,
    limit,
  }: {
    apiKey: string;
    lat: number;
    lng: number;
    limit: number;
  }) {
    const queries = [
      "quán ăn",
      "nhà hàng",
      "cà phê",
      "trà sữa",
      "bánh mì",
      "phở",
    ];
    const seen = new Set<string>();
    const merged: Json[] = [];

    for (const query of queries) {
      if (merged.length >= limit) break;
      const items = await fetchSuggestions({
        apiKey,
        query,
        limit,
        nearLat: lat,
        nearLng: lng,
      });
      for (const item of items) {
        const key = suggestionDedupeKey(item);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        merged.push(item);
        if (merged.length >= limit) break;
      }
    }

    return merged;
  }

  async function fetchSuggestions({
    apiKey,
    query,
    limit,
    nearLat,
    nearLng,
  }: {
    apiKey: string;
    query: string;
    limit: number;
    nearLat: number | null;
    nearLng: number | null;
  }) {
    const url = new URL("https://rsapi.goong.io/Place/AutoComplete");
    url.searchParams.set("api_key", apiKey);
    url.searchParams.set("input", query);

    if (nearLat != null && nearLng != null) {
      url.searchParams.set("location", `${nearLat},${nearLng}`);
    }

    const response = await fetch(url);
    if (!response.ok) {
      console.error("Goong autocomplete failed", response.status);
      return [];
    }

    const payload = await response.json().catch(() => ({}));
    const predictions = Array.isArray(payload.predictions)
      ? payload.predictions
      : [];

    return predictions
      .slice(0, limit)
      .map((item) => normalizeGoongPrediction(item as Json))
      .filter((item) => stringValue(item.name) || stringValue(item.display));
  }

  function normalizeGoongPrediction(item: Json) {
    const structured = item.structured_formatting;
    const formatting = structured && typeof structured === "object"
      ? structured as Json
      : {};
    const mainText = firstString(formatting.main_text, item.name);
    const secondaryText = firstString(
      formatting.secondary_text,
      item.address,
      item.description,
    );
    const placeId = stringValue(item.place_id ?? item.reference);
    return {
      place_id: placeId,
      ref_id: placeId,
      name: mainText,
      address: secondaryText,
      display: firstString(item.description, mainText, secondaryText),
    } as Json;
  }

  async function fetchPlaceDetail(apiKey: string, placeId: string) {
    const url = new URL("https://rsapi.goong.io/place/detail");
    url.searchParams.set("api_key", apiKey);
    url.searchParams.set("place_id", placeId);

    const response = await fetch(url);
    if (!response.ok) {
      console.error("Goong place detail failed", response.status, placeId);
      return {};
    }

    const payload = await response.json().catch(() => ({}));
    const result = payload.result && typeof payload.result === "object"
      ? payload.result as Json
      : payload as Json;
    return {
      name: firstString(result.name, result.formatted_address),
      address: firstString(result.formatted_address, result.vicinity),
      display: firstString(result.formatted_address, result.name),
      geometry: result.geometry,
    } as Json;
  }

  async function upsertPlace(
    supabase: ReturnType<typeof createSupabaseClient>,
    place: {
      name: string;
      address: string;
      lat: number | null;
      lng: number | null;
      refId: string;
      category: string;
    },
  ) {
    if (!isValidCoordinatePair(place.lat, place.lng)) {
      return null;
    }

    return await upsertBasicPlace(supabase, place);
  }

  async function upsertBasicPlace(
    supabase: ReturnType<typeof createSupabaseClient>,
    place: {
      name: string;
      address: string;
      lat?: number | null;
      lng?: number | null;
      refId?: string | null;
      category?: string | null;
    },
  ) {
    const name = stringValue(place.name);
    const address = stringValue(place.address);
    const refId = stringValue(place.refId);
    if (!name) return null;

    const selectColumns =
      "id,name,address,lat,lng,latitude,longitude,vietmap_ref_id,provider,category";
    const existing = refId
      ? await supabase
        .schema("core")
        .from("places")
        .select(selectColumns)
        .eq("vietmap_ref_id", refId)
        .maybeSingle()
      : await supabase
        .schema("core")
        .from("places")
        .select(selectColumns)
        .eq("name", name)
        .eq("address", address || "Việt Nam")
        .maybeSingle();
    if (existing.error) {
      console.error("find basic place failed", existing.error);
    }
    if (existing.data) {
      await updateBasicPlace(supabase, stringValue(existing.data.id), place);
      return await fetchPlaceById(supabase, stringValue(existing.data.id));
    }

    const insertRow = fullPlacePayload(place);
    const created = await supabase.schema("core").from("places").insert(insertRow)
      .select(selectColumns)
      .single();
    if (created.error) {
      console.error("insert basic place failed", created.error);
      const basic = await supabase
        .schema("core")
        .from("places")
        .insert({ name, address: address || null })
        .select("id,name,address")
        .single();
      if (basic.error) {
        console.error("insert minimal place failed", basic.error);
        return null;
      }
      return normalizePlaceRows([basic.data])[0] ?? null;
    }

    return normalizePlaceRows([created.data])[0] ?? null;
  }

  async function fetchPlaceById(
    supabase: ReturnType<typeof createSupabaseClient>,
    placeId: string,
  ) {
    if (!placeId) return null;
    const { data, error } = await supabase
      .schema("core")
      .from("places")
      .select("id,name,address,lat,lng,latitude,longitude,vietmap_ref_id,provider,category")
      .eq("id", placeId)
      .maybeSingle();
    if (error) {
      console.error("fetch place by id failed", error);
      return null;
    }
    return normalizePlaceRows(data ? [data] : [])[0] ?? null;
  }

  async function updateBasicPlace(
    supabase: ReturnType<typeof createSupabaseClient>,
    placeId: string,
    place: {
      name: string;
      address: string;
      lat?: number | null;
      lng?: number | null;
      refId?: string | null;
      category?: string | null;
    },
  ) {
    const payload = fullPlacePayload(place);
    const { error } = await supabase
      .schema("core")
      .from("places")
      .update(payload)
      .eq("id", placeId);
    if (error) {
      console.error("update basic place failed", error);
    }
  }

  function fullPlacePayload(place: {
    name: string;
    address: string;
    lat?: number | null;
    lng?: number | null;
    refId?: string | null;
    category?: string | null;
  }) {
    const lat = numberValue(place.lat);
    const lng = numberValue(place.lng);
    const payload: Json = {
      name: stringValue(place.name),
      address: stringValue(place.address) || "Việt Nam",
      lat,
      lng,
      latitude: lat,
      longitude: lng,
      vietmap_ref_id: stringValue(place.refId) || null,
      provider: "goong",
      category: stringValue(place.category) || "other",
    };
    if (isValidCoordinatePair(lat, lng)) {
      payload.location = `SRID=4326;POINT(${lng} ${lat})`;
    }
    return payload;
  }

  function normalizePlaceRows(data: unknown) {
    if (!Array.isArray(data)) return [];
    return data.map((row) => {
      const item = row as Json;
      return {
        id: stringValue(item.id),
        name: stringValue(item.name),
        address: stringValue(item.address) || null,
        category: stringValue(item.category) || null,
        latitude: numberValue(item.latitude ?? item.lat),
        longitude: numberValue(item.longitude ?? item.lng),
        lat: numberValue(item.lat ?? item.latitude),
        lng: numberValue(item.lng ?? item.longitude),
        vietmap_ref_id: stringValue(item.vietmap_ref_id) || null,
        provider: stringValue(item.provider) || null,
      };
    }).filter((place) => place.id && place.name) as PlaceRow[];
  }

  function hasPlaceCoordinates(place: PlaceRow) {
    return isValidCoordinatePair(
      numberValue(place.latitude ?? place.lat),
      numberValue(place.longitude ?? place.lng),
    );
  }

  function isMissingColumnError(error: unknown) {
    const text = errorMessage(error).toLowerCase();
    return text.includes("column") && text.includes("does not exist");
  }

  function displayAddress(detail: Json, fallback: string) {
    const display = stringValue(detail.display);
    if (display) return display;

    const parts = [
      stringValue(detail.address),
      stringValue(detail.ward),
      stringValue(detail.district),
      stringValue(detail.city ?? detail.province),
    ].filter(Boolean);

    const address = parts.length > 0 ? parts.join(", ") : fallback;
    return address.trim() || "Việt Nam";
  }

  function expandPlaceSearchQueries(query: string) {
    const normalized = query.replace(/\s+/g, " ").trim();
    if (!normalized) return [];

    const tokens = normalized
      .split(" ")
      .map((token) => token.trim())
      .filter((token) => token.length >= 2);
    const variants = [
      normalized,
      removeVietnameseTone(normalized),
    ];

    if (tokens.length > 1) {
      variants.push(...tokens);
      for (let size = Math.min(3, tokens.length); size >= 2; size--) {
        for (let index = 0; index <= tokens.length - size; index++) {
          variants.push(tokens.slice(index, index + size).join(" "));
        }
      }
    }

    return uniqueStrings(variants)
      .filter((item) => item.length >= 2)
      .slice(0, 10);
  }

  function removeVietnameseTone(value: string) {
    return value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/đ/g, "d")
      .replace(/Đ/g, "D");
  }

  function uniqueStrings(values: string[]) {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const value of values) {
      const normalized = value.replace(/\s+/g, " ").trim();
      const key = removeVietnameseTone(normalized).toLowerCase();
      if (normalized && !seen.has(key)) {
        seen.add(key);
        result.push(normalized);
      }
    }
    return result;
  }

  function placeCacheKey(
    queries: string[],
    limit: number,
    lat: number | null,
    lng: number | null,
  ) {
    const near = lat == null || lng == null
      ? "none"
      : `${lat.toFixed(4)},${lng.toFixed(4)}`;
    return `goong:place:v1:${queries.join("|").toLowerCase()}:${limit}:${near}`;
  }

  function generatedRefId(
    name: string,
    address: string,
    lat: number | null,
    lng: number | null,
  ) {
    const key = [
      name,
      address,
      lat == null ? "" : lat.toFixed(7),
      lng == null ? "" : lng.toFixed(7),
    ]
      .join("|")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9|.-]+/g, "-")
      .replace(/^-+|-+$/g, "");
    return `auto:${key || randomUUID()}`;
  }

  async function getCachedPlaces(key: string) {
    const cached = await redisCommand(["GET", key]);
    const value = cached?.result;
    if (typeof value !== "string" || !value) return null;

    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed as PlaceRow[] : null;
    } catch {
      return null;
    }
  }

  async function setCachedPlaces(key: string, places: PlaceRow[]) {
    await redisCommand(["SET", key, JSON.stringify(places), "EX", 86400]);
  }

  async function mapWithConcurrency<T>(
    items: T[],
    concurrency: number,
    mapper: (item: T) => Promise<PlaceRow | null>,
  ) {
    const results: Array<PlaceRow | null> = Array(items.length).fill(null);
    let nextIndex = 0;
    const workerCount = Math.min(Math.max(concurrency, 1), items.length);

    async function worker() {
      while (nextIndex < items.length) {
        const index = nextIndex++;
        const item = items[index];
        const result = await mapper(item);
        if (result) {
          results[index] = result;
        }
      }
    }

    await Promise.all(Array.from({ length: workerCount }, worker));
    return results.filter((place): place is PlaceRow => place != null);
  }

  async function redisCommand(command: unknown[]) {
    const redisUrl = env.UPSTASH_REDIS_REST_URL;
    const redisToken = env.UPSTASH_REDIS_REST_TOKEN;
    if (!redisUrl || !redisToken) return null;

    const response = await fetch(redisUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${redisToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(command),
    });

    if (!response.ok) return null;
    return await response.json().catch(() => null);
  }

  function jsonResponse(body: unknown, status = 200) {
    return Response.json(body, { status, headers: corsHeaders });
  }

  function stringValue(value: unknown) {
    return String(value ?? "").trim();
  }

  function firstString(...values: unknown[]) {
    for (const value of values) {
      const text = stringValue(value);
      if (text) return text;
    }
    return "";
  }

  function numberValue(value: unknown) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (value == null) return null;
    const text = String(value).trim();
    if (!text || text.toLowerCase() === "null" || text.toLowerCase() === "undefined") {
      return null;
    }
    const parsed = Number(text);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function isValidCoordinatePair(
    lat: number | null | undefined,
    lng: number | null | undefined,
  ) {
    if (lat == null || lng == null) return false;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
    if (lat === 0 && lng === 0) return false;
    return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
  }

  function hasValidNear(
    lat: number | null | undefined,
    lng: number | null | undefined,
  ) {
    return isValidCoordinatePair(lat, lng);
  }

  function distanceKm(
    fromLat: number,
    fromLng: number,
    toLat: number,
    toLng: number,
  ) {
    const earthRadiusKm = 6371;
    const dLat = degreesToRadians(toLat - fromLat);
    const dLng = degreesToRadians(toLng - fromLng);
    const lat1 = degreesToRadians(fromLat);
    const lat2 = degreesToRadians(toLat);
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 2 * earthRadiusKm * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function degreesToRadians(value: number) {
    return value * Math.PI / 180;
  }

  function booleanValue(value: unknown) {
    if (typeof value === "boolean") return value;
    return ["1", "true", "yes"].includes(String(value ?? "").toLowerCase());
  }

  function clamp(value: number, min: number, max: number) {
    return Math.max(min, Math.min(max, value));
  }

  function errorMessage(error: unknown) {
    if (error instanceof Error) return error.message;
    if (error && typeof error === "object") {
      const data = error as Json;
      const message = firstString(data.message, data.error, data.details, data.hint);
      if (message) return message;
      try {
        return JSON.stringify(error);
      } catch {
        return String(error);
      }
    }
    return String(error);
  }

  async function fetchReverseGeocode({
    apiKey,
    lat,
    lng,
  }: {
    apiKey: string;
    lat: number;
    lng: number;
  }) {
    const url = new URL("https://rsapi.goong.io/Geocode");
    url.searchParams.set("api_key", apiKey);
    url.searchParams.set("latlng", `${lat},${lng}`);

    const response = await fetch(url);
    if (!response.ok) {
      console.error("Goong reverse geocoding failed", response.status, lat, lng);
      return [];
    }

    const payload = await response.json().catch(() => ({}));
    const results = Array.isArray(payload.results) ? payload.results : [];
    return results.map((item) => {
      const row = item as Json;
      const placeId = stringValue(row.place_id);
      return {
        place_id: placeId,
        ref_id: placeId,
        name: firstString(row.formatted_address, row.name),
        address: firstString(row.formatted_address),
        display: firstString(row.formatted_address),
        geometry: row.geometry,
      } as Json;
    });
  }

  function extractCoordinates(obj: Json | null | undefined): { lat: number | null; lng: number | null } {
    if (!obj) return { lat: null, lng: null };

    // 1. Direct fields
    let lat = numberValue(obj.lat ?? obj.latitude);
    let lng = numberValue(obj.lng ?? obj.longitude);
    if (lat != null && lng != null) {
      return { lat, lng };
    }

    // 2. Under 'location' object
    if (obj.location && typeof obj.location === "object") {
      const loc = obj.location as Json;
      lat = numberValue(loc.lat ?? loc.latitude);
      lng = numberValue(loc.lng ?? loc.longitude);
      if (lat != null && lng != null) {
        return { lat, lng };
      }
    }

    // 3. Under 'geometry' object
    if (obj.geometry && typeof obj.geometry === "object") {
      const geom = obj.geometry as Json;
      // geometry.location
      if (geom.location && typeof geom.location === "object") {
        const loc = geom.location as Json;
        lat = numberValue(loc.lat ?? loc.latitude);
        lng = numberValue(loc.lng ?? loc.longitude);
        if (lat != null && lng != null) {
          return { lat, lng };
        }
      }
      // geometry.coordinates (GeoJSON format: [lng, lat])
      if (Array.isArray(geom.coordinates) && geom.coordinates.length >= 2) {
        const coords = geom.coordinates;
        lng = numberValue(coords[0]);
        lat = numberValue(coords[1]);
        if (lat != null && lng != null) {
          return { lat, lng };
        }
      }
    }

    return { lat: null, lng: null };
  }

export async function handleGoongPlaceSearch(request: PortedRequest): Promise<Response> {

    if (request.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }

    try {
      const body = request.method === "GET"
        ? Object.fromEntries(new URL(request.url).searchParams.entries())
        : await request.json().catch(() => ({}));

      const query = stringValue(body.query ?? body.text).trim();
      const limit = clamp(numberValue(body.limit) ?? 12, 1, 20);
      const nearLat = numberValue(body.near_lat ?? body.nearLat ?? body.lat);
      const nearLng = numberValue(body.near_lng ?? body.nearLng ?? body.lng);
      const localOnly = booleanValue(body.local_only ?? body.localOnly);

      console.log("goong-place-search request", {
        query,
        limit,
        nearLat,
        nearLng,
        localOnly,
      });

      const supabase = createSupabaseClient();

      // If query is empty but coordinates are provided, perform nearby search.
      if (!query) {
        if (nearLat != null && nearLng != null && localOnly) {
          const localPlaces = await searchNearbyLocalPlaces(
            supabase,
            nearLat,
            nearLng,
            limit,
          );
          return jsonResponse({ places: localPlaces, source: "db-nearby" });
        }

        if (nearLat != null && nearLng != null && !localOnly) {
          const localPlaces = await searchNearbyLocalPlaces(
            supabase,
            nearLat,
            nearLng,
            limit,
          );

          const goongKey = getGoongPlaceKey();
          if (!goongKey) {
            return jsonResponse({
              places: localPlaces,
              source: "db-nearby",
              warning: "missing_goong_place_api_key",
            });
          }

          const cacheKey = `goong:nearby:v1:${nearLat.toFixed(5)}:${nearLng.toFixed(5)}:${limit}`;
          const cached = await getCachedPlaces(cacheKey);
          if (cached) {
            return jsonResponse({ places: cached, cache: "hit" });
          }

          console.log("calling Goong", {
            query: "",
            nearLat,
            nearLng,
            mode: "nearby",
          });

          let nearbyResults = await fetchNearbyPlaces({
            apiKey: goongKey,
            lat: nearLat,
            lng: nearLng,
            limit,
          });
          let source = "goong-nearby";

          if (nearbyResults.length === 0) {
            nearbyResults = await fetchReverseGeocode({
              apiKey: goongKey,
              lat: nearLat,
              lng: nearLng,
            });
            source = "goong-reverse";
          }

          const goongPlaces = await mapWithConcurrency(
            nearbyResults,
            4,
            (item) => saveNearbyPlace(supabase, goongKey, item, nearLat, nearLng),
          );

          const places = goongPlaces.length > 0 ? goongPlaces : localPlaces;
          await setCachedPlaces(cacheKey, places);
          return jsonResponse({
            places,
            cache: "miss",
            source: goongPlaces.length > 0 ? source : "db-nearby",
          });
        } else {
          const local = await safeSearchLocalPlaces(
            supabase,
            query,
            limit,
            nearLat,
            nearLng,
          );
          return jsonResponse({
            places: local.places,
            source: "db",
            localError: local.error,
          });
        }
      }

      const local = await safeSearchLocalPlaces(
        supabase,
        query,
        limit,
        nearLat,
        nearLng,
      );
      const localPlaces = local.places;
      if (localOnly) {
        return jsonResponse({
          places: localPlaces,
          source: "db",
          localError: local.error,
        });
      }

      // Ưu tiên core.places — chỉ gọi Goong khi DB không có kết quả.
      if (localPlaces.length > 0) {
        const rankedPlaces = nearLat != null && nearLng != null
          ? [...localPlaces]
            .filter(hasPlaceCoordinates)
            .sort(
              (a, b) =>
                placeDistanceKm(a, nearLat, nearLng) -
                placeDistanceKm(b, nearLat, nearLng),
            )
          : localPlaces;
        const places = (rankedPlaces.length > 0 ? rankedPlaces : localPlaces)
          .slice(0, limit);

        return jsonResponse({
          places,
          source: nearLat != null && nearLng != null ? "db-nearby-ranked" : "db",
          localError: local.error,
        });
      }

      const goongKey = getGoongPlaceKey();
      if (!goongKey) {
        return jsonResponse({
          places: localPlaces,
          source: "db",
          warning: "missing_goong_place_api_key",
        });
      }

      const searchQueries = expandPlaceSearchQueries(query);
      if (searchQueries.length === 0) {
        return jsonResponse({ places: localPlaces, source: "db" });
      }

      const cacheKey = placeCacheKey(searchQueries, limit, nearLat, nearLng);
      const cached = await getCachedPlaces(cacheKey);
      if (cached) {
        return jsonResponse({ places: cached, cache: "hit" });
      }

      console.log("calling Goong", {
        query,
        nearLat,
        nearLng,
        mode: "search",
        reason: "db-empty",
      });

      const mergedSuggestions = await fetchExpandedSuggestions({
        apiKey: goongKey,
        queries: searchQueries,
        limit,
        nearLat,
        nearLng,
      });

      const places = await mapWithConcurrency(mergedSuggestions, 4, (suggestion) =>
        saveSuggestedPlace(supabase, goongKey, suggestion)
      );

      await setCachedPlaces(cacheKey, places);
      return jsonResponse({
        places,
        cache: "miss",
        source: "goong",
        queries: searchQueries,
        localError: local.error,
      });
    } catch (error) {
      console.error("goong-place-search error", error);
      const message = errorMessage(error);
      const status = isClientError(message) ? 400 : 500;
      return jsonResponse({ places: [], error: message }, status);
    }
  
}
