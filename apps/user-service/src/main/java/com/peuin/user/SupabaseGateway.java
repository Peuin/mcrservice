package com.peuin.user;

import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Mono;

@Component
class SupabaseGateway {
  private final WebClient client;
  private final String anonKey;

  SupabaseGateway(WebClient.Builder builder, @Value("${peuin.supabase.url}") String url, @Value("${peuin.supabase.anon-key}") String anonKey) {
    this.anonKey = anonKey;
    this.client = builder.baseUrl(url.replaceAll("/+$", "")).defaultHeader("apikey", anonKey).build();
  }

  Mono<Object> rpc(String schema, String name, Map<String, Object> body, String authorization) {
    return client.post().uri("/rest/v1/rpc/{name}", name)
        .headers(headers -> authHeaders(headers, authorization, schema))
        .bodyValue(body).retrieve().bodyToMono(Object.class);
  }

  Mono<Object> table(String schema, String table, String query, String authorization) {
    String uri = "/rest/v1/" + table + (query == null || query.isBlank() ? "" : "?" + query);
    return client.get().uri(uri)
        .headers(headers -> authHeaders(headers, authorization, schema))
        .retrieve().bodyToMono(Object.class);
  }

  private void authHeaders(HttpHeaders headers, String authorization, String schema) {
    headers.set(HttpHeaders.AUTHORIZATION, authorization == null || authorization.isBlank() ? "Bearer " + anonKey : authorization);
    if (schema != null && !schema.isBlank()) {
      headers.set("Accept-Profile", schema);
      headers.set("Content-Profile", schema);
    }
  }
}
