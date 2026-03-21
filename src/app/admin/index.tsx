import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { BackButton } from '../../components/common/BackButton';
import { useHeaderHorizontalInset } from '../../hooks/useHeaderHorizontalInset';
import type {
  AdminDailyUsageRow,
  AdminRevenueRow,
  AdminStats,
  AdminStatsPeriod
} from '../../services/adminService';
import { getAdminStats } from '../../services/adminService';
import { useStore } from '../../store/useStore';
import { theme } from '../../theme';

const PERIODS: Array<{ label: string; value: AdminStatsPeriod }> = [
  { label: '7 days', value: '7d' },
  { label: '30 days', value: '30d' },
  { label: 'This month', value: 'mtd' }
];

const TIERS = ['free', 'regular', 'premium', 'admin'] as const;

function formatCad(cents: number): string {
  return `$${(cents / 100).toFixed(2)} CAD`;
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(1)}M`;
  }
  if (n >= 1_000) {
    return `${(n / 1_000).toFixed(1)}k`;
  }
  return String(n);
}

function sumField(rows: AdminDailyUsageRow[], field: keyof AdminDailyUsageRow): number {
  return rows.reduce((sum, row) => sum + (Number(row[field]) || 0), 0);
}

function sumRevenue(rows: AdminRevenueRow[]): number {
  return rows.reduce((sum, row) => sum + row.totalCents, 0);
}

function getTierRows(usage: AdminDailyUsageRow[], tier: string): AdminDailyUsageRow[] {
  return usage.filter((r) => r.tier === tier && r.endpoint === 'claude');
}

function BarRow({ label, value, max }: { label: string; value: number; max: number }) {
  const ratio = max > 0 ? Math.min(1, value / max) : 0;
  return (
    <View style={styles.barRow}>
      <Text style={styles.barLabel}>{label}</Text>
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${(ratio * 100).toFixed(1)}%` as `${number}%` }]} />
      </View>
      <Text style={styles.barValue}>{formatNumber(value)}</Text>
    </View>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <View style={styles.statCard}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
      {sub ? <Text style={styles.statSub}>{sub}</Text> : null}
    </View>
  );
}

