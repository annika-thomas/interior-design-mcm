import { create } from 'zustand';
import { api, ApiError } from './api';
import type {
  Furniture, LibraryItem, Opening, Photo, Point, ProjectDetail, ProjectSummary,
  Reference, Room, RoomEvaluation, Suggestion,
} from './types';

const LAST_PROJECT_KEY = 'mcm:lastProject';

export interface Toast { id: number; kind: 'info' | 'error' | 'success'; message: string; detail?: string }

interface State {
  ready: boolean;
  claudeEnabled: boolean;
  model: string | null;
  reference: Reference | null;

  projects: ProjectSummary[];
  project: ProjectDetail | null;
  activeRoomId: string | null;

  photos: Photo[];
  library: LibraryItem[];
  libraryTags: string[];
  suggestions: Suggestion[];
  reviews: Record<string, RoomEvaluation>;

  busy: Record<string, boolean>;
  toasts: Toast[];

  boot: () => Promise<void>;
  selectProject: (id: string) => Promise<void>;
  createProject: (name: string) => Promise<void>;
  refreshProject: () => Promise<void>;
  setActiveRoom: (id: string | null) => void;

  addRoom: (data: Record<string, unknown>) => Promise<void>;
  patchRoom: (id: string, patch: Record<string, unknown>) => Promise<void>;
  removeRoom: (id: string) => Promise<void>;

  addOpening: (roomId: string, data: Record<string, unknown>) => Promise<void>;
  patchOpening: (id: string, patch: Record<string, unknown>) => Promise<void>;
  removeOpening: (id: string) => Promise<void>;

  addFurniture: (roomId: string, data: Record<string, unknown>) => Promise<void>;
  patchFurniture: (id: string, patch: Record<string, unknown>) => Promise<void>;
  /** Local-only update, for the duration of a drag. Never hits the server. */
  nudgeFurniture: (id: string, patch: Partial<Furniture>) => void;
  nudgeOpening: (id: string, patch: Partial<Opening>) => void;
  nudgePolygon: (roomId: string, polygon: Point[]) => void;
  removeFurniture: (id: string) => Promise<void>;

  refreshPhotos: () => Promise<void>;
  patchPhoto: (id: string, patch: Record<string, unknown>) => Promise<void>;
  removePhoto: (id: string) => Promise<void>;
  runSurvey: (roomId: string, options: Record<string, unknown>) => Promise<void>;

  refreshLibrary: (params?: Record<string, string>) => Promise<void>;
  patchLibrary: (id: string, patch: Record<string, unknown>) => Promise<void>;
  removeLibrary: (id: string) => Promise<void>;
  analyzeLibraryItem: (id: string) => Promise<void>;
  analyzeAllLibrary: () => Promise<void>;

  reviewRoom: (roomId: string) => Promise<void>;
  generateSuggestions: (roomId: string) => Promise<string | null>;
  acceptSuggestion: (id: string) => Promise<void>;
  dismissSuggestion: (id: string) => Promise<void>;

  setBusy: (key: string, value: boolean) => void;
  toast: (kind: Toast['kind'], message: string, detail?: string) => void;
  dismissToast: (id: number) => void;
}

let toastId = 0;

