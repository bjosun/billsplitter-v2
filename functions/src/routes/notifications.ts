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

  const ROW = (label: string, value: string, opts: { labelColor?: string; valueColor?: string; bold?: boolean; large?: boolean; topBorder?: string } = {}) =>
    `<tr>
      <td style="padding:10px 0;border-top:${opts.topBorder || 'none'};font-size:14px;line-height:1.5;color:${opts.labelColor || '#6b7280'};">${label}</td>
      <td style="padding:10px 0;border-top:${opts.topBorder || 'none'};font-size:${opts.large ? '17px' : '14px'};line-height:1.5;text-align:right;color:${opts.valueColor || '#111827'};font-weight:${opts.bold ? '700' : '400'};">${value}</td>
    </tr>`;

  const personRows = contributors
    .map(c => {
      const shared = result.contributions[c.name] || 0;
      const indiv = (result.individualBills[c.name] || []).reduce((s, b) => s + b.amount, 0);
      const total = shared + indiv;
      const remaining = result.targetRemainingBalance - indiv;
      const isMe = c.name === recipientName;
      const bg = isMe ? 'background:#f0f4ff;' : '';
      const fw = isMe ? 'font-weight:700;' : '';
      return `<tr style="${bg}">
        <td style="padding:11px 14px;border-bottom:1px solid #e5e7eb;font-size:14px;line-height:1.5;${fw}">${c.name}${isMe ? ' <span style="font-size:11px;background:#c7d2fe;color:#3730a3;padding:1px 6px;border-radius:10px;font-weight:600;">Du</span>' : ''}</td>
        <td style="padding:11px 14px;border-bottom:1px solid #e5e7eb;font-size:13px;line-height:1.5;text-align:right;color:#6b7280;">${kr(c.income)}</td>
        <td style="padding:11px 14px;border-bottom:1px solid #e5e7eb;font-size:13px;line-height:1.5;text-align:right;color:#4f46e5;">${kr(shared)}</td>
        <td style="padding:11px 14px;border-bottom:1px solid #e5e7eb;font-size:13px;line-height:1.5;text-align:right;color:#6b7280;">${indiv > 0 ? kr(indiv) : '&mdash;'}</td>
        <td style="padding:11px 14px;border-bottom:1px solid #e5e7eb;font-size:13px;line-height:1.5;text-align:right;font-weight:700;">${kr(total)}</td>
        <td style="padding:11px 14px;border-bottom:1px solid #e5e7eb;font-size:13px;line-height:1.5;text-align:right;color:#16a34a;font-weight:600;">${kr(remaining)}</td>
      </tr>`;
    })
    .join('');

  const indivSection =
    myIndivBills.length > 0
      ? `<tr><td colspan="2" style="padding:6px 0 0;">
          <p style="margin:0 0 6px;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:#9ca3af;">Specifikation – egna räkningar</p>
          <table style="width:100%;border-collapse:collapse;">
            ${myIndivBills.map(b =>
              `<tr>
                <td style="padding:5px 0;font-size:13px;line-height:1.5;color:#6b7280;">${b.name}</td>
                <td style="padding:5px 0;font-size:13px;line-height:1.5;text-align:right;color:#374151;">${kr(b.amount)}</td>
              </tr>`).join('')}
          </table>
        </td></tr>`
      : '';

  const transfersSection =
    result.transfers.length > 0
      ? `<div style="background:#f5f3ff;border:1px solid #e0e7ff;border-radius:10px;padding:20px 22px;margin-top:24px;">
          <p style="margin:0 0 14px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#6d28d9;">Överföringar som behövs</p>
          <table style="width:100%;border-collapse:collapse;">
            ${result.transfers.map(t => {
              const isFrom = t.from === recipientName;
              const isTo = t.to === recipientName;
              const color = isFrom ? '#dc2626' : isTo ? '#16a34a' : '#374151';
              const badge = isFrom
                ? '<span style="font-size:11px;background:#fee2e2;color:#dc2626;padding:2px 7px;border-radius:10px;margin-left:6px;">du betalar</span>'
                : isTo
                ? '<span style="font-size:11px;background:#dcfce7;color:#16a34a;padding:2px 7px;border-radius:10px;margin-left:6px;">du tar emot</span>'
                : '';
              return `<tr>
                <td style="padding:9px 0;border-bottom:1px solid #e0e7ff;font-size:14px;line-height:1.6;color:${color};">${t.from} &rarr; ${t.to}${badge}</td>
                <td style="padding:9px 0;border-bottom:1px solid #e0e7ff;font-size:14px;line-height:1.6;text-align:right;font-weight:700;color:${color};">${kr(t.amount)}</td>
              </tr>`;
            }).join('')}
          </table>
        </div>`
      : '';

  const historySection =
    recentHistory.length > 0
      ? `<div style="margin-top:32px;padding-top:24px;border-top:2px solid #f3f4f6;">
          <p style="margin:0 0 16px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#9ca3af;">Tidigare månader</p>
          ${recentHistory.map(h => {
            const me = h.contributors.find(c => c.name === recipientName);
            if (!me) return '';
            return `<div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:14px 16px;margin-bottom:10px;">
              <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:10px;">
                <span style="font-size:14px;font-weight:600;color:#374151;">${h.date}</span>
                <span style="font-size:12px;color:#9ca3af;">Gemensamt: ${kr(h.sharedTotal)}</span>
              </div>
              <table style="width:100%;border-collapse:collapse;">
                <tr>
                  <td style="font-size:13px;line-height:1.6;color:#6b7280;padding:0 0 2px;">Din andel gemensamt</td>
                  <td style="font-size:13px;line-height:1.6;text-align:right;color:#4f46e5;font-weight:600;padding:0 0 2px;">${kr(me.shouldPay)}</td>
                </tr>
                <tr>
                  <td style="font-size:13px;line-height:1.6;color:#6b7280;padding:2px 0;">Totalt att betala</td>
                  <td style="font-size:13px;line-height:1.6;text-align:right;font-weight:700;padding:2px 0;">${kr(me.totalToPay)}</td>
                </tr>
                <tr>
                  <td style="font-size:13px;line-height:1.6;color:#6b7280;padding:2px 0 0;border-top:1px solid #e5e7eb;">Kvar totalt</td>
                  <td style="font-size:13px;line-height:1.6;text-align:right;font-weight:700;color:#16a34a;padding:2px 0 0;border-top:1px solid #e5e7eb;">${kr(me.remaining)}</td>
                </tr>
              </table>
            </div>`;
          }).join('')}
        </div>`
      : '';

  return `<!DOCTYPE html>
<html lang="sv">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>BillSplitter – Månadssammanfattning</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased;">
  <div style="max-width:620px;margin:40px auto 24px;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.10);">

    <!-- Header -->
    <div style="background:linear-gradient(135deg,#4f46e5 0%,#7c3aed 100%);padding:32px 36px 28px;">
      <p style="margin:0 0 4px;font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:rgba(255,255,255,.65);">BillSplitter</p>
      <h1 style="margin:0 0 6px;font-size:24px;font-weight:700;color:#ffffff;line-height:1.3;">Månadsberäkning</h1>
      <p style="margin:0;font-size:14px;color:rgba(255,255,255,.80);line-height:1.5;">${calcDate}</p>
    </div>

    <!-- Body -->
    <div style="padding:32px 36px;">
      <p style="margin:0 0 28px;font-size:16px;line-height:1.6;color:#374151;">Hej <strong style="color:#111827;">${recipientName}</strong>,<br>här är din ekonomiska sammanfattning för månaden.</p>

      <!-- Personal summary card -->
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:22px 24px;margin-bottom:28px;">
        <p style="margin:0 0 16px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#166534;">Din sammanfattning</p>
        <table style="width:100%;border-collapse:collapse;">
          ${ROW('Andel gemensamma utgifter', kr(myShared), { valueColor: '#4f46e5', bold: true })}
          ${myIndivBills.length > 0 ? ROW('Egna räkningar', kr(myIndivTotal)) : ''}
          ${indivSection}
          ${ROW('Totalt att betala', kr(myTotalToPay), { topBorder: '2px solid #bbf7d0', labelColor: '#166534', valueColor: '#166534', bold: true, large: true })}
          ${ROW('Kvar efter gemensam delning', kr(result.targetRemainingBalance), { labelColor: '#6b7280', valueColor: '#374151' })}
          ${ROW('Kvar totalt (inkl. egna räkn.)', kr(myRemaining), { labelColor: '#374151', valueColor: '#16a34a', bold: true })}
        </table>
      </div>

      ${transfersSection}

      <!-- All participants table -->
      <p style="margin:${result.transfers.length > 0 ? '28px' : '0'} 0 12px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#9ca3af;">Alla deltagare</p>
      <div style="overflow-x:auto;border:1px solid #e5e7eb;border-radius:10px;">
        <table style="width:100%;border-collapse:collapse;font-size:13px;min-width:420px;">
          <thead>
            <tr style="background:#f9fafb;">
              <th style="padding:11px 14px;text-align:left;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#9ca3af;border-bottom:1px solid #e5e7eb;">Person</th>
              <th style="padding:11px 14px;text-align:right;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#9ca3af;border-bottom:1px solid #e5e7eb;">Inkomst</th>
              <th style="padding:11px 14px;text-align:right;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#9ca3af;border-bottom:1px solid #e5e7eb;">Andel gem.</th>
              <th style="padding:11px 14px;text-align:right;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#9ca3af;border-bottom:1px solid #e5e7eb;">Egna</th>
              <th style="padding:11px 14px;text-align:right;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#9ca3af;border-bottom:1px solid #e5e7eb;">Totalt</th>
              <th style="padding:11px 14px;text-align:right;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#9ca3af;border-bottom:1px solid #e5e7eb;">Kvar</th>
            </tr>
          </thead>
          <tbody>${personRows}</tbody>
        </table>
      </div>

      ${historySection}
    </div>

    <!-- Footer -->
    <div style="background:#f9fafb;padding:18px 36px;text-align:center;border-top:1px solid #e5e7eb;">
      <p style="margin:0;font-size:12px;line-height:1.6;color:#9ca3af;">BillSplitter &middot; Automatisk månadssammanfattning<br>Du får det här mejlet för att du är medlem i ett delat hushåll.</p>
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
