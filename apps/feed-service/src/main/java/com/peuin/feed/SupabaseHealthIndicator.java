package com.peuin.feed;

import org.springframework.boot.actuate.health.Health;
import org.springframework.boot.actuate.health.HealthIndicator;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.client.WebClient;
import org.springframework.data.redis.core.ReactiveRedisTemplate;

@Component("supabase")
public class SupabaseHealthIndicator implements HealthIndicator {

  private final WebClient webClient;
  private final String supabaseUrl;

  public SupabaseHealthIndicator(
    @org.springframework.beans.factory.annotation.Value("${peuin.supabase.url}") String supabaseUrl
  ) {
    this.supabaseUrl = supabaseUrl;
    this.webClient = WebClient.builder()
      .baseUrl(supabaseUrl + "/rest/v1/")
      .build();
  }

  @Override
  public Health health() {
    try {
      webClient.get()
        .uri("headers")
        .retrieve()
        .toBodilessEntity()
        .timeout(java.time.Duration.ofSeconds(5))
        .block();

      return Health.up()
        .withDetail("service", "Supabase")
        .withDetail("url", supabaseUrl)
        .build();
    } catch (Exception e) {
      return Health.down()
        .withDetail("service", "Supabase")
        .withDetail("error", e.getMessage())
        .build();
    }
  }
}
