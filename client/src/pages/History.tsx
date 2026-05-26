import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, query, where, getDocs, orderBy, doc, getDoc } from 'firebase/firestore';
import { auth } from '../firebase';
import { calculateExpenditure } from '../utils/calculations';

interface Contributor {
  name: string;
  income?: number;
}

interface Bill {
  name?: string;
  amount?: number;
  isShared?: boolean;
  payer?: string;
}

interface Transfer {
  from: string;
  to: string;
  amount: number;
}

interface CalculationResult {
  contributions?: Record<string, number>;
  remainingAmounts?: Record<string, number>;
  targetRemainingBalance?: number;
  transfers?: Transfer[];
}

interface Calculation {
  id: string;
  userId?: string;
  householdId?: string;
  contributors: Contributor[];
  bills: Bill[];
  result?: CalculationResult;
  createdAt?: unknown;
}

interface HistoryDebugStats {
  userIdDocs: number;
  householdDocs: number;
  uniqueDocs: number;
  householdQueries: number;
}

const isMissingIndexError = (error: unknown): boolean => {
  const maybeError = error as { code?: string; message?: string };
  return (
    maybeError?.code === 'failed-precondition' ||
    (maybeError?.message || '').toLowerCase().includes('requires an index')
  );
};

const formatCurrency = (value: number): string => `kr ${value.toFixed(2)}`;

