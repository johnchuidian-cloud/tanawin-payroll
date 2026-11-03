// In-app feedback: reports written where the problem happened, answered in
// the same place. The developer side reads/replies via scripts/feedback.mjs.
import { supabase } from './supabase';

export type FeedbackKind = 'bug' | 'idea' | 'question' | 'discrepancy';

// The login screen's display name for the signed-in user — resolved here so
// any component can report without prop-drilling the session.
export async function currentAuthorName(): Promise<string> {
  const email = supabase ? (await supabase.auth.getSession()).data.session?.user?.email ?? '' : '';
  const users = (process.env.NEXT_PUBLIC_LOGIN_USERS ?? '').split(',').map((p) => p.split(':').map((s) => s.trim()));
  return users.find((u) => u[1] === email)?.[0] ?? email ?? 'someone';
}
export type FeedbackStatus = 'open' | 'in-progress' | 'done' | 'wont-do';

export interface FeedbackItem {
  id: string;
  author: string;
  kind: FeedbackKind;
  message: string;
  status: FeedbackStatus;
  reply: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

const MIGRATION_HINT =
  'Feedback needs a one-time database update — run migration-009-feedback.sql in Supabase.';

export async function listFeedback(): Promise<FeedbackItem[]> {
  if (!supabase) throw new Error('Storage is not connected.');
  const { data, error } = await supabase
    .from('feedback')
    .select('id, author, kind, message, status, reply, created_at, resolved_at')
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) {
    throw new Error(error.message.includes('feedback') ? MIGRATION_HINT : `Could not load reports: ${error.message}`);
  }
  return (data as { id: string; author: string; kind: FeedbackKind; message: string; status: FeedbackStatus; reply: string | null; created_at: string; resolved_at: string | null }[]).map((r) => ({
    id: r.id,
    author: r.author,
    kind: r.kind,
    message: r.message,
    status: r.status,
    reply: r.reply,
    createdAt: r.created_at,
    resolvedAt: r.resolved_at,
  }));
}

export async function addFeedback(
  author: string,
  kind: FeedbackKind,
  message: string,
  context: Record<string, unknown>
): Promise<void> {
  if (!supabase) throw new Error('Storage is not connected.');
  const { error } = await supabase.from('feedback').insert({ author, kind, message: message.trim(), context });
  if (error) {
    throw new Error(error.message.includes('feedback') ? MIGRATION_HINT : `Could not send the report: ${error.message}`);
  }
}
