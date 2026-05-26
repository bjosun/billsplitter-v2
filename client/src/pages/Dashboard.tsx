import { signOut, onAuthStateChanged, type User as FirebaseUser } from 'firebase/auth';
import { auth, db } from '../firebase';
import { useNavigate } from 'react-router-dom';
import { Calculator, LogOut, Plus, History as HistoryIcon, Home, Link, BarChart3, Settings, Copy } from 'lucide-react';
import { useState, useEffect, useMemo } from 'react';
import { collection, getDocs, orderBy, query, where } from 'firebase/firestore';
import SankeyChart from '../components/SankeyChart';
import TrendsChart from '../components/TrendsChart';
import PieChartComponent from '../components/PieChart';
import {
  createHousehold,
  createInvite,
  ensureCurrentUser,
  getHouseholds,
  getBillGrouping,
  joinHousehold,
  listInvites,
  revokeInvite,
  sendCalculationNotification,
  type BillGroupingSettings,
} from '../services/api';
import { calculateExpenditure } from '../utils/calculations';
import type { Household, Invite } from '../types';

interface Calculation {
  id: string;
  userId?: string;
  householdId?: string;
  contributors?: Array<{ name: string; income?: number }>;
  bills?: Array<{ name?: string; amount?: number; isShared?: boolean; payer?: string }>;
  createdAt?: unknown;
  result?: {
    contributions?: Record<string, number>;
    remainingAmounts?: Record<string, number>;
    targetRemainingBalance?: number;
    transfers?: Array<{ from: string; to: string; amount: number }>;
  };
}

interface TransferFlow {
  from: string;
  to: string;
  amount: number;
}

const SHARED_POOL_LABEL = 'Shared bills';
const INDIVIDUAL_BILLS_LABEL = 'Individual bills';
const LEFTOVER_LABEL = 'Left over';
const TOP_BILLS_PER_CATEGORY = 8;

type SankeyRange = 'month' | 'quarter' | 'year';
type SankeyMode = 'calendar' | 'rolling';

const applyBillGrouping = (
  totals: Record<string, number>,
  settings: BillGroupingSettings
): Record<string, number> => {
  if (!settings.enabled || settings.groups.length === 0) return totals;
  const ungrouped: Record<string, number> = {};
  const grouped: Record<string, number> = {};
  Object.entries(totals).forEach(([name, value]) => {
    const match = settings.groups.find((g) =>
      g.label &&
      g.patterns.some((p) => p.trim() && name.toLowerCase().includes(p.trim().toLowerCase()))
    );
    if (match) {
      grouped[match.label] = (grouped[match.label] || 0) + value;
    } else {
      ungrouped[name] = value;
    }
  });
  return { ...ungrouped, ...grouped };
};

const isMissingIndexError = (error: unknown): boolean => {
  const maybeError = error as { code?: string; message?: string };
  return (
    maybeError?.code === 'failed-precondition' ||
    (maybeError?.message || '').toLowerCase().includes('requires an index')
  );
};

const getCreatedAtMs = (createdAt: unknown): number => {
  if (typeof createdAt === 'string' || typeof createdAt === 'number') {
    return new Date(createdAt).getTime() || 0;
  }

  if (createdAt && typeof createdAt === 'object' && 'toDate' in (createdAt as Record<string, unknown>)) {
    const timestamp = createdAt as { toDate: () => Date };
    return timestamp.toDate().getTime();
  }

  return 0;
};

const deriveTransfersFromContributions = (
  contributions?: Record<string, number>,
  targetRemainingBalance?: number
): TransferFlow[] => {
  if (!contributions || typeof targetRemainingBalance !== 'number') {
    return [];
  }

  const payers: Array<{ name: string; amount: number }> = [];
  const receivers: Array<{ name: string; amount: number }> = [];

  Object.entries(contributions).forEach(([name, contribution]) => {
    if (contribution > targetRemainingBalance) {
      payers.push({ name, amount: contribution - targetRemainingBalance });
    } else if (contribution < targetRemainingBalance) {
      receivers.push({ name, amount: targetRemainingBalance - contribution });
    }
  });

  const transfers: TransferFlow[] = [];

  payers.forEach((payer) => {
    let remainingToPay = payer.amount;

    for (const receiver of receivers) {
      if (remainingToPay <= 0) {
        break;
      }
      if (receiver.amount <= 0) {
        continue;
      }

      const transferAmount = Math.min(remainingToPay, receiver.amount);
      if (transferAmount > 0) {
        transfers.push({
          from: payer.name,
          to: receiver.name,
          amount: transferAmount,
        });
      }

      remainingToPay -= transferAmount;
      receiver.amount -= transferAmount;
    }
  });

  return transfers;
};

const getCalculationTransfers = (calc: Calculation): TransferFlow[] => {
  const explicitTransfers = (calc.result?.transfers || []).filter((transfer) => (transfer.amount || 0) > 0);
  if (explicitTransfers.length > 0) {
    return explicitTransfers;
  }

  return deriveTransfersFromContributions(
    calc.result?.contributions,
    calc.result?.targetRemainingBalance
  );
};

