package com.peuin.search;

import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Mono;

@RestController
class SearchController {
  private final WebClient supabase;
  private final WebClient web;
  private final String anonKey;
  private final String goongKey;
  private final String vietmapKey;

  SearchController(WebClient.Builder builder,
      @Value("${peuin.supabase.url}") String supabaseUrl,
      @Value("${peuin.supabase.anon-key}") String anonKey,
      @Value("${peuin.goong.place-api-key}") String goongKey,
      @Value("${peuin.vietmap.api-key}") String vietmapKey) {
    this.anonKey = anonKey;
    this.goongKey = goongKey;
    this.vietmapKey = vietmapKey;
    this.supabase = builder.baseUrl(supabaseUrl.replaceAll("/+$", "")).defaultHeader("apikey", anonKey).build();
    this.web = builder.build();
  }

  @GetMapping({"/app-search", "/search/app-search"})
  Mono<Map<String, Object>> appSearch(@RequestParam(defaultValue = "") String q,
      @RequestParam(defaultValue = "8") int limit,
      @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String auth) {
    Mono<Object> users = rpc("public", "search_users", Map.of("search_query", q, "result_limit", limit), auth);
    Mono<Object> places = rpc("public", "search_places", Map.of("search_query", q, "result_limit", limit), auth);
    Mono<Object> foods = rpc("public", "search_foods", Map.of("search_query", q, "result_limit", limit), auth);
    return Mono.zip(users, places, foods).map(tuple -> Map.of("users", tuple.getT1(), "places", tuple.getT2(), "foods", tuple.getT3()));
  }

  @GetMapping({"/app-search/posts", "/search/app-search/posts"})
  Mono<Object> posts(@RequestParam Map<String, String> query, @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String auth) {
    if (query.containsKey("placeId")) {
      return rpc("public", "search_posts_by_place", Map.of("p_place_id", query.get("placeId"), "p_limit", query.getOrDefault("limit", "20")), auth);
    }
    return rpc("public", "search_posts_by_food", Map.of("p_food", query.getOrDefault("food", ""), "p_limit", query.getOrDefault("limit", "20")), auth);
  }

  @GetMapping({"/goong-place-search", "/search/goong-place-search"})
  Mono<Object> goong(@RequestParam(defaultValue = "") String q, @RequestParam(defaultValue = "10") int limit) {
    return web.get().uri(uri -> uri.scheme("https").host("rsapi.goong.io").path("/Place/AutoComplete")
        .queryParam("api_key", goongKey).queryParam("input", q).queryParam("limit", limit).build())
        .retrieve().bodyToMono(Object.class);
  }

  @GetMapping({"/vietmap-place-search", "/search/vietmap-place-search"})
  Mono<Object> vietmap(@RequestParam(defaultValue = "") String q, @RequestParam(defaultValue = "10") int limit) {
    return web.get().uri(uri -> uri.scheme("https").host("maps.vietmap.vn").path("/api/autocomplete/v3")
        .queryParam("apikey", vietmapKey).queryParam("text", q).queryParam("size", limit).build())
        .retrieve().bodyToMono(Object.class);
  }

  private Mono<Object> rpc(String schema, String name, Map<String, ?> body, String auth) {
    return supabase.post().uri("/rest/v1/rpc/{name}", name)
        .headers(h -> {
          h.set(HttpHeaders.AUTHORIZATION, auth == null || auth.isBlank() ? "Bearer " + anonKey : auth);
          h.set("Accept-Profile", schema);
          h.set("Content-Profile", schema);
        })
        .bodyValue(body).retrieve().bodyToMono(Object.class);
  }
}
