import type { Provider } from "./types";
import { stripeFcProvider } from "./stripe-fc";

const providers: Record<string, Provider> = {
  stripe_fc: stripeFcProvider,
};

export function getProvider(name: string): Provider | undefined {
  return providers[name];
}
