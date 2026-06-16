package com.peuin.worker;

import java.util.Arrays;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;

@RestController
class WorkerController {
  private final WebClient supabase;
  private final String serviceRoleKey;
  private final String homeFeedSecret;
  private final String appSearchSecret;
  private final int appSearchLimit;
  private final int appSearchPostsLimit;
  private final String appSearchQueries;

  WorkerController(WebClient.Builder builder,
      @Value("${peuin.supabase.url}") String supabaseUrl,
      @Value("${peuin.supabase.service-role-key}") String serviceRoleKey,
      @Value("${peuin.workers.home-feed-secret}") String homeFeedSecret,
      @Value("${peuin.workers.app-search-secret}") String appSearchSecret,
      @Value("${peuin.workers.app-search-limit}") int appSearchLimit,
      @Value("${peuin.workers.app-search-posts-limit}") int appSearchPostsLimit,
      @Value("${peuin.workers.app-search-queries}") String appSearchQueries) {
    this.serviceRoleKey = serviceRoleKey;
    this.homeFeedSecret = homeFeedSecret;
    this.appSearchSecret = appSearchSecret;
    this.appSearchLimit = appSearchLimit;
    this.appSearchPostsLimit = appSearchPostsLimit;
    this.appSearchQueries = appSearchQueries;
    this.supabase = builder.baseUrl(supabaseUrl.replaceAll("/+$", ""))
        .defaultHeader("apikey", serviceRoleKey)
        .defaultHeader(HttpHeaders.AUTHORIZATION, "Bearer " + serviceRoleKey)
        .build();
  }

  @PostMapping({"/home-feed-warm", "/worker/home-feed-warm"})
  Mono<ResponseEntity<Map<String, Object>>> warmHomeFeed(@RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String auth,
      @RequestHeader(value = "x-cron-secret", required = false) String cronSecret) {
    if (!authorized(auth, cronSecret, homeFeedSecret)) return Mono.just(ResponseEntity.status(401).body(Map.<String, Object>of("error", "Unauthorized")));
    return rpc("social", "home_feed_posts", Map.of("p_limit", 20)).thenReturn(ResponseEntity.ok(Map.of("ok", true, "worker", "home-feed-warm")));
  }

  @PostMapping({"/app-search-warm", "/worker/app-search-warm"})
  Mono<ResponseEntity<Map<String, Object>>> warmAppSearch(@RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String auth,
      @RequestHeader(value = "x-cron-secret", required = false) String cronSecret) {
    if (!authorized(auth, cronSecret, appSearchSecret)) return Mono.just(ResponseEntity.status(401).body(Map.<String, Object>of("error", "Unauthorized")));
    return Flux.fromArray(appSearchQueries.split(","))
        .flatMap(q -> rpc("public", "search_users", Map.of("search_query", q.trim(), "result_limit", appSearchLimit)))
        .then(rpc("public", "search_top_place_ids", Map.of("p_limit", appSearchPostsLimit)))
        .thenReturn(ResponseEntity.ok(Map.of("ok", true, "worker", "app-search-warm", "queries", Arrays.asList(appSearchQueries.split(",")))));
  }

  private boolean authorized(String auth, String cronSecret, String expectedSecret) {
    return ("Bearer " + serviceRoleKey).equals(auth) || (expectedSecret != null && !expectedSecret.isBlank() && expectedSecret.equals(cronSecret));
  }

  private Mono<Object> rpc(String schema, String name, Map<String, ?> body) {
    return supabase.post().uri("/rest/v1/rpc/{name}", name)
        .header("Accept-Profile", schema)
        .header("Content-Profile", schema)
        .bodyValue(body).retrieve().bodyToMono(Object.class);
  }
}
