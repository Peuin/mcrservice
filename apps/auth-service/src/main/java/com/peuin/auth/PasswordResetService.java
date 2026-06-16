package com.peuin.auth;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.HexFormat;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ThreadLocalRandom;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Service;
import org.springframework.web.reactive.function.client.WebClient;
import reactor.core.publisher.Mono;

@Service
class PasswordResetService {
  private final WebClient supabase;
  private final WebClient resend;
  private final String serviceRoleKey;
  private final String otpSecret;
  private final String resendApiKey;
  private final String resendFrom;
  private final String resendReplyTo;
  private final int ttlMinutes;
  private final int maxAttempts;
  private final int minPasswordLength;

  PasswordResetService(
      WebClient.Builder builder,
      @Value("${peuin.supabase.url}") String supabaseUrl,
      @Value("${peuin.supabase.service-role-key}") String serviceRoleKey,
      @Value("${peuin.otp.hash-secret}") String otpSecret,
      @Value("${peuin.resend.api-key}") String resendApiKey,
      @Value("${peuin.resend.from-email}") String resendFrom,
      @Value("${peuin.resend.reply-to}") String resendReplyTo,
      @Value("${peuin.otp.ttl-minutes}") int ttlMinutes,
      @Value("${peuin.otp.max-attempts}") int maxAttempts,
      @Value("${peuin.otp.min-password-length}") int minPasswordLength) {
    this.serviceRoleKey = serviceRoleKey;
    this.otpSecret = otpSecret;
    this.resendApiKey = resendApiKey;
    this.resendFrom = resendFrom;
    this.resendReplyTo = resendReplyTo;
    this.ttlMinutes = ttlMinutes;
    this.maxAttempts = maxAttempts;
    this.minPasswordLength = minPasswordLength;
    this.supabase = builder.baseUrl(supabaseUrl.replaceAll("/+$", ""))
        .defaultHeader("apikey", serviceRoleKey)
        .defaultHeader(HttpHeaders.AUTHORIZATION, "Bearer " + serviceRoleKey)
        .build();
    this.resend = builder.baseUrl("https://api.resend.com").build();
  }

  Mono<ResponseEntity<Map<String, Object>>> requestReset(Map<String, Object> body) {
    String identifier = value(body, "emailOrUsername", "identifier");
    if (identifier.isBlank()) return bad("Vui lòng nhập email hoặc tên người dùng.");
    String email = resolveEmail(identifier);
    String otp = "%06d".formatted(ThreadLocalRandom.current().nextInt(1_000_000));
    return insertOtp(email, otp)
        .then(sendOtp(email, otp))
        .thenReturn(ok(Map.of("ok", true)));
  }

  Mono<ResponseEntity<Map<String, Object>>> verifyOtp(Map<String, Object> body) {
    String identifier = value(body, "emailOrUsername", "identifier");
    String otp = digits(value(body, "otpCode", "otp"));
    if (identifier.isBlank()) return bad("Vui lòng nhập email hoặc tên người dùng.");
    if (otp.length() != 6) return bad("Mã OTP phải gồm 6 chữ số.");
    return verifyOtpForEmail(resolveEmail(identifier), otp, false).thenReturn(ok(Map.of("ok", true)));
  }

  Mono<ResponseEntity<Map<String, Object>>> completeReset(Map<String, Object> body) {
    String identifier = value(body, "emailOrUsername", "identifier");
    String otp = digits(value(body, "otpCode", "otp"));
    String password = value(body, "newPassword", "password");
    if (identifier.isBlank()) return bad("Vui lòng nhập email hoặc tên người dùng.");
    if (otp.length() != 6) return bad("Mã OTP phải gồm 6 chữ số.");
    if (password.length() < minPasswordLength) return bad("Mật khẩu phải có ít nhất " + minPasswordLength + " ký tự.");
    String email = resolveEmail(identifier);
    return verifyOtpForEmail(email, otp, true)
        .then(findUserId(email))
        .flatMap(userId -> updatePassword(userId, password))
        .thenReturn(ok(Map.of("ok", true, "email", email)));
  }

  private Mono<Void> insertOtp(String email, String otp) {
    return supabase.post().uri("/rest/v1/password_reset_otps")
        .header("Content-Profile", "core")
        .bodyValue(Map.of("email", email, "otp_hash", hash(email, otp), "expires_at", Instant.now().plusSeconds(ttlMinutes * 60L).toString()))
        .retrieve().bodyToMono(String.class).then();
  }

  private Mono<Void> sendOtp(String email, String otp) {
    if (resendApiKey == null || resendApiKey.isBlank()) return Mono.error(new IllegalStateException("Thiếu RESEND_API_KEY."));
    Map<String, Object> payload = Map.of(
        "from", resendFrom,
        "to", List.of(email),
        "subject", "Mã đặt lại mật khẩu Peuin",
        "html", "<p>Mã OTP của bạn là <b>" + otp + "</b>. Mã hết hạn sau " + ttlMinutes + " phút.</p>",
        "text", "Ma OTP cua ban la " + otp + ". Ma het han sau " + ttlMinutes + " phut.",
        "reply_to", resendReplyTo == null ? "" : resendReplyTo);
    return resend.post().uri("/emails")
        .header(HttpHeaders.AUTHORIZATION, "Bearer " + resendApiKey)
        .bodyValue(payload)
        .retrieve().bodyToMono(String.class).then();
  }

