const locale = { type: "string", enum: ["vi", "en"], default: "vi" } as const;
const errorResponse = {
  type: "object",
  properties: { error: {} },
  required: ["error"]
} as const;
const okResponse = {
  type: "object",
  properties: { ok: { type: "boolean" } },
  required: ["ok"]
} as const;
const identifierProperties = {
  emailOrUsername: { type: "string", minLength: 1, examples: ["user@example.com"] },
  locale
} as const;

export const loginDocs = {
  tags: ["Auth"], summary: "Đăng nhập bằng email và mật khẩu",
  body: {
    type: "object", required: ["email", "password"],
    properties: { email: { type: "string", format: "email" }, password: { type: "string", format: "password" } }
  },
  response: { 400: errorResponse }
} as const;

export const signupDocs = {
  tags: ["Auth"], summary: "Đăng ký tài khoản bằng email và mật khẩu",
  body: {
    type: "object", required: ["email", "password"],
    properties: {
      email: { type: "string", format: "email" },
      password: { type: "string", format: "password", minLength: 8 }
    },
    additionalProperties: false
  },
  response: {
    200: {
      type: "object", required: ["user", "session", "requiresEmailConfirmation"],
      properties: {
        user: { anyOf: [{ type: "object", properties: { id: { type: "string", format: "uuid" }, email: { type: ["string", "null"] } } }, { type: "null" }] },
        session: { anyOf: [{ type: "object", properties: { access_token: { type: "string" }, refresh_token: { type: "string" }, expires_in: { type: "number" } } }, { type: "null" }] },
        requiresEmailConfirmation: { type: "boolean" }
      }
    },
    400: errorResponse, 409: errorResponse, 422: errorResponse, 429: errorResponse, 500: errorResponse, 503: errorResponse
  }
} as const;

export const requestResetDocs = {
  tags: ["Auth"], summary: "Gửi OTP đặt lại mật khẩu",
  body: { type: "object", required: ["emailOrUsername"], properties: identifierProperties },
  response: { 200: okResponse, 400: errorResponse }
} as const;

export const verifyOtpDocs = {
  tags: ["Auth"], summary: "Kiểm tra OTP đặt lại mật khẩu",
  body: {
    type: "object", required: ["emailOrUsername", "otpCode"],
    properties: { ...identifierProperties, otpCode: { type: "string", pattern: "^[0-9]{6}$", examples: ["123456"] } }
  },
  response: { 200: okResponse, 400: errorResponse }
} as const;

export const completeResetDocs = {
  tags: ["Auth"], summary: "Đặt mật khẩu mới",
  body: {
    type: "object", required: ["emailOrUsername", "otpCode", "newPassword"],
    properties: {
      ...identifierProperties,
      otpCode: { type: "string", pattern: "^[0-9]{6}$", examples: ["123456"] },
      newPassword: { type: "string", format: "password", minLength: 8 }
    }
  },
  response: { 200: { ...okResponse, properties: { ...okResponse.properties, email: { type: "string", format: "email" } } }, 400: errorResponse }
} as const;
