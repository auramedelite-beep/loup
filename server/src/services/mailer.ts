import nodemailer from 'nodemailer';

const smtpHost = process.env.SMTP_HOST;
const smtpPort = Number(process.env.SMTP_PORT || 587);
const smtpUser = process.env.SMTP_USER;
const smtpPass = process.env.SMTP_PASS;
const mailFrom = process.env.MAIL_FROM || 'LOUP-GAROU DZ <no-reply@loupgarou.dz>';
const appUrl = process.env.APP_URL || 'http://localhost:5173';

export const mailerConfigured = Boolean(smtpHost && smtpUser && smtpPass);

const transporter = mailerConfigured
  ? nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465,
      auth: { user: smtpUser, pass: smtpPass },
    })
  : null;

export async function sendPasswordResetEmail(email: string, username: string, token: string): Promise<boolean> {
  const resetUrl = `${appUrl}/?reset=${encodeURIComponent(token)}`;
  if (!transporter) {
    console.log(`[mailer] SMTP not configured. Password reset for ${username}: ${resetUrl}`);
    return false;
  }
  await transporter.sendMail({
    from: mailFrom,
    to: email,
    subject: 'LOUP-GAROU DZ — إعادة تعيين كلمة المرور',
    text: `مرحباً ${username},\n\nلإعادة تعيين كلمة المرور الخاصة بك، افتح الرابط التالي خلال 30 دقيقة:\n${resetUrl}\n\nإذا لم تطلب ذلك، تجاهل هذه الرسالة.\n\nLOUP-GAROU DZ`,
    html: `<div style="font-family:system-ui;background:#0b0b10;color:#eee;padding:32px;border-radius:16px">
      <h2 style="color:#e0b96a">LOUP-GAROU DZ</h2>
      <p>مرحباً <b>${escapeHtml(username)}</b>,</p>
      <p>لإعادة تعيين كلمة المرور الخاصة بك، اضغط على الزر أدناه خلال 30 دقيقة.</p>
      <p><a href="${resetUrl}" style="display:inline-block;background:#8b1524;color:#fff;padding:12px 24px;border-radius:10px;text-decoration:none">إعادة تعيين كلمة المرور</a></p>
      <p style="color:#888;font-size:12px">إذا لم تطلب ذلك، تجاهل هذه الرسالة.</p>
    </div>`,
  });
  return true;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export { appUrl };
