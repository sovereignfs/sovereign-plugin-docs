'use client';

import { useEffect, useRef, useState } from 'react';
import type { NotificationItem } from '@sovereignfs/sdk';
import { Icon, Popover, Typography, useToast } from '@sovereignfs/ui';
import {
  dismissAllPlatformNotifications,
  dismissPlatformNotification,
  listPlatformNotifications,
  markAllPlatformNotificationsRead,
  markPlatformNotificationRead,
} from '../_lib/actions';
import styles from '../docs.module.css';

interface SsePayload {
  notificationId: string;
  userId: string;
  title: string;
  body?: string;
  url?: string;
  category: string;
  source?: string;
}

const POLL_INTERVAL_MS = 10_000;
const SSE_ERROR_FALLBACK_THRESHOLD = 3;

function timeAgo(ts: number): string {
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 60) return 'Just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 2) return 'Yesterday';
  return `${Math.floor(diff / 86400)}d ago`;
}

function categoryIconName(category: string): 'user-round-plus' | 'alert-triangle' | 'layers' {
  const c = category.toLowerCase();
  if (c.includes('user') || c.includes('invite') || c.includes('join')) return 'user-round-plus';
  if (c.includes('security') || c.includes('session') || c.includes('auth') || c.includes('warning'))
    return 'alert-triangle';
  return 'layers';
}

function categoryIconClass(category: string, styles: Record<string, string>): string | undefined {
  const c = category.toLowerCase();
  if (c.includes('user') || c.includes('invite') || c.includes('join')) return styles.iconGreen;
  if (c.includes('security') || c.includes('session') || c.includes('auth') || c.includes('warning'))
    return styles.iconAmber;
  return styles.iconNeutral;
}

/**
 * The real platform Notification Center, not a Docs-scoped substitute —
 * mirrors Kanban's own `KanbanNotificationBell` (`plugins/sovereign-plugin-
 * kanban.local`) verbatim: same SDK-backed reads/writes
 * (`notifications.list/markRead/markAllRead/dismiss/dismissAll` via this
 * plugin's own server actions in `_lib/actions.ts`), same SSE-first-then-
 * polling transport, same DS-primitive rebuild (`Popover`) since the real
 * `NotificationBell` React component can't be imported here — `shell:
 * minimal` gets none of the platform's chrome, and it isn't part of
 * `@sovereignfs/ui`'s published surface.
 *
 * Visual details (panel width/padding, header title, close button, per-item
 * category icon/color, dismiss/unread-dot sizing) are copied from the real
 * `NotificationBell.module.css` token-for-token — same semantic tokens, same
 * pixel values — so the panel reads as the same design, not a reskinned
 * approximation.
 */
