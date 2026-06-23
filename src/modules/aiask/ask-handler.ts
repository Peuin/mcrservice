// @ts-nocheck
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { env } from "../../config/env.js";
import { handlePersonality } from "./personality-handler.js";
import { readHeader, type PortedRequest } from "../../shared/handler-runtime.js";

type Json = Record<string, unknown>;

type ChatRole = "user" | "assistant" | "system";

const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash";
const CHAT_HISTORY_LIMIT = 6;
const PERSONALITY_TIMEOUT_MS = 22000;
const PERSONALITY_CALL_ATTEMPTS = 2;
const PERSONALITY_RETRYABLE_STATUSES = new Set([502, 503, 504]);
const FOOD_CANDIDATE_RPC_LIMIT = 60;
const FOOD_CANDIDATE_RESPONSE_LIMIT = 8;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};



function createRequestClient(request: PortedRequest) {
  const supabaseUrl = env.SUPABASE_URL;
  const supabaseAnonKey = env.SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error("Thiếu cấu hình SUPABASE_URL hoặc SUPABASE_ANON_KEY.");
  }
  return createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: { Authorization: readHeader(request.headers, "authorization") ?? "" },
    },
  });
}

async function requireUser(supabase: ReturnType<typeof createRequestClient>) {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new Error("Bạn cần đăng nhập để chat với Peuin.");
  return { user: data.user };
}

async function getTodaySession(supabase: ReturnType<typeof createRequestClient>) {
  const todaySession = await getOrCreateTodaySession(supabase);
  return {
    success: true,
    session_id: todaySession.session_id,
    session_date: todaySession.session_date,
    messages: await fetchSessionMessages(supabase, todaySession.session_id),
  };
}

async function getOrCreateTodaySession(
  supabase: ReturnType<typeof createRequestClient>,
) {
  const { data, error } = await supabase
    .schema("ai")
    .rpc("get_or_create_today_chat_session")
    .maybeSingle();
  if (error) throw error;

  const sessionId = stringValue(data?.session_id);
  const sessionDate = stringValue(data?.session_date);
  if (!sessionId || !sessionDate) throw new Error("Không tạo được phiên chat hôm nay.");
  return { session_id: sessionId, session_date: sessionDate };
}

async function requireOwnedSession(
  supabase: ReturnType<typeof createRequestClient>,
  sessionId: string,
  userId: string,
) {
  const { data, error } = await supabase
    .schema("ai")
    .from("chat_sessions")
    .select("id")
    .eq("id", sessionId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Không tìm thấy phiên chat của bạn.");
}

async function fetchProfile(
  supabase: ReturnType<typeof createRequestClient>,
  userId: string,
) {
  const { data, error } = await supabase
    .from("profiles")
    .select(
      "id,display_name,username,avatar_url,bio,podcast_url,show_instagram_badge,show_recent_views,is_private,created_at",
    )
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  return data as Json | null;
}

async function fetchChatHistory(
  supabase: ReturnType<typeof createRequestClient>,
  sessionId: string,
) {
  const { data, error } = await supabase
    .schema("ai")
    .from("chat_messages")
    .select("role,content")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false })
    .limit(CHAT_HISTORY_LIMIT);
  if (error) throw error;

  const rows = Array.isArray(data) ? [...data].reverse() : [];
  return rows.map((message) => ({
    role: normalizeChatRole(stringValue(message.role)),
    content: compactHistoryContent(stringValue(message.content)),
  })).filter((message) => message.content);
}

async function fetchSessionMessages(
  supabase: ReturnType<typeof createRequestClient>,
  sessionId: string,
) {
  const { data, error } = await supabase
    .schema("ai")
    .from("chat_messages")
    .select("id,role,content,created_at")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });
  if (error) throw error;

  const rows = Array.isArray(data) ? data as Json[] : [];
  return rows.map((message) => ({
    id: stringValue(message.id),
    role: normalizeChatRole(stringValue(message.role)),
    content: stringValue(message.content),
    created_at: stringValue(message.created_at),
  }));
}

async function fetchPublicFeedFoodCandidates(
  supabase: ReturnType<typeof createRequestClient>,
  viewerId: string,
  query: string,
  excludedPostIds = new Set<string>(),
  mealFilters: MealFilters | null = null,
): Promise<PublicFeedFoodCandidate[]> {
  const searchQuery = foodSearchQuery(query);
  const { data, error } = await supabase.schema("ai").rpc("ask_peuin_food_candidates", {
    p_viewer_id: viewerId || null,
    p_limit: FOOD_CANDIDATE_RPC_LIMIT,
    p_food_query: searchQuery || null,
  });
  if (error) throw error;

  const rows = Array.isArray(data) ? data as Json[] : [];
  const scoredAllTimeCandidates = rows
    .map((row) => feedRowToCandidate(row))
    .filter((candidate) =>
      candidate.post_id &&
      !excludedPostIds.has(candidate.post_id) &&
      candidate.media_url &&
      (candidate.caption || candidate.food_title)
    )
    .map((candidate) => ({
      ...candidate,
      score: publicFeedCandidateScore(candidate, query, mealFilters),
    }))
    .sort((a, b) => b.score - a.score || b.reaction_count - a.reaction_count);

  const allTimeCandidates = scoredAllTimeCandidates
    .map(({ score: _score, ...candidate }) => candidate);

  if (!searchQuery) {
    return refineCandidatesForDrinkQuery(query, allTimeCandidates)
      .slice(0, FOOD_CANDIDATE_RESPONSE_LIMIT);
  }

  const searchCandidates = await fetchSearchFoodCandidates(
    supabase,
    searchQuery,
    viewerId,
    excludedPostIds,
  );
  return refineCandidatesForDrinkQuery(
    query,
    uniqueCandidatesByPostId([...searchCandidates, ...allTimeCandidates]),
  ).slice(0, FOOD_CANDIDATE_RESPONSE_LIMIT);
}

async function fetchSearchFoodCandidates(
  supabase: ReturnType<typeof createRequestClient>,
  query: string,
  viewerId: string,
  excludedPostIds: Set<string>,
): Promise<PublicFeedFoodCandidate[]> {
  const { data, error } = await supabase.rpc("search_posts_by_food", {
    p_food_query: query,
    p_limit: 20,
    p_viewer_id: viewerId || null,
  });
  if (error) {
    console.warn("Ask Peuin food search fallback skipped:", errorMessage(error));
    return [];
  }

  const rows = Array.isArray(data) ? data as Json[] : [];
  return rows
    .map((row) => feedRowToCandidate(row))
    .filter((candidate) =>
      candidate.post_id &&
      !excludedPostIds.has(candidate.post_id) &&
      candidate.media_url &&
      (candidate.caption || candidate.food_title)
    );
}

async function fetchExcludedRecommendationPostIds(
  supabase: ReturnType<typeof createRequestClient>,
  sessionId: string,
  userId: string,
): Promise<Set<string>> {
  const [sessionPostIds, profilePostIds] = await Promise.all([
    fetchSessionRecommendedPostIds(supabase, sessionId, userId),
    fetchProfileRecommendedPostIds(supabase, userId),
  ]);
  return new Set([...sessionPostIds, ...profilePostIds]);
}

async function fetchSessionRecommendedPostIds(
  supabase: ReturnType<typeof createRequestClient>,
  sessionId: string,
  userId: string,
): Promise<Set<string>> {
  const { data, error } = await supabase.schema("ai")
    .from("ai_recommendations")
    .select("recommendation_context")
    .eq("session_id", sessionId)
    .eq("user_id", userId);
  if (error) throw error;

  const rows = Array.isArray(data) ? data as Json[] : [];
  return new Set(
    rows
      .map((row) => objectValue(objectValue(row.recommendation_context).top_pick))
      .map((topPick) => stringValue(topPick.post_id))
      .filter(Boolean),
  );
}

async function fetchProfileRecommendedPostIds(
  supabase: ReturnType<typeof createRequestClient>,
  userId: string,
): Promise<Set<string>> {
  const { data, error } = await supabase.schema("ai")
    .from("user_food_profiles")
    .select("recently_eaten,avoid_recommendations")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return new Set<string>();

  const row = objectValue(data);
  const ids = new Set<string>();
  for (const item of arrayValue(row.recently_eaten)) {
    const entry = objectValue(item);
    const postId = stringValue(entry.post_id) || stringValue(entry.postId);
    if (postId) ids.add(postId);
  }
  for (const item of arrayValue(row.avoid_recommendations)) {
    if (typeof item === "string") {
      const postId = stringValue(item);
      if (postId) ids.add(postId);
      continue;
    }
    const entry = objectValue(item);
    const postId = stringValue(entry.post_id) || stringValue(entry.postId);
    if (postId) ids.add(postId);
  }
  return ids;
}

