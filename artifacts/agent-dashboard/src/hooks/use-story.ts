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

export function useStory() {
  return useQuery<StoryResponse>({
    queryKey: ["/api/story"],
    refetchInterval: (query) => (query.state.data?.manuscript.status === "running" ? 3000 : false),
  });
}

export function useUpdateManuscript() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (data: { title?: string; storyPacket?: string; summary?: string }) => {
      const res = await apiRequest("PATCH", "/api/story", data);
      return (await res.json()) as StoryManuscript;
    },
    onSuccess: (updated) => {
      queryClient.setQueryData<StoryResponse | undefined>(["/api/story"], (old) =>
        old ? { ...old, manuscript: { ...old.manuscript, ...updated } } : old
      );
    }
  });
}

export function useWriteStory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/story/write");
      return (await res.json()) as StoryManuscript;
    },
    onSuccess: (updated) => {
      queryClient.setQueryData<StoryResponse | undefined>(["/api/story"], (old) =>
        old ? { ...old, manuscript: { ...old.manuscript, ...updated } } : old
      );
      queryClient.invalidateQueries({ queryKey: ["/api/story"] });
    }
  });
}

export function useUpdateChapter() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<StoryChapter> }) => {
      const res = await apiRequest("PATCH", `/api/story/chapters/${id}`, data);
      return (await res.json()) as StoryChapter;
    },
    onSuccess: (updated) => {
      queryClient.setQueryData<StoryResponse | undefined>(["/api/story"], (old) => {
        if (!old) return old;
        return {
          ...old,
          chapters: old.chapters.map(c => c.id === updated.id ? { ...c, ...updated } : c)
        };
      });
    }
  });
}

export function useMoveChapter() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, direction }: { id: number; direction: "up" | "down" }) => {
      const res = await apiRequest("POST", `/api/story/chapters/${id}/move`, { direction });
      return (await res.json()) as StoryResponse;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/story"] });
    }
  });
}

export function useDeleteChapter() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/story/chapters/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/story"] });
    }
  });
}
