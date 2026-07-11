import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";

import {
  createOpenAIClient,
  getOpenAIProviderTools,
} from "@/lib/providers/openai-client";
import {
  generateViaAISDK,
  generateViaAISDKNonStreaming,
  shouldUseStreamingAISDK,
} from "@/lib/runtime/providers/ai-sdk-runtime";
import type { ModelRuntime } from "@/lib/runtime/providers/types";

function mergeTools(
  runtimeTools: Parameters<ModelRuntime["generateTextStream"]>[0]["tools"],
  providerTools: Parameters<ModelRuntime["generateTextStream"]>[0]["tools"],
) {
  if (!runtimeTools && !providerTools) {
    return undefined;
  }

  return {
    ...(runtimeTools ?? {}),
    ...(providerTools ?? {}),
  } as Parameters<ModelRuntime["generateTextStream"]>[0]["tools"];
}

function normalizeCodexOAuthError(error: unknown) {
  const details =
    error && typeof error === "object"
      ? (error as {
          message?: string;
          responseBody?: string;
          statusCode?: number;
        })
      : undefined;
  const message = [
    details?.statusCode ? `HTTP ${details.statusCode}` : undefined,
    details?.message,
    details?.responseBody,
  ]
    .filter((part): part is string => Boolean(part?.trim()))
    .join(": ") || String(error);

  if (/\b401\b|unauthorized/i.test(message)) {
    return new Error("Your ChatGPT session expired. Please connect ChatGPT again.");
  }

  return new Error(message, {
    cause: error,
  });
}

function prepareCodexOAuthParams(
  params: Parameters<ModelRuntime["generateTextStream"]>[0],
) {
  if (params.model.transport !== "codexResponses") {
    return params;
  }

  const openaiOptions =
    (params.providerOptions?.openai as Record<string, unknown> | undefined) ?? {};

  return {
    ...params,
    providerOptions: {
      ...(params.providerOptions ?? {}),
      openai: {
        ...openaiOptions,
        instructions: params.system ?? null,
        store: false,
        strictJsonSchema: false,
      },
    },
    requestHeaders: {
      ...(params.requestHeaders ?? {}),
      originator: "opencode",
      ...(params.sessionId ? { "session-id": params.sessionId } : {}),
    },
    // The Codex Responses endpoint expects the prompt in `instructions`.
    // Leaving it here makes the AI SDK add a system/developer input item too.
    system: undefined,
  };
}

export const modelRuntime: ModelRuntime = {
  async generateTextStream(params) {
    if (params.provider.family === "anthropic") {
      const apiKey = await params.secretStore.getProviderApiKey(params.provider.id);

      if (!apiKey) {
        throw new Error(`Missing API key for provider ${params.provider.label}.`);
      }

      const provider = createAnthropic({
        apiKey,
        baseURL: params.provider.baseUrl ?? undefined,
      });
      const languageModel = provider.languageModel(params.model.modelId);

      return shouldUseStreamingAISDK()
        ? generateViaAISDK(languageModel, params)
        : generateViaAISDKNonStreaming(languageModel, params);
    }

    if (params.provider.family === "google") {
      const apiKey = await params.secretStore.getProviderApiKey(params.provider.id);

      if (!apiKey) {
        throw new Error(`Missing API key for provider ${params.provider.label}.`);
      }

      const provider = createGoogleGenerativeAI({
        apiKey,
        baseURL:
          params.provider.baseUrl ??
          "https://generativelanguage.googleapis.com/v1beta",
      });
      const languageModel = provider.languageModel(params.model.modelId);
      const providerOptions = params.model.supportsImageGeneration
        ? {
            ...(params.providerOptions ?? {}),
            google: {
              ...((params.providerOptions?.google as Record<string, unknown> | undefined) ??
                {}),
              responseModalities: ["TEXT", "IMAGE"] as const,
            },
          }
        : params.providerOptions;

      return shouldUseStreamingAISDK()
        ? generateViaAISDK(languageModel, {
            ...params,
            providerOptions,
          })
        : generateViaAISDKNonStreaming(languageModel, {
            ...params,
            providerOptions,
          });
    }

    const provider = await createOpenAIClient({
      provider: params.provider,
      secretStore: params.secretStore,
    });
    const providerTools = getOpenAIProviderTools(params.model);
    const languageModel =
      params.model.transport === "openaiResponses" ||
      params.model.transport === "codexResponses"
        ? provider.responses(params.model.modelId)
        : provider.chat(params.model.modelId);
    const runtimeParams = prepareCodexOAuthParams({
      ...params,
      tools: mergeTools(params.tools, providerTools),
    });

    try {
      return shouldUseStreamingAISDK()
        ? await generateViaAISDK(languageModel, runtimeParams)
        : await generateViaAISDKNonStreaming(languageModel, runtimeParams);
    } catch (error) {
      if (params.model.transport === "codexResponses") {
        throw normalizeCodexOAuthError(error);
      }

      throw error;
    }
  },
};
