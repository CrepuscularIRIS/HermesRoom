import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { initVibeApp, AppLifecycle } from '@gui/vibe-container';
import { fetchVibeInfo, reportLifecycle } from '@/lib';
import './i18n';
import styles from './index.module.scss';

const APP_ID = 11;
const APP_NAME = 'Mailbox';
const CLAWROOM_BASE_URL = 'http://localhost:18790';
const POLL_INTERVAL_MS = 15000;

const AGENT_IDS = ['aoi', 'lacia', 'methode', 'satonus', 'snowdrop', 'kouka'] as const;
type AgentId = (typeof AGENT_IDS)[number];

interface AgentDef {
  id: AgentId;
  label: string;
  color: string;
}

const AGENTS: readonly AgentDef[] = [
  { id: 'aoi', label: 'Aoi', color: '#2EA7FF' },
  { id: 'lacia', label: 'Lacia', color: '#7EC8E3' },
  { id: 'methode', label: 'Methode', color: '#FF8C42' },
  { id: 'satonus', label: 'Satonus', color: '#FFD700' },
  { id: 'snowdrop', label: 'Snowdrop', color: '#E8E8E8' },
  { id: 'kouka', label: 'Kouka', color: '#E53E3E' },
];

type MailBody = string | Record<string, unknown>;

interface MailLetter {
  id: string;
  from: string;
  to: string;
  type: string;
  subject: string;
  body: MailBody;
  priority: string;
  createdAt: string;
  readAt: string | null;
}

interface MailReadPayload {
  ok?: boolean;
  agent?: string;
  count?: number;
  letters?: unknown[];
}

interface MailboxApiResponse {
  agent?: string;
  messages?: MailReadPayload;
  error?: string;
}

function buildAgentRecord<T>(factory: (agent: AgentId) => T): Record<AgentId, T> {
  const record = {} as Record<AgentId, T>;
  for (const agent of AGENT_IDS) {
    record[agent] = factory(agent);
  }
  return record;
}

function parseDate(iso: string): number {
  const value = Date.parse(iso);
  return Number.isNaN(value) ? 0 : value;
}

function formatTimestamp(iso: string): string {
  if (!iso) return '-';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
}

function bodyToText(body: MailBody): string {
  if (typeof body === 'string') return body;
  return JSON.stringify(body, null, 2);
}

function normalizeLetter(input: unknown): MailLetter | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Partial<MailLetter>;

  const id = typeof raw.id === 'string' ? raw.id : '';
  if (!id) return null;

  let body: MailBody;
  if (typeof raw.body === 'string') {
    body = raw.body;
  } else if (raw.body && typeof raw.body === 'object') {
    body = raw.body;
  } else {
    body = '';
  }

  return {
    id,
    from: typeof raw.from === 'string' ? raw.from : 'unknown',
    to: typeof raw.to === 'string' ? raw.to : 'unknown',
    type: typeof raw.type === 'string' ? raw.type : 'message',
    subject: typeof raw.subject === 'string' && raw.subject ? raw.subject : '(no subject)',
    body,
    priority: typeof raw.priority === 'string' ? raw.priority : 'normal',
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : '',
    readAt: typeof raw.readAt === 'string' ? raw.readAt : null,
  };
}

async function fetchMailbox(agent: AgentId): Promise<{ letters: MailLetter[]; error: string | null }> {
  const url = `${CLAWROOM_BASE_URL}/api/mailbox/${agent}?limit=120`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      return { letters: [], error: `HTTP ${response.status}` };
    }

    const payload = (await response.json()) as MailboxApiResponse;
    const rawLetters = Array.isArray(payload.messages?.letters) ? payload.messages?.letters : [];
    const letters = rawLetters
      .map(normalizeLetter)
      .filter((letter): letter is MailLetter => letter !== null)
      .sort((a, b) => parseDate(b.createdAt) - parseDate(a.createdAt));

    return { letters, error: payload.error ?? null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { letters: [], error: message };
  }
}