export default function AdminDashboardScreen() {
  const headerHorizontalInset = useHeaderHorizontalInset();
  const session = useStore((state) => state.session);
  const [period, setPeriod] = useState<AdminStatsPeriod>('mtd');
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (p: AdminStatsPeriod) => {
      if (!session?.accessToken) {
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const data = await getAdminStats(session.accessToken, p);
        setStats(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load stats');
      } finally {
        setLoading(false);
      }
    },
    [session?.accessToken]
  );

  useEffect(() => {
    void load(period);
  }, [load, period]);

  const totalMessages = useMemo(() => sumField(stats?.dailyUsage ?? [], 'requests'), [stats]);
  const totalDAU = useMemo(() => {
    if (!stats) {
      return 0;
    }
    const uniquePerDay = new Map<string, Set<string>>();
    for (const row of stats.dailyUsage) {
      if (!uniquePerDay.has(row.day)) {
        uniquePerDay.set(row.day, new Set());
      }
    }
    return stats.dailyUsage.reduce((max, row) => Math.max(max, row.uniqueUsers), 0);
  }, [stats]);
  const totalTtsChars = useMemo(() => sumField(stats?.dailyUsage ?? [], 'ttsChars'), [stats]);
  const totalRevenueCents = useMemo(() => sumRevenue(stats?.revenue ?? []), [stats]);

  const tierMessageCounts = useMemo(() => {
    return TIERS.map((tier) => ({
      tier,
      count: sumField(getTierRows(stats?.dailyUsage ?? [], tier), 'requests')
    }));
  }, [stats]);
  const maxTierCount = useMemo(
    () => Math.max(1, ...tierMessageCounts.map((t) => t.count)),
    [tierMessageCounts]
  );

  return (
    <View style={styles.root}>
      <View style={[styles.topRow, { paddingHorizontal: headerHorizontalInset }]}>
        <BackButton testID="admin-back" />
        <Pressable
          onPress={() => router.push('/admin/users' as never)}
          style={styles.usersButton}
          testID="admin-users-link"
        >
          <Text style={styles.usersButtonLabel}>Users</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.screen}>
        <Text style={styles.title}>Admin Dashboard</Text>

        {/* Period selector */}
        <View style={styles.chipRow}>
          {PERIODS.map(({ label, value }) => (
            <Pressable
              key={value}
              onPress={() => setPeriod(value)}
              style={[styles.chip, period === value ? styles.chipActive : null]}
              testID={`admin-period-${value}`}
            >
              <Text style={[styles.chipLabel, period === value ? styles.chipLabelActive : null]}>
                {label}
              </Text>
            </Pressable>
          ))}
        </View>

        {loading ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator color={theme.colors.neonBlue} />
          </View>
        ) : null}

        {error ? <Text style={styles.errorText}>{error}</Text> : null}

        {stats && !loading ? (
          <>
            {/* KPI cards */}
            <View style={styles.cardGrid}>
              <StatCard
                label="Peak DAU"
                value={formatNumber(totalDAU)}
                sub="unique users / day"
              />
              <StatCard
                label="Messages"
                value={formatNumber(totalMessages)}
                sub="claude requests"
              />
              <StatCard
                label="TTS chars"
                value={formatNumber(totalTtsChars)}
                sub="characters sent"
              />
              <StatCard
                label="Est. cost"
                value={formatCad(stats.estimatedCostCents)}
                sub="Claude tokens"
              />
            </View>

            {/* Cost vs Revenue */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Cost vs Revenue</Text>
              <View style={styles.costRevenueCard}>
                <View style={styles.costRevenueRow}>
                  <Text style={styles.costRevenueLabel}>Revenue</Text>
                  <Text style={[styles.costRevenueAmount, styles.amountGreen]}>
                    {formatCad(totalRevenueCents)}
                  </Text>
                </View>
                <View style={styles.costRevenueRow}>
                  <Text style={styles.costRevenueLabel}>Est. cost</Text>
                  <Text style={[styles.costRevenueAmount, styles.amountRed]}>
                    {formatCad(stats.estimatedCostCents)}
                  </Text>
                </View>
                <View style={styles.divider} />
                <View style={styles.costRevenueRow}>
                  <Text style={styles.costRevenueLabel}>Net margin (est.)</Text>
                  <Text
                    style={[
                      styles.costRevenueAmount,
                      styles.amountBold,
                      totalRevenueCents - stats.estimatedCostCents >= 0
                        ? styles.amountGreen
                        : styles.amountRed
                    ]}
                  >
                    {formatCad(totalRevenueCents - stats.estimatedCostCents)}
                  </Text>
                </View>
              </View>
            </View>

            {/* Messages by tier */}
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Messages by tier</Text>
              <View style={styles.card}>
                {tierMessageCounts.map(({ tier, count }) => (
                  <BarRow key={tier} label={tier} value={count} max={maxTierCount} />
                ))}
              </View>
            </View>

            {/* Revenue breakdown */}
            {stats.revenue.length > 0 ? (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Revenue events</Text>
                <View style={styles.card}>
                  {stats.revenue.map((row, idx) => (
                    <View key={idx} style={styles.revenueRow}>
                      <View style={styles.revenueLeft}>
                        <Text style={styles.revenueTier}>{row.tier}</Text>
                        <Text style={styles.revenueType}>{row.eventType}</Text>
                      </View>
                      <View style={styles.revenueRight}>
                        <Text style={styles.revenueEvents}>{row.events}×</Text>
                        <Text style={styles.revenueAmount}>{formatCad(row.totalCents)}</Text>
                      </View>
                    </View>
                  ))}
                </View>
              </View>
            ) : null}
          </>
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
    justifyContent: 'space-between',
    paddingTop: theme.spacing.sm,
    paddingBottom: theme.spacing.xs
  },
  screen: {
    width: '100%',
    maxWidth: 720,
    alignSelf: 'center',
    padding: theme.spacing.lg,
    gap: theme.spacing.lg
  },
  title: {
    color: theme.colors.textPrimary,
    fontSize: 22,
    fontWeight: '800'
  },
  chipRow: {
    flexDirection: 'row',
    gap: theme.spacing.xs
  },
  chip: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceSunken
  },
  chipActive: {
    borderColor: theme.colors.neonBlue,
    backgroundColor: theme.colors.surfaceButton,
    shadowColor: theme.colors.neonBlue,
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
    elevation: 4
  },
  chipLabel: {
    color: theme.colors.textSecondary,
    fontSize: 12,
    fontWeight: '700'
  },
  chipLabelActive: {
    color: theme.colors.neonBlue
  },
  loadingRow: {
    alignItems: 'center',
    paddingVertical: theme.spacing.lg
  },
  errorText: {
    color: theme.colors.error,
    fontSize: 13
  },
  cardGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm
  },
  statCard: {
    flex: 1,
    minWidth: 130,
    borderWidth: 1.4,
    borderColor: theme.colors.neonBlueSoft,
    borderRadius: 14,
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.md,
    gap: 4,
    shadowColor: theme.colors.neonBlue,
    shadowOpacity: 0.16,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3
  },
  statLabel: {
    color: theme.colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase'
  },
  statValue: {
    color: theme.colors.textPrimary,
    fontSize: 22,
    fontWeight: '800'
  },
  statSub: {
    color: theme.colors.textMuted,
    fontSize: 11
  },
  section: {
    gap: theme.spacing.sm
  },
  sectionTitle: {
    color: theme.colors.textSecondary,
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase'
  },
  card: {
    borderWidth: 1.4,
    borderColor: theme.colors.neonBlueSoft,
    borderRadius: 14,
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.md,
    gap: theme.spacing.sm,
    shadowColor: theme.colors.neonBlue,
    shadowOpacity: 0.14,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3
  },
  costRevenueCard: {
    borderWidth: 1.4,
    borderColor: theme.colors.neonBlueSoft,
    borderRadius: 14,
    backgroundColor: theme.colors.surface,
    padding: theme.spacing.md,
    gap: theme.spacing.sm,
    shadowColor: theme.colors.neonBlue,
    shadowOpacity: 0.14,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3
  },
  costRevenueRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center'
  },
  costRevenueLabel: {
    color: theme.colors.textSecondary,
    fontSize: 14,
    fontWeight: '600'
  },
  costRevenueAmount: {
    fontSize: 15,
    fontWeight: '700'
  },
  amountGreen: {
    color: '#4ADE80'
  },
  amountRed: {
    color: theme.colors.error
  },
  amountBold: {
    fontSize: 16,
    fontWeight: '800'
  },
  divider: {
    height: 1,
    backgroundColor: theme.colors.border,
    marginVertical: 2
  },
  barRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm
  },
  barLabel: {
    color: theme.colors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
    width: 60
  },
  barTrack: {
    flex: 1,
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.colors.surfaceSunken,
    overflow: 'hidden'
  },
  barFill: {
    height: '100%',
    borderRadius: 4,
    backgroundColor: theme.colors.neonBlue
  },
  barValue: {
    color: theme.colors.textMuted,
    fontSize: 12,
    width: 42,
    textAlign: 'right'
  },
  revenueRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: theme.spacing.xs
  },
  revenueLeft: {
    gap: 2
  },
  revenueTier: {
    color: theme.colors.textPrimary,
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'capitalize'
  },
  revenueType: {
    color: theme.colors.textMuted,
    fontSize: 11
  },
  revenueRight: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    alignItems: 'center'
  },
  revenueEvents: {
    color: theme.colors.textMuted,
    fontSize: 12
  },
  revenueAmount: {
    color: theme.colors.textPrimary,
    fontSize: 13,
    fontWeight: '700'
  },
  usersButton: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: theme.colors.neonBlueSoft,
    backgroundColor: theme.colors.surfaceSunken
  },
  usersButtonLabel: {
    color: theme.colors.neonBlue,
    fontSize: 13,
    fontWeight: '700'
  }
});
