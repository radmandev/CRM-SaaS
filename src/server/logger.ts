import pino from "pino";

// OPS-07 / SEC-13: JSON logs to stdout; secrets and identity numbers are redacted by key.
export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: {
    paths: [
      "password", "*.password", "newPassword", "*.newPassword", "currentPassword",
      "token", "*.token", "tokenHash", "*.tokenHash", "secret", "*.secret",
      "authorization", "*.authorization", "cookie", "*.cookie", "headers.cookie",
      "documentNumber", "*.documentNumber", "iban", "*.iban",
    ],
    censor: "[redacted]",
  },
});