export default function Dashboard() {
  const navigate = useNavigate();
  const [households, setHouseholds] = useState<Household[]>([]);
  const [calculations, setCalculations] = useState<Calculation[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [createName, setCreateName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [householdInvites, setHouseholdInvites] = useState<Record<string, Invite[]>>({});
  const [invitesLoading, setInvitesLoading] = useState(false);
  const [inviteFeedback, setInviteFeedback] = useState<string>('');
  const [selectedHouseholdId, setSelectedHouseholdId] = useState<string>('');
  const [sankeyRange, setSankeyRange] = useState<SankeyRange>('month');
  const [sankeyMode, setSankeyMode] = useState<SankeyMode>('calendar');
  const [resendStatus, setResendStatus] = useState<{ sent: string[]; skipped: string[] } | 'sending' | null>(null);
  const [billGrouping, setBillGrouping] = useState<BillGroupingSettings>({ enabled: false, groups: [] });

  const selectedHousehold = useMemo(
    () => households.find((household) => household.id === selectedHouseholdId) || households[0],
    [households, selectedHouseholdId]
  );

  const loadDashboardData = async (user: FirebaseUser) => {
    const token = await user.getIdToken();
    await ensureCurrentUser(token);

    getBillGrouping().then(setBillGrouping).catch(() => {});

    const householdsData = await getHouseholds(token);
    setHouseholds(householdsData);
    if (householdsData.length > 0) {
      setSelectedHouseholdId((current) => current || householdsData[0].id);
    } else {
      setSelectedHouseholdId('');
    }

    const calculationsRef = collection(db, 'calculations');
    const fetchByField = async (field: 'userId' | 'householdId', value: string) => {
      const orderedQuery = query(
        calculationsRef,
        where(field, '==', value),
        orderBy('createdAt', 'desc')
      );

      try {
        return await getDocs(orderedQuery);
      } catch (error) {
        if (isMissingIndexError(error)) {
          const fallbackQuery = query(
            calculationsRef,
            where(field, '==', value)
          );
          return await getDocs(fallbackQuery);
        }

        // Swallow permission or other per-query errors so a single bad household
        // does not break the whole dashboard. We log for diagnostics.
        console.warn(`[Dashboard] Skipping calculations query for ${field}=${value}:`, error);
        return null;
      }
    };

    const snapshots: Array<Awaited<ReturnType<typeof fetchByField>>> = [];
    snapshots.push(await fetchByField('userId', user.uid));

    const validHouseholds = householdsData.filter((h) => typeof h.id === 'string' && h.id.length > 0);
    if (validHouseholds.length > 0) {
      const householdSnapshots = await Promise.all(
        validHouseholds.map((household) => fetchByField('householdId', household.id))
      );
      snapshots.push(...householdSnapshots);
    }

    const byId = new Map<string, Calculation>();
    snapshots.forEach((snapshot) => {
      if (!snapshot) {
        return;
      }
      snapshot.forEach((historyDoc) => {
        byId.set(historyDoc.id, {
          id: historyDoc.id,
          ...historyDoc.data(),
        } as Calculation);
      });
    });

    const merged = Array.from(byId.values()).sort(
      (a, b) => getCreatedAtMs(b.createdAt) - getCreatedAtMs(a.createdAt)
    );
    setCalculations(merged);
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setHouseholds([]);
        setCalculations([]);
        setLoading(false);
        return;
      }

      try {
        setErrorMessage('');
        setLoading(true);
        await loadDashboardData(user);
      } catch (error) {
        console.error('Error loading dashboard:', error);
        setErrorMessage('Could not load dashboard data. Please refresh and try again.');
      } finally {
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  const handleLogout = async () => {
    try {
      await signOut(auth);
      navigate('/');
    } catch (error) {
      console.error('Error signing out:', error);
    }
  };

  const handleCreateHousehold = async () => {
    if (!createName.trim()) {
      return;
    }

    try {
      setActionLoading(true);
      setErrorMessage('');
      await createHousehold(createName.trim());
      setCreateName('');

      const user = auth.currentUser;
      if (user) {
        await loadDashboardData(user);
      }
    } catch (error) {
      console.error('Error creating household:', error);
      setErrorMessage((error as Error).message || 'Failed to create household');
    } finally {
      setActionLoading(false);
    }
  };

  const handleJoinHousehold = async () => {
    if (!inviteCode.trim()) {
      return;
    }

    try {
      setActionLoading(true);
      setErrorMessage('');
      await joinHousehold(inviteCode.trim().toUpperCase());
      setInviteCode('');

      const user = auth.currentUser;
      if (user) {
        await loadDashboardData(user);
      }
    } catch (error) {
      console.error('Error joining household:', error);
      setErrorMessage((error as Error).message || 'Failed to join household');
    } finally {
      setActionLoading(false);
    }
  };

  const refreshInvites = async (householdId: string) => {
    if (!householdId) return;
    try {
      setInvitesLoading(true);
      const invites = await listInvites(householdId);
      setHouseholdInvites((prev) => ({ ...prev, [householdId]: invites }));
    } catch (error) {
      console.warn('Failed to load invites:', error);
    } finally {
      setInvitesLoading(false);
    }
  };

  const handleSendInvite = async () => {
    if (!selectedHousehold) return;
    const email = inviteEmail.trim();
    if (!email) return;

    try {
      setActionLoading(true);
      setInviteFeedback('');
      setErrorMessage('');
      const result = await createInvite(selectedHousehold.id, email);
      setInviteEmail('');
      setInviteFeedback(
        result.emailDelivered
          ? `Invite sent to ${email}. Code: ${result.invite.code}`
          : `Invite created. Email delivery skipped (${result.emailReason || 'no provider configured'}). Code: ${result.invite.code}`
      );
      await refreshInvites(selectedHousehold.id);
    } catch (error) {
      console.error('Error creating invite:', error);
      setErrorMessage((error as Error).message || 'Failed to send invite');
    } finally {
      setActionLoading(false);
    }
  };

  const handleRevokeInvite = async (inviteId: string) => {
    if (!selectedHousehold) return;
    try {
      setActionLoading(true);
      await revokeInvite(selectedHousehold.id, inviteId);
      await refreshInvites(selectedHousehold.id);
    } catch (error) {
      console.error('Error revoking invite:', error);
      setErrorMessage((error as Error).message || 'Failed to revoke invite');
    } finally {
      setActionLoading(false);
    }
  };

  // Auto-prefill code from URL ?inviteCode=
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const code = params.get('inviteCode');
    if (code) {
      setInviteCode(code.toUpperCase());
    }
  }, []);

  // Load invites whenever selected household changes
  useEffect(() => {
    if (selectedHousehold?.id) {
      refreshInvites(selectedHousehold.id);
    }
  }, [selectedHousehold?.id]);

  const latestCalculation = calculations[0];

  const summaryStats = useMemo(() => {
    const totalBills = calculations.reduce((sum, calc) => sum + (calc.bills?.length || 0), 0);
    const totalBillAmount = calculations.reduce(
      (sum, calc) => sum + (calc.bills || []).reduce((inner, bill) => inner + (bill.amount || 0), 0),
      0
    );

    return [
      {
        label: 'Total Calculations',
        value: calculations.length,
      },
      {
        label: 'Tracked Bills',
        value: totalBills,
      },
      {
        label: 'Total Bill Volume',
        value: `kr ${totalBillAmount.toFixed(0)}`,
      },
      {
        label: 'Active Households',
        value: households.length,
      },
    ];
  }, [calculations, households.length]);

  const trendsData = useMemo(() => {
    const grouped = new Map<string, { month: string; sortKey: string; totalBills: number; avgIncomeSum: number; avgRemainingSum: number; count: number }>();

    calculations.forEach((calc) => {
      const timestamp = getCreatedAtMs(calc.createdAt);
      if (!timestamp) {
        return;
      }

      const createdAtDate = new Date(timestamp);
      const sortKey = `${createdAtDate.getFullYear()}-${String(createdAtDate.getMonth() + 1).padStart(2, '0')}`;
      const month = createdAtDate.toLocaleDateString('sv-SE', { month: 'short', year: 'numeric' });

      const billsTotal = (calc.bills || []).reduce((sum, bill) => sum + (bill.amount || 0), 0);
      const contributors = calc.contributors || [];
      const avgIncome = contributors.length
        ? contributors.reduce((sum, contributor) => sum + (contributor.income || 0), 0) / contributors.length
        : 0;
      const avgRemaining = calc.result?.targetRemainingBalance || 0;

      const existing = grouped.get(sortKey) || {
        month,
        sortKey,
        totalBills: 0,
        avgIncomeSum: 0,
        avgRemainingSum: 0,
        count: 0,
      };

      existing.totalBills += billsTotal;
      existing.avgIncomeSum += avgIncome;
      existing.avgRemainingSum += avgRemaining;
      existing.count += 1;
      grouped.set(sortKey, existing);
    });

    return Array.from(grouped.values())
      .sort((a, b) => a.sortKey.localeCompare(b.sortKey))
      .map((entry) => ({
        month: entry.month,
        totalBills: entry.totalBills,
        avgIncome: entry.count ? entry.avgIncomeSum / entry.count : 0,
        avgRemaining: entry.count ? entry.avgRemainingSum / entry.count : 0,
      }));
  }, [calculations]);

  const contributionPieData = useMemo(() => {
    if (!latestCalculation?.result?.contributions) {
      return [];
    }

    return Object.entries(latestCalculation.result.contributions)
      .map(([name, value]) => ({ name, value: Math.max(0, value) }))
      .filter((item) => item.value > 0);
  }, [latestCalculation]);

  const latestInsights = useMemo(() => {
    if (!latestCalculation) return null;
    const contributors = latestCalculation.contributors || [];
    const bills = latestCalculation.bills || [];
    const incomes: Record<string, number> = {};
    contributors.forEach(c => {
      if (c.name && (c.income ?? 0) > 0) incomes[c.name] = c.income ?? 0;
    });
    if (Object.keys(incomes).length === 0) return null;
    const billObjects = bills.map(b => ({
      name: b.name || '',
      amount: b.amount || 0,
      isShared: b.isShared !== false,
      ...(b.payer ? { payer: b.payer } : {}),
    }));
    return {
      result: calculateExpenditure(incomes, billObjects),
      contributors,
      createdAt: latestCalculation.createdAt,
    };
  }, [latestCalculation]);

  const sankeyRangeCalculations = useMemo(() => {
    const now = new Date();

    return calculations.filter((calc) => {
      const timestamp = getCreatedAtMs(calc.createdAt);
      if (!timestamp) {
        return false;
      }

      const date = new Date(timestamp);
      if (sankeyMode === 'rolling') {
        const windowDays = sankeyRange === 'month' ? 30 : sankeyRange === 'quarter' ? 90 : 365;
        const diffMs = now.getTime() - date.getTime();
        return diffMs >= 0 && diffMs <= windowDays * 24 * 60 * 60 * 1000;
      }

      if (sankeyRange === 'month') {
        return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth();
      }

      if (sankeyRange === 'quarter') {
        const currentQuarter = Math.floor(now.getMonth() / 3);
        const dateQuarter = Math.floor(date.getMonth() / 3);
        return date.getFullYear() === now.getFullYear() && dateQuarter === currentQuarter;
      }

      return date.getFullYear() === now.getFullYear();
    });
  }, [calculations, sankeyRange, sankeyMode]);

  const calculationsWithTransfers = useMemo(() => {
    return calculations.filter((calc) => getCalculationTransfers(calc).length > 0);
  }, [calculations]);

  const hasFlowData = (calc: Calculation): boolean => {
    const contributions = calc.result?.contributions || {};
    const remaining = calc.result?.remainingAmounts || {};
    const bills = calc.bills || [];
    const hasContributions = Object.values(contributions).some((value) => (value || 0) > 0);
    const hasRemaining = Object.values(remaining).some((value) => (value || 0) > 0);
    const hasIndividual = bills.some((bill) => bill && bill.isShared === false && bill.payer && (bill.amount || 0) > 0);
    return hasContributions || hasRemaining || hasIndividual;
  };

  const sankeySourceCalculations = useMemo(() => {
    const rangeWithFlow = sankeyRangeCalculations.filter(hasFlowData);
    if (rangeWithFlow.length > 0) {
      return { items: rangeWithFlow, isFallback: false };
    }

    const anyWithFlow = calculations.filter(hasFlowData);
    if (anyWithFlow.length > 0) {
      return { items: anyWithFlow, isFallback: true };
    }

    return { items: [], isFallback: false };
  }, [sankeyRangeCalculations, calculations]);

  const sankeyData = useMemo(() => {
    let transferCount = 0;
    const flowSums = new Map<string, number>();
    const sharedBillTotals: Record<string, number> = {};
    const individualBillTotals: Record<string, number> = {};

    const addFlow = (from: string, to: string, amount: number) => {
      if (!from || !to || !(amount > 0)) return;
      const key = `${from}__${to}`;
      flowSums.set(key, (flowSums.get(key) || 0) + amount);
    };

    sankeySourceCalculations.items.forEach((calc) => {
      const contributions = calc.result?.contributions || {};
      const remaining = calc.result?.remainingAmounts || {};
      const bills = calc.bills || [];

      // Stage 1 -> Stage 2: Person -> Shared / Individual / Left over
      Object.entries(contributions).forEach(([person, value]) => {
        addFlow(person, SHARED_POOL_LABEL, value);
      });

      const individualPaidByPerson: Record<string, number> = {};
      bills.forEach((bill) => {
        const amount = bill?.amount || 0;
        if (!(amount > 0) || !bill?.name) return;

        if (bill.isShared === false) {
          if (bill.payer) {
            individualPaidByPerson[bill.payer] = (individualPaidByPerson[bill.payer] || 0) + amount;
          }
          individualBillTotals[bill.name] = (individualBillTotals[bill.name] || 0) + amount;
        } else {
          sharedBillTotals[bill.name] = (sharedBillTotals[bill.name] || 0) + amount;
        }
      });

      Object.entries(individualPaidByPerson).forEach(([person, value]) => {
        addFlow(person, INDIVIDUAL_BILLS_LABEL, value);
      });

      Object.entries(remaining).forEach(([person, value]) => {
        addFlow(person, LEFTOVER_LABEL, value);
      });

      getCalculationTransfers(calc).forEach(() => {
        transferCount += 1;
      });
    });

    const reduceToTopN = (
      totals: Record<string, number>,
      categoryLabel: string,
      n: number
    ) => {
      const entries = Object.entries(totals).sort((a, b) => b[1] - a[1]);
      const top = entries.slice(0, n);
      const rest = entries.slice(n);
      top.forEach(([name, value]) => addFlow(categoryLabel, name, value));
      if (rest.length > 0) {
        const otherTotal = rest.reduce((s, [, v]) => s + v, 0);
        if (otherTotal > 0) {
          addFlow(categoryLabel, `Other (${rest.length})`, otherTotal);
        }
      }
    };

    // Stage 2 -> Stage 3: category -> specific bill (apply user-configured grouping first)
    reduceToTopN(applyBillGrouping(sharedBillTotals, billGrouping), SHARED_POOL_LABEL, TOP_BILLS_PER_CATEGORY);
    reduceToTopN(applyBillGrouping(individualBillTotals, billGrouping), INDIVIDUAL_BILLS_LABEL, TOP_BILLS_PER_CATEGORY);

    const flows = Array.from(flowSums.entries()).map(([key, amount]) => {
      const [from, to] = key.split('__');
      return { from, to, amount };
    });

    if (flows.length === 0) {
      return { nodes: [], links: [], totalAmount: 0, transferCount: 0, stageCount: 0, peopleCount: 0 };
    }

    const nameToIndex = new Map<string, number>();
    const nodes: Array<{ name: string }> = [];

    const getIndex = (name: string) => {
      if (nameToIndex.has(name)) return nameToIndex.get(name)!;
      const index = nodes.length;
      nameToIndex.set(name, index);
      nodes.push({ name });
      return index;
    };

    const links = flows.map((flow) => ({
      source: getIndex(flow.from),
      target: getIndex(flow.to),
      value: flow.amount,
    }));

    // The "total flow" should reflect total income (= sum of stage1->stage2 links only)
    // not double-count via stage2->stage3.
    const totalAmount = flows
      .filter(
        (f) =>
          f.to === SHARED_POOL_LABEL ||
          f.to === INDIVIDUAL_BILLS_LABEL ||
          f.to === LEFTOVER_LABEL
      )
      .reduce((sum, flow) => sum + flow.amount, 0);

    const peopleCount = new Set(
      flows
        .filter(
          (f) =>
            f.to === SHARED_POOL_LABEL ||
            f.to === INDIVIDUAL_BILLS_LABEL ||
            f.to === LEFTOVER_LABEL
        )
        .map((f) => f.from)
    ).size;

    const hasStage3 = flows.some(
      (f) => f.from === SHARED_POOL_LABEL || f.from === INDIVIDUAL_BILLS_LABEL
    );

    return {
      nodes,
      links,
      totalAmount,
      transferCount,
      stageCount: hasStage3 ? 3 : 2,
      peopleCount,
    };
  }, [sankeySourceCalculations, billGrouping]);

  const sankeyWindowLabel = useMemo(() => {
    if (sankeyMode === 'rolling') {
      if (sankeyRange === 'month') return 'Last 30 days';
      if (sankeyRange === 'quarter') return 'Last 90 days';
      return 'Last 365 days';
    }

    if (sankeyRange === 'month') return 'Current month';
    if (sankeyRange === 'quarter') return 'Current quarter';
    return 'Current year';
  }, [sankeyMode, sankeyRange]);

  useEffect(() => {
    console.groupCollapsed('[Dashboard:Sankey Debug]');
    console.log('mode/range', { sankeyMode, sankeyRange, sankeyWindowLabel });
    console.log('calculation counts', {
      totalCalculations: calculations.length,
      inSelectedWindow: sankeyRangeCalculations.length,
      withTransfersOverall: calculationsWithTransfers.length,
      sourceItemsUsed: sankeySourceCalculations.items.length,
      usedFallback: sankeySourceCalculations.isFallback,
    });
    console.log('sankey shape', {
      nodes: sankeyData.nodes.length,
      links: sankeyData.links.length,
      transferCount: sankeyData.transferCount,
      totalAmount: sankeyData.totalAmount,
    });
    if (sankeyData.links.length === 0) {
      console.warn('No Sankey links available for current source data.');
    }
    console.groupEnd();
  }, [
    sankeyMode,
    sankeyRange,
    sankeyWindowLabel,
    calculations.length,
    sankeyRangeCalculations.length,
    calculationsWithTransfers.length,
    sankeySourceCalculations.items.length,
    sankeySourceCalculations.isFallback,
    sankeyData.nodes.length,
    sankeyData.links.length,
    sankeyData.transferCount,
    sankeyData.totalAmount,
  ]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 animate-pulse">
          <div className="h-9 w-56 bg-gray-200 rounded mb-3" />
          <div className="h-5 w-80 bg-gray-100 rounded mb-8" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-24 rounded-xl bg-white border border-gray-100" />
            ))}
          </div>
          <div className="h-72 rounded-xl bg-white border border-gray-100" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16 items-center">
            <div className="flex items-center">
              <Calculator className="h-8 w-8 text-indigo-600" />
              <span className="ml-2 text-xl font-bold text-gray-900">BillSplitter</span>
            </div>
            <div className="flex items-center gap-4">
              <button
                onClick={() => navigate('/settings')}
                className="flex items-center text-gray-600 hover:text-gray-900"
              >
                <Settings className="h-5 w-5 mr-2" />
                Settings
              </button>
              <button
                onClick={handleLogout}
                className="flex items-center text-gray-600 hover:text-gray-900"
              >
                <LogOut className="h-5 w-5 mr-2" />
                Sign Out
              </button>
            </div>
          </div>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-gray-600 mt-2">Households, history, and spending insights in one place.</p>
        </div>

        {errorMessage && (
          <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {errorMessage}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          <button
            onClick={() => navigate('/calculator')}
            className="bg-indigo-600 text-white p-6 rounded-xl hover:bg-indigo-700 transition shadow-lg"
          >
            <Plus className="h-8 w-8 mb-2 mx-auto" />
            <div className="text-lg font-semibold">New Calculation</div>
            <div className="text-sm opacity-90">Split a new bill</div>
          </button>

          <button
            onClick={() => navigate('/history')}
            className="bg-white text-gray-900 p-6 rounded-xl hover:bg-gray-50 transition shadow-md border border-gray-200"
          >
            <HistoryIcon className="h-8 w-8 mb-2 mx-auto text-indigo-600" />
            <div className="text-lg font-semibold">History</div>
            <div className="text-sm text-gray-600">View past calculations</div>
          </button>
        </div>

        {latestInsights && (
          <div className="bg-white rounded-xl shadow-md p-6 mb-8">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold">Senaste beräkning</h2>
              {getCreatedAtMs(latestInsights.createdAt) > 0 && (
                <span className="text-sm text-gray-500">
                  {new Date(getCreatedAtMs(latestInsights.createdAt)).toLocaleDateString('sv-SE', {
                    year: 'numeric', month: 'long', day: 'numeric',
                  })}
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {latestInsights.contributors.map(contributor => {
                const name = contributor.name;
                const income = contributor.income || 0;
                const sharedAmount = latestInsights.result.contributions[name] || 0;
                const indivBills = latestInsights.result.individualBills[name] || [];
                const indivTotal = indivBills.reduce((s, b) => s + b.amount, 0);
                const totalToPay = sharedAmount + indivTotal;
                const remainingAfterShared = latestInsights.result.targetRemainingBalance;
                const remainingAfterAll = remainingAfterShared - indivTotal;
                return (
                  <div key={name} className="border rounded-xl p-4">
                    <div className="flex justify-between items-center mb-3">
                      <p className="font-semibold text-gray-900">{name}</p>
                      <span className="text-sm text-gray-400">kr {income.toLocaleString('sv-SE')}</span>
                    </div>
                    <div className="space-y-1.5 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-500">Gemensamma utgifter</span>
                        <span className="font-medium text-indigo-700">kr {sharedAmount.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">Egna räkningar</span>
                        <span className="font-medium text-gray-700">
                          {indivBills.length > 0 ? `kr ${indivTotal.toFixed(2)}` : '—'}
                        </span>
                      </div>
                      {indivBills.length > 0 && (
                        <ul className="ml-3 space-y-0.5">
                          {indivBills.map((b, i) => (
                            <li key={i} className="flex justify-between text-xs text-gray-400">
                              <span>{b.name}</span>
                              <span>kr {b.amount.toFixed(2)}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                      <div className="flex justify-between border-t pt-2 mt-1 font-semibold">
                        <span className="text-gray-700">Totalt att betala</span>
                        <span className="text-gray-900">kr {totalToPay.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between text-xs text-gray-400">
                        <span>Kvar efter gemensam delning</span>
                        <span>kr {remainingAfterShared.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between text-sm font-medium">
                        <span className="text-gray-600">Kvar totalt (inkl. egna)</span>
                        <span className="text-green-700">kr {remainingAfterAll.toFixed(2)}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {latestInsights.result.transfers.length > 0 && (
              <div className="mt-4 pt-4 border-t">
                <p className="font-semibold text-gray-700 mb-2 text-sm">Överföringar som behövs:</p>
                <div className="space-y-2">
                  {latestInsights.result.transfers.map((t, i) => (
                    <div key={i} className="flex justify-between bg-indigo-50 rounded-lg px-3 py-2 text-sm">
                      <span className="text-gray-800">{t.from} betalar {t.to}</span>
                      <span className="font-semibold text-indigo-700">kr {t.amount.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-4 pt-4 border-t flex items-center justify-between gap-4">
              <div className="text-sm">
                {resendStatus === 'sending' && (
                  <span className="text-gray-500">Skickar e-post…</span>
                )}
                {resendStatus && resendStatus !== 'sending' && resendStatus.sent.length > 0 && (
                  <span className="text-green-700">✓ Skickad till: {resendStatus.sent.join(', ')}</span>
                )}
                {resendStatus && resendStatus !== 'sending' && resendStatus.sent.length === 0 && (
                  <span className="text-amber-600">Ingen e-post skickad – inga e-postadresser hittades.</span>
                )}
              </div>
              <button
                onClick={async () => {
                  if (!latestCalculation?.id) return;
                  setResendStatus('sending');
                  try {
                    const result = await sendCalculationNotification(latestCalculation.id);
                    setResendStatus(result);
                  } catch {
                    setResendStatus({ sent: [], skipped: ['Fel vid skickning'] });
                  }
                }}
                disabled={resendStatus === 'sending'}
                className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 disabled:opacity-50 text-sm font-medium shrink-0"
              >
                Skicka sammanfattning via e-post
              </button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {summaryStats.map((stat) => (
            <div key={stat.label} className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
              <p className="text-xs uppercase tracking-wide text-gray-500">{stat.label}</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">{stat.value}</p>
            </div>
          ))}
        </div>

        <div className="bg-white rounded-xl shadow-md p-6 mb-8">
          <h2 className="text-xl font-semibold mb-4 flex items-center">
            <Home className="h-6 w-6 mr-2 text-indigo-600" />
            Household Management
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            <div className="border border-gray-200 rounded-lg p-4">
              <h3 className="font-semibold mb-2">Create Household</h3>
              <div className="flex gap-2">
                <input
                  value={createName}
                  onChange={(event) => setCreateName(event.target.value)}
                  placeholder="Household name"
                  className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
                <button
                  onClick={handleCreateHousehold}
                  disabled={actionLoading || !createName.trim()}
                  className="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                >
                  Create
                </button>
              </div>
            </div>

            <div className="border border-gray-200 rounded-lg p-4">
              <h3 className="font-semibold mb-2 flex items-center gap-2">
                <Link className="h-4 w-4" />
                Join with Invite Code
              </h3>
              <div className="flex gap-2">
                <input
                  value={inviteCode}
                  onChange={(event) => setInviteCode(event.target.value.toUpperCase())}
                  placeholder="ABC123"
                  className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm uppercase"
                />
                <button
                  onClick={handleJoinHousehold}
                  disabled={actionLoading || !inviteCode.trim()}
                  className="bg-emerald-600 text-white px-4 py-2 rounded-lg hover:bg-emerald-700 disabled:opacity-50"
                >
                  Join
                </button>
              </div>
            </div>
          </div>

          <h3 className="font-semibold mb-3">Your Households</h3>
          {households.length === 0 ? (
            <div className="text-center py-8 text-gray-500 border border-dashed rounded-lg">
              <p>No households yet. Create one or join with an invite code.</p>
            </div>
          ) : (
            <div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {households.map((household) => (
                  <button
                    key={household.id}
                    onClick={() => setSelectedHouseholdId(household.id)}
                    className={`text-left border rounded-lg p-4 transition w-full ${selectedHousehold?.id === household.id ? 'border-indigo-500 bg-indigo-50' : 'hover:border-indigo-500'}`}
                  >
                    <h4 className="font-semibold">{household.name}</h4>
                    <p className="text-sm text-gray-600 mt-1">
                      {Object.keys(household.members || {}).length} members
                    </p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {selectedHousehold && (
            <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="border border-gray-200 rounded-lg p-4 bg-gray-50">
                <h4 className="font-semibold text-gray-900 mb-3">{selectedHousehold.name} · Members</h4>
                <div className="space-y-2">
                  {Object.entries(selectedHousehold.members || {}).map(([memberId, member]) => (
                    <div key={memberId} className="flex items-center justify-between text-sm bg-white rounded border border-gray-200 px-3 py-2">
                      <span className="font-medium text-gray-800">{member.name || memberId}</span>
                      <span className="text-xs uppercase tracking-wide text-gray-500">{member.role}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="border border-gray-200 rounded-lg p-4 bg-white">
                <h4 className="font-semibold text-gray-900 mb-1">Invite by email</h4>
                <p className="text-xs text-gray-500 mb-3">
                  Sends a one-time code valid for 7 days. The recipient enters the code in their dashboard to join.
                </p>
                <div className="flex gap-2">
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={(event) => setInviteEmail(event.target.value)}
                    placeholder="name@example.com"
                    className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
                  />
                  <button
                    onClick={handleSendInvite}
                    disabled={actionLoading || !inviteEmail.trim()}
                    className="bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 disabled:opacity-50 text-sm font-medium"
                  >
                    Send invite
                  </button>
                </div>
                {inviteFeedback && (
                  <div className="mt-3 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800 flex items-center justify-between gap-2">
                    <span className="break-all">{inviteFeedback}</span>
                    <button
                      onClick={() => {
                        const codeMatch = inviteFeedback.match(/Code: ([A-Z0-9]+)/);
                        if (codeMatch) {
                          navigator.clipboard.writeText(codeMatch[1]);
                        }
                      }}
                      className="inline-flex items-center gap-1 text-emerald-700 hover:text-emerald-900"
                      title="Copy code"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}

                <div className="mt-4">
                  <div className="flex items-center justify-between mb-2">
                    <h5 className="text-xs font-semibold uppercase tracking-wide text-gray-600">Pending invites</h5>
                    {invitesLoading && <span className="text-xs text-gray-400">Loading…</span>}
                  </div>
                  {(() => {
                    const list = householdInvites[selectedHousehold.id] || [];
                    const pending = list.filter((inv) => !inv.usedAt && !inv.revokedAt);
                    if (pending.length === 0) {
                      return <p className="text-xs text-gray-500">No pending invites.</p>;
                    }
                    return (
                      <ul className="space-y-2">
                        {pending.map((inv) => {
                          const expiresMs = (() => {
                            const v: any = inv.expiresAt;
                            if (!v) return 0;
                            if (typeof v === 'number') return v;
                            if (typeof v === 'string') return new Date(v).getTime();
                            if (v?._seconds) return v._seconds * 1000;
                            if (v?.seconds) return v.seconds * 1000;
                            return 0;
                          })();
                          const daysLeft = expiresMs
                            ? Math.max(0, Math.ceil((expiresMs - Date.now()) / (24 * 60 * 60 * 1000)))
                            : null;
                          return (
                            <li key={inv.id} className="flex items-center justify-between gap-2 text-sm border border-gray-200 rounded-md px-3 py-2 bg-gray-50">
                              <div className="min-w-0">
                                <div className="font-medium text-gray-800 truncate">{inv.email}</div>
                                <div className="text-xs text-gray-500">
                                  Code <span className="font-mono">{inv.code}</span>
                                  {daysLeft !== null && (
                                    <> · expires in {daysLeft} day{daysLeft === 1 ? '' : 's'}</>
                                  )}
                                </div>
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <button
                                  onClick={() => navigator.clipboard.writeText(inv.code)}
                                  className="text-xs px-2 py-1 rounded border border-gray-300 bg-white hover:bg-gray-100 inline-flex items-center gap-1"
                                  title="Copy code"
                                >
                                  <Copy className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  onClick={() => handleRevokeInvite(inv.id)}
                                  disabled={actionLoading}
                                  className="text-xs px-2 py-1 rounded border border-red-200 bg-white text-red-700 hover:bg-red-50 disabled:opacity-50"
                                >
                                  Revoke
                                </button>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    );
                  })()}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mb-6">
          <div className="bg-white rounded-xl shadow-md p-6">
            <h2 className="text-xl font-semibold mb-4 flex items-center">
              <BarChart3 className="h-5 w-5 mr-2 text-indigo-600" />
              Monthly Trends
            </h2>
            {trendsData.length > 0 ? (
              <TrendsChart data={trendsData} />
            ) : (
              <p className="text-gray-500">Not enough data yet for trends.</p>
            )}
          </div>

          <div className="bg-white rounded-xl shadow-md p-6">
            <h2 className="text-xl font-semibold mb-4">Latest Contribution Split</h2>
            {contributionPieData.length > 0 ? (
              <PieChartComponent data={contributionPieData} />
            ) : (
              <p className="text-gray-500">Run a calculation to see contribution distribution.</p>
            )}
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-md p-6 border border-gray-100">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-4">
            <div>
              <h2 className="text-xl font-semibold">Money Flow Overview</h2>
              <p className="text-sm text-gray-600 mt-1">
                See how income splits into shared bills, individual bills and what's left in this {sankeyRange} ({sankeyMode === 'calendar' ? 'calendar period' : 'rolling window'}).
              </p>
              <p className={`text-xs font-medium uppercase tracking-wide mt-2 ${sankeyMode === 'calendar' ? 'text-indigo-600' : 'text-emerald-600'}`}>
                {sankeyWindowLabel}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-1">
                {(['month', 'quarter', 'year'] as SankeyRange[]).map((range) => (
                  <button
                    key={range}
                    onClick={() => setSankeyRange(range)}
                    className={`px-3 py-1.5 text-sm rounded-md transition ${sankeyRange === range ? 'bg-white shadow text-indigo-700 font-medium' : 'text-gray-600 hover:text-gray-900'}`}
                  >
                    {range.charAt(0).toUpperCase() + range.slice(1)}
                  </button>
                ))}
              </div>
              <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-1">
                {(['calendar', 'rolling'] as SankeyMode[]).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setSankeyMode(mode)}
                    className={`px-3 py-1.5 text-sm rounded-md transition ${sankeyMode === mode ? mode === 'calendar' ? 'bg-indigo-50 shadow text-indigo-700 font-medium border border-indigo-200' : 'bg-emerald-50 shadow text-emerald-700 font-medium border border-emerald-200' : 'text-gray-600 hover:text-gray-900 border border-transparent'}`}
                  >
                    {mode.charAt(0).toUpperCase() + mode.slice(1)}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <div className="rounded-lg bg-indigo-50 px-3 py-2">
              <p className="text-[11px] uppercase tracking-wide text-indigo-700">Calculations</p>
              <p className="text-lg font-semibold text-indigo-900">{sankeySourceCalculations.items.length}</p>
            </div>
            <div className="rounded-lg bg-emerald-50 px-3 py-2">
              <p className="text-[11px] uppercase tracking-wide text-emerald-700">Flow links</p>
              <p className="text-lg font-semibold text-emerald-900">{sankeyData.links.length}</p>
            </div>
            <div className="rounded-lg bg-amber-50 px-3 py-2">
              <p className="text-[11px] uppercase tracking-wide text-amber-700">Transfers</p>
              <p className="text-lg font-semibold text-amber-900">{sankeyData.transferCount}</p>
            </div>
            <div className="rounded-lg bg-sky-50 px-3 py-2">
              <p className="text-[11px] uppercase tracking-wide text-sky-700">Total flow</p>
              <p className="text-lg font-semibold text-sky-900">kr {sankeyData.totalAmount.toFixed(0)}</p>
            </div>
          </div>

          {sankeySourceCalculations.isFallback && (
            <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              No transfers were found in the selected window. Showing latest available transfer history instead.
            </div>
          )}

          {sankeyData.nodes.length > 0 ? (
            <>
              <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-600">
                <span>
                  <span className="font-semibold text-gray-800">Total income:</span> kr{' '}
                  {sankeyData.totalAmount.toLocaleString('sv-SE', { maximumFractionDigits: 0 })}
                </span>
                <span className="text-gray-300">|</span>
                <span>
                  <span className="font-semibold text-gray-800">{sankeyData.peopleCount}</span>{' '}
                  {sankeyData.peopleCount === 1 ? 'person' : 'people'}
                </span>
                <span className="text-gray-300">|</span>
                <span>
                  <span className="font-semibold text-gray-800">{sankeyData.stageCount}</span> stages
                </span>
                <span className="text-gray-300">|</span>
                <span>
                  <span className="font-semibold text-gray-800">{sankeyData.links.length}</span> flow links
                </span>
                <span className="ml-auto text-gray-400 italic">
                  Hover a ribbon for details
                </span>
              </div>
              <SankeyChart data={sankeyData} />
            </>
          ) : (
            <p className="text-gray-500">No transfer data available for this period yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}
