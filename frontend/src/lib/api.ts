export class ApiError extends Error {
  status: number;
  payload: Record<string, unknown> | null;
  constructor(status: number, message: string, payload: Record<string, unknown> | null = null) {
    super(message);
    this.status = status;
    this.payload = payload;
  }
}

function csrfToken(): string {
  const match = document.cookie.match(/(?:^|; )wmbg_csrf=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : "";
}

// Paths where a 401 is an expected "am I logged in?" check, not a stale session.
const AUTH_CHECK_PATHS = new Set(["/api/auth/me", "/api/auth/login"]);

let onSessionExpired: (() => void) | null = null;

/** Registered once by AuthProvider so any 401 from an authenticated call can log the user out. */
export function setSessionExpiredHandler(handler: (() => void) | null): void {
  onSessionExpired = handler;
}

async function request<T>(
  path: string,
  options: { method?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<T> {
  const method = options.method ?? "GET";
  const headers: Record<string, string> = { ...options.headers };
  if (options.body !== undefined) headers["Content-Type"] = "application/json";
  if (method !== "GET") {
    headers["X-CSRF-Token"] = csrfToken();
    headers["Idempotency-Key"] = crypto.randomUUID();
  }
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers,
      credentials: "include",
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    throw new ApiError(0, "Can't reach the server — check your connection and try again.");
  }
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    if (res.status === 401 && !AUTH_CHECK_PATHS.has(path)) onSessionExpired?.();
    throw new ApiError(res.status, (data && data.error) || `Request failed (${res.status})`, data);
  }
  return data as T;
}

export interface Me {
  username: string;
}

export function login(username: string, password: string): Promise<{ username: string; csrfToken: string }> {
  return request("/api/auth/login", { method: "POST", body: { username, password } });
}

export function logout(): Promise<{ ok: boolean }> {
  return request("/api/auth/logout", { method: "POST" });
}

export function me(): Promise<Me> {
  return request("/api/auth/me");
}

export function changePassword(currentPassword: string, newPassword: string): Promise<{ ok: boolean }> {
  return request("/api/auth/change-password", { method: "POST", body: { currentPassword, newPassword } });
}

export type Category =
  | "food_drink"
  | "transport"
  | "bills"
  | "shopping"
  | "entertainment"
  | "housing"
  | "income"
  | "other";

export const CATEGORY_LABELS: Record<Category, string> = {
  food_drink: "Food & Drink",
  transport: "Transport",
  bills: "Bills",
  shopping: "Shopping",
  entertainment: "Entertainment",
  housing: "Housing",
  income: "Income",
  other: "Other",
};

export interface TransactionDto {
  id: string;
  version: number;
  deleted: boolean;
  amount: string;
  currency: string;
  direction: "income" | "expense";
  description: string;
  category: Category;
  occurredDate: string;
  occurredTime: string;
  period: string;
  timeSource: string;
}

export function listTransactions(): Promise<{ items: TransactionDto[] }> {
  return request("/api/transactions");
}

export function getTransaction(id: string): Promise<TransactionDto & { evidenceIds: string[] }> {
  return request(`/api/transactions/${id}`);
}

export type EvidenceItem = { kind: "text"; content: string } | { kind: "image"; content: string };

export async function getEvidence(id: string): Promise<EvidenceItem> {
  let res: Response;
  try {
    res = await fetch(`/api/evidence/${id}`, { credentials: "include" });
  } catch {
    throw new ApiError(0, "Can't reach the server — check your connection and try again.");
  }
  if (!res.ok) throw new ApiError(res.status, "Could not load evidence");
  const contentType = res.headers.get("content-type") ?? "";
  if (contentType.startsWith("image/")) {
    const blob = await res.blob();
    return { kind: "image", content: URL.createObjectURL(blob) };
  }
  return { kind: "text", content: await res.text() };
}

export interface ProposalDto {
  id: string;
  version: number;
  state: string;
  operation: string;
  targetId: string | null;
  baseVersion: number | null;
  resultDeleted: boolean;
  amount: string | null;
  currency: string;
  direction: "income" | "expense";
  description: string;
  category: Category;
  occurredDate: string | null;
  occurredTime: string;
  period: string;
  timeSource: string;
  canConfirm: boolean;
  confirmedTransactionId: string | null;
  evidenceIds: string[];
}

export function proposeChange(
  operation: "edit" | "delete" | "undo",
  targetId: string,
  expectedVersion: number,
  evidenceText: string,
  fields?: Partial<{ amount: string; currency: string; direction: string; description: string; category: Category;
    occurredDate: string | null; occurredTime: string | null; period: string | null }>,
): Promise<ProposalDto> {
  return request("/api/proposals/changes", {
    method: "POST",
    body: { operation, targetId, expectedVersion, evidenceText, ...fields },
  });
}

export function confirmProposal(
  id: string,
  expectedVersion: number,
): Promise<{ proposal: ProposalDto; transaction: TransactionDto }> {
  return request(`/api/proposals/${id}/confirm`, { method: "POST", body: { expectedVersion } });
}

export interface ReportsSummary {
  start: string;
  end: string;
  totals: { income: string; expense: string };
  months: { month: string; income: string; expense: string }[];
  categories: Partial<Record<Category, string>>;
}

export function reportsSummary(months = 6): Promise<ReportsSummary> {
  return request(`/api/reports/summary?months=${months}`);
}

export interface ChatHistoryItem {
  role: "user" | "assistant";
  text: string;
}

export interface TraceEntry {
  kind: "step" | "sql";
  title: string;
  detail?: string;
  sql?: string;
}

export type ChatResponse = { chatId?: string; debugTrace?: TraceEntry[] } & (
  | { kind: "qa"; message: string; start: string; end: string; totals: { income: string; expense: string } }
  | { kind: "intake"; proposals: ProposalDto[]; errors: { index: number; error: string }[]; message: string }
  | { kind: "change"; proposal: ProposalDto; message: string }
  | {
      kind: "needs_selection";
      message: string;
      candidates?: TransactionDto[];
      operation?: "edit" | "delete" | "undo";
    }
);

export function sendChatMessage(
  text: string,
  history: ChatHistoryItem[],
  chatId?: string,
): Promise<ChatResponse> {
  return request("/api/chat/messages", {
    method: "POST",
    body: { text, history, expectedVersion: 0, ...(chatId ? { chatId } : {}) },
  });
}

export interface ChatSummary {
  id: string;
  title: string;
  createdAt: string;
}

export function listChats(): Promise<{ items: ChatSummary[] }> {
  return request("/api/chats");
}

export interface StoredMessage {
  role: "user" | "assistant";
  text: string;
  createdAt: string;
  debugTrace?: TraceEntry[] | null;
}

export function getChatMessages(chatId: string): Promise<{ items: StoredMessage[] }> {
  return request(`/api/chats/${chatId}/messages`);
}

export interface PinDto {
  id: string;
  title: string;
  start: string;
  end: string;
  totals: { income: string; expense: string };
}

export function createPin(title: string, start: string, end: string): Promise<PinDto> {
  return request("/api/chat/pins", { method: "POST", body: { title, start, end } });
}

export function listPins(): Promise<{ items: PinDto[] }> {
  return request("/api/chat/pins");
}

export function deletePin(id: string): Promise<{ ok: boolean }> {
  return request(`/api/chat/pins/${id}`, { method: "DELETE" });
}

export interface ImageIntakeResponse {
  kind: "image_intake";
  proposal: ProposalDto;
  message: string;
  debugTrace?: TraceEntry[];
}

export async function imageIntake(file: File, caption?: string): Promise<ImageIntakeResponse> {
  const form = new FormData();
  form.append("image", file);
  if (caption) form.append("caption", caption);
  let res: Response;
  try {
    res = await fetch("/api/chat/image-intake", {
      method: "POST",
      credentials: "include",
      headers: { "X-CSRF-Token": csrfToken(), "Idempotency-Key": crypto.randomUUID() },
      body: form,
    });
  } catch {
    throw new ApiError(0, "Can't reach the server — check your connection and try again.");
  }
  const data = await res.json();
  if (!res.ok) throw new ApiError(res.status, data.error || "Image intake failed", data);
  return data as ImageIntakeResponse;
}