async function ensureUserFoodProfile(
  supabase: ReturnType<typeof createRequestClient>,
  userId: string,
) {
  const { error } = await supabase.schema("ai")
    .from("user_food_profiles")
    .upsert(
      { user_id: userId, updated_at: new Date().toISOString() },
      { onConflict: "user_id", ignoreDuplicates: true },
    );
  if (error) {
    console.warn("ensureUserFoodProfile skipped:", errorMessage(error));
  }
}

async function syncUserFoodProfile(
  supabase: ReturnType<typeof createRequestClient>,
  options: {
    userId: string;
    recommendationContext: Json;
  },
) {
  const { data: current, error: readError } = await supabase.schema("ai")
    .from("user_food_profiles")
    .select(
      [
        "favorite_foods",
        "favorite_drinks",
        "favorite_places",
        "favorite_place_types",
        "disliked_foods",
        "liked_foods",
        "liked_drinks",
        "disliked_drinks",
        "preferred_place_types",
        "preferred_budget",
        "budget_profile",
        "location_preferences",
        "diet_goals",
        "recently_eaten",
        "avoid_recommendations",
        "learning_confidence",
      ].join(","),
    )
    .eq("user_id", options.userId)
    .maybeSingle();
  if (readError) {
    console.warn("syncUserFoodProfile read skipped:", errorMessage(readError));
    return;
  }

  const patch = buildUserFoodProfilePatch(
    objectValue(current),
    options.recommendationContext,
  );
  if (!patch) return;

  const { error: updateError } = await supabase.schema("ai")
    .from("user_food_profiles")
    .update({
      ...patch,
      updated_at: new Date().toISOString(),
      last_generated_at: new Date().toISOString(),
    })
    .eq("user_id", options.userId);
  if (updateError) {
    console.warn("syncUserFoodProfile update skipped:", errorMessage(updateError));
  }
}

function buildUserFoodProfilePatch(
  current: Json,
  recommendationContext: Json,
): Json | null {
  const patch: Json = {};
  let changed = false;

  for (const event of arrayValue(recommendationContext.memory_events).map(objectValue)) {
    const eventType = stringValue(event.event_type);
    const eventValue = stringValue(event.event_value).slice(0, 180);
    if (eventValue.length < 2) continue;

    if (eventType === "recently_eaten") {
      const recentlyEaten = prependUniqueRecentlyEaten(current.recently_eaten, {
        food_title: eventValue,
        noted_at: new Date().toISOString(),
      });
      if (JSON.stringify(recentlyEaten) !== JSON.stringify(arrayValue(current.recently_eaten))) {
        patch.recently_eaten = recentlyEaten;
        current.recently_eaten = recentlyEaten;
        changed = true;
      }
      continue;
    }

    const field = memoryEventProfileField(eventType);
    if (!field) continue;

    const merged = appendUniqueJsonValues(current[field], eventValue);
    if (JSON.stringify(merged) !== JSON.stringify(arrayValue(current[field]))) {
      patch[field] = merged;
      current[field] = merged;
      changed = true;
    }

    if (eventType === "liked_food") {
      const favorites = appendUniqueJsonValues(current.favorite_foods, eventValue);
      if (JSON.stringify(favorites) !== JSON.stringify(arrayValue(current.favorite_foods))) {
        patch.favorite_foods = favorites;
        current.favorite_foods = favorites;
        changed = true;
      }
    }
    if (eventType === "preferred_place_type") {
      const favoritePlaceTypes = appendUniqueJsonValues(
        current.favorite_place_types,
        eventValue,
      );
      if (JSON.stringify(favoritePlaceTypes) !==
        JSON.stringify(arrayValue(current.favorite_place_types))) {
        patch.favorite_place_types = favoritePlaceTypes;
        current.favorite_place_types = favoritePlaceTypes;
        changed = true;
      }
    }
    if (eventType === "preferred_budget") {
      patch.preferred_budget = { note: eventValue };
      patch.budget_profile = { note: eventValue };
      current.preferred_budget = patch.preferred_budget;
      current.budget_profile = patch.budget_profile;
      changed = true;
    }
  }

  if (stringValue(recommendationContext.answer_type) === "food_recommendation") {
    const topPick = objectValue(recommendationContext.top_pick);
    const postId = stringValue(topPick.post_id);
    if (postId) {
      const eatenEntry = {
        post_id: postId,
        food_title: stringValue(topPick.food_title),
        place_name: stringValue(topPick.place_name),
        recommended_at: new Date().toISOString(),
      };
      const recentlyEaten = prependUniqueRecentlyEaten(current.recently_eaten, eatenEntry);
      if (JSON.stringify(recentlyEaten) !== JSON.stringify(arrayValue(current.recently_eaten))) {
        patch.recently_eaten = recentlyEaten;
        current.recently_eaten = recentlyEaten;
        changed = true;
      }

      const avoidRecommendations = prependUniqueRecentlyEaten(
        current.avoid_recommendations,
        { post_id: postId, food_title: stringValue(topPick.food_title) },
        60,
      );
      if (JSON.stringify(avoidRecommendations) !==
        JSON.stringify(arrayValue(current.avoid_recommendations))) {
        patch.avoid_recommendations = avoidRecommendations;
        changed = true;
      }
    }
  }

  if (!changed) return null;

  const previousConfidence = Number(current.learning_confidence ?? 0.5) || 0.5;
  patch.learning_confidence = Math.min(0.95, previousConfidence + 0.03);
  return patch;
}

function memoryEventProfileField(eventType: string) {
  switch (eventType) {
    case "liked_food":
      return "liked_foods";
    case "disliked_food":
      return "disliked_foods";
    case "liked_drink":
      return "liked_drinks";
    case "disliked_drink":
      return "disliked_drinks";
    case "preferred_place_type":
      return "preferred_place_types";
    case "location_preference":
      return "location_preferences";
    case "diet_goal":
      return "diet_goals";
    default:
      return "";
  }
}

function appendUniqueJsonValues(existing: unknown, value: string, maxItems = 24) {
  const items = arrayValue(existing)
    .map((item) => stringValue(item))
    .filter((item) => item.length > 0);
  if (!value || items.includes(value)) return items.slice(0, maxItems);
  return [value, ...items].slice(0, maxItems);
}

function prependUniqueRecentlyEaten(
  existing: unknown,
  entry: Json,
  maxItems = 40,
): Json[] {
  const postId = stringValue(entry.post_id);
  const foodTitle = stringValue(entry.food_title);
  const items = arrayValue(existing).map(objectValue);
  const filtered = items.filter((item) => {
    if (postId) return stringValue(item.post_id) !== postId;
    if (foodTitle) return stringValue(item.food_title) !== foodTitle;
    return true;
  });
  return [entry, ...filtered].slice(0, maxItems);
}