const getCalculationInsights = (calc: Calculation) => {
  const bills = calc.bills || [];
  const contributors = calc.contributors || [];

  // Build inputs for a fresh recalculation using the current algorithm
  const incomes: Record<string, number> = {};
  contributors.forEach(c => {
    if (c.name && (c.income ?? 0) > 0) {
      incomes[c.name] = c.income ?? 0;
    }
  });

  const billObjects = bills.map(b => ({
    name: b.name || '',
    amount: b.amount || 0,
    isShared: b.isShared !== false,
    ...(b.payer ? { payer: b.payer } : {}),
  }));

  const freshResult = Object.keys(incomes).length > 0
    ? calculateExpenditure(incomes, billObjects)
    : null;

  const contributions = freshResult?.contributions ?? calc.result?.contributions ?? {};
  const remainingAmounts = freshResult?.remainingAmounts ?? calc.result?.remainingAmounts ?? {};
  const transfers = freshResult?.transfers ?? calc.result?.transfers ?? [];
  const freshIndividualBills = freshResult?.individualBills ?? {};

  const totalBills = bills.reduce((sum, bill) => sum + (bill.amount || 0), 0);
  const sharedBillsTotal = bills
    .filter((bill) => bill.isShared !== false)
    .reduce((sum, bill) => sum + (bill.amount || 0), 0);
  const individualBillsTotal = totalBills - sharedBillsTotal;
  const transferTotal = transfers.reduce((sum, transfer) => sum + (transfer.amount || 0), 0);

  const perPerson = contributors.map((contributor) => {
    const name = contributor.name;
    const income = contributor.income || 0;
    const indivBillsForPerson = freshIndividualBills[name] || [];
    const paidByBills = indivBillsForPerson.reduce((s, b) => s + b.amount, 0);
    const shouldPay = contributions[name] || 0;
    const remaining = remainingAmounts[name] ?? Math.max(0, income - (shouldPay + paidByBills));
    const totalToPay = shouldPay + paidByBills;
    const totalRemaining = remaining - paidByBills;

    return {
      name,
      income,
      paidByBills,
      shouldPay,
      remaining,
      totalToPay,
      totalRemaining,
    };
  });

  return {
    totalBills,
    sharedBills: sharedBillsTotal,
    individualBills: individualBillsTotal,
    transferTotal,
    transferCount: transfers.length,
    perPerson,
    transfers,
  };
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

const formatCreatedAt = (createdAt: unknown): string => {
  const timestamp = getCreatedAtMs(createdAt);
  if (!timestamp) {
    return 'Unknown date';
  }

  return new Date(timestamp).toLocaleString('sv-SE');
};

export default function History() {
  const navigate = useNavigate();
  const [calculations, setCalculations] = useState<Calculation[]>([]);
  const [loading, setLoading] = useState(true);
  const showDebugPanel = import.meta.env.DEV && typeof window !== 'undefined' && (
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1'
  );
  const [debugStats, setDebugStats] = useState<HistoryDebugStats>({
    userIdDocs: 0,
    householdDocs: 0,
    uniqueDocs: 0,
    householdQueries: 0,
  });

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setCalculations([]);
        setDebugStats({ userIdDocs: 0, householdDocs: 0, uniqueDocs: 0, householdQueries: 0 });
        setLoading(false);
        return;
      }

      try {
        const db = getFirestore();
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

            console.warn(`[History] Skipping calculations query for ${field}=${value}:`, error);
            return null;
          }
        };

        const snapshots: Array<Awaited<ReturnType<typeof fetchByField>>> = [];
        snapshots.push(await fetchByField('userId', user.uid));
        const userIdDocsCount = snapshots[0]?.size || 0;

        const userDocRef = doc(db, 'users', user.uid);
        const userDoc = await getDoc(userDocRef);
        const householdIds: string[] = userDoc.exists() ? (userDoc.data()?.households || []) : [];

        if (householdIds.length > 0) {
          const householdSnapshots = await Promise.all(
            householdIds.map((householdId) => fetchByField('householdId', householdId))
          );
          snapshots.push(...householdSnapshots);
        }

        const householdDocsCount = snapshots
          .slice(1)
          .reduce((sum, snapshot) => sum + (snapshot?.size || 0), 0);

        const calculationsById = new Map<string, Calculation>();
        snapshots.forEach((snapshot) => {
          if (!snapshot) {
            return;
          }
          snapshot.forEach((historyDoc) => {
            calculationsById.set(historyDoc.id, {
              id: historyDoc.id,
              ...historyDoc.data(),
            } as Calculation);
          });
        });

        const historyData = Array.from(calculationsById.values()).sort((a, b) => {
          return getCreatedAtMs(b.createdAt) - getCreatedAtMs(a.createdAt);
        });

        setCalculations(historyData);
        setDebugStats({
          userIdDocs: userIdDocsCount,
          householdDocs: householdDocsCount,
          uniqueDocs: historyData.length,
          householdQueries: householdIds.length,
        });
      } catch (error) {
        console.error('Error fetching history:', error);
      } finally {
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <nav className="bg-white shadow-sm">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex h-16 items-center">
              <button
                onClick={() => navigate('/dashboard')}
                className="flex items-center text-gray-600 hover:text-gray-900"
              >
                <ArrowLeft className="h-5 w-5 mr-2" />
                Back
              </button>
              <h1 className="ml-4 text-xl font-bold text-gray-900">History</h1>
            </div>
          </div>
        </nav>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="bg-white rounded-xl shadow-md p-6">
            <p>Loading history...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center">
            <button
              onClick={() => navigate('/dashboard')}
              className="flex items-center text-gray-600 hover:text-gray-900"
            >
              <ArrowLeft className="h-5 w-5 mr-2" />
              Back
            </button>
            <h1 className="ml-4 text-xl font-bold text-gray-900">History</h1>
          </div>
        </div>
      </nav>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-white rounded-xl shadow-md p-6">
          <h2 className="text-xl font-semibold mb-4">Past Calculations</h2>
          {showDebugPanel && (
            <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              <div className="flex items-center justify-between gap-3">
                <p>
                  Debug: userId docs={debugStats.userIdDocs}, household docs={debugStats.householdDocs}, unique={debugStats.uniqueDocs}, household queries={debugStats.householdQueries}
                </p>
                <button
                  onClick={() => {
                    const debugText = `History debug -> userId docs=${debugStats.userIdDocs}, household docs=${debugStats.householdDocs}, unique=${debugStats.uniqueDocs}, household queries=${debugStats.householdQueries}`;
                    navigator.clipboard.writeText(debugText);
                  }}
                  className="rounded border border-amber-300 bg-white px-2 py-1 text-[11px] font-medium text-amber-900 hover:bg-amber-100"
                >
                  Copy debug info
                </button>
              </div>
            </div>
          )}
          {calculations.length === 0 ? (
            <p className="text-gray-500">No calculations saved yet.</p>
          ) : (
            <div className="space-y-4">
              {calculations.map((calc) => (
                <div key={calc.id} className="border rounded-xl p-4 md:p-5 hover:border-indigo-500 transition shadow-sm">
                  {(() => {
                    const insights = getCalculationInsights(calc);
                    const contributorNames = (calc.contributors || []).map((contributor) => contributor.name);
                    const billsCount = calc.bills?.length || 0;
                    return (
                      <>
                        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                          <div>
                            <p className="text-sm text-gray-500">
                              {formatCreatedAt(calc.createdAt)}
                            </p>
                            <p className="font-semibold mt-1 text-gray-900">
                              {contributorNames.length > 0 ? contributorNames.join(', ') : 'Unnamed contributors'}
                            </p>
                            <p className="text-sm text-gray-600">
                              {billsCount} bills · {insights.transferCount} transfers
                            </p>
                          </div>
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                            <div className="rounded-lg bg-indigo-50 px-3 py-2">
                              <p className="text-[11px] uppercase tracking-wide text-indigo-700">Total</p>
                              <p className="font-semibold text-indigo-900">{formatCurrency(insights.totalBills)}</p>
                            </div>
                            <div className="rounded-lg bg-sky-50 px-3 py-2">
                              <p className="text-[11px] uppercase tracking-wide text-sky-700">Shared</p>
                              <p className="font-semibold text-sky-900">{formatCurrency(insights.sharedBills)}</p>
                            </div>
                            <div className="rounded-lg bg-emerald-50 px-3 py-2">
                              <p className="text-[11px] uppercase tracking-wide text-emerald-700">Individual</p>
                              <p className="font-semibold text-emerald-900">{formatCurrency(insights.individualBills)}</p>
                            </div>
                            <div className="rounded-lg bg-amber-50 px-3 py-2">
                              <p className="text-[11px] uppercase tracking-wide text-amber-700">Moved</p>
                              <p className="font-semibold text-amber-900">{formatCurrency(insights.transferTotal)}</p>
                            </div>
                          </div>
                        </div>

                        <div className="mt-4 overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="text-left text-gray-500 border-b">
                                <th className="py-2 pr-4 font-medium">Person</th>
                                <th className="py-2 pr-4 font-medium">Inkomst</th>
                                <th className="py-2 pr-4 font-medium">Egna räkningar</th>
                                <th className="py-2 pr-4 font-medium">Andel gemensamt</th>
                                <th className="py-2 pr-4 font-medium">Totalt att betala</th>
                                <th className="py-2 pr-4 font-medium">Kvar delning</th>
                                <th className="py-2 font-medium text-green-700">Kvar totalt</th>
                              </tr>
                            </thead>
                            <tbody>
                              {insights.perPerson.map((person) => (
                                <tr key={`${calc.id}-${person.name}`} className="border-b last:border-b-0">
                                  <td className="py-2 pr-4 font-medium text-gray-800">{person.name}</td>
                                  <td className="py-2 pr-4 text-gray-700">{formatCurrency(person.income)}</td>
                                  <td className="py-2 pr-4 text-gray-700">{person.paidByBills > 0 ? formatCurrency(person.paidByBills) : '—'}</td>
                                  <td className="py-2 pr-4 text-indigo-700 font-medium">{formatCurrency(person.shouldPay)}</td>
                                  <td className="py-2 pr-4 font-semibold text-gray-900">{formatCurrency(person.totalToPay)}</td>
                                  <td className="py-2 pr-4 text-gray-500 text-xs">{formatCurrency(person.remaining)}</td>
                                  <td className="py-2 font-semibold text-green-700">{formatCurrency(person.totalRemaining)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>

                        {insights.transfers.length > 0 && (
                          <div className="mt-4 pt-3 border-t">
                            <p className="text-sm font-semibold text-gray-700 mb-2">Överföringar som behövs:</p>
                            <div className="space-y-1">
                              {insights.transfers.map((t, i) => (
                                <div key={i} className="flex justify-between text-sm bg-indigo-50 rounded-lg px-3 py-2">
                                  <span className="text-gray-800">{t.from} betalar {t.to}</span>
                                  <span className="font-semibold text-indigo-700">{formatCurrency(t.amount)}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
