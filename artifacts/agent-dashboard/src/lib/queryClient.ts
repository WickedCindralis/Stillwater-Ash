import { QueryClient, QueryFunction } from "@tanstack/react-query";

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly url: string,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

async function throwIfResNotOk(res: Response, url: string) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    let message = text;
    try {
      const payload = JSON.parse(text) as { error?: unknown; message?: unknown };
      if (typeof payload.error === "string") message = payload.error;
      else if (typeof payload.message === "string") message = payload.message;
    } catch {
      // Preserve plain-text or HTML error responses as returned by the server.
    }
    throw new ApiRequestError(message, res.status, url);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  try {
    const res = await fetch(url, {
      method,
      headers: data ? { "Content-Type": "application/json" } : {},
      body: data ? JSON.stringify(data) : undefined,
      credentials: "include",
      cache: method === "GET" ? "no-store" : undefined,
    });

    await throwIfResNotOk(res, url);
    return res;
  } catch (error) {
    if (error instanceof ApiRequestError) throw error;
    throw new ApiRequestError(error instanceof Error ? error.message : String(error), null, url);
  }
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const url = String(queryKey.join("/"));
    let res: Response;
    try {
      res = await fetch(url, {
        credentials: "include",
        cache: "no-store",
      });
    } catch (error) {
      throw new ApiRequestError(error instanceof Error ? error.message : String(error), null, url);
    }

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res, url);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      staleTime: 30 * 1000,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
