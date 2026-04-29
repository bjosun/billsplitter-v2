interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

interface SendEmailResult {
  delivered: boolean;
  reason?: string;
  providerId?: string;
}

const DEFAULT_FROM = 'BillSplitter <onboarding@resend.dev>';

export class EmailService {
  static isConfigured(): boolean {
    return Boolean(process.env.RESEND_API_KEY);
  }

  static async send(params: SendEmailParams): Promise<SendEmailResult> {
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      console.warn('[EmailService] RESEND_API_KEY not configured. Skipping email delivery.', {
        to: params.to,
        subject: params.subject,
      });
      return { delivered: false, reason: 'RESEND_API_KEY not set' };
    }

    const from = process.env.RESEND_FROM_EMAIL || DEFAULT_FROM;

    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          from,
          to: params.to,
          subject: params.subject,
          html: params.html,
          text: params.text,
        }),
      });

      const body = (await response.json().catch(() => ({}))) as { message?: string; id?: string };

      if (!response.ok) {
        console.error('[EmailService] Resend error:', body);
        return {
          delivered: false,
          reason: body.message || `Resend HTTP ${response.status}`,
        };
      }

      return { delivered: true, providerId: body.id };
    } catch (error) {
      console.error('[EmailService] Failed to send email:', error);
      return { delivered: false, reason: (error as Error).message };
    }
  }
}