export function DocsNotificationBell() {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // The trigger button's own bottom edge (plain px, measured at open time) —
  // mirrors Kanban's own `triggerBottom` pattern. Not read off
  // `--sv-shell-header-height`: that variable is only ever published onto
  // `#sv-app-shell` (`usePublishShellChromeHeight`), an element that doesn't
  // exist under `shell: minimal`.
  const [triggerBottom, setTriggerBottom] = useState<number | null>(null);
  const [transport, setTransport] = useState<'polling' | 'sse'>('sse');
  const seenIds = useRef<Set<string>>(new Set());
  const initialFetchDone = useRef(false);
  const sseErrorCount = useRef(0);

  async function fetchNotifications(opts?: { silent?: boolean }): Promise<void> {
    try {
      const data = await listPlatformNotifications();

      const isFirstFetch = !initialFetchDone.current;
      for (const item of data.items) {
        if (!seenIds.current.has(item.id)) {
          seenIds.current.add(item.id);
          if (!isFirstFetch && !opts?.silent && item.readAt == null) {
            toast.show({
              title: item.title,
              message: item.body ?? undefined,
              category: item.category,
            });
          }
        }
      }
      initialFetchDone.current = true;
      setItems(data.items);
      setUnreadCount(data.unreadCount);
    } catch {
      // Transient fetch failure — the next poll tick or SSE reconnect retries.
    }
  }

  useEffect(() => {
    void fetchNotifications({ silent: true });
  }, []);

  useEffect(() => {
    if (transport === 'sse') {
      sseErrorCount.current = 0;
      const es = new EventSource('/api/account/notifications/stream');
      es.onmessage = (event: MessageEvent<string>) => {
        sseErrorCount.current = 0;
        try {
          const payload = JSON.parse(event.data) as SsePayload;
          if (seenIds.current.has(payload.notificationId)) return;
          seenIds.current.add(payload.notificationId);
          toast.show({
            title: payload.title,
            message: payload.body,
            category: payload.category,
          });
          setItems((prev) => [
            {
              id: payload.notificationId,
              source: payload.source ?? 'unknown',
              sourceType: 'plugin',
              title: payload.title,
              body: payload.body ?? null,
              url: payload.url ?? null,
              category: payload.category,
              icon: null,
              readAt: null,
              dismissedAt: null,
              createdAt: Math.floor(Date.now() / 1000),
            },
            ...prev,
          ]);
          setUnreadCount((c) => c + 1);
        } catch {
          // Malformed payload — ignore.
        }
      };
      es.onerror = () => {
        sseErrorCount.current += 1;
        if (sseErrorCount.current >= SSE_ERROR_FALLBACK_THRESHOLD) setTransport('polling');
      };
      return () => es.close();
    }

    const handle = setInterval(() => void fetchNotifications(), POLL_INTERVAL_MS);
    return () => clearInterval(handle);
  }, [transport]);

  async function markAllRead(): Promise<void> {
    setItems((prev) =>
      prev.map((n) => ({ ...n, readAt: n.readAt ?? Math.floor(Date.now() / 1000) })),
    );
    setUnreadCount(0);
    await markAllPlatformNotificationsRead();
  }

  async function markRead(id: string): Promise<void> {
    const item = items.find((n) => n.id === id);
    if (!item || item.readAt != null) return;
    setItems((prev) =>
      prev.map((n) => (n.id === id ? { ...n, readAt: Math.floor(Date.now() / 1000) } : n)),
    );
    setUnreadCount((c) => Math.max(0, c - 1));
    await markPlatformNotificationRead(id);
  }

  async function dismiss(id: string): Promise<void> {
    const item = items.find((n) => n.id === id);
    setItems((prev) => prev.filter((n) => n.id !== id));
    if (item?.readAt == null) setUnreadCount((c) => Math.max(0, c - 1));
    await dismissPlatformNotification(id);
  }

  async function clearAll(): Promise<void> {
    setItems([]);
    setUnreadCount(0);
    await dismissAllPlatformNotifications();
  }

  return (
    <Popover
      align="right"
      width={340}
      open={open}
      onClose={() => setOpen(false)}
      aria-label="Notifications"
      panelStyle={{
        position: 'fixed',
        top:
          triggerBottom != null
            ? `calc(${triggerBottom}px + var(--sv-space-3) + var(--sv-space-2))`
            : undefined,
        left: 'var(--sv-space-4)',
        right: 'var(--sv-space-4)',
        width: 'auto',
        maxHeight: 480,
      }}
      trigger={
        <button
          ref={triggerRef}
          type="button"
          className={[styles.mobileHeaderIconButton, open ? styles.mobileHeaderIconButtonActive : '']
            .filter(Boolean)
            .join(' ')}
          aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ''}`}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={() => {
            const willOpen = !open;
            setOpen(willOpen);
            if (willOpen) {
              void fetchNotifications({ silent: true });
              if (triggerRef.current) {
                setTriggerBottom(triggerRef.current.getBoundingClientRect().bottom);
              }
            }
          }}
        >
          <Icon name="bell" size="lg" aria-hidden />
          {unreadCount > 0 && (
            <span className={styles.notificationBadge} aria-hidden>
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>
      }
    >
      <div className={styles.notificationPanelHeader}>
        <span className={styles.notificationPanelTitle}>Notifications</span>
        <div className={styles.notificationPanelActions}>
          {items.length > 0 && (
            <>
              {unreadCount > 0 && (
                <button
                  type="button"
                  className={styles.notificationActionBtn}
                  onClick={() => void markAllRead()}
                >
                  Mark all read
                </button>
              )}
              <button
                type="button"
                className={styles.notificationActionBtn}
                onClick={() => void clearAll()}
              >
                Clear all
              </button>
            </>
          )}
          <button
            type="button"
            className={styles.notificationCloseBtn}
            aria-label="Close notifications"
            onClick={() => setOpen(false)}
          >
            <Icon name="x" size="sm" aria-hidden />
          </button>
        </div>
      </div>
      <ul className={styles.notificationList} aria-label="Notification list">
        {items.length === 0 && (
          <li className={styles.notificationEmpty}>
            <span className={styles.notificationEmptyIcon} aria-hidden>
              <Icon name="bell" size="md" aria-hidden />
            </span>
            <Typography variant="caption">No notifications.</Typography>
          </li>
        )}
        {items.map((item) => (
          <li
            key={item.id}
            className={[styles.notificationItem, item.readAt != null ? styles.notificationItemRead : '']
              .filter(Boolean)
              .join(' ')}
          >
            <span
              className={[styles.notificationCategoryIcon, categoryIconClass(item.category, styles)]
                .filter(Boolean)
                .join(' ')}
              aria-hidden
            >
              <Icon name={categoryIconName(item.category)} size="sm" aria-hidden />
            </span>
            <div className={styles.notificationItemBody}>
              {item.url ? (
                <a
                  href={item.url}
                  className={styles.notificationItemTitle}
                  onClick={() => {
                    void markRead(item.id);
                    setOpen(false);
                  }}
                >
                  {item.title}
                </a>
              ) : item.readAt == null ? (
                <button
                  type="button"
                  className={styles.notificationItemTitle}
                  aria-label={`Mark as read: ${item.title}`}
                  onClick={() => void markRead(item.id)}
                >
                  {item.title}
                </button>
              ) : (
                <span className={styles.notificationItemTitle}>{item.title}</span>
              )}
              <Typography variant="caption" className={styles.notificationItemTime}>
                {timeAgo(item.createdAt)}
              </Typography>
            </div>
            <div className={styles.notificationItemEnd}>
              {item.readAt == null && (
                <span className={styles.notificationUnreadDot} aria-label="Unread" />
              )}
              <button
                type="button"
                className={styles.notificationDismissBtn}
                aria-label={`Dismiss: ${item.title}`}
                onClick={() => void dismiss(item.id)}
              >
                <Icon name="x" size="xs" aria-hidden />
              </button>
            </div>
          </li>
        ))}
      </ul>
    </Popover>
  );
}