export const useStore = create<State>((set, get) => {
  /** Run an async action with a busy flag and uniform error reporting. */
  const guard = async <T>(key: string, fn: () => Promise<T>): Promise<T | undefined> => {
    set((s) => ({ busy: { ...s.busy, [key]: true } }));
    try {
      return await fn();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Something went wrong.';
      const detail = err instanceof ApiError ? err.detail : undefined;
      get().toast('error', message, detail);
      return undefined;
    } finally {
      set((s) => ({ busy: { ...s.busy, [key]: false } }));
    }
  };

  /** Replace one room inside the loaded project without refetching everything. */
  const mergeRoom = (room: Room) =>
    set((s) => s.project
      ? { project: { ...s.project, rooms: s.project.rooms.map((r) => (r.id === room.id ? { ...r, ...room } : r)) } }
      : {});

  const patchRoomLocal = (roomId: string, fn: (room: Room) => Room) =>
    set((s) => s.project
      ? { project: { ...s.project, rooms: s.project.rooms.map((r) => (r.id === roomId ? fn(r) : r)) } }
      : {});

  return {
    ready: false,
    claudeEnabled: false,
    model: null,
    reference: null,
    projects: [],
    project: null,
    activeRoomId: null,
    photos: [],
    library: [],
    libraryTags: [],
    suggestions: [],
    reviews: {},
    busy: {},
    toasts: [],

    setBusy: (key, value) => set((s) => ({ busy: { ...s.busy, [key]: value } })),

    toast: (kind, message, detail) => {
      const id = ++toastId;
      set((s) => ({ toasts: [...s.toasts, { id, kind, message, detail }] }));
      // Errors stay until dismissed; everything else clears itself.
      if (kind !== 'error') setTimeout(() => get().dismissToast(id), 4000);
    },

    dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

    boot: async () => {
      const [health, reference, projects] = await Promise.all([
        api.health().catch(() => ({ ok: false, claude: false, model: null })),
        api.reference().catch(() => null),
        api.listProjects().catch(() => []),
      ]);
      set({ ready: true, claudeEnabled: health.claude, model: health.model, reference, projects });

      const remembered = localStorage.getItem(LAST_PROJECT_KEY);
      const target = projects.find((p) => p.id === remembered) ?? projects[0];
      if (target) await get().selectProject(target.id);
    },

    selectProject: async (id) => {
      const project = await guard('project', () => api.getProject(id));
      if (!project) return;
      localStorage.setItem(LAST_PROJECT_KEY, id);
      set({
        project,
        library: project.library,
        suggestions: project.suggestions,
        activeRoomId: project.rooms[0]?.id ?? null,
      });
      await Promise.all([get().refreshPhotos(), get().refreshLibrary()]);
    },

    createProject: async (name) => {
      const created = await guard('project', () => api.createProject({ name }));
      if (!created) return;
      set((s) => ({ projects: [created, ...s.projects] }));
      await get().selectProject(created.id);
      get().toast('success', `Created "${created.name}".`);
    },

    refreshProject: async () => {
      const id = get().project?.id;
      if (!id) return;
      const project = await guard('project', () => api.getProject(id));
      if (project) set({ project, library: project.library, suggestions: project.suggestions });
    },

    setActiveRoom: (id) => set({ activeRoomId: id }),

    addRoom: async (data) => {
      const projectId = get().project?.id;
      if (!projectId) return;
      const room = await guard('room', () => api.createRoom(projectId, data));
      if (!room) return;
      set((s) => (s.project ? { project: { ...s.project, rooms: [...s.project.rooms, room] }, activeRoomId: room.id } : {}));
    },

    patchRoom: async (id, patch) => {
      const room = await guard('room', () => api.updateRoom(id, patch));
      if (room) mergeRoom(room);
    },

    removeRoom: async (id) => {
      const ok = await guard('room', async () => { await api.deleteRoom(id); return true; });
      if (!ok) return;
      set((s) => {
        const rooms = s.project?.rooms.filter((r) => r.id !== id) ?? [];
        return {
          project: s.project ? { ...s.project, rooms } : null,
          activeRoomId: s.activeRoomId === id ? rooms[0]?.id ?? null : s.activeRoomId,
        };
      });
      await get().refreshPhotos();
    },

    addOpening: async (roomId, data) => {
      const opening = await guard('opening', () => api.addOpening(roomId, data));
      if (opening) patchRoomLocal(roomId, (r) => ({ ...r, openings: [...(r.openings ?? []), opening] }));
    },

    patchOpening: async (id, patch) => {
      const opening = await guard('opening', () => api.updateOpening(id, patch));
      if (opening) patchRoomLocal(opening.roomId, (r) => ({
        ...r, openings: (r.openings ?? []).map((o) => (o.id === id ? opening : o)),
      }));
    },

    removeOpening: async (id) => {
      const room = get().project?.rooms.find((r) => r.openings?.some((o) => o.id === id));
      const ok = await guard('opening', async () => { await api.deleteOpening(id); return true; });
      if (ok && room) patchRoomLocal(room.id, (r) => ({ ...r, openings: (r.openings ?? []).filter((o) => o.id !== id) }));
    },

    addFurniture: async (roomId, data) => {
      const piece = await guard('furniture', () => api.addFurniture(roomId, data));
      if (piece) patchRoomLocal(roomId, (r) => ({ ...r, furniture: [...(r.furniture ?? []), piece] }));
    },

    nudgeFurniture: (id, patch) => {
      const room = get().project?.rooms.find((r) => r.furniture?.some((f) => f.id === id));
      if (!room) return;
      patchRoomLocal(room.id, (r) => ({
        ...r, furniture: (r.furniture ?? []).map((f) => (f.id === id ? { ...f, ...patch } : f)),
      }));
    },

    nudgeOpening: (id, patch) => {
      const room = get().project?.rooms.find((r) => r.openings?.some((o) => o.id === id));
      if (!room) return;
      patchRoomLocal(room.id, (r) => ({
        ...r, openings: (r.openings ?? []).map((o) => (o.id === id ? { ...o, ...patch } : o)),
      }));
    },

    nudgePolygon: (roomId, polygon) => patchRoomLocal(roomId, (r) => ({ ...r, polygon })),

    patchFurniture: async (id, patch) => {
      const piece = await guard('furniture', () => api.updateFurniture(id, patch));
      if (piece) patchRoomLocal(piece.roomId, (r) => ({
        ...r, furniture: (r.furniture ?? []).map((f) => (f.id === id ? piece : f)),
      }));
    },

    removeFurniture: async (id) => {
      const room = get().project?.rooms.find((r) => r.furniture?.some((f) => f.id === id));
      const ok = await guard('furniture', async () => { await api.deleteFurniture(id); return true; });
      if (ok && room) patchRoomLocal(room.id, (r) => ({ ...r, furniture: (r.furniture ?? []).filter((f) => f.id !== id) }));
    },

    refreshPhotos: async () => {
      const id = get().project?.id;
      if (!id) return;
      const photos = await guard('photos', () => api.listPhotos(id));
      if (photos) {
        set({ photos });
        // Keep each room's embedded photo list in step with the flat list.
        set((s) => s.project
          ? { project: { ...s.project, rooms: s.project.rooms.map((r) => ({ ...r, photos: photos.filter((p) => p.roomId === r.id) })) } }
          : {});
      }
    },

    patchPhoto: async (id, patch) => {
      const photo = await guard('photos', () => api.updatePhoto(id, patch));
      if (photo) await get().refreshPhotos();
    },

    removePhoto: async (id) => {
      const ok = await guard('photos', async () => { await api.deletePhoto(id); return true; });
      if (ok) await get().refreshPhotos();
    },

    runSurvey: async (roomId, options) => {
      const result = await guard(`survey:${roomId}`, () => api.survey(roomId, options));
      if (!result) return;
      await get().refreshProject();
      await get().refreshPhotos();
      const dims = result.survey as { widthCm?: number; depthCm?: number; confidence?: string; scaleAnchor?: string };
      get().toast(
        'success',
        dims.widthCm && dims.depthCm
          ? `Surveyed: about ${Math.round(dims.widthCm)} x ${Math.round(dims.depthCm)} cm (${dims.confidence} confidence).`
          : 'Survey finished, but the room dimensions could not be pinned down.',
        dims.scaleAnchor ? `Scaled from: ${dims.scaleAnchor}. Check it against a tape measure before you buy anything.` : undefined,
      );
    },

    refreshLibrary: async (params) => {
      const id = get().project?.id;
      if (!id) return;
      const result = await guard('library', () => api.listLibrary(id, params));
      if (result) set({ library: result.items, libraryTags: result.allTags });
    },

    patchLibrary: async (id, patch) => {
      const item = await guard('library', () => api.updateLibrary(id, patch));
      if (item) set((s) => ({ library: s.library.map((l) => (l.id === id ? item : l)) }));
    },

    removeLibrary: async (id) => {
      const ok = await guard('library', async () => { await api.deleteLibrary(id); return true; });
      if (ok) set((s) => ({ library: s.library.filter((l) => l.id !== id) }));
    },

    analyzeLibraryItem: async (id) => {
      const item = await guard(`analyze:${id}`, () => api.analyzeLibrary(id));
      if (item) set((s) => ({ library: s.library.map((l) => (l.id === id ? item : l)) }));
    },

    analyzeAllLibrary: async () => {
      const id = get().project?.id;
      if (!id) return;
      const result = await guard('analyzeAll', () => api.analyzeAllLibrary(id));
      if (!result) return;
      await get().refreshLibrary();
      get().toast(
        result.failed ? 'info' : 'success',
        `Read ${result.analyzed} item(s).${result.failed ? ` ${result.failed} failed.` : ''}${result.remaining ? ` ${result.remaining} still to go — run it again.` : ''}`,
        result.errors.slice(0, 3).join(' · ') || undefined,
      );
    },

    reviewRoom: async (roomId) => {
      const review = await guard(`review:${roomId}`, () => api.reviewRoom(roomId));
      if (review) set((s) => ({ reviews: { ...s.reviews, [roomId]: review } }));
    },

    generateSuggestions: async (roomId) => {
      const result = await guard(`suggest:${roomId}`, () => api.suggest(roomId));
      if (!result) return null;
      set((s) => ({
        suggestions: [...s.suggestions.filter((x) => x.roomId !== roomId || x.status !== 'open'), ...result.suggestions],
      }));
      await get().reviewRoom(roomId);
      get().toast(
        'success',
        `${result.suggestions.length} suggestion(s)${result.usedLibraryItems ? `, ${result.usedLibraryItems} from your library` : ''}.`,
        result.engine === 'heuristic' && get().claudeEnabled ? 'Written by the rule engine — the Claude pass did not complete.' : undefined,
      );
      return result.designNote;
    },

    acceptSuggestion: async (id) => {
      const result = await guard(`accept:${id}`, () => api.acceptSuggestion(id));
      if (!result) return;
      set((s) => ({ suggestions: s.suggestions.map((x) => (x.id === id ? result.suggestion : x)) }));
      if (result.furniture) {
        patchRoomLocal(result.furniture.roomId, (r) => ({ ...r, furniture: [...(r.furniture ?? []), result.furniture!] }));
        await get().reviewRoom(result.furniture.roomId);
      }
    },

    dismissSuggestion: async (id) => {
      const updated = await guard(`dismiss:${id}`, () => api.dismissSuggestion(id));
      if (updated) set((s) => ({ suggestions: s.suggestions.map((x) => (x.id === id ? updated : x)) }));
    },
  };
});

/** The room currently being worked on, with its openings, furniture and photos. */
export function useActiveRoom(): Room | null {
  return useStore((s) => s.project?.rooms.find((r) => r.id === s.activeRoomId) ?? null);
}
