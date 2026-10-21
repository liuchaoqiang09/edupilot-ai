export class SmsUnavailableError extends Error {
  constructor(message = "短信服务尚未配置，无法发送验证码。") {
    super(message);
    this.name = "SmsUnavailableError";
  }
}

export interface SmsProvider {
  readonly mode: "development" | "production";
  send(phone: string, code: string): Promise<void>;
}

class DevelopmentSmsProvider implements SmsProvider {
  readonly mode = "development" as const;

  async send() {
    return;
  }
}

class UnavailableSmsProvider implements SmsProvider {
  readonly mode = "production" as const;

  async send() {
    throw new SmsUnavailableError();
  }
}

export function createSmsProvider(env: NodeJS.ProcessEnv = process.env): SmsProvider {
  if (env.NODE_ENV === "production") return new UnavailableSmsProvider();
  return new DevelopmentSmsProvider();
}
