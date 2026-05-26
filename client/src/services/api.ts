import { auth } from '../firebase';
import type { Household, Invite, User } from '../types';

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ||
  'https://us-central1-billsplitter-v2.cloudfunctions.net/api';

interface ApiOptions extends RequestInit {
  authToken?: string;
}

async function apiRequest<T>(path: string, options: ApiOptions = {}): Promise<T> {
  const token = options.authToken || (await auth.currentUser?.getIdToken());

  if (!token) {
    throw new Error('User is not authenticated');
  }

  const url = `${API_BASE_URL}${path}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });

  const rawText = await response.text();
  let data: any = {};
  try {
    data = rawText ? JSON.parse(rawText) : {};
  } catch {
    // Non-JSON response (e.g. HTML 404 page)
  }

  if (!response.ok) {
    const method = (options.method || 'GET').toUpperCase();
    const serverError = data?.error;
    const snippet = !serverError && rawText ? ` :: ${rawText.slice(0, 160)}` : '';
    const message = `${method} ${path} → ${response.status} ${response.statusText}${
      serverError ? ` :: ${serverError}` : snippet
    }`;
    console.error('[api] request failed', { url, status: response.status, body: rawText });
    throw new Error(message);
  }

  return data as T;
}

export async function ensureCurrentUser(authToken?: string): Promise<User> {
  const data = await apiRequest<{ user: User }>('/users/me', {
    method: 'GET',
    authToken,
  });

  return data.user;
}

export async function getHouseholds(authToken?: string): Promise<Household[]> {
  const data = await apiRequest<{ households: Household[] }>('/households', {
    method: 'GET',
    authToken,
  });

  return data.households;
}

export async function createHousehold(name: string, authToken?: string): Promise<Household> {
  const data = await apiRequest<{ household: Household }>('/households', {
    method: 'POST',
    body: JSON.stringify({ name }),
    authToken,
  });

  return data.household;
}

export async function joinHousehold(inviteCode: string, authToken?: string): Promise<Household> {
  const data = await apiRequest<{ household: Household }>('/households/join', {
    method: 'POST',
    body: JSON.stringify({ inviteCode }),
    authToken,
  });

  return data.household;
}

export async function listInvites(householdId: string, authToken?: string): Promise<Invite[]> {
  const data = await apiRequest<{ invites: Invite[] }>(`/households/${encodeURIComponent(householdId)}/invites`, {
    method: 'GET',
    authToken,
  });

  return data.invites;
}

export async function createInvite(
  householdId: string,
  email: string,
  authToken?: string
): Promise<{ invite: Invite; emailDelivered: boolean; emailReason?: string }> {
  return apiRequest<{ invite: Invite; emailDelivered: boolean; emailReason?: string }>(
    `/households/${encodeURIComponent(householdId)}/invites`,
    {
      method: 'POST',
      body: JSON.stringify({ email }),
      authToken,
    }
  );
}

export async function revokeInvite(
  householdId: string,
  inviteId: string,
  authToken?: string
): Promise<void> {
  await apiRequest<{ success: boolean }>(
    `/households/${encodeURIComponent(householdId)}/invites/${encodeURIComponent(inviteId)}`,
    {
      method: 'DELETE',
      authToken,
    }
  );
}

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  phone?: string;
  households: string[];
}

export interface HouseholdMember {
  uid: string;
  name: string;
  email: string;
  phone: string;
  role: string;
  joinedAt: unknown;
}

export async function getMyProfile(): Promise<UserProfile> {
  const data = await apiRequest<{ user: UserProfile }>('/users/me');
  return data.user;
}

export async function updateMyProfile(updates: { name?: string; phone?: string; email?: string }): Promise<UserProfile> {
  const data = await apiRequest<{ user: UserProfile }>('/users/me', {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
  return data.user;
}

export async function updateMemberProfile(
  userId: string,
  updates: { name?: string; phone?: string; email?: string }
): Promise<UserProfile> {
  const data = await apiRequest<{ user: UserProfile }>(`/users/${encodeURIComponent(userId)}`, {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
  return data.user;
}

export async function getHouseholdMembers(householdId: string): Promise<HouseholdMember[]> {
  const data = await apiRequest<{ members: HouseholdMember[] }>(
    `/households/${encodeURIComponent(householdId)}/members`
  );
  return data.members;
}

export async function sendCalculationNotification(
  calcId: string
): Promise<{ sent: string[]; skipped: string[] }> {
  return apiRequest<{ sent: string[]; skipped: string[] }>('/notifications/calculation', {
    method: 'POST',
    body: JSON.stringify({ calcId }),
  });
}

export interface BillGroup {
  id: string;
  label: string;
  patterns: string[];
}

export interface BillGroupingSettings {
  enabled: boolean;
  groups: BillGroup[];
}

export async function getBillGrouping(): Promise<BillGroupingSettings> {
  const data = await apiRequest<{ billGrouping: BillGroupingSettings }>('/users/me/bill-groups');
  return data.billGrouping;
}

export async function saveBillGrouping(settings: BillGroupingSettings): Promise<BillGroupingSettings> {
  const data = await apiRequest<{ billGrouping: BillGroupingSettings }>('/users/me/bill-groups', {
    method: 'PUT',
    body: JSON.stringify(settings),
  });
  return data.billGrouping;
}

export { API_BASE_URL };
