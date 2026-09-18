"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiFetch, setAccessToken } from "@/lib/api";
import { isProfileRequired } from "@/lib/errors";

export const AVATAR_KEYS = [
  "popcorn",
  "rocket",
  "cat",
  "panda",
  "robot",
  "ghost",
  "alien",
  "ninja",
  "pirate",
  "dino",
  "star",
  "clover",
] as const;

export type AvatarKey = (typeof AVATAR_KEYS)[number];

export interface Profile {
  id: string;
  name: string;
  avatar: string;
  position: number;
  has_pin: boolean;
  is_default: boolean;
}

export interface ProfileListItem extends Profile {
  is_current: boolean;
}

export interface ProfileList {
  items: ProfileListItem[];
  max: number;
}

export interface SwitchResult {
  access_token: string | null;
  profile: Profile | null;
}

export interface CreateProfileInput {
  name: string;
  avatar: string;
}

export interface UpdateProfileInput {
  id: string;
  name?: string;
  avatar?: string;
}

export interface DeleteProfileInput {
  id: string;
  pin?: string;
}

export interface SwitchProfileInput {
  id: string;
  pin?: string;
}

export interface SetProfilePinInput {
  id: string;
  password: string;
  pin: string | null;
  currentPin?: string;
}

export const PROFILE_KEYS = {
  all: ["me", "profiles"] as const,
  current: ["me", "profile"] as const,
};

export function useProfiles() {
  return useQuery({
    queryKey: PROFILE_KEYS.all,
    queryFn: () => apiFetch<ProfileList>("/api/v1/me/profiles"),
  });
}

export function useCurrentProfile(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: PROFILE_KEYS.current,
    queryFn: () => apiFetch<Profile>("/api/v1/me/profile"),
    enabled: options.enabled ?? true,
    // PROFILE_REQUIRED is deterministic (no profile picked yet), so the
    // default retry would only delay the redirect to the chooser.
    retry: (count, error) =>
      !isProfileRequired(error) && count < 1,
  });
}

export function useCreateProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ name, avatar }: CreateProfileInput) =>
      apiFetch<Profile>("/api/v1/me/profiles", {
        method: "POST",
        body: JSON.stringify({ name, avatar }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PROFILE_KEYS.all });
    },
  });
}

export function useUpdateProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name, avatar }: UpdateProfileInput) =>
      apiFetch<Profile>(`/api/v1/me/profiles/${id}`, {
        method: "PATCH",
        body: JSON.stringify({
          ...(name !== undefined ? { name } : {}),
          ...(avatar !== undefined ? { avatar } : {}),
        }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PROFILE_KEYS.all });
      void queryClient.invalidateQueries({ queryKey: PROFILE_KEYS.current });
    },
  });
}

export function useDeleteProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, pin }: DeleteProfileInput) =>
      apiFetch<SwitchResult>(`/api/v1/me/profiles/${id}`, {
        method: "DELETE",
        body: JSON.stringify(pin ? { pin } : {}),
      }),
    onSuccess: () => {
      // The server never hands out a successor profile (an unselected session
      // goes back to the chooser), so there is no token to install here.
      void queryClient.invalidateQueries({ queryKey: PROFILE_KEYS.all });
      void queryClient.invalidateQueries({ queryKey: PROFILE_KEYS.current });
    },
  });
}

export function useSwitchProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, pin }: SwitchProfileInput) =>
      apiFetch<SwitchResult>(`/api/v1/me/profiles/${id}/switch`, {
        method: "POST",
        body: JSON.stringify(pin ? { pin } : {}),
      }),
    onSuccess: (data) => {
      if (data.access_token) setAccessToken(data.access_token);
      // Drop every profile-scoped cache entry (favorites, progress, current
      // profile) and refetch the active ones. `clear()` would remove queries
      // without refetching their active observers, leaving the header on the
      // previous profile after an in-place switch.
      void queryClient.resetQueries();
    },
  });
}

export function useSetProfilePin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, password, pin, currentPin }: SetProfilePinInput) =>
      apiFetch<Profile>(`/api/v1/me/profiles/${id}/pin`, {
        method: "PUT",
        body: JSON.stringify({
          password,
          pin,
          ...(currentPin ? { current_pin: currentPin } : {}),
        }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PROFILE_KEYS.all });
      void queryClient.invalidateQueries({ queryKey: PROFILE_KEYS.current });
    },
  });
}
