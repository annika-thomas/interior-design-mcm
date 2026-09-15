import type {
  CapturePlanStep, Furniture, LibraryItem, Opening, Photo, ProjectDetail, ProjectSummary,
  Reference, Room, RoomDetail, RoomEvaluation, Suggestion,
} from './types';

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly detail?: string, readonly needsKey?: boolean) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: init?.body instanceof FormData ? init.headers : { 'content-type': 'application/json', ...init?.headers },
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    let detail: string | undefined;
    let needsKey = false;
    try {
      const body = await res.json();
      message = body.error ?? message;
      detail = body.detail;
      needsKey = Boolean(body.needsKey);
    } catch { /* non-JSON error body */ }
    throw new ApiError(message, res.status, detail, needsKey);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

const body = (data: unknown) => ({ body: JSON.stringify(data) });

export const api = {
  health: () => request<{ ok: boolean; claude: boolean; model: string | null }>('/health'),
  reference: () => request<Reference>('/catalog'),
  capturePlan: () => request<CapturePlanStep[]>('/capture-plan'),

  listProjects: () => request<ProjectSummary[]>('/projects'),
  createProject: (data: { name: string; paletteKey?: string | null }) =>
    request<ProjectSummary>('/projects', { method: 'POST', ...body(data) }),
  getProject: (id: string) => request<ProjectDetail>(`/projects/${id}`),
  updateProject: (id: string, patch: Record<string, unknown>) =>
    request<ProjectSummary>(`/projects/${id}`, { method: 'PATCH', ...body(patch) }),
  deleteProject: (id: string) => request<void>(`/projects/${id}`, { method: 'DELETE' }),

  createRoom: (projectId: string, data: Record<string, unknown>) =>
    request<Room>(`/projects/${projectId}/rooms`, { method: 'POST', ...body(data) }),
  getRoom: (id: string) => request<RoomDetail>(`/rooms/${id}`),
  updateRoom: (id: string, patch: Record<string, unknown>) =>
    request<Room>(`/rooms/${id}`, { method: 'PATCH', ...body(patch) }),
  deleteRoom: (id: string) => request<void>(`/rooms/${id}`, { method: 'DELETE' }),

  addOpening: (roomId: string, data: Record<string, unknown>) =>
    request<Opening>(`/rooms/${roomId}/openings`, { method: 'POST', ...body(data) }),
  updateOpening: (id: string, patch: Record<string, unknown>) =>
    request<Opening>(`/openings/${id}`, { method: 'PATCH', ...body(patch) }),
  deleteOpening: (id: string) => request<void>(`/openings/${id}`, { method: 'DELETE' }),

  addFurniture: (roomId: string, data: Record<string, unknown>) =>
    request<Furniture>(`/rooms/${roomId}/furniture`, { method: 'POST', ...body(data) }),
  updateFurniture: (id: string, patch: Record<string, unknown>) =>
    request<Furniture>(`/furniture/${id}`, { method: 'PATCH', ...body(patch) }),
  deleteFurniture: (id: string) => request<void>(`/furniture/${id}`, { method: 'DELETE' }),

  uploadPhotos: (projectId: string, form: FormData) =>
    request<Photo[]>(`/projects/${projectId}/photos`, { method: 'POST', body: form }),
  listPhotos: (projectId: string) => request<Photo[]>(`/projects/${projectId}/photos`),
  updatePhoto: (id: string, patch: Record<string, unknown>) =>
    request<Photo>(`/photos/${id}`, { method: 'PATCH', ...body(patch) }),
  deletePhoto: (id: string) => request<void>(`/photos/${id}`, { method: 'DELETE' }),
  photoUrl: (id: string) => `/api/photos/${id}/file`,

  survey: (roomId: string, options: Record<string, unknown>) =>
    request<{ room: Room; survey: Record<string, unknown>; photos: Photo[]; openings: Opening[]; furniture: Furniture[] }>(
      `/rooms/${roomId}/survey`, { method: 'POST', ...body(options) }),

  listLibrary: (projectId: string, params: Record<string, string> = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v));
    return request<{ items: LibraryItem[]; allTags: string[] }>(`/projects/${projectId}/library?${qs}`);
  },
  addLibrary: (projectId: string, form: FormData) =>
    request<LibraryItem[]>(`/projects/${projectId}/library`, { method: 'POST', body: form }),
  updateLibrary: (id: string, patch: Record<string, unknown>) =>
    request<LibraryItem>(`/library/${id}`, { method: 'PATCH', ...body(patch) }),
  deleteLibrary: (id: string) => request<void>(`/library/${id}`, { method: 'DELETE' }),
  analyzeLibrary: (id: string) => request<LibraryItem>(`/library/${id}/analyze`, { method: 'POST' }),
  analyzeAllLibrary: (projectId: string) =>
    request<{ analyzed: number; failed: number; errors: string[]; remaining: number }>(
      `/projects/${projectId}/library/analyze-all`, { method: 'POST', ...body({}) }),
  libraryUrl: (id: string) => `/api/library/${id}/file`,

  reviewRoom: (roomId: string) => request<RoomEvaluation>(`/rooms/${roomId}/review`),
  reviewProject: (projectId: string) =>
    request<{ rooms: Array<RoomEvaluation & { roomName: string }>; projectScore: number }>(`/projects/${projectId}/review`),
  suggest: (roomId: string, options: Record<string, unknown> = {}) =>
    request<{ suggestions: Suggestion[]; kept: Suggestion[]; styleScore: number; designNote: string | null; engine: string; usedLibraryItems: number }>(
      `/rooms/${roomId}/suggest`, { method: 'POST', ...body(options) }),
  listSuggestions: (projectId: string) => request<Suggestion[]>(`/projects/${projectId}/suggestions`),
  acceptSuggestion: (id: string) =>
    request<{ suggestion: Suggestion; furniture: Furniture | null }>(`/suggestions/${id}/accept`, { method: 'POST' }),
  dismissSuggestion: (id: string) => request<Suggestion>(`/suggestions/${id}/dismiss`, { method: 'POST' }),
  reopenSuggestion: (id: string) => request<Suggestion>(`/suggestions/${id}/reopen`, { method: 'POST' }),

  exportUrl: (projectId: string, kind: 'blender' | 'json' | 'plan') => `/api/projects/${projectId}/export/${kind}`,
};
