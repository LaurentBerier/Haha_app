import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View
} from 'react-native';
import { BackButton } from '../../components/common/BackButton';
import { useToast } from '../../components/common/ToastProvider';
import { resolveErrorMessage } from '../../config/errorMessages';
import { useHeaderHorizontalInset } from '../../hooks/useHeaderHorizontalInset';
import type { AdminUser, AdminUsersPage } from '../../services/adminService';
import { getAdminUsers, setUserAccountType, setUserQuotaOverride } from '../../services/adminService';
import { useStore } from '../../store/useStore';
import { theme } from '../../theme';
import { getAccountTypeLabel } from '../../utils/accountTypeUtils';

type TierFilter = 'all' | 'free' | 'regular' | 'premium' | 'admin';
const TIER_FILTERS: TierFilter[] = ['all', 'free', 'regular', 'premium', 'admin'];
const ACCOUNT_TYPES = ['free', 'regular', 'premium', 'admin'] as const;
const PAGE_SIZE = 25;

const TIER_COLORS: Record<string, string> = {
  free: theme.colors.textMuted,
  regular: theme.colors.neonBlue,
  premium: '#A78BFA',
  admin: theme.colors.neonRed
};

function TierBadge({ tier }: { tier: string | null }) {
  const color = tier ? (TIER_COLORS[tier] ?? theme.colors.textMuted) : theme.colors.textMuted;
  return (
    <View style={[styles.tierBadge, { borderColor: color }]}>
      <Text style={[styles.tierBadgeLabel, { color }]}>{tier ? getAccountTypeLabel(tier) : '—'}</Text>
    </View>
  );
}

