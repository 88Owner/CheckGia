import { createDemoBridge } from "./demo-bridge";
import { createExtensionBridge, type ExtensionBridge } from "./extension-bridge";

export function isExtensionRuntime(): boolean {
  return typeof chrome !== "undefined" && Boolean(chrome.runtime?.id);
}

export function getBridge(): { bridge: ExtensionBridge; demo: boolean } {
  if (isExtensionRuntime()) return { bridge: createExtensionBridge(), demo: false };
  return { bridge: createDemoBridge(), demo: true };
}
