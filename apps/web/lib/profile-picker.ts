"use client";

// Per-tab, in-memory intent to show the profile picker. Set on login/register
// and on the header's "Đổi profile" action, consumed by ProfilePickerGate the
// first time it can fulfil the request. Deliberately NOT persisted (no
// storage): a page reload must not re-ask, because the server already
// remembers the device's active profile.
let pending = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function requestProfilePicker(): void {
  if (pending) return;
  pending = true;
  emit();
}

export function consumeProfilePicker(): void {
  if (!pending) return;
  pending = false;
  emit();
}

export function subscribeProfilePicker(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getProfilePickerPending(): boolean {
  return pending;
}

export function getServerProfilePickerPending(): boolean {
  return false;
}