function UserRow({
  user,
  token,
  onUpdated
}: {
  user: AdminUser;
  token: string;
  onUpdated: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [quotaInput, setQuotaInput] = useState(
    user.capOverride !== null ? String(user.capOverride) : ''
  );
  const toast = useToast();

  const handleTierChange = async (accountTypeId: string) => {
    if (accountTypeId === user.tier) {
      return;
    }
    setSaving(true);
    try {
      await setUserAccountType(token, user.id, accountTypeId);
      toast.success(`Tier updated to ${accountTypeId}`);
      onUpdated();
    } catch (err) {
      toast.error(resolveErrorMessage(err, 'generic'));
    } finally {
      setSaving(false);
    }
  };

  const handleQuotaSave = async () => {
    const trimmed = quotaInput.trim();
    const monthlyCap = trimmed === '' ? null : parseInt(trimmed, 10);
    if (trimmed !== '' && (!Number.isFinite(monthlyCap) || (monthlyCap as number) < 0)) {
      Alert.alert('Invalid value', 'Monthly cap must be a non-negative number or empty to reset.');
      return;
    }
    setSaving(true);
    try {
      await setUserQuotaOverride(token, user.id, monthlyCap);
      toast.success(monthlyCap === null ? 'Quota override cleared' : `Quota set to ${monthlyCap}`);
      onUpdated();
    } catch (err) {
      toast.error(resolveErrorMessage(err, 'generic'));
    } finally {
      setSaving(false);
    }
  };

  const lastActive = user.lastActiveAt
    ? new Date(user.lastActiveAt).toLocaleDateString('en-CA', { month: 'short', day: 'numeric' })
    : 'Never';

  return (
    <Pressable
      onPress={() => setExpanded((v) => !v)}
      style={({ pressed }) => [styles.userRow, pressed ? styles.userRowPressed : null]}
      testID={`admin-user-row-${user.id}`}
    >
      <View style={styles.userRowMain}>
        <View style={styles.userRowInfo}>
          <Text style={styles.userEmail} numberOfLines={1}>
            {user.email ?? user.id.slice(0, 8)}
          </Text>
          <Text style={styles.userMeta}>
            {user.messagesThisMonth} msgs · last {lastActive}
            {user.capOverride !== null ? ` · cap: ${user.capOverride}` : ''}
          </Text>
        </View>
        <TierBadge tier={user.tier} />
      </View>

      {expanded ? (
        <View style={styles.userActions}>
          <Text style={styles.actionsLabel}>Change tier</Text>
          <View style={styles.tierChipRow}>
            {ACCOUNT_TYPES.map((t) => (
              <Pressable
                key={t}
                onPress={() => void handleTierChange(t)}
                disabled={saving}
                style={[
                  styles.tierChip,
                  user.tier === t ? styles.tierChipActive : null,
                  saving ? styles.disabledOpacity : null
                ]}
                testID={`admin-tier-chip-${t}`}
              >
                <Text
                  style={[
                    styles.tierChipLabel,
                    user.tier === t ? styles.tierChipLabelActive : null
                  ]}
                >
                  {getAccountTypeLabel(t)}
                </Text>
              </Pressable>
            ))}
          </View>

          <Text style={styles.actionsLabel}>Monthly quota override</Text>
          <View style={styles.quotaRow}>
            <TextInput
              value={quotaInput}
              onChangeText={setQuotaInput}
              placeholder="e.g. 500 (empty = tier default)"
              placeholderTextColor={theme.colors.textDisabled}
              keyboardType="number-pad"
              style={[styles.quotaInput, saving ? styles.disabledOpacity : null]}
              editable={!saving}
              testID="admin-quota-input"
            />
            <Pressable
              onPress={() => void handleQuotaSave()}
              disabled={saving}
              style={[styles.saveButton, saving ? styles.disabledOpacity : null]}
              testID="admin-quota-save"
            >
              {saving ? (
                <ActivityIndicator color={theme.colors.textPrimary} size="small" />
              ) : (
                <Text style={styles.saveButtonLabel}>Save</Text>
              )}
            </Pressable>
          </View>

          <View style={styles.userMetaDetail}>
            <Text style={styles.userMetaDetailText}>ID: {user.id}</Text>
            <Text style={styles.userMetaDetailText}>
              Total events: {user.totalEvents}
            </Text>
            {user.resetAt ? (
              <Text style={styles.userMetaDetailText}>
                Resets: {new Date(user.resetAt).toLocaleDateString('en-CA')}
              </Text>
            ) : null}
          </View>
        </View>
      ) : null}
    </Pressable>
  );
}

export default function AdminUsersScreen() {
  const headerHorizontalInset = useHeaderHorizontalInset();
  const session = useStore((state) => state.session);
  const [tierFilter, setTierFilter] = useState<TierFilter>('all');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [page, setPage] = useState(0);
  const [result, setResult] = useState<AdminUsersPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(
    async (p: number, s: string, tier: TierFilter) => {
      if (!session?.accessToken) {
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const data = await getAdminUsers(session.accessToken, {
          page: p,
          limit: PAGE_SIZE,
          search: s || undefined,
          tier: tier === 'all' ? undefined : tier
        });
        setResult(data);
      } catch (err) {
        setError(resolveErrorMessage(err, 'generic'));
      } finally {
        setLoading(false);
      }
    },
    [session?.accessToken]
  );

  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(0);
    }, 300);
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [search]);

  useEffect(() => {
    void load(page, debouncedSearch, tierFilter);
  }, [load, page, debouncedSearch, tierFilter]);

  const handleTierFilterChange = (t: TierFilter) => {
    setTierFilter(t);
    setPage(0);
  };

  const users = Array.isArray(result?.users) ? result.users : [];
  const totalResults = typeof result?.total === 'number' ? result.total : 0;
  const totalPages = result ? Math.ceil(totalResults / PAGE_SIZE) : 0;

  return (
    <View style={styles.root}>
      <View style={[styles.topRow, { paddingHorizontal: headerHorizontalInset }]}>
        <BackButton testID="admin-users-back" />
        <Text style={styles.screenTitle}>Users</Text>
        <View style={styles.topRowSpacer} />
      </View>

      <View style={[styles.controls, { paddingHorizontal: headerHorizontalInset }]}>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search by email or ID…"
          placeholderTextColor={theme.colors.textDisabled}
          style={styles.searchInput}
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
          testID="admin-users-search"
        />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filterScroll}>
          <View style={styles.filterRow}>
            {TIER_FILTERS.map((t) => (
              <Pressable
                key={t}
                onPress={() => handleTierFilterChange(t)}
                style={[styles.filterChip, tierFilter === t ? styles.filterChipActive : null]}
                testID={`admin-filter-${t}`}
              >
                <Text
                  style={[
                    styles.filterChipLabel,
                    tierFilter === t ? styles.filterChipLabelActive : null
                  ]}
                >
                  {t}
                </Text>
              </Pressable>
            ))}
          </View>
        </ScrollView>
      </View>

      <ScrollView contentContainerStyle={styles.list}>
        {loading && !result ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator color={theme.colors.neonBlue} />
          </View>
        ) : null}

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        {users.map((user) => (
          <UserRow
            key={user.id}
            user={user}
            token={session?.accessToken ?? ''}
            onUpdated={() => void load(page, debouncedSearch, tierFilter)}
          />
        ))}

        {result && users.length === 0 && !loading ? (
          <Text style={styles.emptyText}>No users found.</Text>
        ) : null}

        {/* Pagination */}
        {totalPages > 1 ? (
          <View style={styles.paginationRow}>
            <Pressable
              onPress={() => setPage((p) => Math.max(0, p - 1))}
              disabled={page === 0 || loading}
              style={[styles.pageButton, page === 0 ? styles.disabledOpacity : null]}
              testID="admin-page-prev"
            >
              <Text style={styles.pageButtonLabel}>← Previous</Text>
            </Pressable>
            <Text style={styles.pageInfo}>
              {page + 1} / {totalPages}
            </Text>
            <Pressable
              onPress={() => setPage((p) => p + 1)}
              disabled={page >= totalPages - 1 || loading}
              style={[
                styles.pageButton,
                page >= totalPages - 1 ? styles.disabledOpacity : null
              ]}
              testID="admin-page-next"
            >
              <Text style={styles.pageButtonLabel}>Next →</Text>
            </Pressable>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: theme.colors.background
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: theme.spacing.sm,
    paddingBottom: theme.spacing.xs,
    gap: theme.spacing.sm
  },
  topRowSpacer: {
    flex: 1
  },
  screenTitle: {
    color: theme.colors.textPrimary,
    fontSize: 17,
    fontWeight: '800',
    flex: 1
  },
  controls: {
    gap: theme.spacing.sm,
    paddingBottom: theme.spacing.sm
  },
  searchInput: {
    height: 42,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 12,
    backgroundColor: theme.colors.surfaceSunken,
    color: theme.colors.textPrimary,
    paddingHorizontal: theme.spacing.md,
    fontSize: 14
  },
  filterScroll: {
    flexGrow: 0
  },
  filterRow: {
    flexDirection: 'row',
    gap: theme.spacing.xs
  },
  filterChip: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceSunken
  },
  filterChipActive: {
    borderColor: theme.colors.neonBlue,
    backgroundColor: theme.colors.surfaceButton,
    shadowColor: theme.colors.neonBlue,
    shadowOpacity: 0.3,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
    elevation: 3
  },
  filterChipLabel: {
    color: theme.colors.textSecondary,
    fontSize: 12,
    fontWeight: '700'
  },
  filterChipLabelActive: {
    color: theme.colors.neonBlue
  },
  list: {
    padding: theme.spacing.md,
    gap: theme.spacing.sm
  },
  loadingRow: {
    alignItems: 'center',
    paddingVertical: theme.spacing.lg
  },
  errorText: {
    color: theme.colors.error,
    fontSize: 13,
    padding: theme.spacing.sm
  },
  emptyText: {
    color: theme.colors.textMuted,
    fontSize: 14,
    textAlign: 'center',
    paddingVertical: theme.spacing.lg
  },
  userRow: {
    borderWidth: 1.4,
    borderColor: theme.colors.border,
    borderRadius: 14,
    backgroundColor: theme.colors.surface,
    overflow: 'hidden'
  },
  userRowPressed: {
    opacity: 0.88
  },
  userRowMain: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: theme.spacing.md,
    gap: theme.spacing.sm
  },
  userRowInfo: {
    flex: 1,
    gap: 3
  },
  userEmail: {
    color: theme.colors.textPrimary,
    fontSize: 14,
    fontWeight: '600'
  },
  userMeta: {
    color: theme.colors.textMuted,
    fontSize: 11
  },
  tierBadge: {
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 3
  },
  tierBadgeLabel: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'capitalize'
  },
  userActions: {
    padding: theme.spacing.md,
    paddingTop: 0,
    gap: theme.spacing.sm,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border
  },
  actionsLabel: {
    color: theme.colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    marginTop: theme.spacing.xs
  },
  tierChipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.xs
  },
  tierChip: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceSunken
  },
  tierChipActive: {
    borderColor: theme.colors.neonBlue,
    backgroundColor: theme.colors.surfaceButton
  },
  tierChipLabel: {
    color: theme.colors.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'capitalize'
  },
  tierChipLabelActive: {
    color: theme.colors.neonBlue
  },
  quotaRow: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    alignItems: 'center'
  },
  quotaInput: {
    flex: 1,
    height: 40,
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 10,
    backgroundColor: theme.colors.surfaceSunken,
    color: theme.colors.textPrimary,
    paddingHorizontal: theme.spacing.sm,
    fontSize: 13
  },
  saveButton: {
    height: 40,
    paddingHorizontal: theme.spacing.md,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.colors.neonBlue,
    backgroundColor: theme.colors.surfaceButton,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 60
  },
  saveButtonLabel: {
    color: theme.colors.neonBlue,
    fontSize: 13,
    fontWeight: '700'
  },
  userMetaDetail: {
    gap: 3,
    paddingTop: theme.spacing.xs
  },
  userMetaDetailText: {
    color: theme.colors.textMuted,
    fontSize: 11
  },
  disabledOpacity: {
    opacity: 0.45
  },
  paginationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: theme.spacing.md
  },
  pageButton: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceSunken
  },
  pageButtonLabel: {
    color: theme.colors.textSecondary,
    fontSize: 13,
    fontWeight: '700'
  },
  pageInfo: {
    color: theme.colors.textMuted,
    fontSize: 13
  }
});
