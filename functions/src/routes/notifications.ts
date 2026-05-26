import { Router } from 'express';
import { authenticateUser, AuthRequest } from '../middleware/auth';
import { db } from '../config/firebase';
import { EmailService } from '../services/email.service';
import { calculateExpenditure, Bill } from '../services/calculation.service';

const router = Router();

function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[åä]/g, 'a')
    .replace(/ö/g, 'o')
    .replace(/é/g, 'e')
    .replace(/ü/g, 'u')
    .trim();
}

function findEmail(
  contributorName: string,
  emailMap: Record<string, string>
): string | undefined {
  // 1. Exact match
  if (emailMap[contributorName]) return emailMap[contributorName];

  const normContrib = normalizeName(contributorName);
  const firstContrib = normContrib.split(' ')[0];

  for (const [mapName, email] of Object.entries(emailMap)) {
    const normMap = normalizeName(mapName);
    // 2. Case+diacritic insensitive full name
    if (normMap === normContrib) return email;
    // 3. Contributor first name matches map full name ("Björn" vs "Bjorn")
    if (normMap === firstContrib) return email;
    // 4. Contributor first name matches map first name ("Björn" vs "Bjorn Sundberg")
    const firstMap = normMap.split(' ')[0];
    if (firstMap === firstContrib) return email;
  }

  return undefined;
}