  @SuppressWarnings("unchecked")
  private Mono<Void> verifyOtpForEmail(String email, String otp, boolean consume) {
    return supabase.get().uri(uri -> uri.path("/rest/v1/password_reset_otps")
        .queryParam("select", "id,otp_hash,attempts")
        .queryParam("email", "eq." + email)
        .queryParam("consumed_at", "is.null")
        .queryParam("expires_at", "gt." + Instant.now())
        .queryParam("order", "created_at.desc")
        .queryParam("limit", "1").build())
        .header("Accept-Profile", "core")
        .retrieve().bodyToMono(List.class)
        .flatMap(rows -> {
          if (rows.isEmpty()) return Mono.error(new IllegalArgumentException("Mã OTP đã hết hạn hoặc không hợp lệ. Vui lòng gửi lại mã."));
          Map<String, Object> row = (Map<String, Object>) rows.getFirst();
          String id = String.valueOf(row.get("id"));
          int attempts = Number.class.isInstance(row.get("attempts")) ? ((Number) row.get("attempts")).intValue() : 0;
          if (attempts >= maxAttempts) return consumeOtp(id).then(Mono.error(new IllegalArgumentException("Bạn đã nhập sai quá nhiều lần. Vui lòng gửi lại mã.")));
          if (!hash(email, otp).equals(String.valueOf(row.get("otp_hash")))) {
            int next = attempts + 1;
            Mono<Void> update = patchOtp(id, Map.of("attempts", next));
            return next >= maxAttempts
                ? update.then(consumeOtp(id)).then(Mono.error(new IllegalArgumentException("Bạn đã nhập sai quá nhiều lần. Vui lòng gửi lại mã.")))
                : update.then(Mono.error(new IllegalArgumentException("Mã OTP không đúng. Vui lòng thử lại.")));
          }
          return consume ? consumeOtp(id) : Mono.empty();
        });
  }

  private Mono<Void> patchOtp(String id, Map<String, Object> body) {
    return supabase.patch().uri("/rest/v1/password_reset_otps?id=eq.{id}", id)
        .header("Content-Profile", "core").bodyValue(body).retrieve().bodyToMono(String.class).then();
  }

  private Mono<Void> consumeOtp(String id) {
    return patchOtp(id, Map.of("consumed_at", Instant.now().toString()));
  }

  @SuppressWarnings("unchecked")
  private Mono<String> findUserId(String email) {
    return supabase.get().uri(uri -> uri.path("/rest/v1/profiles")
        .queryParam("select", "id").queryParam("email", "ilike." + email).queryParam("limit", "1").build())
        .retrieve().bodyToMono(List.class)
        .flatMap(rows -> rows.isEmpty()
            ? Mono.error(new IllegalArgumentException("Không tìm thấy tài khoản với thông tin này."))
            : Mono.just(String.valueOf(((Map<String, Object>) rows.getFirst()).get("id"))));
  }

  private Mono<Void> updatePassword(String userId, String password) {
    return supabase.put().uri("/auth/v1/admin/users/{id}", userId)
        .bodyValue(Map.of("password", password)).retrieve().bodyToMono(String.class).then();
  }

  @SuppressWarnings("unchecked")
  private String resolveEmail(String identifier) {
    String clean = identifier.trim().toLowerCase();
    if (clean.contains("@")) return clean;
    String username = clean.replaceFirst("^@+", "");
    List<Map<String, Object>> rows = supabase.get().uri(uri -> uri.path("/rest/v1/profiles")
        .queryParam("select", "email").queryParam("username", "eq." + username).queryParam("limit", "1").build())
        .retrieve().bodyToMono(List.class).block();
    if (rows == null || rows.isEmpty() || rows.getFirst().get("email") == null) {
      throw new IllegalArgumentException("Không tìm thấy tài khoản với thông tin này.");
    }
    return String.valueOf(rows.getFirst().get("email")).toLowerCase();
  }

  private String hash(String email, String otp) {
    try {
      MessageDigest digest = MessageDigest.getInstance("SHA-256");
      return HexFormat.of().formatHex(digest.digest((email.toLowerCase() + ":" + otp + ":" + otpSecret).getBytes(StandardCharsets.UTF_8)));
    } catch (Exception error) {
      throw new IllegalStateException(error);
    }
  }

  private static String value(Map<String, Object> body, String first, String second) {
    Object value = body.get(first);
    if (value == null) value = body.get(second);
    return value == null ? "" : String.valueOf(value).trim();
  }

  private static String digits(String value) {
    return value.replaceAll("\\D", "");
  }

  private static ResponseEntity<Map<String, Object>> ok(Map<String, Object> body) {
    return ResponseEntity.ok(body);
  }

  private static Mono<ResponseEntity<Map<String, Object>>> bad(String error) {
    return Mono.just(ResponseEntity.badRequest().body(Map.<String, Object>of("error", error)));
  }
}
