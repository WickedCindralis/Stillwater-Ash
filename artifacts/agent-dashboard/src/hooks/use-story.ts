import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

export interface StoryManuscript {
  id: string;
  title: string;
  storyPacket: string;
  summary: string;
  status: "idle" | "running" | "incomplete" | "error";
  lastError: string | null;
  currentChapterId: number | null;
  updatedAt: string;
}

export interface StoryChapter {
  id: number;
  title: string;
  content: string;
  continuation: string | null;
  position: number;
  status: "complete" | "unfinished";
  createdAt: string;
  updatedAt: string;
}

export interface StoryResponse {
  manuscript: StoryManuscript;
  chapters: StoryChapter[];
}

export interface StoryBook {
  id: string;
  title: string;
  createdAt: string;
  lastWrittenAt: string | null;
  chapterCount: number;
  runStatus: "idle" | "running" | "complete" | "paused" | "failed";
}

export function useBooks() {
  return useQuery<{ books: StoryBook[] }>({
    queryKey: ["/api/story/books"],
    refetchInterval: 10_000,
  });
}

export function useStory(bookId: string | null) {
  return useQuery<StoryResponse>({
    queryKey: [bookId ? `/api/story/books/${bookId}` : "/api/story/books/none"],
    enabled: Boolean(bookId),
    refetchInterval: (query) => (query.state.data?.manuscript.status === "running" ? 3000 : false),
  });
}

export function useUpdateManuscript(bookId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: { title?: string; storyPacket?: string }) => {
      const res = await apiRequest("PATCH", `/api/story/books/${bookId}`, data);
      return (await res.json()) as StoryManuscript;
    },
    onSuccess: (updated) => {
      queryClient.setQueryData<StoryResponse | undefined>([`/api/story/books/${bookId}`], (old) =>
        old ? { ...old, manuscript: { ...old.manuscript, ...updated } } : old
      );
    }
  });
}

export function useWriteStory(bookId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/story/books/${bookId}/write`);
      return (await res.json()) as StoryManuscript;
    },
    onSuccess: (updated) => {
      queryClient.setQueryData<StoryResponse | undefined>([`/api/story/books/${bookId}`], (old) =>
        old ? { ...old, manuscript: { ...old.manuscript, ...updated } } : old
      );
      queryClient.invalidateQueries({ queryKey: [`/api/story/books/${bookId}`] });
    }
  });
}

export function useUpdateChapter(bookId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<StoryChapter> }) => {
      const res = await apiRequest("PATCH", `/api/story/books/${bookId}/chapters/${id}`, data);
      return (await res.json()) as StoryChapter;
    },
    onSuccess: (updated) => {
      queryClient.setQueryData<StoryResponse | undefined>([`/api/story/books/${bookId}`], (old) => {
        if (!old) return old;
        return {
          ...old,
          chapters: old.chapters.map(c => c.id === updated.id ? { ...c, ...updated } : c)
        };
      });
    }
  });
}

export function useMoveChapter(bookId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, direction }: { id: number; direction: "up" | "down" }) => {
      const res = await apiRequest("POST", `/api/story/books/${bookId}/chapters/${id}/move`, { direction });
      return (await res.json()) as StoryResponse;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/story/books/${bookId}`] });
    }
  });
}

export function useDeleteChapter(bookId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/story/books/${bookId}/chapters/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/story/books/${bookId}`] });
    }
  });
}
