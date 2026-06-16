package com.peuin.user;

import java.util.Map;
import org.springframework.http.HttpHeaders;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import reactor.core.publisher.Mono;

@RestController
class UserController {
  private final SupabaseGateway supabase;

  UserController(SupabaseGateway supabase) {
    this.supabase = supabase;
  }

  @GetMapping({"/profile", "/user/profile"})
  Mono<Object> profile(@RequestParam Map<String, String> query, @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String auth) {
    if (query.containsKey("username")) return supabase.table("public", "profiles", "select=*&username=eq." + query.get("username") + "&limit=1", auth);
    if (query.containsKey("userId")) return supabase.table("public", "profiles", "select=*&id=eq." + query.get("userId") + "&limit=1", auth);
    return supabase.table("public", "profiles", "select=*&limit=1", auth);
  }

  @PostMapping({"/profile", "/user/profile"})
  Mono<Object> updateProfile(@RequestBody Map<String, Object> body, @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String auth) {
    return supabase.rpc("public", "upsert_profile_from_api", body, auth);
  }

  @GetMapping({"/friends", "/user/friends"})
  Mono<Object> friends(@RequestParam(defaultValue = "50") int limit, @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String auth) {
    return supabase.rpc("social", "list_friends", Map.of("p_limit", limit), auth);
  }

  @PostMapping({"/friends", "/user/friends"})
  Mono<Object> friendAction(@RequestBody Map<String, Object> body, @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String auth) {
    String action = String.valueOf(body.getOrDefault("action", "send_request"));
    String rpc = switch (action) {
      case "accept" -> "accept_friend_request";
      case "decline" -> "decline_friend_request";
      case "remove" -> "remove_friend";
      case "cancel" -> "cancel_friend_request";
      default -> "send_friend_request";
    };
    return supabase.rpc("social", rpc, body, auth);
  }

  @PostMapping({"/personality", "/user/personality"})
  Mono<Map<String, Object>> personality(@RequestBody Map<String, Object> body) {
    return Mono.just(Map.of("ok", true, "message", "Port Gemini prompt logic from BE/functions/personality/index.ts here.", "input", body));
  }

  @PostMapping({"/ask-peuin", "/user/ask-peuin"})
  Mono<Object> askPeuin(@RequestBody Map<String, Object> body, @RequestHeader(value = HttpHeaders.AUTHORIZATION, required = false) String auth) {
    return supabase.rpc("ai", "ask_peuin_food_candidates", body, auth);
  }
}
