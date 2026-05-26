import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus, Trash2, Save } from 'lucide-react';
import { calculateExpenditure, Contributor, Bill } from '../utils/calculations';
import { ParsedIncome, ParsedBill } from '../utils/csvParser';
import CSVUploader from '../components/CSVUploader';
import { getFirestore, collection, addDoc, query, where, limit, getDocs } from 'firebase/firestore';
import { auth } from '../firebase';
import { getHouseholds, sendCalculationNotification } from '../services/api';
import type { Household } from '../types';

export default function Calculator() {
  const navigate = useNavigate();
  const [contributors, setContributors] = useState<Contributor[]>([
    { name: '', income: 0 }
  ]);
  const [bills, setBills] = useState<ParsedBill[]>([]);
  const [result, setResult] = useState<any>(null);
  const [historicalSuggestions, setHistoricalSuggestions] = useState<Record<string, { isShared: boolean; payer?: string }>>({});
  const [households, setHouseholds] = useState<Household[]>([]);
  const [selectedHouseholdId, setSelectedHouseholdId] = useState<string>('');
  const [saveConfirmation, setSaveConfirmation] = useState(false);
  const [notificationStatus, setNotificationStatus] = useState<{ sent: string[]; skipped: string[] } | null>(null);

  // Load historical suggestions on mount
  useEffect(() => {
    const loadHistoricalSuggestions = async () => {
      if (!auth.currentUser) return;

      try {
        const db = getFirestore();
        const q = query(
          collection(db, 'calculations'),
          where('userId', '==', auth.currentUser.uid),
          limit(10)
        );
        const querySnapshot = await getDocs(q);
        const docs = querySnapshot.docs.sort((a, b) => {
          const aTime = new Date((a.data() as any).createdAt || 0).getTime();
          const bTime = new Date((b.data() as any).createdAt || 0).getTime();
          return bTime - aTime;
        });

        const suggestions: Record<string, { isShared: boolean; payer?: string }> = {};

        docs.forEach((doc) => {
          const data = doc.data();
          if (data.bills && Array.isArray(data.bills)) {
            data.bills.forEach((bill: any) => {
              if (!bill.isShared && bill.payer) {
                const billName = bill.name.toLowerCase().trim();
                if (!suggestions[billName]) {
                  suggestions[billName] = {
                    isShared: false,
                    payer: bill.payer
                  };
                }
              }
            });
          }
        });

        setHistoricalSuggestions(suggestions);
      } catch (error) {
        console.error('Error loading historical suggestions:', error);
      }
    };

    loadHistoricalSuggestions();
  }, []);

  // Load user's households for selector
  useEffect(() => {
    const loadHouseholds = async () => {
      if (!auth.currentUser) return;
      try {
        const list = await getHouseholds();
        const valid = list.filter((h) => typeof h.id === 'string' && h.id.length > 0);
        setHouseholds(valid);
        if (valid.length > 0) {
          setSelectedHouseholdId((current) => current || valid[0].id);
        }
      } catch (error) {
        console.warn('Failed to load households:', error);
      }
    };
    loadHouseholds();
  }, []);

  const addContributor = () => {
    setContributors([...contributors, { name: '', income: 0 }]);
  };

  const removeContributor = (index: number) => {
    setContributors(contributors.filter((_, i) => i !== index));
  };

  const updateContributor = (index: number, field: keyof Contributor, value: string | number) => {
    const updated = [...contributors];
    updated[index] = { ...updated[index], [field]: value };
    setContributors(updated);
  };

  const handleCSVDataLoaded = (incomes: ParsedIncome[], billItems: ParsedBill[]) => {
    const newContributors: Contributor[] = incomes.map((inc) => ({
      name: inc.name,
      income: inc.income,
    }));

    if (newContributors.length > 0) {
      setContributors(newContributors);
    }

    if (billItems.length > 0) {
      // Apply historical suggestions to bills
      const billsWithSuggestions = billItems.map(bill => {
        const billNameLower = bill.name.toLowerCase().trim();
        const suggestion = historicalSuggestions[billNameLower];

        if (suggestion && !suggestion.isShared) {
          return {
            ...bill,
            isShared: false,
            payer: suggestion.payer
          };
        }

        return bill;
      });

      setBills(billsWithSuggestions);
    }
  };

  const addBill = () => {
    setBills([...bills, { name: '', amount: 0, isShared: true }]);
  };

  const updateBill = (index: number, field: keyof ParsedBill, value: any) => {
    const updated = [...bills];
    updated[index] = { ...updated[index], [field]: value };
    setBills(updated);
  };

  const removeBill = (index: number) => {
    setBills(bills.filter((_, i) => i !== index));
  };

  const getTotalBills = () => {
    return bills
      .filter(b => b.isShared)
      .reduce((sum, bill) => sum + (bill.amount || 0), 0);
  };

  const handleCalculate = () => {
    const incomes: Record<string, number> = {};
    contributors.forEach((c) => {
      if (c.name && c.income > 0) {
        incomes[c.name] = c.income;
      }
    });

    // Convert ParsedBill to Bill format
    const billObjects: Bill[] = bills.map(b => ({
      name: b.name,
      amount: b.amount,
      isShared: b.isShared,
      payer: b.payer,
    }));

    const calculation = calculateExpenditure(incomes, billObjects);
    setResult(calculation);
  };

  const handleSave = async () => {
    if (!result) {
      alert('Calculate first before saving');
      return;
    }

    if (!auth.currentUser) {
      alert('You must be logged in to save');
      return;
    }

    try {
      const db = getFirestore();
      const billObjects = bills.map(b => {
        const bill: any = {
          name: b.name,
          amount: b.amount,
          isShared: b.isShared,
        };
        if (b.payer) {
          bill.payer = b.payer;
        }
        return bill;
      });

      const calculation: Record<string, unknown> = {
        userId: auth.currentUser.uid,
        contributors: contributors.filter(c => c.name && c.income > 0),
        bills: billObjects,
        result,
        createdAt: new Date().toISOString(),
      };

      if (selectedHouseholdId) {
        calculation.householdId = selectedHouseholdId;
      }

      const docRef = await addDoc(collection(db, 'calculations'), calculation);
      setSaveConfirmation(true);
      setNotificationStatus(null);
      try {
        const notifResult = await sendCalculationNotification(docRef.id);
        setNotificationStatus(notifResult);
      } catch (notifErr) {
        console.warn('Could not send notification emails:', notifErr);
      }
    } catch (error) {
      console.error('Error saving calculation:', error);
      alert('Failed to save calculation: ' + (error as any).message);
    }
  };

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
            <h1 className="ml-4 text-xl font-bold text-gray-900">Bill Calculator</h1>
          </div>
        </div>
      </nav>

      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-white rounded-xl shadow-md p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">CSV Import</h2>
          <CSVUploader onDataLoaded={handleCSVDataLoaded} />
        </div>

        <div className="bg-white rounded-xl shadow-md p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">Contributors</h2>
          {contributors.map((contributor, index) => (
            <div key={index} className="flex gap-4 mb-4 items-end">
              <div className="flex-1">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Name
                </label>
                <input
                  type="text"
                  value={contributor.name}
                  onChange={(e) => updateContributor(index, 'name', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  placeholder="Enter name"
                />
              </div>
              <div className="flex-1">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Income
                </label>
                <input
                  type="number"
                  value={contributor.income || ''}
                  onChange={(e) => updateContributor(index, 'income', parseFloat(e.target.value) || 0)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  placeholder="Enter income"
                />
              </div>
              {contributors.length > 1 && (
                <button
                  onClick={() => removeContributor(index)}
                  className="p-2 text-red-600 hover:bg-red-50 rounded-lg"
                >
                  <Trash2 className="h-5 w-5" />
                </button>
              )}
            </div>
          ))}
          <button
            onClick={addContributor}
            className="flex items-center text-indigo-600 hover:text-indigo-700 mt-2"
          >
            <Plus className="h-5 w-5 mr-2" />
            Add Contributor
          </button>
        </div>

        <div className="bg-white rounded-xl shadow-md p-6 mb-6">
          <h2 className="text-xl font-semibold mb-4">Räkningar</h2>
          {bills.map((bill, index) => (
            <div key={index} className="flex gap-4 mb-4 items-end">
              <div className="flex-1">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Namn
                </label>
                <input
                  type="text"
                  value={bill.name}
                  onChange={(e) => updateBill(index, 'name', e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  placeholder="Räkningens namn"
                />
              </div>
              <div className="flex-1">
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Belopp (kr)
                </label>
                <input
                  type="number"
                  value={bill.amount || ''}
                  onChange={(e) => updateBill(index, 'amount', parseFloat(e.target.value) || 0)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  placeholder="Belopp"
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={bill.isShared}
                    onChange={(e) => updateBill(index, 'isShared', e.target.checked)}
                    className="w-4 h-4 text-indigo-600 rounded focus:ring-indigo-500"
                  />
                  Gemensam
                </label>
              </div>
              {!bill.isShared && (
                <div className="flex-1">
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Betalare
                  </label>
                  <select
                    value={bill.payer || ''}
                    onChange={(e) => updateBill(index, 'payer', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  >
                    <option value="">Välj person</option>
                    {contributors.map((c, i) => (
                      c.name && <option key={i} value={c.name}>{c.name}</option>
                    ))}
                  </select>
                </div>
              )}
              <button
                onClick={() => removeBill(index)}
                className="p-2 text-red-600 hover:bg-red-50 rounded-lg"
              >
                <Trash2 className="h-5 w-5" />
              </button>
            </div>
          ))}
          <button
            onClick={addBill}
            className="flex items-center text-indigo-600 hover:text-indigo-700 mt-2"
          >
            <Plus className="h-5 w-5 mr-2" />
            Lägg till räkning
          </button>

          <div className="mt-4 pt-4 border-t">
            <div className="flex justify-between items-center">
              <span className="font-semibold">Total gemensamma räkningar:</span>
              <span className="text-xl font-bold text-indigo-600">kr {getTotalBills().toLocaleString()}</span>
            </div>
          </div>
        </div>

        {households.length > 0 && (
          <div className="bg-white rounded-xl shadow-md p-4 mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Spara till hushåll
            </label>
            <select
              value={selectedHouseholdId}
              onChange={(e) => setSelectedHouseholdId(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">Bara jag (privat)</option>
              {households.map((h) => (
                <option key={h.id} value={h.id}>{h.name}</option>
              ))}
            </select>
            <p className="mt-2 text-xs text-gray-500">
              Väljer du ett hushåll kan alla medlemmar se kalkylen.
            </p>
          </div>
        )}

        <div className="flex gap-4">
        <button
          onClick={handleCalculate}
          className="flex-1 bg-indigo-600 text-white py-3 rounded-lg hover:bg-indigo-700 transition font-semibold"
        >
          Calculate
        </button>
        {result && (
          <button
            onClick={handleSave}
            className="flex items-center justify-center gap-2 bg-green-600 text-white px-6 py-3 rounded-lg hover:bg-green-700 transition font-semibold"
          >
            <Save className="h-5 w-5" />
            Spara
          </button>
        )}
      </div>

      {saveConfirmation && result && (
        <div className="mt-4 bg-green-50 border border-green-200 rounded-xl p-5">
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-semibold text-green-800 text-lg">Sparad! Betalningsöversikt</h3>
            <button
              onClick={() => { setSaveConfirmation(false); setNotificationStatus(null); }}
              className="text-green-600 hover:text-green-900 text-xl font-bold leading-none"
            >
              ×
            </button>
          </div>

          {notificationStatus === null ? (
            <p className="text-xs text-green-600 mb-3">Skickar e-postsammanfattning…</p>
          ) : notificationStatus.sent.length > 0 ? (
            <p className="text-xs text-green-700 mb-3">
              ✓ E-post skickad till: {notificationStatus.sent.join(', ')}
              {notificationStatus.skipped.length > 0 && ` · Hoppade över: ${notificationStatus.skipped.join(', ')}`}
            </p>
          ) : (
            <p className="text-xs text-amber-600 mb-3">
              Ingen e-post skickad (ingen matchad e-postadress hittades för deltagarna).
            </p>
          )}

          <div className="space-y-3">
            {Object.entries(result.contributions).map(([name, amount]) => {
              const sharedAmount = amount as number;
              const indivBills: any[] = result.individualBills?.[name] || [];
              const indivTotal = indivBills.reduce((s: number, b: any) => s + b.amount, 0);
              const totalToPay = sharedAmount + indivTotal;
              const remaining = (result.targetRemainingBalance ?? 0) - indivTotal;
              return (
                <div key={name} className="bg-white rounded-lg p-3 border border-green-100">
                  <p className="font-semibold text-gray-800 mb-2">{name}</p>
                  <div className="text-sm space-y-1">
                    <div className="flex justify-between">
                      <span className="text-gray-500">Gemensamma utgifter</span>
                      <span className="text-indigo-700 font-medium">kr {sharedAmount.toFixed(2)}</span>
                    </div>
                    {indivBills.length > 0 && (
                      <>
                        <div className="flex justify-between">
                          <span className="text-gray-500">Egna räkningar</span>
                          <span className="text-gray-700 font-medium">kr {indivTotal.toFixed(2)}</span>
                        </div>
                        <ul className="ml-3 space-y-0.5">
                          {indivBills.map((b: any, i: number) => (
                            <li key={i} className="flex justify-between text-xs text-gray-400">
                              <span>{b.name}</span>
                              <span>kr {b.amount.toFixed(2)}</span>
                            </li>
                          ))}
                        </ul>
                      </>
                    )}
                    <div className="flex justify-between border-t pt-1 mt-1 font-semibold">
                      <span className="text-gray-700">Totalt att betala</span>
                      <span className="text-gray-900">kr {totalToPay.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-xs text-gray-400 pt-0.5">
                      <span>Kvar efter gemensam delning</span>
                      <span>kr {(result.targetRemainingBalance ?? 0).toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-xs text-gray-500 font-medium">
                      <span>Kvar totalt (inkl. egna räkningar)</span>
                      <span className="text-green-700">kr {remaining.toFixed(2)}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {result.transfers && result.transfers.length > 0 && (
            <div className="mt-4 pt-4 border-t border-green-200">
              <p className="font-semibold text-green-800 mb-2">Överföringar som behövs:</p>
              <div className="space-y-2">
                {result.transfers.map((t: any, i: number) => (
                  <div key={i} className="flex justify-between bg-white rounded-lg px-3 py-2 border border-green-100 text-sm">
                    <span className="text-gray-800">{t.from} betalar {t.to}</span>
                    <span className="font-semibold text-indigo-700">kr {t.amount.toFixed(2)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

        {result && (
          <div className="mt-6 bg-white rounded-xl shadow-md p-6">
            <h2 className="text-xl font-semibold mb-4">Resultat</h2>

            <div className="space-y-4">
              {Object.entries(result.contributions).map(([name, amount]) => {
                const sharedAmount = amount as number;
                const indivBills: any[] = result.individualBills?.[name] || [];
                const indivTotal = indivBills.reduce((s: number, b: any) => s + b.amount, 0);
                const totalToPay = sharedAmount + indivTotal;
                const remainingAfterShared = result.targetRemainingBalance ?? 0;
                const remainingAfterAll = remainingAfterShared - indivTotal;
                return (
                  <div key={name} className="border rounded-xl p-4">
                    <p className="font-semibold text-gray-900 mb-3 text-base">{name}</p>
                    <div className="space-y-1.5 text-sm">
                      <div className="flex justify-between">
                        <span className="text-gray-500">Gemensamma utgifter (din andel)</span>
                        <span className="font-medium text-indigo-700">kr {sharedAmount.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">Egna räkningar</span>
                        <span className="font-medium text-gray-700">
                          {indivBills.length > 0 ? `kr ${indivTotal.toFixed(2)}` : '—'}
                        </span>
                      </div>
                      {indivBills.length > 0 && (
                        <ul className="ml-3 mt-0.5 space-y-0.5">
                          {indivBills.map((b: any, i: number) => (
                            <li key={i} className="flex justify-between text-xs text-gray-400">
                              <span>{b.name}</span>
                              <span>kr {b.amount.toFixed(2)}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                      <div className="flex justify-between border-t pt-2 mt-1 font-semibold text-base">
                        <span className="text-gray-800">Totalt att betala</span>
                        <span className="text-gray-900">kr {totalToPay.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between pt-1 text-xs text-gray-400">
                        <span>Kvar efter gemensam delning</span>
                        <span>kr {remainingAfterShared.toFixed(2)}</span>
                      </div>
                      <div className="flex justify-between text-sm font-medium">
                        <span className="text-gray-600">Kvar totalt (inkl. egna räkningar)</span>
                        <span className="text-green-700">kr {remainingAfterAll.toFixed(2)}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {result.transfers.length > 0 && (
              <div className="mt-5 pt-4 border-t">
                <h3 className="font-semibold mb-2 text-gray-800">Överföringar som behövs</h3>
                <div className="space-y-2">
                  {result.transfers.map((transfer: any, index: number) => (
                    <div key={index} className="flex justify-between bg-indigo-50 rounded-lg px-3 py-2 text-sm">
                      <span className="text-gray-800">{transfer.from} betalar {transfer.to}</span>
                      <span className="font-semibold text-indigo-700">kr {transfer.amount.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
