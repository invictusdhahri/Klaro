'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Plus, MessageSquare, MoreHorizontal, Pencil, Trash2, Check, X } from 'lucide-react';
import { cn } from '@klaro/ui/cn';
import { API_ENDPOINTS } from '@klaro/shared';
import { api } from '@/lib/api';

interface Session {
  id: string;
  title: string;
  updatedAt: string;
  lastMessageAt: string | null;
  messageCount: number;
}

function relativeTime(iso: string | null): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

interface ChatSessionsRailProps {
  // reserved for future use
}

export function ChatSessionsRail(_props: ChatSessionsRailProps = {}) {
  const router = useRouter();
  const pathname = usePathname();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);
  const renameRef = useRef<HTMLInputElement>(null);

  const activeSessionId = pathname.startsWith('/chat/') ? pathname.slice(6).split('/')[0] : null;

  const fetchSessions = useCallback(async () => {
    try {
      const data = await api.get<Session[]>(API_ENDPOINTS.chat.sessions);
      setSessions(data);
    } catch {
      // silently ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchSessions();
  }, [fetchSessions, pathname]); // refetch whenever we navigate to a new session

  // Close dropdown on outside click.
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpenMenuId(null);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Focus rename input when it mounts.
  useEffect(() => {
    if (renamingId) renameRef.current?.focus();
  }, [renamingId]);

  const handleNewChat = useCallback(async () => {
    try {
      const session = await api.post<Session>(API_ENDPOINTS.chat.sessions, {});
      setSessions((prev) => [session, ...prev]);
      router.push(`/chat/${session.id}`);
    } catch {
      router.push('/chat');
    }
  }, [router]);

  const handleRename = useCallback(
    async (id: string) => {
      const title = renameValue.trim();
      if (!title) {
        setRenamingId(null);
        return;
      }
      try {
        await api.patch(API_ENDPOINTS.chat.session(id), { title });
        setSessions((prev) =>
          prev.map((s) => (s.id === id ? { ...s, title } : s)),
        );
      } catch {
        // ignore
      }
      setRenamingId(null);
    },
    [renameValue],
  );

  const handleDelete = useCallback(
    async (id: string) => {
      try {
        await api.delete(API_ENDPOINTS.chat.session(id));
        setSessions((prev) => prev.filter((s) => s.id !== id));
        if (activeSessionId === id) {
          router.push('/chat');
        }
      } catch {
        // ignore
      }
    },
    [activeSessionId, router],
  );

  return (
    <aside className="hidden w-52 shrink-0 flex-col lg:flex">
      <div className="flex flex-col h-full rounded-xl border border-border/60 bg-background/60 overflow-hidden">
        {/* New chat button */}
        <div className="p-2 border-b border-border/40">
          <button
            onClick={handleNewChat}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition hover:bg-muted/60 hover:text-foreground"
          >
            <Plus className="h-4 w-4 shrink-0" strokeWidth={2.5} />
            New chat
          </button>
        </div>

        {/* Sessions list */}
        <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {loading ? (
            <div className="space-y-1.5 py-2 px-1">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-10 rounded-lg bg-muted/40 animate-pulse"
                  style={{ opacity: 1 - i * 0.2 }}
                />
              ))}
            </div>
          ) : sessions.length === 0 ? (
            <p className="py-6 text-center text-xs text-muted-foreground/60">
              No chats yet
            </p>
          ) : (
            sessions.map((session) => {
              const isActive = session.id === activeSessionId;
              const isRenaming = renamingId === session.id;

              return (
                <div
                  key={session.id}
                  className={cn(
                    'group relative flex items-center rounded-lg transition',
                    isActive
                      ? 'bg-primary/10 text-primary'
                      : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
                  )}
                >
                  {isRenaming ? (
                    <div className="flex flex-1 items-center gap-1 px-2 py-1.5">
                      <input
                        ref={renameRef}
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void handleRename(session.id);
                          if (e.key === 'Escape') setRenamingId(null);
                        }}
                        className="flex-1 min-w-0 rounded bg-background border border-border/60 px-2 py-0.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary/40"
                        maxLength={120}
                      />
                      <button
                        onClick={() => void handleRename(session.id)}
                        className="text-primary hover:opacity-70"
                      >
                        <Check className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => setRenamingId(null)}
                        className="text-muted-foreground hover:opacity-70"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ) : (
                    <>
                      <button
                        onClick={() => router.push(`/chat/${session.id}`)}
                        className="flex flex-1 min-w-0 items-center gap-2 px-2 py-2 text-left"
                      >
                        <MessageSquare
                          className={cn('h-3.5 w-3.5 shrink-0', isActive ? 'text-primary' : 'text-muted-foreground/60')}
                          strokeWidth={2}
                        />
                        <div className="flex-1 min-w-0">
                          <p className="truncate text-xs font-medium leading-tight">
                            {session.title}
                          </p>
                          <p className="text-[10px] leading-tight text-muted-foreground/60 mt-0.5">
                            {relativeTime(session.lastMessageAt ?? session.updatedAt)}
                          </p>
                        </div>
                      </button>

                      {/* Context menu trigger — shown on hover or when menu is open */}
                      <div className="relative" ref={openMenuId === session.id ? menuRef : null}>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpenMenuId((prev) =>
                              prev === session.id ? null : session.id,
                            );
                          }}
                          className={cn(
                            'flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition',
                            'opacity-0 group-hover:opacity-100',
                            openMenuId === session.id && 'opacity-100 bg-muted/60',
                          )}
                          aria-label="Session options"
                        >
                          <MoreHorizontal className="h-3.5 w-3.5" />
                        </button>

                        {openMenuId === session.id && (
                          <div className="absolute right-0 top-7 z-50 w-36 rounded-lg border border-border/60 bg-popover p-1 shadow-lg">
                            <button
                              onClick={() => {
                                setOpenMenuId(null);
                                setRenamingId(session.id);
                                setRenameValue(session.title);
                              }}
                              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-foreground hover:bg-muted/60"
                            >
                              <Pencil className="h-3.5 w-3.5 text-muted-foreground" />
                              Rename
                            </button>
                            <button
                              onClick={() => {
                                setOpenMenuId(null);
                                void handleDelete(session.id);
                              }}
                              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-destructive hover:bg-destructive/10"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              Delete
                            </button>
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </aside>
  );
}
