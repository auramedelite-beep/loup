import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Search, UserMinus, UserPlus, Users, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Avatar } from '@/components/Avatar';
import { ConfirmDialog, EmptyState, LoadingBlock, PageHeader } from '@/components/ui';
import { api, errorCode } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import { useToast } from '@/contexts/ToastContext';
import type { FriendRequest, FriendRow } from '@/types';

interface FriendsResponse {
  friends: FriendRow[];
}

interface RequestsResponse {
  incoming: FriendRequest[];
  outgoing: FriendRequest[];
}

interface SearchUser {
  id: string;
  username: string;
  avatar: string;
  last_seen: number;
}

interface SearchResponse {
  users: SearchUser[];
}

type FriendsTab = 'friends' | 'requests';

export function FriendsPage() {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const [friends, setFriends] = useState<FriendRow[]>([]);
  const [incoming, setIncoming] = useState<FriendRequest[]>([]);
  const [outgoing, setOutgoing] = useState<FriendRequest[]>([]);
  const [search, setSearch] = useState('');
  const [results, setResults] = useState<SearchUser[]>([]);
  const [tab, setTab] = useState<FriendsTab>('friends');
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<FriendRow | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const [friendData, requestData] = await Promise.all([
        api<FriendsResponse>('/api/social/friends'),
        api<RequestsResponse>('/api/social/requests'),
      ]);
      setFriends(friendData.friends);
      setIncoming(requestData.incoming);
      setOutgoing(requestData.outgoing);
    } catch (error) {
      setLoadError(errorCode(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const query = search.trim();
    if (query.length < 2) {
      setResults([]);
      setSearchError(null);
      return;
    }

    let active = true;
    setResults([]);
    const timeout = window.setTimeout(() => {
      setSearchError(null);
      api<SearchResponse>(`/api/social/search?q=${encodeURIComponent(query)}`)
        .then((data) => {
          if (active) setResults(data.users);
        })
        .catch((error: unknown) => {
          if (active) {
            setResults([]);
            setSearchError(errorCode(error));
          }
        });
    }, 250);

    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [search]);

  const friendIds = useMemo(() => new Set(friends.map((friend) => friend.id)), [friends]);
  const outgoingIds = useMemo(() => new Set(outgoing.map((request) => request.to_user_id)), [outgoing]);
  const incomingByUser = useMemo(
    () => new Map(incoming.map((request) => [request.from_user_id, request])),
    [incoming],
  );

  const performAction = async (id: string, action: () => Promise<void>, success?: string): Promise<boolean> => {
    setBusyId(id);
    try {
      await action();
      await load();
      if (success) toast.success(t(success));
      return true;
    } catch (error) {
      toast.error(t(`errors.${errorCode(error)}`, { defaultValue: t('errors.unknown_error') }));
      return false;
    } finally {
      setBusyId(null);
    }
  };

  const sendRequest = (username: string, id: string) =>
    performAction(
      id,
      async () => {
        await api('/api/social/requests', { method: 'POST', body: { username } });
      },
      'profile.requestSent',
    );

  if (loading) return <LoadingBlock label={t('common.loading')} />;

  if (loadError) {
    return (
      <div className="card mx-auto max-w-xl p-6 text-center sm:p-8" role="alert">
        <p className="text-sm text-blood-300">
          {t(`errors.${loadError}`, { defaultValue: t('errors.unknown_error') })}
        </p>
        <button type="button" className="btn-ghost mt-4" onClick={() => void load()}>
          {t('common.retry')}
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-4xl min-w-0 px-1 sm:px-2">
      <PageHeader eyebrow={t('friends.title')} title={t('friends.title')} subtitle={t('friends.subtitle')} />

      <section className="panel mb-6">
        <label htmlFor="friend-search" className="label">{t('friends.search')}</label>
        <div className="relative">
          <Search size={17} className="pointer-events-none absolute end-3 top-1/2 -translate-y-1/2 text-mist" />
          <input
            id="friend-search"
            className="input pe-10"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('friends.searchPlaceholder')}
            autoComplete="off"
          />
        </div>
        <p className="mt-2 text-xs text-mist">{t('friends.searchHint')}</p>

        {searchError && (
          <p className="mt-3 text-sm text-blood-300" role="alert">
            {t(`errors.${searchError}`, { defaultValue: t('errors.unknown_error') })}
          </p>
        )}
        {search.trim().length >= 2 && !searchError && results.length > 0 && (
          <div className="mt-4 divide-y divide-white/[0.06]">
            {results.map((result) => {
              const request = incomingByUser.get(result.id);
              const isFriend = friendIds.has(result.id);
              const requestSent = outgoingIds.has(result.id);
              return (
                <div key={result.id} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0">
                  <Avatar avatar={result.avatar} size="sm" />
                  <Link to={`/profile/${result.id}`} className="min-w-0 flex-1 truncate text-sm font-semibold text-parchment-100 hover:text-gold-300">
                    {result.username}
                  </Link>
                  {request ? (
                    <button
                      type="button"
                      className="btn-primary btn-sm"
                      disabled={busyId === request.id}
                      onClick={() =>
                        void performAction(request.id, () =>
                          api(`/api/social/requests/${encodeURIComponent(request.id)}/accept`, { method: 'POST' }),
                        )
                      }
                    >
                      <Check size={14} /> {t('friends.accept')}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn-ghost btn-sm"
                      disabled={isFriend || requestSent || busyId === result.id}
                      onClick={() => void sendRequest(result.username, result.id)}
                    >
                      {isFriend ? t('profile.alreadyFriend') : requestSent ? t('profile.requestSent') : (
                        <><UserPlus size={14} /> {t('friends.add')}</>
                      )}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <div className="mb-5 flex gap-2 border-b border-white/[0.08]">
        {(['friends', 'requests'] as const).map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setTab(item)}
            className={`border-b-2 px-4 py-3 text-sm font-semibold transition-colors ${
              tab === item ? 'border-gold-400 text-gold-300' : 'border-transparent text-mist hover:text-parchment-100'
            }`}
            aria-current={tab === item ? 'page' : undefined}
          >
            {t(`friends.${item}`)}
            {item === 'friends' ? ` (${friends.length})` : ` (${incoming.length + outgoing.length})`}
          </button>
        ))}
      </div>

      {tab === 'friends' ? (
        friends.length === 0 ? (
          <EmptyState icon={<Users size={30} />} title={t('friends.noFriends')} text={t('friends.searchHint')} />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {friends.map((friend) => (
              <section key={friend.id} className="panel flex min-w-0 items-center gap-3">
                <Avatar avatar={friend.avatar} size="md" online={friend.online} />
                <div className="min-w-0 flex-1">
                  <Link to={`/profile/${friend.id}`} className="block truncate text-sm font-semibold text-parchment-100 hover:text-gold-300">
                    {friend.username}
                  </Link>
                  <p className="mt-1 text-xs text-mist">
                    {friend.online
                      ? t('friends.online')
                      : t('friends.lastSeen', { time: timeAgo(friend.last_seen, i18n.language) })}
                  </p>
                </div>
                <button
                  type="button"
                  className="btn-icon h-10 w-10"
                  aria-label={`${t('friends.remove')} ${friend.username}`}
                  onClick={() => setRemoveTarget(friend)}
                >
                  <UserMinus size={16} />
                </button>
              </section>
            ))}
          </div>
        )
      ) : (
        <div className="space-y-6">
          <RequestList
            title={t('friends.incoming')}
            requests={incoming}
            busyId={busyId}
            emptyLabel={t('friends.noRequests')}
            onAction={(request, action) =>
              void performAction(request.id, () =>
                api(`/api/social/requests/${encodeURIComponent(request.id)}/${action}`, { method: 'POST' }),
              )
            }
          />
          <RequestList
            title={t('friends.outgoing')}
            requests={outgoing}
            busyId={busyId}
            emptyLabel={t('friends.noRequests')}
          />
        </div>
      )}

      <ConfirmDialog
        open={removeTarget !== null}
        title={t('friends.remove')}
        message={t('friends.removeConfirm', { name: removeTarget?.username ?? '' })}
        confirmLabel={t('friends.remove')}
        danger
        onClose={() => setRemoveTarget(null)}
        onConfirm={async () => {
          if (!removeTarget) return;
          const target = removeTarget;
          const removed = await performAction(target.id, () =>
            api(`/api/social/friends/${encodeURIComponent(target.id)}`, { method: 'DELETE' }),
          );
          if (removed) setRemoveTarget(null);
        }}
      />
    </div>
  );
}

function RequestList({
  title,
  requests,
  busyId,
  emptyLabel,
  onAction,
}: {
  title: string;
  requests: FriendRequest[];
  busyId: string | null;
  emptyLabel: string;
  onAction?: (request: FriendRequest, action: 'accept' | 'decline') => void;
}) {
  const { t } = useTranslation();

  return (
    <section>
      <h2 className="section-title mb-3">{title}</h2>
      {requests.length === 0 ? (
        <p className="rounded-2xl border border-white/[0.06] bg-white/[0.02] px-4 py-5 text-center text-sm text-mist">
          {emptyLabel}
        </p>
      ) : (
        <div className="space-y-2">
          {requests.map((request) => (
            <div key={request.id} className="panel flex min-w-0 items-center gap-3">
              <Avatar avatar={request.avatar} size="sm" />
              <span className="min-w-0 flex-1 truncate text-sm font-semibold text-parchment-100">
                {request.username}
              </span>
              {onAction ? (
                <>
                  <button
                    type="button"
                    className="btn-primary btn-sm"
                    disabled={busyId === request.id}
                    onClick={() => onAction(request, 'accept')}
                  >
                    <Check size={14} /> {t('friends.accept')}
                  </button>
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    disabled={busyId === request.id}
                    onClick={() => onAction(request, 'decline')}
                  >
                    <X size={14} /> {t('friends.decline')}
                  </button>
                </>
              ) : (
                <span className="text-xs text-mist">{t('friends.outgoing')}</span>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
