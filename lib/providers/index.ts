import type { Provider } from "./types";
import { stripeFcProvider } from "./stripe-fc";
import { testProvider } from "./test-provider";

const providers: Record<string, Provider> = {
  stripe_fc: stripeFcProvider,
};

if (
  process.env.NODE_ENV !== "production" &&
  process.env.AMA_ENABLE_TEST_PROVIDER === "1"
) {
  providers[testProvider.name] = testProvider;
}

export function getProvider(name: string): Provider | undefined {
  return Object.hasOwn(providers, name) ? providers[name] : undefined;
}
