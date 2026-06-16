package com.peuin.auth;

import java.util.Map;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import reactor.core.publisher.Mono;

@RestController
class AuthController {
  private final PasswordResetService passwordResetService;

  AuthController(PasswordResetService passwordResetService) {
    this.passwordResetService = passwordResetService;
  }

  @PostMapping({"/auth-password-reset", "/auth/password-reset"})
  Mono<ResponseEntity<Map<String, Object>>> requestReset(@RequestBody Map<String, Object> body) {
    return passwordResetService.requestReset(body);
  }

  @PostMapping({"/auth-verify-password-reset-otp", "/auth/password-reset/verify"})
  Mono<ResponseEntity<Map<String, Object>>> verifyOtp(@RequestBody Map<String, Object> body) {
    return passwordResetService.verifyOtp(body);
  }

  @PostMapping({"/auth-complete-password-reset", "/auth/password-reset/complete"})
  Mono<ResponseEntity<Map<String, Object>>> completeReset(@RequestBody Map<String, Object> body) {
    return passwordResetService.completeReset(body);
  }
}
