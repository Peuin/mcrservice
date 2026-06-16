package com.peuin.feed;

import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Mono;

@RestController
class FeedController {
  private final WebClient client;
  private final String anonKey;

  FeedController(WebClient.Builder builder, @Value("${peuin.supabase.url}") String url, @Value("${peuin.supabase.anon-key}") String anonKey) {
    this.anonKey = anonKey;
    this.client = builder.baseUrl(url.replaceAll("/+$", "")).defaultHeader("apikey", anonKey).build();
  }

  @GetMapping({"/home-feed", "/feed/home-feed"})
  Mono<Object> homeFeed(@RequestParam(defaultValue = "20") int limit, @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String auth) {
    return rpc("social", "home_feed_posts", Map.of("p_limit", limit), auth);
  }

  @GetMapping({"/home-feed/post", "/feed/home-feed/post"})
  Mono<Object> post(@RequestParam String postId, @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String auth) {
    return rpc("social", "home_feed_post_by_id", Map.of("p_post_id", postId), auth);
  }

  @PostMapping({"/home-feed/love", "/feed/home-feed/love"})
  Mono<Object> love(@RequestBody Map<String, Object> body, @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String auth) {
    return rpc("social", "toggle_post_reaction", body, auth);
  }

  @GetMapping({"/journal", "/feed/journal"})
  Mono<Object> journal(@RequestParam Map<String, String> query, @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String auth) {
    return rpc("social", "journal_entries", Map.copyOf(query), auth);
  }

  @GetMapping({"/stories", "/feed/stories"})
  Mono<Object> stories(@RequestParam(defaultValue = "40") int limit, @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String auth) {
    return rpc("social", "list_stories", Map.of("p_limit", limit), auth);
  }

  @GetMapping({"/food-catalog", "/feed/food-catalog"})
  Mono<Object> foodCatalog(@RequestParam(defaultValue = "50") int limit, @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String auth) {
    return get("public", "/rest/v1/food_catalog?select=*&limit=" + limit, auth);
  }

  private Mono<Object> rpc(String schema, String name, Map<String, ?> body, String auth) {
    return client.post().uri("/rest/v1/rpc/{name}", name).headers(h -> headers(h, auth, schema)).bodyValue(body).retrieve().bodyToMono(Object.class);
  }

  private Mono<Object> get(String schema, String uri, String auth) {
    return client.get().uri(uri).headers(h -> headers(h, auth, schema)).retrieve().bodyToMono(Object.class);
  }

  private void headers(HttpHeaders h, String auth, String schema) {
    h.set(HttpHeaders.AUTHORIZATION, auth == null || auth.isBlank() ? "Bearer " + anonKey : auth);
    h.set("Accept-Profile", schema);
    h.set("Content-Profile", schema);
  }
}