async function fetchUserFoodMemoryContext(
  supabase: ReturnType<typeof createRequestClient>,
  userId: string,
  options: { includeUserPostTasteSummary?: boolean } = {},
): Promise<Json> {
  const [profile, weeklyMemories, recentEvents, userPostTasteSummary] = await Promise.all([
    supabase.schema("ai")
      .from("user_food_profiles")
      .select(
        [
          "favorite_foods",
          "favorite_drinks",
          "favorite_places",
          "favorite_place_types",
          "disliked_foods",
          "avoid_recommendations",
          "taste_profile",
          "budget_profile",
          "meal_time_pattern",
          "latest_summary",
          "liked_foods",
          "liked_drinks",
          "disliked_drinks",
          "preferred_place_types",
          "preferred_budget",
          "location_preferences",
          "diet_goals",
          "recently_eaten",
          "learning_confidence",
          "last_generated_at",
        ].join(","),
      )
      .eq("user_id", userId)
      .maybeSingle(),
    supabase.schema("ai")
      .from("user_food_weekly_memories")
      .select(
        "week_start,week_end,summary_text,summary_markdown,taste_summary,mood_summary,recommendation_rules,generated_at",
      )
      .eq("user_id", userId)
      .order("week_start", { ascending: false })
      .limit(2),
    supabase.schema("ai")
      .from("user_food_memory_events")
      .select("event_type,event_value,confidence,source,metadata,created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(20),
    options.includeUserPostTasteSummary
      ? fetchUserPostTasteSummary(supabase, userId)
      : Promise.resolve(emptyUserPostTasteSummary()),
  ]);

  return {
    profile: profile.error ? null : profile.data ?? null,
    latest_weekly_memories: weeklyMemories.error || !Array.isArray(weeklyMemories.data)
      ? []
      : weeklyMemories.data,
    recent_memory_events: recentEvents.error || !Array.isArray(recentEvents.data)
      ? []
      : recentEvents.data,
    user_post_taste_summary: userPostTasteSummary,
  };
}

async function fetchUserPostTasteSummary(
  supabase: ReturnType<typeof createRequestClient>,
  userId: string,
): Promise<Json> {
  const { data: postsData, error: postsError } = await supabase
    .schema("social")
    .from("posts")
    .select("id,caption,price_label,place_id,reaction_count,created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(30);
  if (postsError) {
    console.warn("user post taste summary skipped:", errorMessage(postsError));
    return emptyUserPostTasteSummary();
  }

  const posts = Array.isArray(postsData) ? postsData as Json[] : [];
  if (posts.length === 0) return emptyUserPostTasteSummary();

  const postIds = posts.map((post) => stringValue(post.id)).filter(Boolean);
  const placeIds = uniqueStrings(
    posts.map((post) => stringValue(post.place_id)).filter(Boolean),
  );

  const [stickersResult, placesResult] = await Promise.all([
    postIds.length === 0
      ? Promise.resolve({ data: [], error: null })
      : supabase
        .schema("social")
        .from("post_stickers")
        .select("post_id,sticker_type,label,created_at")
        .in("post_id", postIds)
        .in("sticker_type", ["food", "topic", "tag"])
        .order("created_at", { ascending: true }),
    placeIds.length === 0
      ? Promise.resolve({ data: [], error: null })
      : supabase
        .schema("core")
        .from("places")
        .select("id,name,address")
        .in("id", placeIds),
  ]);

  if (stickersResult.error) {
    console.warn("user post stickers taste summary skipped:", errorMessage(stickersResult.error));
  }
  if (placesResult.error) {
    console.warn("user post places taste summary skipped:", errorMessage(placesResult.error));
  }

  const stickers = Array.isArray(stickersResult.data)
    ? stickersResult.data as Json[]
    : [];
  const stickersByPostId = groupBy(stickers, "post_id");
  const places = firstBy(
    Array.isArray(placesResult.data) ? placesResult.data as Json[] : [],
    "id",
  );
  const foodLabels: string[] = [];
  const topicLabels: string[] = [];
  const drinkLabels: string[] = [];
  const placeNames: string[] = [];
  const priceLabels: string[] = [];
  const captionSignals: string[] = [];
  const recentPosts: Json[] = [];

  for (const post of posts) {
    const postStickers = stickersByPostId.get(stringValue(post.id)) ?? [];
    const foodLabel = firstStickerLabel(postStickers, "food");
    const topicLabel = firstStickerLabel(postStickers, "topic") ||
      firstStickerLabel(postStickers, "tag");
    const caption = stringValue(post.caption);
    const inferredFood = foodLabel || firstFoodFromCaption(caption);
    const place = places.get(stringValue(post.place_id));
    const placeName = stringValue(place?.name);
    const priceLabel = stringValue(post.price_label);
    const haystack = [inferredFood, topicLabel, caption, placeName].join(" ");

    if (inferredFood) foodLabels.push(inferredFood);
    if (topicLabel) topicLabels.push(topicLabel);
    if (looksLikeDrinkText(haystack)) {
      drinkLabels.push(inferredFood || topicLabel || firstFoodFromCaption(caption));
    }
    if (placeName) placeNames.push(placeName);
    if (priceLabel) priceLabels.push(priceLabel);
    captionSignals.push(...tasteSignalsFromText(caption));

    recentPosts.push({
      post_id: stringValue(post.id),
      food_title: inferredFood,
      topic: topicLabel,
      place_name: placeName,
      place_address: stringValue(place?.address),
      price_label: priceLabel,
      caption: caption.slice(0, 220),
      created_at: stringValue(post.created_at),
      reaction_count: Number(post.reaction_count ?? 0) || 0,
    });
  }

  const topFoods = topCountedValues(foodLabels, 8);
  const topDrinks = topCountedValues(drinkLabels.filter(Boolean), 5);
  const topTopics = topCountedValues(topicLabels, 6);
  const topPlaces = topCountedValues(placeNames, 6);
  const topPrices = topCountedValues(priceLabels, 5);
  const topSignals = topCountedValues(captionSignals, 8);

  return {
    source: "recent_user_posts",
    post_count_analyzed: posts.length,
    confidence: posts.length >= 8 ? 0.78 : posts.length >= 3 ? 0.62 : 0.45,
    top_foods: topFoods,
    top_drinks: topDrinks,
    top_topics: topTopics,
    top_places: topPlaces,
    top_price_labels: topPrices,
    caption_taste_signals: topSignals,
    inference_vi: userPostTasteInferenceVi({
      topFoods,
      topDrinks,
      topTopics,
      topPrices,
      topSignals,
      postCount: posts.length,
    }),
    recent_posts: recentPosts.slice(0, 12),
  };
}

function emptyUserPostTasteSummary(): Json {
  return {
    source: "recent_user_posts",
    post_count_analyzed: 0,
    confidence: 0,
    top_foods: [],
    top_drinks: [],
    top_topics: [],
    top_places: [],
    top_price_labels: [],
    caption_taste_signals: [],
    inference_vi: "Chưa đủ bài đăng của bạn để suy luận gu ăn uống.",
    recent_posts: [],
  };
}

function topCountedValues(values: string[], limit: number): Json[] {
  const counts = new Map<string, number>();
  const labels = new Map<string, string>();
  for (const raw of values) {
    const label = stringValue(raw);
    if (!label || label.length < 2) continue;
    const key = removeVietnameseMarks(label.toLowerCase());
    counts.set(key, (counts.get(key) ?? 0) + 1);
    labels.set(key, labels.get(key) ?? label);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || labels.get(a[0])!.localeCompare(labels.get(b[0])!))
    .slice(0, limit)
    .map(([key, count]) => ({ label: labels.get(key) ?? key, count }));
}

function userPostTasteInferenceVi(input: {
  topFoods: Json[];
  topDrinks: Json[];
  topTopics: Json[];
  topPrices: Json[];
  topSignals: Json[];
  postCount: number;
}) {
  if (input.postCount === 0) {
    return "Chưa đủ bài đăng của bạn để suy luận gu ăn uống.";
  }

  const foods = countedLabels(input.topFoods, 4);
  const drinks = countedLabels(input.topDrinks, 3);
  const topics = countedLabels(input.topTopics, 3);
  const prices = countedLabels(input.topPrices, 2);
  const signals = countedLabels(input.topSignals, 4);
  const parts = [
    foods ? `hay đăng về ${foods}` : "",
    drinks ? `có tín hiệu thích nhóm đồ uống như ${drinks}` : "",
    topics ? `thường gắn với vibe ${topics}` : "",
    prices ? `hay để mức giá ${prices}` : "",
    signals ? `caption hay có tín hiệu ${signals}` : "",
  ].filter(Boolean);

  return parts.length === 0
    ? `Có ${input.postCount} bài đăng gần đây nhưng tín hiệu gu còn hơi mỏng.`
    : `Dựa trên ${input.postCount} bài đăng gần đây, bạn ${parts.join("; ")}.`;
}

function countedLabels(values: Json[], limit: number) {
  return values
    .slice(0, limit)
    .map((item) => stringValue(item.label))
    .filter(Boolean)
    .join(", ");
}

function tasteSignalsFromText(text: string) {
  const plain = removeVietnameseMarks(text.toLowerCase());
  const signals: string[] = [];
  const patterns: Array<[RegExp, string]> = [
    [/(healthy|eat clean|salad|thanh|nhe bung|nhe nhang)/, "thích món nhẹ/healthy"],
    [/(cay|sa te|mala|ot|kim chi)/, "chịu cay"],
    [/(ngot|dessert|banh|kem|tra sua|matcha)/, "hảo ngọt"],
    [/(bun|pho|hu tieu|mi|my|nuoc leo)/, "thích món nước"],
    [/(com|ga|thit|bbq|nuong)/, "thích món no/đậm vị"],
    [/(cafe|ca phe|bac xiu|latte|tra|nuoc ep|sinh to)/, "thích đồ uống"],
    [/(homemade|nha lam|tu nau)/, "thích món tự làm"],
    [/(re|gia on|sinh vien|binh dan)/, "ưu tiên giá mềm"],
  ];
  for (const [pattern, label] of patterns) {
    if (pattern.test(plain)) signals.push(label);
  }
  return signals;
}

function looksLikeDrinkText(text: string) {
  const plain = removeVietnameseMarks(text.toLowerCase());
  return [
    "tra sua",
    "tra dao",
    "tra chanh",
    "hong tra",
    "luc tra",
    "matcha",
    "cafe",
    "ca phe",
    "bac xiu",
    "latte",
    "espresso",
    "sinh to",
    "nuoc ep",
    "soda",
    "smoothie",
    "juice",
  ].some((keyword) => plain.includes(keyword));
}

function feedRowToCandidate(row: Json): PublicFeedFoodCandidate {
  const postId = stringValue(row.id);
  const caption = stringValue(row.caption);
  const location = stringValue(row.location);
  const foodTitle = stringValue(row.food_name) ||
    firstFoodFromCaption(caption) ||
    "món ngon";
  const placeName = shortPlaceName(location) || foodTitle;
  const searchableText = [
    foodTitle,
    caption,
    placeName,
    location && location !== placeName ? location : "",
  ].join(" ").toLowerCase();
  return {
    post_id: postId,
    author_name: stringValue(row.author_name) || "Peuin user",
    author_avatar_url: avatarPublicUrl(stringValue(row.avatar_url)),
    author_username: "",
    place_name: placeName,
    place_address: location && location !== placeName ? location : "",
    food_title: foodTitle,
    caption,
    price_label: stringValue(row.price_label) || "—",
    media_url: publicPostMediaUrl(stringValue(row.media_url)),
    created_at: stringValue(row.created_at),
    reaction_count: Number(row.reaction_count ?? 0) || 0,
    searchable_text_plain: removeVietnameseMarks(searchableText),
  };
}

function shortPlaceName(location: string) {
  const value = stringValue(location);
  if (!value) return "";
  return value.split(/[,\n]/)[0]?.trim() ?? "";
}

async function askPersonality(options: {
  request: PortedRequest;
  preferredName: string;
  history: { role: ChatRole; content: string }[];
  query: string;
  profileContext: Json;
  foodMemoryContext: Json;
  publicFeedCandidates: PublicFeedFoodCandidate[];
  shouldRecommendFood: boolean;
  mealFilters: MealFilters | null;
}) {
  const body = {
    action: "generate_reply",
    preferred_name: options.preferredName,
    history: options.history,
    query: options.query,
    profile_context: options.profileContext,
    memory_context: options.foodMemoryContext,
    public_feed_candidates: options.publicFeedCandidates,
    should_recommend_food: options.shouldRecommendFood,
    meal_filters: options.mealFilters,
    meal_filters_prompt: mealFiltersPromptBlock(options.mealFilters),
  };

  let lastError: unknown;
  for (let attempt = 1; attempt <= PERSONALITY_CALL_ATTEMPTS; attempt++) {
    try {
      const response = await handlePersonality({
        method: "POST",
        url: "http://mcrservice.local/functions/v1/personality",
        headers: {
          authorization: readHeader(options.request.headers, "authorization"),
          apikey: readHeader(options.request.headers, "apikey") || stringValue(env.SUPABASE_ANON_KEY),
          "content-type": "application/json"
        },
        json: async () => body
      });
      const data = await response.json().catch(() => ({}));

      if (response.ok) {
        const content = stringValue(data.ai_content);
        if (!content) throw new Error("personality không trả về nội dung trả lời.");
        return content;
      }

      const details = stringValue(data.error) || `HTTP ${response.status}`;
      if (
        attempt < PERSONALITY_CALL_ATTEMPTS &&
        PERSONALITY_RETRYABLE_STATUSES.has(response.status)
      ) {
        console.warn(
          `personality retryable ${response.status} (attempt ${attempt}/${PERSONALITY_CALL_ATTEMPTS}): ${details}`,
        );
        await delayMs(450);
        continue;
      }
      throw new PersonalityUpstreamError(response.status, details);
    } catch (error) {
      lastError = error;
      if (error instanceof PersonalityUpstreamError) {
        if (
          attempt < PERSONALITY_CALL_ATTEMPTS &&
          PERSONALITY_RETRYABLE_STATUSES.has(error.status)
        ) {
          await delayMs(450);
          continue;
        }
        throw error;
      }
      if (attempt < PERSONALITY_CALL_ATTEMPTS) {
        console.warn(
          `personality call failed (attempt ${attempt}/${PERSONALITY_CALL_ATTEMPTS}): ${errorMessage(error)}`,
        );
        await delayMs(450);
        continue;
      }
      throw new PersonalityUpstreamError(503, errorMessage(error));
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new PersonalityUpstreamError(503, errorMessage(lastError));
}

function delayMs(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runBackgroundTask(promise: Promise<unknown>, label: string) {
  const guarded = promise.catch((error) => {
    console.warn(`${label} background task skipped:`, errorMessage(error));
  });
  const runtime = (globalThis as {
    EdgeRuntime?: { waitUntil?: (task: Promise<unknown>) => void };
  }).EdgeRuntime;
  if (typeof runtime?.waitUntil === "function") {
    runtime.waitUntil(guarded);
  }
}

function normalizeAssistantContext(options: {
  parsedContent: Json | null;
  aiContent: string;
  preferredName: string;
  shouldRecommendFood: boolean;
  publicFeedCandidates: PublicFeedFoodCandidate[];
  query: string;
}): Json {
  const parsed = options.parsedContent ?? {};
  const rawReply = stringValue(parsed.reply) ||
    stringValue(parsed.reasoning) ||
    fallbackAssistantReply(options.aiContent, options.shouldRecommendFood);
  const guardedReply = guardChatReply(rawReply, options.preferredName);

  if (!options.shouldRecommendFood) {
    return {
      ...parsed,
      answer_type: "normal_chat",
      reply: guardedReply,
      reasoning: stringValue(parsed.reasoning),
      top_pick: null,
      alternatives: [],
    };
  }

  if (options.publicFeedCandidates.length === 0) {
    return noMatchingPostResponse(false, options.query);
  }
  const candidateById = new Map(
    options.publicFeedCandidates.map((candidate) => [candidate.post_id, candidate]),
  );
  const requestedTopPick = objectValue(parsed.top_pick);
  const requestedCandidate = candidateById.get(stringValue(requestedTopPick.post_id));
  const selectedTopPick = requestedCandidate ??
    options.publicFeedCandidates[0];
  if (!selectedTopPick) return noMatchingPostResponse();
  const requestedAlternatives = arrayValue(parsed.alternatives)
    .map((item) => candidateById.get(stringValue(objectValue(item).post_id)))
    .filter((candidate): candidate is PublicFeedFoodCandidate =>
      Boolean(candidate && candidate.post_id !== selectedTopPick.post_id)
    );
  const fallbackAlternatives = options.publicFeedCandidates
    .filter((candidate) => candidate.post_id !== selectedTopPick.post_id);
  const mergedAlternatives = uniqueCandidatesByPostId([
    ...requestedAlternatives,
    ...fallbackAlternatives,
  ])
    .slice(0, 2)
    .map((candidate) => recommendationPick(candidate));

  const parsedReply = stringValue(parsed.reply);
  const aiReply = looksEnglishText(parsedReply) ? "" : parsedReply;
  const requestedDrink = requestedDrinkLabel(options.query);
  const reply = aiReply ||
    (requestedDrink && !candidateMatchesRequestedDrink(selectedTopPick, requestedDrink)
      ? drinkFallbackRecommendationReply(selectedTopPick, requestedDrink)
      : foodRecommendationReply(selectedTopPick));
  return {
    ...parsed,
    answer_type: "food_recommendation",
    reply,
    reasoning: vietnameseReasoning(
      stringValue(parsed.reasoning),
      selectedTopPick,
      requestedDrink,
    ),
    top_pick: recommendationPick(selectedTopPick),
    alternatives: mergedAlternatives,
  };
}

function foodRecommendationReply(candidate: PublicFeedFoodCandidate) {
  return `Peuin thấy bài đăng ${candidate.food_title} ở ${candidate.place_name} khá hợp nè. Mình xem thử món này nha.`;
}

function drinkFallbackRecommendationReply(
  candidate: PublicFeedFoodCandidate,
  requestedDrink: string,
) {
  return `Peuin chưa thấy bài đăng ${requestedDrink} đủ ổn lúc này, nên tui chuyển sang thức uống khác nha. Thử ${candidate.food_title} ở ${candidate.place_name} trước nè.`;
}

function vietnameseReasoning(
  reasoning: string,
  candidate: PublicFeedFoodCandidate,
  requestedDrink: string,
) {
  if (reasoning && !looksEnglishReasoning(reasoning)) return reasoning;
  if (
    requestedDrink &&
    !candidateMatchesRequestedDrink(candidate, requestedDrink)
  ) {
    return `Chưa thấy bài đăng ${requestedDrink} phù hợp, nên Peuin ưu tiên một lựa chọn thức uống từ bài đăng công khai.`;
  }
  return `Gợi ý từ bài đăng của ${candidate.author_name} trên Peuin.`;
}

function looksEnglishReasoning(value: string) {
  return looksEnglishText(value);
}

function looksEnglishText(value: string) {
  const text = value.toLowerCase();
  return /\b(the|user|asked|recommended|candidates|public feed|top pick|reasoning|food|drink|post)\b/.test(
    text,
  );
}

function fallbackAssistantReply(aiContent: string, shouldRecommendFood: boolean) {
  const content = stringValue(aiContent);
  if (!looksLikeBrokenJson(content)) return content;
  return shouldRecommendFood
    ? "Peuin bị hụt nhịp lúc chọn món rồi. Bạn nhắn lại món đang thèm, tui chọn lại cho gọn nha."
    : "Peuin bị hụt nhịp một chút rồi. Bạn nhắn lại câu đó giúp tui nha.";
}

function looksLikeBrokenJson(value: string) {
  const text = value.trim();
  if (!text) return false;
  if (!/[{[]/.test(text[0])) return false;
  try {
    JSON.parse(text);
    return false;
  } catch {
    return true;
  }
}

function recommendationPick(candidate: PublicFeedFoodCandidate): Json {
  return {
    post_id: candidate.post_id,
    author_name: candidate.author_name,
    author_avatar_url: candidate.author_avatar_url,
    place_name: candidate.place_name,
    place_address: candidate.place_address,
    time_ago: formatRelativeTimeAgo(candidate.created_at),
    food_title: candidate.food_title,
    place_handle: candidate.author_username ? `@${candidate.author_username}` : "",
    review: candidate.caption,
    caption: candidate.caption,
    price_label: candidate.price_label,
    media_url: candidate.media_url,
    distance_label: "",
    social_hint: "",
  };
}

function noMatchingPostResponse(
  hasSeenSessionRecommendations = false,
  query = "",
): Json {
  const requestedDrink = requestedDrinkLabel(query);
  return {
    answer_type: "food_recommendation",
    reply: requestedDrink
      ? `Peuin chưa thấy bài đăng ${requestedDrink} hay thức uống nào đủ hợp để gợi ý lúc này. Bạn đổi sang món khác hoặc nói thêm khu vực tui lọc lại nha.`
      : hasSeenSessionRecommendations
      ? "Mấy món hợp nhất trong cuộc trò chuyện này Peuin đã gợi ý rồi. Chưa thấy bài đăng mới đủ ổn để đổi món, bạn thử nói rõ thèm món gì hơn nha."
      : "Peuin chưa thấy bài đăng nào đủ hợp để gợi ý cho bạn lúc này. Có bài ngon đúng ý rồi tui mới dám chốt nha.",
    reasoning: requestedDrink
      ? `Không có bài đăng công khai phù hợp cho ${requestedDrink} hoặc nhóm thức uống.`
      : hasSeenSessionRecommendations
      ? "Các bài đăng phù hợp trong phiên chat này đã được gợi ý trước đó."
      : "Chưa có bài đăng công khai phù hợp trong Peuin.",
    top_pick: null,
    alternatives: [],
    memory_events: [],
  };
}

async function insertChatMessage(
  supabase: ReturnType<typeof createRequestClient>,
  sessionId: string,
  role: "user" | "assistant",
  content: string,
) {
  const { data, error } = await supabase.schema("ai").from("chat_messages").insert({
    session_id: sessionId,
    role,
    content,
  }).select("id").maybeSingle();
  if (error) throw error;
  return stringValue(data?.id);
}

async function saveAiRecommendation(options: {
  supabase: ReturnType<typeof createRequestClient>;
  userId: string;
  sessionId: string;
  query: string;
  recommendationContext: Json;
}) {
  const modelVersion = env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
  const suggestions = buildRecommendationSuggestions(options.recommendationContext);
  const { data, error } = await options.supabase.schema("ai")
    .from("ai_recommendations")
    .insert({
      user_id: options.userId,
      rec_type: "meal_suggest",
      input_context: {
        source: "ask_peuin",
        session_id: options.sessionId,
        query: options.query,
        answer_type: stringValue(options.recommendationContext.answer_type) ||
          "food_recommendation",
      },
      suggestions,
      model_version: modelVersion,
      session_id: options.sessionId,
      query: options.query,
      answer_type: "food_recommendation",
      recommendation_context: options.recommendationContext,
    })
    .select("id")
    .maybeSingle();
  if (error) throw error;
  return stringValue(data?.id);
}

function buildRecommendationSuggestions(recommendationContext: Json): Json[] {
  const suggestions: Json[] = [];
  const topPick = objectValue(recommendationContext.top_pick);
  const topPostId = stringValue(topPick.post_id);
  if (topPostId) {
    suggestions.push({
      rank: 1,
      post_id: topPostId,
      food_title: stringValue(topPick.food_title),
      place_name: stringValue(topPick.place_name),
      media_url: stringValue(topPick.media_url),
    });
  }

  for (const [index, item] of arrayValue(recommendationContext.alternatives).entries()) {
    const alternative = objectValue(item);
    const postId = stringValue(alternative.post_id);
    if (!postId || postId === topPostId) continue;
    suggestions.push({
      rank: index + 2,
      post_id: postId,
      food_title: stringValue(alternative.food_title),
      place_name: stringValue(alternative.place_name),
      media_url: stringValue(alternative.media_url),
    });
  }

  return suggestions;
}

async function insertChatTrainingData(
  supabase: ReturnType<typeof createRequestClient>,
  options: {
    userId: string;
    sessionId: string;
    userMessageId: string;
    assistantMessageId: string;
    recommendationId: string;
    query: string;
    response: string;
    answerType: string;
    recommendationContext: Json;
    model: string;
  },
) {
  const { error } = await supabase.schema("ai").from("chat_training_data").insert({
    user_id: options.userId,
    session_id: options.sessionId,
    user_message_id: options.userMessageId || null,
    assistant_message_id: options.assistantMessageId || null,
    recommendation_id: options.recommendationId || null,
    user_query: options.query,
    assistant_response: options.response,
    answer_type: options.answerType,
    recommendation_context: options.recommendationContext,
    model: options.model,
  });
  if (error) throw error;
}

async function insertUserFoodMemoryEvents(
  supabase: ReturnType<typeof createRequestClient>,
  options: {
    userId: string;
    sessionId: string;
    messageId: string;
    recommendationContext: Json;
  },
) {
  const allowedEventTypes = new Set([
    "liked_food",
    "disliked_food",
    "liked_drink",
    "disliked_drink",
    "preferred_place_type",
    "preferred_budget",
    "location_preference",
    "diet_goal",
    "recently_eaten",
  ]);
  const events = arrayValue(options.recommendationContext.memory_events)
    .map((item) => objectValue(item))
    .map((event) => ({
      event_type: stringValue(event.event_type),
      event_value: stringValue(event.event_value).slice(0, 180),
      confidence: Math.max(0, Math.min(1, Number(event.confidence ?? 0.7) || 0.7)),
      source: "chat",
      metadata: objectValue(event.metadata),
    }))
    .filter((event) =>
      allowedEventTypes.has(event.event_type) &&
      event.event_value.length >= 2
    )
    .slice(0, 5);

  if (events.length === 0) return;

  const { error } = await supabase.schema("ai").from("user_food_memory_events").insert(
    events.map((event) => ({
      user_id: options.userId,
      session_id: options.sessionId,
      message_id: options.messageId || null,
      ...event,
    })),
  );
  if (error) {
    console.warn("User food memory event write skipped:", errorMessage(error));
  }
}

async function handleRecommendationFeedback(
  supabase: ReturnType<typeof createRequestClient>,
  userId: string,
  body: Json,
) {
  const recommendationId = stringValue(body.recommendation_id ?? body.recommendationId);
  const feedback = stringValue(body.feedback);
  const feedbackReason = stringValue(body.feedback_reason ?? body.feedbackReason);
  const allowedFeedback = new Set([
    "like",
    "dislike",
    "ate",
    "not_relevant",
    "too_expensive",
    "too_far",
    "suggest_again",
  ]);
  if (!recommendationId || !allowedFeedback.has(feedback)) {
    throw new Error("Thiếu recommendation_id hoặc feedback không hợp lệ.");
  }

  const { data, error } = await supabase.schema("ai")
    .from("ai_recommendations")
    .update({
      feedback,
      feedback_reason: feedbackReason,
      updated_at: new Date().toISOString(),
    })
    .eq("id", recommendationId)
    .eq("user_id", userId)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Không tìm thấy recommendation của bạn.");

  const { error: trainingError } = await supabase.schema("ai")
    .from("chat_training_data")
    .update({ feedback, feedback_reason: feedbackReason })
    .eq("recommendation_id", recommendationId)
    .eq("user_id", userId);
  if (trainingError) {
    console.warn("Chat training feedback update skipped:", errorMessage(trainingError));
  }

  return { success: true, recommendation_id: recommendationId, feedback };
}

function detectFoodRecommendationIntent(query: string) {
  const text = query.toLowerCase().normalize("NFC");
  const plainText = removeVietnameseMarks(text);
  if (
    [
      /không cần gợi ý/,
      /đừng gợi ý/,
      /chưa muốn ăn/,
      /không đói/,
      /no rồi/,
      /tui no/,
      /mình no/,
      /khong can goi y/,
      /dung goi y/,
      /chua muon an/,
      /khong doi/,
      /no roi/,
    ].some((pattern) => pattern.test(text) || pattern.test(plainText))
  ) return false;

  return [
    /ăn gì/,
    /ăn món gì/,
    /muốn ăn/,
    /gợi ý.*(món|quán|ăn|đồ uống|nước)/,
    /(tìm|kiếm).*quán/,
    /quán.*(ngon|gần|ở đâu)/,
    /(ăn sáng|ăn trưa|ăn tối|ăn khuya)/,
    /(bữa sáng|bữa trưa|bữa tối)/,
    /thèm/,
    /(món nào|quán nào).*(ngon|ổn|hợp)/,
    /(đi ăn|ăn ở đâu)/,
    /(near me|nearby|restaurant|food|meal|lunch|dinner|breakfast)/,
    /an gi/,
    /an mon gi/,
    /mon gi/,
    /mon gif/,
    /mon nao/,
    /mon .*di/,
    /mon an/,
    /muon an/,
    /goi y.*(mon|quan|an|do uong|nuoc)/,
    /(tim|kiem).*quan/,
    /quan.*(ngon|gan|o dau)/,
    /(an sang|an trua|an toi|an khuya)/,
    /(bua sang|bua trua|bua toi)/,
    /them/,
    /(mon nao|quan nao).*(ngon|on|hop)/,
    /(di an|an o dau)/,
    /(pho|bun|com|mi|my|hu tieu|banh mi|banh xeo|lau|bbq|ga ran|tra sua|cafe|ca phe)/,
  ].some((pattern) => pattern.test(text) || pattern.test(plainText));
}

function detectTasteInsightQuestion(query: string) {
  const text = query.toLowerCase().normalize("NFC");
  const plainText = removeVietnameseMarks(text);
  return [
    /biết gu.*(mình|tui|tôi|tao|em|anh|chị)/,
    /(gu|khẩu vị|sở thích).*(mình|tui|tôi|tao|em|anh|chị)/,
    /(mình|tui|tôi|tao|em|anh|chị).*(thích ăn gì|hay ăn gì|gu gì|khẩu vị gì|sở thích ăn)/,
    /ban biet gu.*(minh|tui|toi|tao|em|anh|chi)/,
    /(gu|khau vi|so thich).*(minh|tui|toi|tao|em|anh|chi)/,
    /(minh|tui|toi|tao|em|anh|chi).*(thich an gi|hay an gi|gu gi|khau vi gi|so thich an)/,
  ].some((pattern) => pattern.test(text) || pattern.test(plainText));
}

function foodSearchQuery(query: string) {
  const text = stringValue(query).toLowerCase().normalize("NFC");
  const plainText = removeVietnameseMarks(text);
  const knownFoods = [
    ["phở", "pho"],
    ["bún", "bun"],
    ["cơm", "com"],
    ["mì", "mi"],
    ["mỳ", "my"],
    ["hủ tiếu", "hu tieu"],
    ["bánh mì", "banh mi"],
    ["bánh xèo", "banh xeo"],
    ["lẩu", "lau"],
    ["bbq", "bbq"],
    ["gà rán", "ga ran"],
    ["trà sữa", "tra sua"],
    ["cà phê", "ca phe"],
    ["cafe", "cafe"],
  ];
  for (const [accented, plain] of knownFoods) {
    if (text.includes(accented) || plainText.includes(plain)) return accented;
  }

  const cleaned = plainText
    .replace(/\b(cho|tui|minh|toi|ban|peuin|goi|y|tim|kiem|mon|an|gi|gif|cung|duoc|di|nha|nhe|ngon|gan|day)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length >= 2 && cleaned.length <= 40 ? cleaned : "";
}

function refineCandidatesForDrinkQuery(
  query: string,
  candidates: PublicFeedFoodCandidate[],
) {
  const requestedDrink = requestedDrinkLabel(query);
  if (!requestedDrink) return candidates;

  const exactCandidates = candidates.filter((candidate) =>
    candidateMatchesRequestedDrink(candidate, requestedDrink)
  );
  if (exactCandidates.length > 0) return exactCandidates;

  return candidates.filter((candidate) => candidateLooksLikeDrink(candidate));
}

function requestedDrinkLabel(query: string) {
  const text = stringValue(query).toLowerCase().normalize("NFC");
  const plainText = removeVietnameseMarks(text);
  const requestedDrinks = [
    ["trà sữa", "tra sua"],
    ["cà phê", "ca phe"],
    ["cafe", "cafe"],
    ["trà đào", "tra dao"],
    ["trà chanh", "tra chanh"],
    ["trà trái cây", "tra trai cay"],
    ["matcha", "matcha"],
    ["sinh tố", "sinh to"],
    ["nước ép", "nuoc ep"],
    ["soda", "soda"],
  ];
  for (const [label, plain] of requestedDrinks) {
    if (text.includes(label) || plainText.includes(plain)) return label;
  }
  if (/(đồ uống|thức uống|nước uống|do uong|thuc uong|nuoc uong)/.test(plainText)) {
    return "thức uống";
  }
  return "";
}

function candidateMatchesRequestedDrink(
  candidate: PublicFeedFoodCandidate,
  requestedDrink: string,
) {
  if (!requestedDrink || requestedDrink === "thức uống") {
    return candidateLooksLikeDrink(candidate);
  }
  const haystack = candidateHaystack(candidate);
  const plainHaystack = candidatePlainHaystack(candidate);
  const plainDrink = removeVietnameseMarks(requestedDrink.toLowerCase());
  return haystack.includes(requestedDrink.toLowerCase()) ||
    plainHaystack.includes(plainDrink);
}

function candidateLooksLikeDrink(candidate: PublicFeedFoodCandidate) {
  const haystack = candidatePlainHaystack(candidate);
  return [
    "tra sua",
    "tra dao",
    "tra chanh",
    "tra trai cay",
    "hong tra",
    "luc tra",
    "matcha",
    "cafe",
    "ca phe",
    "bac xiu",
    "latte",
    "espresso",
    "sinh to",
    "nuoc ep",
    "nuoc mia",
    "soda",
    "smoothie",
    "juice",
    "milo",
    "cacao",
  ].some((keyword) => haystack.includes(keyword));
}

function candidateHaystack(candidate: PublicFeedFoodCandidate) {
  return [
    candidate.food_title,
    candidate.caption,
    candidate.place_name,
    candidate.place_address,
  ].join(" ").toLowerCase();
}

function candidatePlainHaystack(candidate: PublicFeedFoodCandidate) {
  return candidate.searchable_text_plain ||
    removeVietnameseMarks(candidateHaystack(candidate));
}

function buildUserProfileContext(
  profile: Json | null,
  user: { id?: unknown; email?: unknown; user_metadata?: unknown },
): Json {
  const displayName = profileDisplayName(profile);
  const username = stringValue(profile?.username);
  const accountEmail = stringValue(user.email);
  const emailName = accountEmail.includes("@") ? accountEmail.split("@")[0] : accountEmail;
  const metadata = objectValue(user.user_metadata);
  return {
    user_id: stringValue(user.id),
    display_name: displayName || profileDisplayName(metadata),
    username,
    preferred_name: displayName || username || profileDisplayName(metadata) || emailName,
    bio: stringValue(profile?.bio),
    is_private: booleanValue(profile?.is_private),
  };
}

type MealFilters = {
  local_time: string;
  meal_period: string;
  budget_thousands: number | null;
  taste: string;
  max_distance_km: number | null;
};

const MEAL_PERIOD_HINTS: Record<string, string[]> = {
  earlyMorning: ["sáng sớm", "cà phê", "ca phe", "bánh mì", "banh mi"],
  breakfast: ["sáng", "sang", "breakfast", "phở sáng", "pho sang", "cà phê", "ca phe"],
  lunch: ["trưa", "trua", "lunch", "cơm trưa", "com trua", "bún", "bun"],
  afternoon: ["chiều", "chieu", "xế", "xe", "trà sữa", "tra sua", "cafe", "bánh"],
  dinner: ["tối", "toi", "dinner", "lẩu", "lau", "nhậu", "nhau", "bbq"],
  lateNight: ["khuya", "đêm", "dem", "sup", "ăn đêm", "an dem"],
};

const TASTE_HINTS: Record<string, string[]> = {
  any: [],
  spicy: ["cay", "spicy", "ớt", "ot", "kim chi", "mala", "lẩu cay"],
  mild: ["nhẹ", "nhe", "thanh", "healthy", "salad", "chay"],
  sweet: ["ngọt", "ngot", "sweet", "dessert", "bánh", "banh", "trà sữa"],
  salty: ["mặn", "man", "savory", "cơm", "com", "mì", "mi"],
};

const MEAL_PERIOD_LABELS: Record<string, string> = {
  earlyMorning: "sáng sớm",
  breakfast: "buổi sáng",
  lunch: "buổi trưa",
  afternoon: "buổi xế",
  dinner: "buổi tối",
  lateNight: "khuya",
};

function parseMealFilters(raw: unknown): MealFilters | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const mealPeriod = stringValue(value.meal_period ?? value.mealPeriod);
  if (!mealPeriod) return null;

  const budgetRaw = value.budget_thousands ?? value.budgetThousands;
  const budget = budgetRaw == null ? null : Number(budgetRaw);
  const distanceRaw = value.max_distance_km ?? value.maxDistanceKm;
  const distance = distanceRaw == null ? null : Number(distanceRaw);

  return {
    local_time: stringValue(value.local_time ?? value.localTime) || new Date().toISOString(),
    meal_period: mealPeriod,
    budget_thousands: Number.isFinite(budget) ? budget : null,
    taste: stringValue(value.taste) || "any",
    max_distance_km: Number.isFinite(distance) ? distance : null,
  };
}

function mealFilterCandidateBonus(
  haystack: string,
  priceLabel: string,
  filters: MealFilters,
): number {
  let score = 0;
  const text = haystack.toLowerCase();

  for (const keyword of MEAL_PERIOD_HINTS[filters.meal_period] ?? []) {
    if (text.includes(keyword)) score += 4;
  }

  for (const keyword of TASTE_HINTS[filters.taste] ?? []) {
    if (text.includes(keyword)) score += 3;
  }

  const budget = filters.budget_thousands;
  if (budget != null) {
    const priceK = parseMealFilterPriceThousands(priceLabel);
    if (priceK != null) {
      if (priceK <= budget) score += 5;
      else if (priceK <= budget * 1.25) score += 1;
      else score -= 4;
    }
  }

  return score;
}

function mealFiltersPromptBlock(filters: MealFilters | null): string {
  if (!filters) return "Bộ lọc bữa ăn: không có, hãy suy luận từ câu hỏi và giờ địa phương.";

  const periodLabel = MEAL_PERIOD_LABELS[filters.meal_period] ?? filters.meal_period;
  const budget = filters.budget_thousands == null
    ? "không giới hạn"
    : `~${filters.budget_thousands}K`;
  const taste = filters.taste === "any" ? "không chọn vị cụ thể" : filters.taste;
  const distance = filters.max_distance_km == null
    ? "không giới hạn khoảng cách"
    : `trong ~${filters.max_distance_km}km`;

  return [
    "Bộ lọc bữa ăn từ thiết bị của người dùng:",
    `- Giờ địa phương: ${filters.local_time}`,
    `- Khung bữa: ${periodLabel} (${filters.meal_period})`,
    `- Ngân sách: ${budget}`,
    `- Vị ưu tiên: ${taste}`,
    `- Khoảng cách: ${distance}`,
    "Ưu tiên lựa chọn hợp khung bữa và khẩu vị; nếu có price_label thì tôn trọng ngân sách.",
  ].join("\n");
}

function parseMealFilterPriceThousands(raw: string): number | null {
  const digits = stringValue(raw).replace(/[^0-9]/g, "");
  if (!digits) return null;
  const value = Number(digits);
  if (!Number.isFinite(value)) return null;
  if (value >= 1000) return Math.round(value / 1000);
  return value;
}

function publicFeedCandidateScore(
  candidate: PublicFeedFoodCandidate,
  query: string,
  mealFilters: MealFilters | null = null,
) {
  const haystack = candidateHaystack(candidate);
  const plainHaystack = candidatePlainHaystack(candidate);
  const tokens = uniqueStrings(
    removeVietnameseMarks(query.toLowerCase())
      .split(/[^\p{L}\p{N}]+/u)
      .filter((token) => token.length >= 3),
  );
  const tokenScore = tokens.reduce(
    (score, token) => score + (plainHaystack.includes(token) ? 3 : 0),
    0,
  );
  const filterBonus = mealFilters
    ? mealFilterCandidateBonus(haystack, candidate.price_label, mealFilters)
    : 0;
  return tokenScore + filterBonus + Math.min(candidate.reaction_count, 20) / 10;
}

function avatarPublicUrl(rawPath: string) {
  const path = stringValue(rawPath)
    .replace(/^\/+/, "")
    .replace(/^avata\//, "")
    .trim();
  if (!path) return "";
  if (/^https?:\/\//i.test(path)) return path;
  const supabaseUrl = stringValue(env.SUPABASE_URL).replace(/\/+$/, "");
  if (!supabaseUrl) return "";
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  return `${supabaseUrl}/storage/v1/object/public/avata/${encodedPath}`;
}

function publicPostMediaUrl(rawPath: string) {
  const path = stringValue(rawPath)
    .replace(/^\/+/, "")
    .replace(/^post-media\//, "")
    .trim();
  if (!path) return "";
  if (/^https?:\/\//i.test(path)) return path;
  const supabaseUrl = stringValue(env.SUPABASE_URL).replace(/\/+$/, "");
  if (!supabaseUrl) return "";
  const encodedPath = path.split("/").map(encodeURIComponent).join("/");
  return `${supabaseUrl}/storage/v1/object/public/post-media/${encodedPath}`;
}

function compactHistoryContent(content: string) {
  const parsed = parseJsonObject(content);
  if (!parsed) return content.slice(0, 1200);
  const topPick = objectValue(parsed.top_pick);
  return [
    stringValue(parsed.reply),
    stringValue(parsed.reasoning),
    stringValue(topPick.food_title) || stringValue(topPick.place_name)
      ? `Top pick: ${stringValue(topPick.food_title)} at ${stringValue(topPick.place_name)}`
      : "",
  ].filter(Boolean).join("\n").slice(0, 1200);
}

function firstStickerLabel(stickers: Json[], type: string) {
  return stringValue(
    stickers.find((sticker) => stringValue(sticker.sticker_type) === type)?.label,
  );
}

function firstFoodFromCaption(caption: string) {
  return caption.split(/[,.#@\n]/)[0]?.trim() ?? "";
}

function groupBy(rows: Json[], key: string) {
  const output = new Map<string, Json[]>();
  for (const row of rows) {
    const id = stringValue(row[key]);
    if (id) output.set(id, [...(output.get(id) ?? []), row]);
  }
  return output;
}

function firstBy(rows: Json[], key: string) {
  const output = new Map<string, Json>();
  for (const row of rows) {
    const id = stringValue(row[key]);
    if (id && !output.has(id)) output.set(id, row);
  }
  return output;
}

async function selectMany(query: PromiseLike<{ data: unknown; error: unknown }>) {
  const { data, error } = await query;
  if (error) throw error;
  return Array.isArray(data) ? data as Json[] : [];
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function uniqueCandidatesByPostId(candidates: PublicFeedFoodCandidate[]) {
  const seen = new Set<string>();
  const output: PublicFeedFoodCandidate[] = [];
  for (const candidate of candidates) {
    if (!candidate.post_id || seen.has(candidate.post_id)) continue;
    seen.add(candidate.post_id);
    output.push(candidate);
  }
  return output;
}

function formatRelativeTimeAgo(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const diffMs = Date.now() - date.getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "vừa xong";
  if (minutes < 60) return `${minutes} phút trước`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} giờ trước`;
  const days = Math.floor(hours / 24);
  return `${days} ngày trước`;
}

function elapsedMs(startedAt: number) {
  return Math.round(performance.now() - startedAt);
}

function normalizeChatRole(role: string): ChatRole {
  if (role === "assistant" || role === "system") return role;
  return "user";
}

function removeVietnameseMarks(value: string) {
  return value.normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D");
}

function isPeuinIdentityChat(text: string): boolean {
  const q = text.toLowerCase().normalize("NFC");
  if (!q.includes("peuin")) {
    return /(bạn là ai|ban la ai|ai đây|tên bạn|ten ban|biết tên bạn|biet ten ban)/.test(q);
  }
  return /(bạn là peuin|ban la peuin|peuin chứ ai|peuin ơi|peuin oi|tên bạn|ten ban|biết tên bạn|biet ten ban|ai là peuin|đúng hăm|dung ham|không nhầm.*peuin|khong nham.*peuin)/.test(q);
}

function isUserNameQuestion(text: string): boolean {
  const q = text.toLowerCase().normalize("NFC");
  if (isPeuinIdentityChat(q)) return false;
  return /(tên mình|ten minh|tên tui|ten tui|tên của mình|ten cua minh|biết tên mình|biet ten minh|biết tên tui|tên tôi là gì|mình tên gì)/.test(q);
}

function guardChatReply(
  reply: string,
  userPreferredName: string,
  assistantName = "Peuin",
): string {
  const trimmed = reply.trim();
  if (!trimmed) return trimmed;

  const userName = userPreferredName.trim();
  const userIsPeuin = userName.toLowerCase() === assistantName.toLowerCase();
  const wronglyCallsUserPeuin =
    /(tên (hiển thị |)(của )?bạn (là |đều là )?peuin|tên bạn là peuin|bạn tên peuin)/i.test(trimmed) ||
    /(display name|tên hiển thị).{0,20}peuin/i.test(trimmed);

  if (!userIsPeuin && userName && wronglyCallsUserPeuin) {
    return `Biết chứ, ${userName} mà! Còn Peuin là tui, trợ lý ăn uống trong app nè.`;
  }

  return trimmed;
}

function profileDisplayName(profile?: Json | null) {
  return stringValue(profile?.display_name) ||
    stringValue(profile?.full_name) ||
    stringValue(profile?.name) ||
    stringValue(profile?.username);
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value);
}

function objectValue(value: unknown): Json {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Json
    : {};
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function booleanValue(value: unknown, fallback = false) {
  if (typeof value === "boolean") return value;
  const text = stringValue(value).toLowerCase();
  if (text === "true") return true;
  if (text === "false") return false;
  return fallback;
}

function parseJsonObject(value: string): Json | null {
  const text = stringValue(value);
  if (!text) return null;
  const direct = parseJson(text);
  if (direct) return direct;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  return start >= 0 && end > start ? parseJson(text.slice(start, end + 1)) : null;
}

function parseJson(value: string): Json | null {
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed as Json
      : null;
  } catch {
    return null;
  }
}

function jsonResponse(body: Json, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    return stringValue((error as { message?: unknown }).message);
  }
  if (typeof error === "string" && error.trim()) return error.trim();
  return "Có lỗi xảy ra khi chat với Peuin.";
}

function publicErrorMessage(error: unknown) {
  if (error instanceof PersonalityUpstreamError) {
    return "Peuin đang bận một chút, bạn thử lại sau nha.";
  }
  return errorMessage(error);
}

class PersonalityUpstreamError extends Error {
  status: number;

  constructor(status: number, details: string) {
    super(`Personality function error: ${status} ${details}`);
    this.status = status >= 400 && status < 600 ? status : 503;
  }
}

type PublicFeedFoodCandidate = {
  post_id: string;
  author_name: string;
  author_avatar_url: string;
  author_username: string;
  place_name: string;
  place_address: string;
  food_title: string;
  caption: string;
  price_label: string;
  media_url: string;
  created_at: string;
  reaction_count: number;
  searchable_text_plain?: string;
};

export async function handleAskPeuin(request: PortedRequest): Promise<Response> {

  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return jsonResponse({ error: "ask-peuin chỉ hỗ trợ POST." }, 405);
  }

  try {
    const startedAt = performance.now();
    const body = await request.json().catch(() => ({}));
    const action = stringValue(body.action);
    const supabase = createRequestClient(request);
    const { user } = await requireUser(supabase);

    if (action === "get_today_session" || action === "getTodaySession") {
      return jsonResponse(await getTodaySession(supabase), 200);
    }
    if (
      action === "recommendation_feedback" ||
      action === "recommendationFeedback"
    ) {
      return jsonResponse(await handleRecommendationFeedback(supabase, user.id, body), 200);
    }

    const query = stringValue(body.query);
    if (!query) return jsonResponse({ error: "Thiếu query." }, 400);

    let sessionId = stringValue(body.session_id ?? body.sessionId);
    if (!sessionId) {
      sessionId = (await getOrCreateTodaySession(supabase)).session_id;
    }
    await requireOwnedSession(supabase, sessionId, user.id);
    runBackgroundTask(
      ensureUserFoodProfile(supabase, user.id),
      "ensureUserFoodProfile",
    );
    const authMs = elapsedMs(startedAt);

    const mealFilters = parseMealFilters(body.meal_filters ?? body.mealFilters);
    const shouldRecommendFood = detectFoodRecommendationIntent(query) &&
      !isPeuinIdentityChat(query) &&
      !isUserNameQuestion(query);
    const shouldInferTasteFromPosts = detectTasteInsightQuestion(query);
    const previousPostIdsPromise = shouldRecommendFood
      ? fetchExcludedRecommendationPostIds(supabase, sessionId, user.id)
      : Promise.resolve(new Set<string>());
    const userMessagePromise = insertChatMessage(supabase, sessionId, "user", query)
      .catch((error) => {
        console.warn("User chat message write skipped:", errorMessage(error));
        return "";
      });
    const [profile, history, foodMemoryContext, publicFeedCandidates] = await Promise.all([
      fetchProfile(supabase, user.id),
      fetchChatHistory(supabase, sessionId),
      fetchUserFoodMemoryContext(supabase, user.id, {
        includeUserPostTasteSummary: shouldInferTasteFromPosts,
      }),
      shouldRecommendFood
        ? previousPostIdsPromise.then((previousPostIds) =>
          fetchPublicFeedFoodCandidates(
            supabase,
            user.id,
            query,
            previousPostIds,
            mealFilters,
          )
        )
        : Promise.resolve([]),
    ]);
    const previousPostIds = shouldRecommendFood
      ? await previousPostIdsPromise
      : new Set<string>();
    const contextMs = elapsedMs(startedAt) - authMs;

    const profileContext = buildUserProfileContext(profile, user);
    const preferredName = stringValue(profileContext.preferred_name) || "bạn";

    const aiContent = shouldRecommendFood && publicFeedCandidates.length === 0
      ? JSON.stringify(noMatchingPostResponse(previousPostIds.size > 0, query))
      : await askPersonality({
        request,
        preferredName,
        history,
        query,
        profileContext,
        foodMemoryContext,
        publicFeedCandidates,
        shouldRecommendFood,
        mealFilters,
      });
    const personalityMs = elapsedMs(startedAt) - authMs - contextMs;

    const userMessageId = await userMessagePromise;
    const parsedContent = parseJsonObject(aiContent);
    const recommendationContext = normalizeAssistantContext({
      parsedContent,
      aiContent,
      preferredName,
      shouldRecommendFood,
      publicFeedCandidates,
      query,
    });
    const reply = stringValue(recommendationContext.reply);
    const assistantStoredContent = JSON.stringify(recommendationContext);
    const assistantMessageId = await insertChatMessage(
      supabase,
      sessionId,
      "assistant",
      assistantStoredContent,
    );

    let recommendationId = "";
    if (
      stringValue(recommendationContext.answer_type) === "food_recommendation" &&
      stringValue(objectValue(recommendationContext.top_pick).post_id)
    ) {
      try {
        recommendationId = await saveAiRecommendation({
          supabase,
          userId: user.id,
          sessionId,
          query,
          recommendationContext,
        });
      } catch (error) {
        console.error("Saving AI recommendation failed:", errorMessage(error));
      }
    }

    runBackgroundTask(
      Promise.allSettled([
        insertUserFoodMemoryEvents(supabase, {
          userId: user.id,
          sessionId,
          messageId: assistantMessageId,
          recommendationContext,
        }),
        syncUserFoodProfile(supabase, {
          userId: user.id,
          recommendationContext,
        }),
        insertChatTrainingData(supabase, {
          userId: user.id,
          sessionId,
          userMessageId,
          assistantMessageId,
          recommendationId,
          query,
          response: reply,
          answerType: stringValue(recommendationContext.answer_type),
          recommendationContext,
          model: env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL,
        }),
      ]).then((results) => {
        for (const result of results) {
          if (result.status === "rejected") {
            console.warn("Ask Peuin post-save task skipped:", errorMessage(result.reason));
          }
        }
      }),
      "ask-peuin post-save",
    );

    const totalMs = elapsedMs(startedAt);
    const timings = {
      authMs,
      contextMs,
      personalityMs,
      saveMs: totalMs - authMs - contextMs - personalityMs,
      totalMs,
    };
    console.info("ask-peuin timings", timings);

    return jsonResponse({
      success: true,
      session_id: sessionId,
      recommendation_id: recommendationId,
      reply,
      recommendationContext,
      personality: {
        source: shouldRecommendFood && publicFeedCandidates.length === 0
          ? "ask-peuin"
          : "personality",
      },
      timings,
    }, 200);
  } catch (error) {
    console.error("Error in ask-peuin:", error);
    const status = error instanceof PersonalityUpstreamError ? 502 : 400;
    return jsonResponse({ error: publicErrorMessage(error) }, status);
  }

}
