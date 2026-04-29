import { db, admin } from '../config/firebase';
import { CreateInviteData, Invite } from '../models/invite';
import { HouseholdService } from './household.service';
import { EmailService } from './email.service';

const INVITE_CODE_LENGTH = 8;
const INVITE_CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I to avoid confusion
const DEFAULT_EXPIRY_DAYS = 7;

export interface RedeemInviteSuccess {
  status: 'redeemed';
  invite: Invite;
  householdId: string;
}

export type RedeemInviteResult =
  | RedeemInviteSuccess
  | { status: 'not-found' }
  | { status: 'expired' }
  | { status: 'already-used' }
  | { status: 'revoked' };

export class InviteService {
  private static generateCode(): string {
    let code = '';
    for (let i = 0; i < INVITE_CODE_LENGTH; i++) {
      code += INVITE_CODE_CHARS.charAt(Math.floor(Math.random() * INVITE_CODE_CHARS.length));
    }
    return code;
  }

  private static async generateUniqueCode(): Promise<string> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = this.generateCode();
      const existing = await db
        .collection('invites')
        .where('code', '==', candidate)
        .limit(1)
        .get();
      if (existing.empty) {
        return candidate;
      }
    }
    // Fallback: append timestamp suffix to guarantee uniqueness
    return `${this.generateCode()}${Date.now().toString(36).slice(-3).toUpperCase()}`;
  }

  static async createInvite(
    data: CreateInviteData
  ): Promise<{ invite: Invite; emailDelivered: boolean; emailReason?: string }> {
    const household = await HouseholdService.getHousehold(data.householdId);
    if (!household) {
      throw new Error('Household not found');
    }

    const now = admin.firestore.Timestamp.now();
    const expiresMs = now.toMillis() + DEFAULT_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
    const expiresAt = admin.firestore.Timestamp.fromMillis(expiresMs);

    const code = await this.generateUniqueCode();

    const invitePayload: Omit<Invite, 'id'> = {
      householdId: household.id,
      householdName: household.name,
      code,
      email: data.email.trim().toLowerCase(),
      invitedBy: data.invitedBy,
      invitedByName: data.invitedByName,
      expiresAt,
      usedAt: null,
      usedBy: null,
      revokedAt: null,
      createdAt: now,
    };

    const docRef = await db.collection('invites').add(invitePayload);
    const invite: Invite = { id: docRef.id, ...invitePayload };

    const appBaseUrl = process.env.APP_BASE_URL || 'https://billsplitter-v2.web.app';
    const redeemUrl = `${appBaseUrl}/dashboard?inviteCode=${encodeURIComponent(code)}`;

    const emailHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Invitation to join ${escapeHtml(household.name)}</title>
      </head>
      <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f9fafb; color: #111827;">
        <div style="max-width: 600px; margin: 40px auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
          <!-- Header -->
          <div style="background: linear-gradient(135deg, #6366f1 0%, #4f46e5 100%); padding: 32px 24px; text-align: center;">
            <div style="font-size: 24px; font-weight: 700; color: #ffffff; margin: 0; letter-spacing: -0.5px;">BillSplitter</div>
            <div style="font-size: 13px; color: rgba(255,255,255,0.8); margin-top: 4px;">Squareverse Group</div>
          </div>

          <!-- Content -->
          <div style="padding: 32px 24px;">
            <h1 style="margin: 0 0 16px; font-size: 20px; font-weight: 600; color: #111827;">
              ${escapeHtml(invite.invitedByName || 'A member')} invited you to join "${escapeHtml(household.name)}"
            </h1>
            <p style="margin: 0 0 24px; font-size: 15px; line-height: 1.6; color: #4b5563;">
              You've been invited to a shared household on BillSplitter. Enter the code below on your dashboard to join.
              This invitation expires in ${DEFAULT_EXPIRY_DAYS} days and can only be used once.
            </p>

            <!-- Code box -->
            <div style="background: linear-gradient(135deg, #f3f4f6 0%, #e5e7eb 100%); border: 1px solid #d1d5db; border-radius: 12px; padding: 24px; text-align: center; margin-bottom: 24px;">
              <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; color: #6b7280; margin-bottom: 10px; font-weight: 600;">Your invite code</div>
              <div style="font-size: 32px; font-weight: 800; letter-spacing: 6px; color: #111827; font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace;">${escapeHtml(code)}</div>
              <div style="font-size: 12px; color: #6b7280; margin-top: 12px;">Valid for ${DEFAULT_EXPIRY_DAYS} days • Single use</div>
            </div>

            <!-- CTA -->
            <div style="text-align: center; margin-bottom: 24px;">
              <a href="${redeemUrl}" style="background: #4f46e5; color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 10px; font-weight: 600; font-size: 15px; display: inline-block; box-shadow: 0 2px 4px rgba(79, 70, 229, 0.2);">Open BillSplitter</a>
            </div>

            <!-- Divider -->
            <div style="height: 1px; background: #e5e7eb; margin: 24px 0;"></div>

            <!-- Footer note -->
            <p style="margin: 0; font-size: 13px; line-height: 1.5; color: #6b7280;">
              If you didn't expect this invitation, you can ignore this email. The code will expire automatically.
            </p>
          </div>

          <!-- Footer -->
          <div style="background: #f9fafb; padding: 20px 24px; text-align: center; border-top: 1px solid #e5e7eb;">
            <div style="font-size: 12px; color: #9ca3af;">
              Sent by <span style="color: #4f46e5; font-weight: 500;">BillSplitter</span> • Squareverse Group
            </div>
          </div>
        </div>
      </body>
      </html>
    `;

    const emailText = [
      `${invite.invitedByName || 'A member'} invited you to join "${household.name}" on BillSplitter.`,
      '',
      `Invite code: ${code}`,
      `Link: ${redeemUrl}`,
      '',
      `This invitation expires in ${DEFAULT_EXPIRY_DAYS} days and can only be used once.`,
    ].join('\n');

    const emailResult = await EmailService.send({
      to: invite.email,
      subject: `You've been invited to "${household.name}" on BillSplitter`,
      html: emailHtml,
      text: emailText,
    });

    return {
      invite,
      emailDelivered: emailResult.delivered,
      emailReason: emailResult.reason,
    };
  }

  static async listInvitesForHousehold(householdId: string): Promise<Invite[]> {
    const snapshot = await db
      .collection('invites')
      .where('householdId', '==', householdId)
      .get();

    return snapshot.docs
      .map((doc) => ({ id: doc.id, ...doc.data() } as Invite))
      .sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis());
  }

  static async revokeInvite(inviteId: string): Promise<boolean> {
    const docRef = db.collection('invites').doc(inviteId);
    const doc = await docRef.get();
    if (!doc.exists) {
      return false;
    }

    await docRef.update({
      revokedAt: admin.firestore.Timestamp.now(),
    });
    return true;
  }

  static async redeemInvite(
    code: string,
    userId: string,
    userName: string
  ): Promise<RedeemInviteResult> {
    const trimmed = code.trim().toUpperCase();
    const snapshot = await db
      .collection('invites')
      .where('code', '==', trimmed)
      .limit(1)
      .get();

    if (snapshot.empty) {
      return { status: 'not-found' };
    }

    const inviteDoc = snapshot.docs[0];
    const invite = { id: inviteDoc.id, ...inviteDoc.data() } as Invite;

    if (invite.revokedAt) {
      return { status: 'revoked' };
    }

    if (invite.usedAt) {
      return { status: 'already-used' };
    }

    const nowMs = Date.now();
    if (invite.expiresAt && invite.expiresAt.toMillis() < nowMs) {
      return { status: 'expired' };
    }

    await HouseholdService.joinHousehold(invite.householdId, userId, userName);

    await inviteDoc.ref.update({
      usedAt: admin.firestore.Timestamp.now(),
      usedBy: userId,
    });

    const updated: Invite = {
      ...invite,
      usedAt: admin.firestore.Timestamp.now(),
      usedBy: userId,
    };

    return { status: 'redeemed', invite: updated, householdId: invite.householdId };
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