const kr = (n: number) =>
  `kr ${n.toLocaleString('sv-SE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function buildCalculationEmail(
  recipientName: string,
  contributors: Array<{ name: string; income: number }>,
  result: {
    contributions: Record<string, number>;
    remainingAmounts: Record<string, number>;
    targetRemainingBalance: number;
    transfers: Array<{ from: string; to: string; amount: number }>;
    individualBills: Record<string, Bill[]>;
  },
  calcDate: string,
  recentHistory: Array<{
    date: string;
    sharedTotal: number;
    contributors: Array<{ name: string; shouldPay: number; totalToPay: number; remaining: number }>;
  }>
): string {
  const myShared = result.contributions[recipientName] || 0;
  const myIndivBills = result.individualBills[recipientName] || [];
  const myIndivTotal = myIndivBills.reduce((s, b) => s + b.amount, 0);
  const myTotalToPay = myShared + myIndivTotal;
  const myRemaining = result.targetRemainingBalance - myIndivTotal;

  const personRows = contributors
    .map(c => {
      const shared = result.contributions[c.name] || 0;
      const indiv = (result.individualBills[c.name] || []).reduce((s, b) => s + b.amount, 0);
      const total = shared + indiv;
      const remaining = result.targetRemainingBalance - indiv;
      const highlight =
        c.name === recipientName
          ? 'background:#f0f4ff;font-weight:bold;'
          : '';
      return `<tr style="${highlight}">
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${c.name}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:right;">${kr(c.income)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:right;color:#4f46e5;">${kr(shared)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:right;">${indiv > 0 ? kr(indiv) : '&mdash;'}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:right;font-weight:bold;">${kr(total)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:right;color:#16a34a;">${kr(remaining)}</td>
      </tr>`;
    })
    .join('');

  const indivSection =
    myIndivBills.length > 0
      ? `<div style="margin-top:8px;">
          <p style="font-size:13px;color:#6b7280;margin:0 0 4px;">Dina egna räkningar:</p>
          ${myIndivBills
            .map(
              b => `<div style="display:flex;justify-content:space-between;font-size:13px;color:#6b7280;padding:2px 0;">
                <span>${b.name}</span><span>${kr(b.amount)}</span>
              </div>`
            )
            .join('')}
        </div>`
      : '';

  const transfersSection =
    result.transfers.length > 0
      ? `<div style="background:#f5f3ff;border-radius:8px;padding:16px;margin-top:16px;">
          <h3 style="margin:0 0 10px;font-size:15px;color:#4f46e5;">Överföringar som behövs</h3>
          ${result.transfers
            .map(t => {
              const isFrom = t.from === recipientName;
              const isTo = t.to === recipientName;
              const color = isFrom ? '#dc2626' : isTo ? '#16a34a' : '#374151';
              const note = isFrom ? ' (du betalar)' : isTo ? ' (du tar emot)' : '';
              return `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #e0e7ff;font-size:14px;">
                <span style="color:${color};">${t.from} &rarr; ${t.to}${note}</span>
                <strong>${kr(t.amount)}</strong>
              </div>`;
            })
            .join('')}
        </div>`
      : '';

  const historySection =
    recentHistory.length > 0
      ? `<div style="margin-top:24px;border-top:1px solid #e5e7eb;padding-top:16px;">
          <h3 style="margin:0 0 12px;font-size:15px;color:#374151;">Tidigare månader</h3>
          ${recentHistory
            .map(h => {
              const me = h.contributors.find(c => c.name === recipientName);
              if (!me) return '';
              return `<div style="background:#f9fafb;border-radius:6px;padding:10px 12px;margin-bottom:8px;font-size:13px;">
                <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
                  <span style="color:#6b7280;">${h.date}</span>
                  <span style="color:#6b7280;">Gemensamt totalt: ${kr(h.sharedTotal)}</span>
                </div>
                <div style="display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;">
                  <span>Din andel: <strong>${kr(me.shouldPay)}</strong></span>
                  <span>Totalt: <strong>${kr(me.totalToPay)}</strong></span>
                  <span>Kvar: <strong style="color:#16a34a;">${kr(me.remaining)}</strong></span>
                </div>
              </div>`;
            })
            .join('')}
        </div>`
      : '';

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:620px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.12);">

    <div style="background:linear-gradient(135deg,#4f46e5 0%,#7c3aed 100%);padding:28px 32px;color:#fff;">
      <h1 style="margin:0 0 4px;font-size:22px;font-weight:700;">Månadsberäkning</h1>
      <p style="margin:0;opacity:.85;font-size:14px;">${calcDate}</p>
    </div>

    <div style="padding:24px 32px;">
      <p style="font-size:16px;color:#374151;margin:0 0 20px;">Hej <strong>${recipientName}</strong>! Här är din sammanfattning för månaden.</p>

      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:18px 20px;margin-bottom:20px;">
        <h2 style="margin:0 0 12px;font-size:16px;color:#166534;">Din sammanfattning</h2>
        <div style="display:flex;justify-content:space-between;margin-bottom:6px;font-size:14px;">
          <span style="color:#6b7280;">Andel gemensamma utgifter</span>
          <strong style="color:#4f46e5;">${kr(myShared)}</strong>
        </div>
        ${
          myIndivBills.length > 0
            ? `<div style="display:flex;justify-content:space-between;margin-bottom:4px;font-size:14px;">
            <span style="color:#6b7280;">Egna räkningar</span>
            <strong>${kr(myIndivTotal)}</strong>
          </div>`
            : ''
        }
        ${indivSection}
        <div style="display:flex;justify-content:space-between;padding-top:10px;border-top:1px solid #bbf7d0;margin-top:10px;">
          <strong style="color:#166534;font-size:15px;">Totalt att betala</strong>
          <strong style="color:#166534;font-size:18px;">${kr(myTotalToPay)}</strong>
        </div>
        <div style="display:flex;justify-content:space-between;margin-top:6px;font-size:13px;">
          <span style="color:#6b7280;">Kvar efter gemensam delning</span>
          <span>${kr(result.targetRemainingBalance)}</span>
        </div>
        <div style="display:flex;justify-content:space-between;font-size:14px;font-weight:600;margin-top:2px;">
          <span style="color:#374151;">Kvar totalt (inkl. egna räkn.)</span>
          <span style="color:#16a34a;">${kr(myRemaining)}</span>
        </div>
      </div>

      ${transfersSection}

      <h3 style="margin:20px 0 10px;font-size:15px;color:#374151;">Alla deltagare</h3>
      <div style="overflow-x:auto;">
        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          <thead>
            <tr style="background:#f9fafb;">
              <th style="padding:8px 12px;text-align:left;color:#6b7280;font-weight:600;border-bottom:2px solid #e5e7eb;">Person</th>
              <th style="padding:8px 12px;text-align:right;color:#6b7280;font-weight:600;border-bottom:2px solid #e5e7eb;">Inkomst</th>
              <th style="padding:8px 12px;text-align:right;color:#6b7280;font-weight:600;border-bottom:2px solid #e5e7eb;">Andel gem.</th>
              <th style="padding:8px 12px;text-align:right;color:#6b7280;font-weight:600;border-bottom:2px solid #e5e7eb;">Egna räkn.</th>
              <th style="padding:8px 12px;text-align:right;color:#6b7280;font-weight:600;border-bottom:2px solid #e5e7eb;">Totalt</th>
              <th style="padding:8px 12px;text-align:right;color:#6b7280;font-weight:600;border-bottom:2px solid #e5e7eb;">Kvar</th>
            </tr>
          </thead>
          <tbody>${personRows}</tbody>
        </table>
      </div>

      ${historySection}
    </div>

    <div style="background:#f9fafb;padding:16px 32px;text-align:center;border-top:1px solid #e5e7eb;">
      <p style="margin:0;font-size:12px;color:#9ca3af;">BillSplitter &middot; Automatisk månadssammanfattning</p>
    </div>
  </div>
</body>
</html>`;
}

router.post('/calculation', authenticateUser, async (req: AuthRequest, res) => {
  try {
    if (!req.user?.uid) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { calcId } = req.body as { calcId: string };
    if (!calcId) {
      return res.status(400).json({ error: 'calcId is required' });
    }

    const calcDoc = await db.collection('calculations').doc(calcId).get();
    if (!calcDoc.exists) {
      return res.status(404).json({ error: 'Calculation not found' });
    }
    const calc = calcDoc.data()!;

    const contributors: Array<{ name: string; income: number }> = calc.contributors || [];
    const bills: Bill[] = (calc.bills || []).map((b: any) => ({
      name: b.name || '',
      amount: b.amount || 0,
      isShared: b.isShared !== false,
      ...(b.payer ? { payer: b.payer } : {}),
    }));

    const incomes: Record<string, number> = {};
    contributors.forEach(c => {
      if (c.name && c.income > 0) incomes[c.name] = c.income;
    });

    if (Object.keys(incomes).length === 0) {
      return res.status(400).json({ error: 'No valid contributors in calculation' });
    }

    const result = calculateExpenditure(incomes, bills);

    // Build name → email map from household members or requesting user
    const emailMap: Record<string, string> = {};

    if (calc.householdId) {
      const householdDoc = await db.collection('households').doc(calc.householdId).get();
      if (householdDoc.exists) {
        const memberIds = Object.keys(householdDoc.data()?.members || {});
        await Promise.all(
          memberIds.map(async uid => {
            const userDoc = await db.collection('users').doc(uid).get();
            if (userDoc.exists) {
              const u = userDoc.data()!;
              if (u.name && u.email) emailMap[u.name] = u.email;
            }
          })
        );
      }
    }

    // Always ensure the requesting user is included
    const requestingUserDoc = await db.collection('users').doc(req.user.uid).get();
    if (requestingUserDoc.exists) {
      const u = requestingUserDoc.data()!;
      if (u.name && u.email && !emailMap[u.name]) emailMap[u.name] = u.email;
    }

    // Fetch last 3 prior calculations for historical context
    const historySnap = calc.householdId
      ? await db
          .collection('calculations')
          .where('householdId', '==', calc.householdId)
          .orderBy('createdAt', 'desc')
          .limit(4)
          .get()
      : await db
          .collection('calculations')
          .where('userId', '==', req.user.uid)
          .orderBy('createdAt', 'desc')
          .limit(4)
          .get();

    const recentHistory = historySnap.docs
      .filter(d => d.id !== calcId)
      .slice(0, 3)
      .map(d => {
        const h = d.data();
        const hContributors: Array<{ name: string; income: number }> = h.contributors || [];
        const hBills: Bill[] = (h.bills || []).map((b: any) => ({
          name: b.name || '',
          amount: b.amount || 0,
          isShared: b.isShared !== false,
          ...(b.payer ? { payer: b.payer } : {}),
        }));
        const hIncomes: Record<string, number> = {};
        hContributors.forEach(c => {
          if (c.name && c.income > 0) hIncomes[c.name] = c.income;
        });
        if (Object.keys(hIncomes).length === 0) return null;

        const hResult = calculateExpenditure(hIncomes, hBills);
        const sharedTotal = hBills
          .filter(b => b.isShared)
          .reduce((s, b) => s + b.amount, 0);
        const dateStr =
          typeof h.createdAt === 'string'
            ? new Date(h.createdAt).toLocaleDateString('sv-SE', {
                year: 'numeric',
                month: 'long',
              })
            : '';

        return {
          date: dateStr,
          sharedTotal,
          contributors: hContributors.map(c => {
            const shared = hResult.contributions[c.name] || 0;
            const indiv = (hResult.individualBills[c.name] || []).reduce(
              (s, b) => s + b.amount,
              0
            );
            return {
              name: c.name,
              shouldPay: shared,
              totalToPay: shared + indiv,
              remaining: hResult.targetRemainingBalance - indiv,
            };
          }),
        };
      })
      .filter((h): h is NonNullable<typeof h> => h !== null);

    const calcDate =
      typeof calc.createdAt === 'string'
        ? new Date(calc.createdAt).toLocaleDateString('sv-SE', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })
        : new Date().toLocaleDateString('sv-SE', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          });

    const sent: string[] = [];
    const skipped: string[] = [];

    for (const contributor of contributors) {
      const email = findEmail(contributor.name, emailMap);
      if (!email) {
        skipped.push(contributor.name);
        continue;
      }

      const html = buildCalculationEmail(
        contributor.name,
        contributors,
        result,
        calcDate,
        recentHistory
      );

      const emailResult = await EmailService.send({
        to: email,
        subject: `BillSplitter – Månadssammanfattning ${calcDate}`,
        html,
      });

      if (emailResult.delivered) {
        sent.push(contributor.name);
      } else {
        skipped.push(`${contributor.name} (${emailResult.reason})`);
      }
    }

    return res.json({ sent, skipped });
  } catch (error) {
    console.error('[notifications] Error:', error);
    return res.status(500).json({ error: 'Failed to send notifications' });
  }
});

export default router;
