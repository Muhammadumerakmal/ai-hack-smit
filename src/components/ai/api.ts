// Browser side of M8. The browser only ever talks to our own /api/ai/* routes, never to the AI provider.

export type AiResponse<T> =
  | { ok: true; label: "AI-generated"; data: T }
  | { ok: false; message: string; reason?: string; data?: T };

/** POST to /api/ai/{path}. Pass a signal to let the user stop waiting (the reply is then `reason: "aborted"`). */
export async function postAi<T>(path: string, body: unknown, signal?: AbortSignal): Promise<AiResponse<T>> {
  try {
    const res = await fetch(`/api/ai/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    const json = await res.json().catch(() => null);
    if (!json) return { ok: false, message: "The assistant is not available right now." };
    return json as AiResponse<T>;
  } catch {
    if (signal?.aborted) return { ok: false, reason: "aborted", message: "You stopped this answer." };
    return { ok: false, message: "Could not reach the server. Check your connection and try again." };
  }
}
