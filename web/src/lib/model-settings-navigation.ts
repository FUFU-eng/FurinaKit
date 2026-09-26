// Keep the target until the settings panel mounts; do not depend on event timing.
let pendingModel: string | null = null;
export function openModelSettings(componentId: string) {
  pendingModel = componentId;
  window.dispatchEvent(new CustomEvent("furina:open-settings", { detail: { section: "components" } }));
  window.dispatchEvent(new CustomEvent("furina:focus-component"));
}
export function takeModelFocus(): string | null {
  const id = pendingModel;
  pendingModel = null;
  return id;
}
