import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    TouchableOpacity,
    RefreshControl,
    ActivityIndicator,
    Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../../core/constants/theme';
import { useResponsive } from '../../../core/utils/responsive';
import api from '../../../core/services/api';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const formatINR = (v) =>
    '₹' + Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const formatCount = (v) => Number(v || 0).toLocaleString('en-IN');

const formatMs = (v) => `${Math.round(v || 0)} ms`;

const formatBytes = (bytes) => {
    const mb = bytes / 1024 / 1024;
    return `${mb.toFixed(1)} MB`;
};

const formatUptime = (seconds) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h}h ${m}m`;
};

const formatTime = (ts) => {
    const d = new Date(ts);
    return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
};

const formatDateTime = (ts) => {
    const d = new Date(ts);
    return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hour12: true });
};

// ─── Mini Bar Chart (pure RN Views) ──────────────────────────────────────────

function BarChart({ data, color, height = 80, valueFormat }) {
    if (!data || data.length === 0) {
        return (
            <View style={{ height, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={styles.emptyText}>No data</Text>
            </View>
        );
    }
    const max = Math.max(...data.map((d) => d.value), 1);
    return (
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', height, gap: 4 }}>
            {data.map((d, i) => {
                const barH = Math.max((d.value / max) * (height - 18), 2);
                const isLast = i === data.length - 1;
                return (
                    <View key={i} style={{ flex: 1, alignItems: 'center', justifyContent: 'flex-end' }}>
                        <View
                            style={{
                                width: '90%',
                                height: barH,
                                backgroundColor: color || COLORS.primary,
                                borderTopLeftRadius: 2,
                                borderTopRightRadius: 2,
                                opacity: isLast ? 1 : 0.55 + (i / data.length) * 0.45,
                            }}
                        />
                        {data.length <= 12 && (
                            <Text style={styles.barTick} numberOfLines={1}>{d.label}</Text>
                        )}
                    </View>
                );
            })}
        </View>
    );
}

// ─── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({ icon, iconBg, iconColor, label, value, sub, subColor, dot, dotColor }) {
    return (
        <View style={styles.statCard}>
            <View style={styles.statHeader}>
                <View style={[styles.iconBox, { backgroundColor: iconBg || COLORS.primaryGhost }]}>
                    <Ionicons name={icon} size={15} color={iconColor || COLORS.primary} />
                </View>
                <Text style={styles.statLabel}>{label}</Text>
                {dot && (
                    <View style={[styles.dot, { backgroundColor: dotColor || '#2e7d32' }]} />
                )}
            </View>
            <Text style={styles.statValue}>{value}</Text>
            {sub !== undefined && (
                <Text style={[styles.statSub, subColor && { color: subColor }]}>{sub}</Text>
            )}
        </View>
    );
}

// ─── Section Header ───────────────────────────────────────────────────────────

function SectionHeader({ title, sub, right }) {
    return (
        <View style={styles.sectionHeaderRow}>
            <View style={styles.sectionAccent} />
            <View style={{ flex: 1 }}>
                <Text style={styles.sectionTitle}>{title}</Text>
                {sub && <Text style={styles.sectionSub}>{sub}</Text>}
            </View>
            {right}
        </View>
    );
}

// ─── Status Badge ─────────────────────────────────────────────────────────────

function Badge({ text, type }) {
    const config = {
        success: { bg: 'rgba(28,92,74,0.10)', color: COLORS.primary, border: COLORS.primary },
        error:   { bg: 'rgba(192,57,43,0.09)', color: COLORS.error,   border: COLORS.error },
        warn:    { bg: 'rgba(184,134,11,0.10)', color: COLORS.warning, border: COLORS.warning },
        info:    { bg: COLORS.infoLight,         color: COLORS.info,    border: COLORS.info },
        muted:   { bg: COLORS.bgSurface,         color: COLORS.textMuted, border: COLORS.border },
    }[type] || { bg: COLORS.bgSurface, color: COLORS.textMuted, border: COLORS.border };

    return (
        <View style={[styles.badge, { backgroundColor: config.bg, borderColor: config.border }]}>
            <Text style={[styles.badgeText, { color: config.color }]}>{text}</Text>
        </View>
    );
}

// ─── Progress Bar ─────────────────────────────────────────────────────────────

function ProgressBar({ pct, color }) {
    return (
        <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${Math.min(pct, 100)}%`, backgroundColor: color || COLORS.primary }]} />
        </View>
    );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function PerformanceScreen() {
    const r = useResponsive();
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [lastUpdated, setLastUpdated] = useState(null);

    // Data buckets
    const [overview, setOverview]       = useState(null);
    const [apiUsage, setApiUsage]       = useState(null);
    const [health, setHealth]           = useState(null);
    const [revenue, setRevenue]         = useState(null);
    const [errors, setErrors]           = useState(null);
    const [liveReqs, setLiveReqs]       = useState([]);
    const [stores, setStores]           = useState([]);

    // Auto-refresh live requests every 15s
    const liveTimer = useRef(null);

    const fetchAll = useCallback(async () => {
        try {
            const [ov, au, hl, rv, er, lr, st] = await Promise.all([
                api.get('/analytics/overview').catch(() => null),
                api.get('/analytics/api-usage').catch(() => null),
                api.get('/analytics/health').catch(() => null),
                api.get('/admin/billing/revenue').catch(() => null),
                api.get('/analytics/errors').catch(() => null),
                api.get('/analytics/live-requests').catch(() => null),
                api.get('/admin/billing/stores').catch(() => null),
            ]);

            if (ov?.data?.data)  setOverview(ov.data.data);
            if (au?.data?.data)  setApiUsage(au.data.data);
            if (hl?.data?.data)  setHealth(hl.data.data);
            if (rv?.data?.data)  setRevenue(rv.data.data);
            if (er?.data?.data)  setErrors(er.data.data);
            if (lr?.data?.data)  setLiveReqs(lr.data.data || []);
            if (st?.data?.stores) setStores(st.data.stores || []);

            setLastUpdated(new Date());
        } catch (e) {
            console.log('PerformanceScreen error:', e?.message);
        } finally {
            setLoading(false);
        }
    }, []);

    const fetchLive = useCallback(async () => {
        try {
            const lr = await api.get('/analytics/live-requests').catch(() => null);
            if (lr?.data?.data) setLiveReqs(lr.data.data || []);
        } catch (_) {}
    }, []);

    useEffect(() => {
        fetchAll();
        liveTimer.current = setInterval(fetchLive, 15000);
        return () => clearInterval(liveTimer.current);
    }, [fetchAll, fetchLive]);

    const onRefresh = async () => {
        setRefreshing(true);
        await fetchAll();
        setRefreshing(false);
    };

    // ── Computed values ───────────────────────────────────────────────────────

    const totalStores   = stores.length;
    const activeStores  = stores.filter((s) => !s.isBlocked).length;
    const trialStores   = stores.filter((s) => s.isTrial).length;
    const blockedStores = stores.filter((s) => s.isBlocked).length;

    const successRate = overview
        ? ((overview.successfulRequests / Math.max(overview.totalRequests, 1)) * 100).toFixed(1)
        : null;

    const memPct = health?.memoryUsage?.usedPercentage || 0;
    const memColor = memPct > 85 ? COLORS.error : memPct > 65 ? COLORS.warning : '#2e7d32';

    // Revenue chart — last 12 months
    const revenueChartData = (revenue?.monthlyData || []).map((d) => ({
        label: d.month?.slice(5) || '',   // "MM" from "YYYY-MM"
        value: d.amount,
    }));

    // API requests by day chart
    const reqByDayData = (apiUsage?.requestsByDay || []).map((d) => ({
        label: d.day?.slice(5) || '',
        value: d.hits,
    }));

    // Req by hour chart
    const reqByHourData = Array.from({ length: 24 }, (_, h) => {
        const match = (apiUsage?.requestsByHour || []).find((r) => r.hour === h);
        return { label: h % 6 === 0 ? `${h}h` : '', value: match?.hits || 0 };
    });

    // Top 8 endpoints
    const topEndpoints = (apiUsage?.topEndpoints || []).slice(0, 8);

    // Recent 10 live requests
    const recentRequests = liveReqs.slice(0, 12);

    // Recent 5 errors
    const recentErrors = (errors?.latestErrors || []).slice(0, 8);

    return (
        <View style={styles.container}>
            {/* ─── Page Header ─── */}
            <View style={styles.header}>
                <View>
                    <Text style={styles.headerTitle}>Platform Performance</Text>
                    <Text style={styles.headerSub}>
                        API health, revenue and user metrics across all stores
                        {lastUpdated && ` — Last updated ${formatTime(lastUpdated)}`}
                    </Text>
                </View>
                <TouchableOpacity style={styles.refreshBtn} onPress={onRefresh}>
                    <Ionicons name="refresh-outline" size={13} color={COLORS.primary} style={{ marginRight: 5 }} />
                    <Text style={styles.refreshBtnText}>Refresh</Text>
                </TouchableOpacity>
            </View>

            {loading ? (
                <View style={styles.loaderBox}>
                    <ActivityIndicator size="large" color={COLORS.primary} />
                    <Text style={styles.loaderText}>Loading platform data...</Text>
                </View>
            ) : (
                <ScrollView
                    contentContainerStyle={styles.scroll}
                    refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={COLORS.primary} />}
                    showsVerticalScrollIndicator={false}
                >

                    {/* ── Platform Users / Stores ── */}
                    <SectionHeader title="USER MONITOR" sub="Total stores and user accounts on the platform" />
                    <View style={[styles.statsRow, r.isSmall && { flexDirection: 'column' }]}>
                        <StatCard
                            icon="storefront-outline"
                            iconBg={COLORS.primaryGhost}
                            iconColor={COLORS.primary}
                            label="TOTAL STORES"
                            value={formatCount(totalStores)}
                            sub={`${activeStores} active, ${blockedStores} blocked`}
                        />
                        <StatCard
                            icon="people-outline"
                            iconBg={COLORS.infoLight}
                            iconColor={COLORS.info}
                            label="TOTAL USERS"
                            value={formatCount(overview?.totalUsers)}
                            sub="Registered user accounts"
                        />
                        <StatCard
                            icon="pulse-outline"
                            iconBg="rgba(28,92,74,0.08)"
                            iconColor={COLORS.primary}
                            label="ONLINE NOW"
                            value={formatCount(overview?.onlineUsers)}
                            sub="Active in last 5 minutes"
                            dot
                            dotColor="#2e7d32"
                        />
                        <StatCard
                            icon="time-outline"
                            iconBg="rgba(184,134,11,0.08)"
                            iconColor={COLORS.warning}
                            label="TRIAL STORES"
                            value={formatCount(trialStores)}
                            sub="Currently on trial period"
                        />
                    </View>

                    {/* ── Platform Revenue ── */}
                    <SectionHeader title="REVENUE MONITOR" sub="Subscription payments collected from stores" />
                    <View style={[styles.statsRow, r.isSmall && { flexDirection: 'column' }]}>
                        <StatCard
                            icon="wallet-outline"
                            iconBg="rgba(46,125,50,0.08)"
                            iconColor="#2e7d32"
                            label="TOTAL COLLECTED"
                            value={formatINR(revenue?.collectedRevenue)}
                            sub="Confirmed payments received"
                            subColor="#2e7d32"
                        />
                        <StatCard
                            icon="card-outline"
                            iconBg={COLORS.primaryGhost}
                            iconColor={COLORS.primary}
                            label="TOTAL CONTRACTED"
                            value={formatINR(revenue?.totalRevenue)}
                            sub="Across all subscription plans"
                        />
                        <StatCard
                            icon="hourglass-outline"
                            iconBg="rgba(184,134,11,0.08)"
                            iconColor={COLORS.warning}
                            label="PENDING COLLECTION"
                            value={formatINR(revenue?.pendingRevenue)}
                            sub="Outstanding balance due"
                            subColor={COLORS.warning}
                        />
                        <StatCard
                            icon="checkmark-circle-outline"
                            iconBg={COLORS.infoLight}
                            iconColor={COLORS.info}
                            label="FULLY PAID STORES"
                            value={formatCount(revenue?.paidStores)}
                            sub={`of ${formatCount(revenue?.totalStores)} subscribed stores`}
                        />
                    </View>

                    {/* Revenue Chart */}
                    <View style={styles.chartCard}>
                        <View style={styles.chartCardHeader}>
                            <Text style={styles.chartCardTitle}>Monthly Revenue Collection (Last 12 Months)</Text>
                            <Text style={styles.chartCardSub}>in Rupees</Text>
                        </View>
                        {revenueChartData.length > 0 ? (
                            <BarChart data={revenueChartData} color={COLORS.primary} height={100} />
                        ) : (
                            <View style={styles.chartEmpty}>
                                <Text style={styles.emptyText}>No payment history recorded yet</Text>
                            </View>
                        )}
                    </View>

                    {/* ── API Performance ── */}
                    <SectionHeader title="API PERFORMANCE" sub="Request volume, response times and error rates" />
                    <View style={[styles.statsRow, r.isSmall && { flexDirection: 'column' }]}>
                        <StatCard
                            icon="flash-outline"
                            iconBg={COLORS.primaryGhost}
                            iconColor={COLORS.primary}
                            label="REQUESTS TODAY"
                            value={formatCount(overview?.requestsToday)}
                            sub={`${formatCount(overview?.totalRequests)} total all-time`}
                        />
                        <StatCard
                            icon="speedometer-outline"
                            iconBg={COLORS.infoLight}
                            iconColor={COLORS.info}
                            label="AVG RESPONSE TIME"
                            value={formatMs(overview?.avgResponseTime)}
                            sub={overview?.avgResponseTime < 300 ? 'Healthy' : overview?.avgResponseTime < 800 ? 'Moderate' : 'Slow'}
                            subColor={overview?.avgResponseTime < 300 ? '#2e7d32' : overview?.avgResponseTime < 800 ? COLORS.warning : COLORS.error}
                        />
                        <StatCard
                            icon="shield-checkmark-outline"
                            iconBg="rgba(46,125,50,0.08)"
                            iconColor="#2e7d32"
                            label="SUCCESS RATE"
                            value={successRate !== null ? `${successRate}%` : '-'}
                            sub={`${formatCount(overview?.successfulRequests)} successful`}
                            subColor="#2e7d32"
                        />
                        <StatCard
                            icon="warning-outline"
                            iconBg="rgba(192,57,43,0.08)"
                            iconColor={COLORS.error}
                            label="FAILED REQUESTS"
                            value={formatCount(overview?.failedRequests)}
                            sub={`${errors?.errorsToday || 0} errors today`}
                            subColor={COLORS.error}
                        />
                    </View>

                    {/* API Charts Row */}
                    <View style={[styles.chartsRow, r.isSmall && { flexDirection: 'column' }]}>
                        <View style={[styles.chartCard, { flex: 1 }]}>
                            <View style={styles.chartCardHeader}>
                                <Text style={styles.chartCardTitle}>Requests per Day (Last 7 Days)</Text>
                                <Text style={styles.chartCardSub}>count</Text>
                            </View>
                            <BarChart data={reqByDayData} color={COLORS.primaryLight} height={80} />
                        </View>
                        <View style={[styles.chartCard, { flex: 1 }]}>
                            <View style={styles.chartCardHeader}>
                                <Text style={styles.chartCardTitle}>Requests by Hour (Today)</Text>
                                <Text style={styles.chartCardSub}>count</Text>
                            </View>
                            <BarChart data={reqByHourData} color="#2C6E8A" height={80} />
                        </View>
                    </View>

                    {/* ── Server Health ── */}
                    <SectionHeader title="SERVER HEALTH" sub="Backend system resource utilisation" />
                    <View style={[styles.statsRow, r.isSmall && { flexDirection: 'column' }]}>
                        <StatCard
                            icon="server-outline"
                            iconBg={health?.mongoDbConnected ? 'rgba(46,125,50,0.08)' : 'rgba(192,57,43,0.08)'}
                            iconColor={health?.mongoDbConnected ? '#2e7d32' : COLORS.error}
                            label="DATABASE"
                            value={health?.mongoDbConnected ? 'Connected' : 'Disconnected'}
                            sub="MongoDB"
                            subColor={health?.mongoDbConnected ? '#2e7d32' : COLORS.error}
                        />
                        <StatCard
                            icon="time-outline"
                            iconBg={COLORS.primaryGhost}
                            iconColor={COLORS.primary}
                            label="SERVER UPTIME"
                            value={formatUptime(health?.nodeUptime || 0)}
                            sub="Node.js process uptime"
                        />
                        <StatCard
                            icon="hardware-chip-outline"
                            iconBg={COLORS.infoLight}
                            iconColor={COLORS.info}
                            label="MEMORY USED"
                            value={`${memPct}%`}
                            sub={`${formatBytes(health?.memoryUsage?.heapUsed || 0)} heap used`}
                            subColor={memColor}
                        />
                        <StatCard
                            icon="analytics-outline"
                            iconBg="rgba(184,134,11,0.08)"
                            iconColor={COLORS.warning}
                            label="CPU LOAD (1m)"
                            value={health?.cpuUsage?.loadAvg1m?.toFixed(2) || '-'}
                            sub={`${health?.cpuUsage?.cores || '-'} cores`}
                        />
                    </View>

                    {/* Memory progress bars */}
                    <View style={[styles.chartsRow, r.isSmall && { flexDirection: 'column' }]}>
                        <View style={[styles.chartCard, { flex: 1 }]}>
                            <Text style={[styles.chartCardTitle, { marginBottom: 12 }]}>System Memory Usage</Text>
                            <View style={{ gap: 10 }}>
                                <View>
                                    <View style={styles.progressLabelRow}>
                                        <Text style={styles.progressLabel}>System RAM</Text>
                                        <Text style={[styles.progressLabel, { color: memColor, fontWeight: '600' }]}>{memPct}%</Text>
                                    </View>
                                    <ProgressBar pct={memPct} color={memColor} />
                                </View>
                                <View>
                                    <View style={styles.progressLabelRow}>
                                        <Text style={styles.progressLabel}>Heap Used</Text>
                                        <Text style={styles.progressLabel}>
                                            {formatBytes(health?.memoryUsage?.heapUsed || 0)} / {formatBytes(health?.memoryUsage?.heapTotal || 0)}
                                        </Text>
                                    </View>
                                    <ProgressBar
                                        pct={((health?.memoryUsage?.heapUsed || 0) / Math.max(health?.memoryUsage?.heapTotal || 1, 1)) * 100}
                                        color={COLORS.info}
                                    />
                                </View>
                                <View>
                                    <View style={styles.progressLabelRow}>
                                        <Text style={styles.progressLabel}>RSS</Text>
                                        <Text style={styles.progressLabel}>{formatBytes(health?.memoryUsage?.rss || 0)}</Text>
                                    </View>
                                    <ProgressBar
                                        pct={((health?.memoryUsage?.rss || 0) / Math.max(health?.memoryUsage?.systemTotal || 1, 1)) * 100}
                                        color={COLORS.primaryLight}
                                    />
                                </View>
                            </View>
                        </View>

                        <View style={[styles.chartCard, { flex: 1 }]}>
                            <Text style={[styles.chartCardTitle, { marginBottom: 12 }]}>CPU Load Average</Text>
                            <View style={{ gap: 10 }}>
                                {[
                                    { label: '1 Minute', val: health?.cpuUsage?.loadAvg1m || 0 },
                                    { label: '5 Minutes', val: health?.cpuUsage?.loadAvg5m || 0 },
                                    { label: '15 Minutes', val: health?.cpuUsage?.loadAvg15m || 0 },
                                ].map((row) => {
                                    const cores = health?.cpuUsage?.cores || 1;
                                    const pct = Math.min((row.val / cores) * 100, 100);
                                    const col = pct > 80 ? COLORS.error : pct > 50 ? COLORS.warning : '#2e7d32';
                                    return (
                                        <View key={row.label}>
                                            <View style={styles.progressLabelRow}>
                                                <Text style={styles.progressLabel}>{row.label}</Text>
                                                <Text style={[styles.progressLabel, { color: col, fontWeight: '600' }]}>{row.val.toFixed(2)}</Text>
                                            </View>
                                            <ProgressBar pct={pct} color={col} />
                                        </View>
                                    );
                                })}
                            </View>
                        </View>
                    </View>

                    {/* ── Top Endpoints ── */}
                    <SectionHeader title="TOP API ENDPOINTS" sub="Ranked by hit count, all-time" />
                    <View style={styles.tableContainer}>
                        <View style={styles.tableHeader}>
                            {[
                                { label: 'Endpoint', flex: 3 },
                                { label: 'Hits', flex: 0.8, align: 'right' },
                                { label: 'Avg Time', flex: 1, align: 'right' },
                                { label: 'Errors', flex: 0.8, align: 'right' },
                                { label: 'Success %', flex: 1, align: 'right' },
                            ].map((col, i, arr) => (
                                <View key={i} style={[styles.thCell, { flex: col.flex }, col.align === 'right' && { alignItems: 'flex-end' }, i === arr.length - 1 && { borderRightWidth: 0 }]}>
                                    <Text style={styles.th}>{col.label}</Text>
                                </View>
                            ))}
                        </View>
                        {topEndpoints.length === 0 ? (
                            <View style={styles.centerBox}><Text style={styles.emptyText}>No endpoint data yet</Text></View>
                        ) : topEndpoints.map((ep, i) => {
                            const sr = ep.successRate || 0;
                            const srColor = sr >= 95 ? '#2e7d32' : sr >= 80 ? COLORS.warning : COLORS.error;
                            return (
                                <View key={i} style={[styles.tableRow, i % 2 === 1 && styles.tableRowAlt]}>
                                    <View style={[styles.cell, { flex: 3 }]}>
                                        <Text style={[styles.cellText, { fontFamily: Platform.OS === 'web' ? 'monospace' : undefined }]} numberOfLines={1}>{ep.endpoint}</Text>
                                    </View>
                                    <View style={[styles.cell, { flex: 0.8, alignItems: 'flex-end' }]}>
                                        <Text style={[styles.cellText, { fontWeight: '600', color: COLORS.primary }]}>{formatCount(ep.hits)}</Text>
                                    </View>
                                    <View style={[styles.cell, { flex: 1, alignItems: 'flex-end' }]}>
                                        <Text style={styles.cellText}>{formatMs(ep.avgResponseTime)}</Text>
                                    </View>
                                    <View style={[styles.cell, { flex: 0.8, alignItems: 'flex-end' }]}>
                                        <Text style={[styles.cellText, ep.errorCount > 0 && { color: COLORS.error, fontWeight: '600' }]}>{ep.errorCount || 0}</Text>
                                    </View>
                                    <View style={[styles.cell, { flex: 1, alignItems: 'flex-end', borderRightWidth: 0 }]}>
                                        <Text style={[styles.cellText, { fontWeight: '600', color: srColor }]}>{sr}%</Text>
                                    </View>
                                </View>
                            );
                        })}
                    </View>

                    {/* ── Live Requests Feed ── */}
                    <SectionHeader
                        title="LIVE REQUEST FEED"
                        sub="Last 12 API calls — auto-refreshes every 15 seconds"
                        right={
                            <View style={styles.livePill}>
                                <View style={styles.liveDot} />
                                <Text style={styles.livePillText}>LIVE</Text>
                            </View>
                        }
                    />
                    <View style={styles.tableContainer}>
                        <View style={styles.tableHeader}>
                            {[
                                { label: 'Time', flex: 1.2 },
                                { label: 'Store', flex: 1.5 },
                                { label: 'Method', flex: 0.8, align: 'center' },
                                { label: 'Endpoint', flex: 3 },
                                { label: 'Status', flex: 0.8, align: 'center' },
                                { label: 'Time', flex: 0.8, align: 'right' },
                            ].map((col, i, arr) => (
                                <View key={i} style={[styles.thCell, { flex: col.flex }, col.align === 'center' && { alignItems: 'center' }, col.align === 'right' && { alignItems: 'flex-end' }, i === arr.length - 1 && { borderRightWidth: 0 }]}>
                                    <Text style={styles.th}>{col.label}</Text>
                                </View>
                            ))}
                        </View>
                        {recentRequests.length === 0 ? (
                            <View style={styles.centerBox}><Text style={styles.emptyText}>No recent requests</Text></View>
                        ) : recentRequests.map((req, i) => {
                            const ok = req.success;
                            const methodColor = { GET: COLORS.info, POST: '#2e7d32', PUT: COLORS.warning, DELETE: COLORS.error, PATCH: COLORS.warning }[req.method] || COLORS.textMuted;
                            return (
                                <View key={i} style={[styles.tableRow, i % 2 === 1 && styles.tableRowAlt]}>
                                    <View style={[styles.cell, { flex: 1.2 }]}>
                                        <Text style={[styles.cellText, { fontSize: 11 }]}>{formatTime(req.timestamp)}</Text>
                                    </View>
                                    <View style={[styles.cell, { flex: 1.5 }]}>
                                        <Text style={styles.cellText} numberOfLines={1}>{req.storeName || '-'}</Text>
                                    </View>
                                    <View style={[styles.cell, { flex: 0.8, alignItems: 'center' }]}>
                                        <Text style={[styles.cellText, { fontWeight: '700', color: methodColor, fontSize: 10 }]}>{req.method}</Text>
                                    </View>
                                    <View style={[styles.cell, { flex: 3 }]}>
                                        <Text style={[styles.cellText, { fontSize: 11, fontFamily: Platform.OS === 'web' ? 'monospace' : undefined }]} numberOfLines={1}>{req.endpoint}</Text>
                                    </View>
                                    <View style={[styles.cell, { flex: 0.8, alignItems: 'center' }]}>
                                        <Text style={[styles.cellText, { fontWeight: '600', color: ok ? '#2e7d32' : COLORS.error }]}>{req.statusCode}</Text>
                                    </View>
                                    <View style={[styles.cell, { flex: 0.8, alignItems: 'flex-end', borderRightWidth: 0 }]}>
                                        <Text style={[styles.cellText, req.responseTime > 500 && { color: COLORS.warning }]}>{req.responseTime}ms</Text>
                                    </View>
                                </View>
                            );
                        })}
                    </View>

                    {/* ── Recent Errors ── */}
                    <SectionHeader
                        title="RECENT ERRORS"
                        sub={`${errors?.errorsToday || 0} errors today — ${errors?.totalErrors || 0} total`}
                    />
                    <View style={styles.tableContainer}>
                        <View style={styles.tableHeader}>
                            {[
                                { label: 'Time', flex: 1.2 },
                                { label: 'Store', flex: 1.2 },
                                { label: 'Endpoint', flex: 3 },
                                { label: 'Status', flex: 0.8, align: 'center' },
                                { label: 'Error', flex: 2 },
                            ].map((col, i, arr) => (
                                <View key={i} style={[styles.thCell, { flex: col.flex }, col.align === 'center' && { alignItems: 'center' }, i === arr.length - 1 && { borderRightWidth: 0 }]}>
                                    <Text style={styles.th}>{col.label}</Text>
                                </View>
                            ))}
                        </View>
                        {recentErrors.length === 0 ? (
                            <View style={styles.centerBox}>
                                <Text style={[styles.emptyText, { color: '#2e7d32' }]}>No recent errors — all systems nominal</Text>
                            </View>
                        ) : recentErrors.map((err, i) => (
                            <View key={i} style={[styles.tableRow, i % 2 === 1 && styles.tableRowAlt]}>
                                <View style={[styles.cell, { flex: 1.2 }]}>
                                    <Text style={[styles.cellText, { fontSize: 11 }]}>{formatDateTime(err.timestamp)}</Text>
                                </View>
                                <View style={[styles.cell, { flex: 1.2 }]}>
                                    <Text style={styles.cellText} numberOfLines={1}>{err.storeName || '-'}</Text>
                                </View>
                                <View style={[styles.cell, { flex: 3 }]}>
                                    <Text style={[styles.cellText, { fontSize: 11 }]} numberOfLines={1}>{err.endpoint}</Text>
                                </View>
                                <View style={[styles.cell, { flex: 0.8, alignItems: 'center' }]}>
                                    <Text style={[styles.cellText, { fontWeight: '600', color: COLORS.error }]}>{err.statusCode}</Text>
                                </View>
                                <View style={[styles.cell, { flex: 2, borderRightWidth: 0 }]}>
                                    <Text style={[styles.cellText, { fontSize: 11, color: COLORS.error }]} numberOfLines={1}>{err.error || 'Unknown error'}</Text>
                                </View>
                            </View>
                        ))}
                    </View>

                    {/* Bottom spacing */}
                    <View style={{ height: 20 }} />
                </ScrollView>
            )}
        </View>
    );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: COLORS.bgDark,
    },

    // Header
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: 16,
        paddingVertical: 11,
        backgroundColor: COLORS.bgSurface,
        borderBottomWidth: 0.5,
        borderBottomColor: COLORS.border,
    },
    headerTitle: {
        fontSize: 14,
        fontWeight: '700',
        color: COLORS.textPrimary,
        letterSpacing: 0.4,
    },
    headerSub: {
        fontSize: 11,
        color: COLORS.textMuted,
        marginTop: 2,
    },
    refreshBtn: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 11,
        paddingVertical: 6,
        borderWidth: 0.5,
        borderColor: COLORS.primary,
        borderRadius: 3,
        backgroundColor: COLORS.primaryGhost,
    },
    refreshBtnText: {
        fontSize: 11,
        fontWeight: '600',
        color: COLORS.primary,
        letterSpacing: 0.3,
    },

    // Loader
    loaderBox: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 14,
    },
    loaderText: {
        fontSize: 12,
        color: COLORS.textMuted,
    },

    // Scroll
    scroll: {
        padding: 14,
        paddingBottom: 30,
    },

    // Section headers
    sectionHeaderRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginTop: 18,
        marginBottom: 8,
        gap: 8,
    },
    sectionAccent: {
        width: 3,
        height: 24,
        backgroundColor: COLORS.primary,
        borderRadius: 2,
    },
    sectionTitle: {
        fontSize: 10,
        fontWeight: '700',
        color: COLORS.textSecondary,
        letterSpacing: 0.9,
        textTransform: 'uppercase',
    },
    sectionSub: {
        fontSize: 10,
        color: COLORS.textMuted,
        marginTop: 1,
    },

    // Live pill
    livePill: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 5,
        paddingHorizontal: 8,
        paddingVertical: 3,
        backgroundColor: 'rgba(192,57,43,0.08)',
        borderRadius: 3,
        borderWidth: 0.5,
        borderColor: COLORS.error,
    },
    liveDot: {
        width: 5,
        height: 5,
        borderRadius: 3,
        backgroundColor: COLORS.error,
    },
    livePillText: {
        fontSize: 9,
        fontWeight: '700',
        color: COLORS.error,
        letterSpacing: 0.8,
    },

    // Stat cards
    statsRow: {
        flexDirection: 'row',
        gap: 8,
        marginBottom: 8,
    },
    statCard: {
        flex: 1,
        backgroundColor: COLORS.bgCard,
        borderWidth: 0.5,
        borderColor: COLORS.border,
        borderRadius: 3,
        padding: 13,
    },
    statHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 8,
    },
    iconBox: {
        width: 26,
        height: 26,
        borderRadius: 3,
        alignItems: 'center',
        justifyContent: 'center',
        marginRight: 7,
    },
    statLabel: {
        fontSize: 9,
        fontWeight: '700',
        color: COLORS.textMuted,
        letterSpacing: 0.7,
        textTransform: 'uppercase',
        flex: 1,
    },
    dot: {
        width: 6,
        height: 6,
        borderRadius: 3,
    },
    statValue: {
        fontSize: 19,
        fontWeight: '700',
        color: COLORS.textPrimary,
        letterSpacing: 0.2,
    },
    statSub: {
        fontSize: 10,
        color: COLORS.textMuted,
        marginTop: 3,
    },

    // Charts
    chartsRow: {
        flexDirection: 'row',
        gap: 8,
        marginBottom: 8,
    },
    chartCard: {
        backgroundColor: COLORS.bgCard,
        borderWidth: 0.5,
        borderColor: COLORS.border,
        borderRadius: 3,
        padding: 14,
        marginBottom: 8,
    },
    chartCardHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        marginBottom: 14,
    },
    chartCardTitle: {
        fontSize: 11,
        fontWeight: '600',
        color: COLORS.textSecondary,
        letterSpacing: 0.2,
        flex: 1,
    },
    chartCardSub: {
        fontSize: 10,
        color: COLORS.textMuted,
    },
    chartEmpty: {
        height: 80,
        alignItems: 'center',
        justifyContent: 'center',
    },
    barTick: {
        fontSize: 8,
        color: COLORS.textMuted,
        marginTop: 3,
        textAlign: 'center',
    },

    // Progress bars
    progressLabelRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        marginBottom: 4,
    },
    progressLabel: {
        fontSize: 11,
        color: COLORS.textMuted,
    },
    progressTrack: {
        height: 5,
        backgroundColor: COLORS.bgSurface,
        borderRadius: 3,
        overflow: 'hidden',
        borderWidth: 0.5,
        borderColor: COLORS.borderLight,
    },
    progressFill: {
        height: '100%',
        borderRadius: 3,
    },

    // Tables
    tableContainer: {
        borderWidth: 0.5,
        borderColor: COLORS.border,
        borderRadius: 3,
        backgroundColor: COLORS.bgCard,
        overflow: 'hidden',
        marginBottom: 8,
    },
    tableHeader: {
        flexDirection: 'row',
        backgroundColor: COLORS.bgSurface,
        borderBottomWidth: 0.5,
        borderBottomColor: COLORS.border,
    },
    thCell: {
        flex: 1,
        paddingVertical: 7,
        paddingHorizontal: 10,
        borderRightWidth: 0.5,
        borderRightColor: COLORS.borderLight,
    },
    th: {
        fontSize: 9,
        fontWeight: '700',
        color: COLORS.textMuted,
        letterSpacing: 0.6,
        textTransform: 'uppercase',
    },
    tableRow: {
        flexDirection: 'row',
        borderBottomWidth: 0.5,
        borderBottomColor: COLORS.borderLight,
        minHeight: 34,
        alignItems: 'center',
    },
    tableRowAlt: {
        backgroundColor: COLORS.bgCardHover,
    },
    cell: {
        flex: 1,
        paddingVertical: 6,
        paddingHorizontal: 10,
        borderRightWidth: 0.5,
        borderRightColor: COLORS.borderLight,
        justifyContent: 'center',
    },
    cellText: {
        fontSize: 12,
        color: COLORS.textSecondary,
    },
    centerBox: {
        paddingVertical: 24,
        alignItems: 'center',
    },
    emptyText: {
        fontSize: 12,
        color: COLORS.textMuted,
    },

    // Badge
    badge: {
        paddingHorizontal: 7,
        paddingVertical: 2,
        borderRadius: 2,
        borderWidth: 0.5,
        alignSelf: 'flex-start',
    },
    badgeText: {
        fontSize: 9,
        fontWeight: '700',
        letterSpacing: 0.4,
        textTransform: 'uppercase',
    },
});
