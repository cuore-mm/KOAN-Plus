export { sendMessage, getManifest } from "./runtime";
export { create as createTab, update as updateTab, remove as removeTab, onRemoved as tabOnRemoved } from "./tabs";
export type { Tab, CreateTabOptions, UpdateTabOptions } from "./tabs";
export { detectBrowser, getApi, isExtensionContext } from "./browser";
