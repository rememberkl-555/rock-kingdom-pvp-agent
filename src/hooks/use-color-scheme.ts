import { useColorScheme as useNativeWindColorScheme } from "nativewind";

export function useColorScheme() {
  return useNativeWindColorScheme().colorScheme ?? "light";
}