const EmailPage: React.FC = () => {
  const [activeAgent, setActiveAgent] = useState<AgentId>('aoi');
  const [mailboxes, setMailboxes] = useState<Record<AgentId, MailLetter[]>>(() =>
    buildAgentRecord(() => []),
  );
  const [selectedByAgent, setSelectedByAgent] = useState<Record<AgentId, string | null>>(() =>
    buildAgentRecord(() => null),
  );
  const [loadingByAgent, setLoadingByAgent] = useState<Record<AgentId, boolean>>(() =>
    buildAgentRecord(() => false),
  );
  const [errorByAgent, setErrorByAgent] = useState<Record<AgentId, string | null>>(() =>
    buildAgentRecord(() => null),
  );
  const [bootstrapping, setBootstrapping] = useState(true);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string>('');

  const loadMailbox = useCallback(async (agent: AgentId) => {
    setLoadingByAgent((prev) => ({ ...prev, [agent]: true }));

    const result = await fetchMailbox(agent);

    setMailboxes((prev) => ({ ...prev, [agent]: result.letters }));
    setErrorByAgent((prev) => ({ ...prev, [agent]: result.error }));
    setLoadingByAgent((prev) => ({ ...prev, [agent]: false }));
    setSelectedByAgent((prev) => {
      const current = prev[agent];
      const exists = current ? result.letters.some((item) => item.id === current) : false;
      const next = exists ? current : (result.letters[0]?.id ?? null);
      if (next === current) return prev;
      return { ...prev, [agent]: next };
    });
  }, []);

  const refreshAll = useCallback(async () => {
    await Promise.all(AGENT_IDS.map((agent) => loadMailbox(agent)));
    setLastUpdatedAt(new Date().toISOString());
  }, [loadMailbox]);

  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      reportLifecycle(AppLifecycle.LOADING);

      try {
        const manager = await initVibeApp({
          id: APP_ID,
          url: window.location.href,
          type: 'page',
          name: APP_NAME,
          windowStyle: { width: 900, height: 620 },
        });

        manager.handshake({
          id: APP_ID,
          url: window.location.href,
          type: 'page',
          name: APP_NAME,
          windowStyle: { width: 900, height: 620 },
        });

        reportLifecycle(AppLifecycle.DOM_READY);

        try {
          await fetchVibeInfo();
        } catch (error) {
          console.warn('[Mailbox] fetchVibeInfo failed:', error);
        }

        await refreshAll();

        if (cancelled) return;

        setBootstrapping(false);
        reportLifecycle(AppLifecycle.LOADED);
        manager.ready();
      } catch (error) {
        setBootstrapping(false);
        reportLifecycle(AppLifecycle.ERROR, String(error));
      }
    };

    void init();

    return () => {
      cancelled = true;
      reportLifecycle(AppLifecycle.UNLOADING);
      reportLifecycle(AppLifecycle.DESTROYED);
    };
  }, [refreshAll]);

  useEffect(() => {
    if (bootstrapping) return;

    const timer = window.setInterval(() => {
      void refreshAll();
    }, POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(timer);
    };
  }, [bootstrapping, refreshAll]);

  const activeLetters = mailboxes[activeAgent];
  const selectedId = selectedByAgent[activeAgent];

  const selectedMessage = useMemo(
    () => activeLetters.find((item) => item.id === selectedId) ?? null,
    [activeLetters, selectedId],
  );

  const unreadCounts = useMemo(() => {
    return buildAgentRecord((agent) => mailboxes[agent].filter((item) => !item.readAt).length);
  }, [mailboxes]);

  return (
    <div className={styles.mailboxPage}>
      <header className={styles.header}>
        <div className={styles.headerTitle}>Hermes Mailbox</div>
        <button className={styles.refreshButton} onClick={() => void refreshAll()}>
          Refresh
        </button>
      </header>

      <div className={styles.subHeader}>
        <span>Source: ClawRoom /api/mailbox/:agent</span>
        <span>{lastUpdatedAt ? `Updated: ${formatTimestamp(lastUpdatedAt)}` : 'Updated: -'}</span>
      </div>

      <div className={styles.agentTabs}>
        {AGENTS.map((agent) => {
          const active = activeAgent === agent.id;
          const unread = unreadCounts[agent.id];
          return (
            <button
              key={agent.id}
              className={`${styles.agentTab} ${active ? styles.agentTabActive : ''}`}
              style={{ '--agent-color': agent.color } as React.CSSProperties}
              onClick={() => setActiveAgent(agent.id)}
            >
              <span className={styles.agentName}>{agent.label}</span>
              <span className={styles.agentMeta}>{agent.id}</span>
              {unread > 0 && <span className={styles.unreadBadge}>{unread}</span>}
            </button>
          );
        })}
      </div>

      <div className={styles.body}>
        <section className={styles.messageList}>
          {loadingByAgent[activeAgent] && activeLetters.length === 0 ? (
            <div className={styles.emptyState}>Loading mailbox...</div>
          ) : errorByAgent[activeAgent] ? (
            <div className={styles.errorState}>Mailbox error: {errorByAgent[activeAgent]}</div>
          ) : activeLetters.length === 0 ? (
            <div className={styles.emptyState}>No messages in this inbox.</div>
          ) : (
            activeLetters.map((letter) => {
              const selected = selectedId === letter.id;
              return (
                <button
                  key={letter.id}
                  className={`${styles.messageItem} ${selected ? styles.messageItemActive : ''}`}
                  onClick={() => setSelectedByAgent((prev) => ({ ...prev, [activeAgent]: letter.id }))}
                >
                  <div className={styles.messageTopRow}>
                    <span className={styles.messageType}>{letter.type}</span>
                    <span className={styles.messageTime}>{formatTimestamp(letter.createdAt)}</span>
                  </div>
                  <div className={styles.messageSubject}>{letter.subject}</div>
                  <div className={styles.messageMeta}>
                    <span>from: {letter.from}</span>
                    <span>to: {letter.to}</span>
                  </div>
                </button>
              );
            })
          )}
        </section>

        <section className={styles.detailPane}>
          {selectedMessage ? (
            <>
              <div className={styles.detailHeader}>
                <h3 className={styles.detailSubject}>{selectedMessage.subject}</h3>
                <div className={styles.detailMetaRow}>
                  <span>type: {selectedMessage.type}</span>
                  <span>priority: {selectedMessage.priority}</span>
                  <span>created: {formatTimestamp(selectedMessage.createdAt)}</span>
                </div>
                <div className={styles.detailMetaRow}>
                  <span>from: {selectedMessage.from}</span>
                  <span>to: {selectedMessage.to}</span>
                  <span>{selectedMessage.readAt ? `read: ${formatTimestamp(selectedMessage.readAt)}` : 'read: no'}</span>
                </div>
              </div>
              <pre className={styles.detailBody}>{bodyToText(selectedMessage.body)}</pre>
            </>
          ) : (
            <div className={styles.emptyState}>Select a message to view details.</div>
          )}
        </section>
      </div>
    </div>
  );
};

export default EmailPage;
