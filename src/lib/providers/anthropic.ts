import type { SupportedProviderDefinition } from "@/lib/providers/types";

export const ANTHROPIC_PROVIDER = {
  config: {
    id: "anthropic",
    family: "anthropic",
    label: "Anthropic",
    authType: "apiKey",
    baseUrl: "https://api.anthropic.com/v1",
    enabled: false,
    oauthAccountEmail: null,
  },
} satisfies SupportedProviderDefinition;
