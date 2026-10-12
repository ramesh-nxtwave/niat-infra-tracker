import { logger } from "./logger";
import type { ReportData } from "./reportGenerator";

const REPORT_RECIPIENTS = [
  "gvriteeshreddy02@gmail.com",
];

const FROM_EMAIL = "onboarding@resend.dev";
const FROM_NAME = "NIAT InfraTracker";

function statusColor(val: number): string {
  if (val >= 75) return "#10b981";
  if (val >= 40) return "#f59e0b";
  return "#ef4444";
}

function statusBadge(val: number): string {
  if (val >= 75) return `<span style="background:#d1fae5;color:#065f46;padding:2px 8px;border-radius:99px;font-size:11px;font-weight:700;">✓ On Track</span>`;
  if (val >= 40) return `<span style="background:#fef3c7;color:#92400e;padding:2px 8px;border-radius:99px;font-size:11px;font-weight:700;">● In Progress</span>`;
  return `<span style="background:#fee2e2;color:#991b1b;padding:2px 8px;border-radius:99px;font-size:11px;font-weight:700;">! Needs Attention</span>`;
}

function buildHtmlEmail(data: ReportData, aiInsights: string): string {
  const reportDate = new Date(data.generatedAt).toLocaleDateString("en-IN", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });

  const insightBullets = aiInsights
    .split("\n")
    .filter(l => l.trim().startsWith("•"))
    .map(l => `<li style="margin-bottom:8px;color:#374151;">${l.replace("•", "").trim()}</li>`)
    .join("");

  const delayedRows = data.delayedUniversities.slice(0, 8).map(u => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${u.name}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${u.targetDate}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#ef4444;font-weight:700;">${u.daysOverdue}d overdue</td>
    </tr>`).join("");

  const notAllocatedItems = data.notAllocatedList.length > 0
    ? data.notAllocatedList.map(n => `<li style="color:#374151;margin-bottom:4px;">${n}</li>`).join("")
    : `<li style="color:#6b7280;font-style:italic;">All universities have APMs assigned</li>`;

  const zoneRows = data.zoneBreakdown.map(z => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${z.zone}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center;">${z.count}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center;font-weight:700;color:${statusColor(z.avgReadiness)};">${z.avgReadiness}%</td>
    </tr>`).join("");

  const lowReadinessRows = data.readinessBelow30.map(u => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${u.name}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;color:#ef4444;font-weight:700;">${u.readiness}%</td>
    </tr>`).join("");

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 16px;">
    <tr><td align="center">
      <table width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;">

        <!-- Header -->
        <tr><td style="background:linear-gradient(135deg,#1e3a5f 0%,#2563eb 100%);border-radius:16px 16px 0 0;padding:32px 36px;">
          <table width="100%"><tr>
            <td>
              <div style="font-size:11px;color:#93c5fd;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:6px;">NIAT InfraTracker</div>
              <div style="font-size:24px;font-weight:800;color:#ffffff;">Infra Tracker — Automated Status Report</div>
              <div style="font-size:13px;color:#bfdbfe;margin-top:6px;">${reportDate}</div>
            </td>
            <td align="right">
              <div style="background:rgba(255,255,255,0.15);border-radius:12px;padding:12px 20px;text-align:center;">
                <div style="font-size:36px;font-weight:900;color:#ffffff;">${data.overallReadiness}%</div>
                <div style="font-size:11px;color:#bfdbfe;font-weight:600;">Avg Readiness</div>
              </div>
            </td>
          </tr></table>
        </td></tr>

        <!-- AI Insights -->
        <tr><td style="background:#fffbeb;border-left:4px solid #f59e0b;padding:20px 28px;">
          <div style="font-size:12px;font-weight:800;color:#92400e;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:10px;">🤖 AI-Generated Key Observations</div>
          <ul style="margin:0;padding-left:18px;">${insightBullets || `<li style="color:#374151;">${aiInsights}</li>`}</ul>
        </td></tr>

        <!-- Main content bg -->
        <tr><td style="background:#ffffff;padding:28px 36px;">

          <!-- Summary stats -->
          <div style="font-size:14px;font-weight:800;color:#111827;margin-bottom:16px;text-transform:uppercase;letter-spacing:0.06em;">1. Overall Summary</div>
          <table width="100%" cellpadding="0" cellspacing="8" style="margin-bottom:28px;">
            <tr>
              <td width="25%" style="background:#eff6ff;border-radius:10px;padding:14px;text-align:center;">
                <div style="font-size:28px;font-weight:900;color:#2563eb;">${data.totalUniversities}</div>
                <div style="font-size:11px;color:#6b7280;font-weight:600;">Total Universities</div>
              </td>
              <td width="25%" style="background:#f0fdf4;border-radius:10px;padding:14px;text-align:center;">
                <div style="font-size:28px;font-weight:900;color:#10b981;">${data.allocated}</div>
                <div style="font-size:11px;color:#6b7280;font-weight:600;">Allocated (APM)</div>
              </td>
              <td width="25%" style="background:#fff7ed;border-radius:10px;padding:14px;text-align:center;">
                <div style="font-size:28px;font-weight:900;color:#f59e0b;">${data.notAllocated}</div>
                <div style="font-size:11px;color:#6b7280;font-weight:600;">Not Allocated</div>
              </td>
              <td width="25%" style="background:#fef2f2;border-radius:10px;padding:14px;text-align:center;">
                <div style="font-size:28px;font-weight:900;color:#ef4444;">${data.pendingActionItems}</div>
                <div style="font-size:11px;color:#6b7280;font-weight:600;">Pending Actions</div>
              </td>
            </tr>
          </table>

          <!-- Allocation Status -->
          <div style="font-size:14px;font-weight:800;color:#111827;margin-bottom:12px;text-transform:uppercase;letter-spacing:0.06em;">2. Allocation Status</div>
          <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;margin-bottom:12px;">
            <tr style="background:#f9fafb;">
              <td style="padding:10px 16px;font-size:12px;font-weight:700;color:#6b7280;text-transform:uppercase;">Status</td>
              <td style="padding:10px 16px;font-size:12px;font-weight:700;color:#6b7280;text-transform:uppercase;text-align:center;">Count</td>
            </tr>
            <tr>
              <td style="padding:10px 16px;border-top:1px solid #e5e7eb;">✅ Allocated (APM Assigned)</td>
              <td style="padding:10px 16px;border-top:1px solid #e5e7eb;text-align:center;font-weight:700;color:#10b981;">${data.allocated}</td>
            </tr>
            <tr style="background:#fef2f2;">
              <td style="padding:10px 16px;border-top:1px solid #e5e7eb;">❌ Not Allocated</td>
              <td style="padding:10px 16px;border-top:1px solid #e5e7eb;text-align:center;font-weight:700;color:#ef4444;">${data.notAllocated}</td>
            </tr>
          </table>
          ${data.notAllocatedList.length > 0 ? `
          <div style="background:#fef2f2;border-radius:8px;padding:14px 18px;margin-bottom:28px;">
            <div style="font-size:12px;font-weight:700;color:#991b1b;margin-bottom:8px;">Unallocated Universities:</div>
            <ul style="margin:0;padding-left:16px;">${notAllocatedItems}</ul>
          </div>` : `<div style="margin-bottom:28px;"></div>`}

          <!-- Space Readiness -->
          <div style="font-size:14px;font-weight:800;color:#111827;margin-bottom:12px;text-transform:uppercase;letter-spacing:0.06em;">3. Space Readiness</div>
          <table width="100%" cellpadding="6" cellspacing="0" style="margin-bottom:28px;">
            ${[
              ["Model Classroom", data.spaceReadiness.modelClassroom],
              ["5.0 Lab", data.spaceReadiness.lab5],
              ["Staff Room", data.spaceReadiness.staffRoom],
              ["All Classrooms", data.spaceReadiness.allClassrooms],
            ].map(([label, val]) => `
            <tr>
              <td width="40%" style="padding:8px 0;font-size:13px;color:#374151;">${label}</td>
              <td style="padding:8px 0;">
                <div style="background:#e5e7eb;border-radius:4px;height:8px;width:100%;">
                  <div style="background:${statusColor(val as number)};height:8px;border-radius:4px;width:${val}%;"></div>
                </div>
              </td>
              <td width="15%" style="padding:8px 0;text-align:right;font-weight:800;color:${statusColor(val as number)};">${val}%</td>
              <td width="25%" style="padding:8px 0;text-align:right;">${statusBadge(val as number)}</td>
            </tr>`).join("")}
          </table>

          <!-- Timeline Summary -->
          <div style="font-size:14px;font-weight:800;color:#111827;margin-bottom:12px;text-transform:uppercase;letter-spacing:0.06em;">4. Model Classroom Timeline Status</div>
          <table width="100%" cellpadding="0" cellspacing="6" style="margin-bottom:${data.delayedUniversities.length > 0 ? '16' : '28'}px;">
            <tr>
              <td width="25%" style="background:#f0fdf4;border-radius:8px;padding:12px;text-align:center;">
                <div style="font-size:22px;font-weight:900;color:#10b981;">${data.timelineSummary.onTrack}</div>
                <div style="font-size:11px;color:#6b7280;">✓ On Track</div>
              </td>
              <td width="25%" style="background:#fef2f2;border-radius:8px;padding:12px;text-align:center;">
                <div style="font-size:22px;font-weight:900;color:#ef4444;">${data.timelineSummary.delayed}</div>
                <div style="font-size:11px;color:#6b7280;">! Delayed</div>
              </td>
              <td width="25%" style="background:#fffbeb;border-radius:8px;padding:12px;text-align:center;">
                <div style="font-size:22px;font-weight:900;color:#f59e0b;">${data.timelineSummary.missing}</div>
                <div style="font-size:11px;color:#6b7280;">⚠ Missing</div>
              </td>
              <td width="25%" style="background:#eff6ff;border-radius:8px;padding:12px;text-align:center;">
                <div style="font-size:22px;font-weight:900;color:#2563eb;">${data.timelineSummary.completed}</div>
                <div style="font-size:11px;color:#6b7280;">✅ Completed</div>
              </td>
            </tr>
          </table>

          ${data.delayedUniversities.length > 0 ? `
          <!-- Critical Delays -->
          <div style="font-size:14px;font-weight:800;color:#111827;margin-bottom:12px;text-transform:uppercase;letter-spacing:0.06em;">5. Critical Delays</div>
          <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #fecaca;border-radius:8px;overflow:hidden;margin-bottom:28px;">
            <tr style="background:#fef2f2;">
              <td style="padding:10px 12px;font-size:12px;font-weight:700;color:#6b7280;text-transform:uppercase;">University</td>
              <td style="padding:10px 12px;font-size:12px;font-weight:700;color:#6b7280;text-transform:uppercase;">Target Date</td>
              <td style="padding:10px 12px;font-size:12px;font-weight:700;color:#6b7280;text-transform:uppercase;">Status</td>
            </tr>
            ${delayedRows}
          </table>` : ""}

          ${data.readinessBelow30.length > 0 ? `
          <!-- Low Readiness -->
          <div style="font-size:14px;font-weight:800;color:#111827;margin-bottom:12px;text-transform:uppercase;letter-spacing:0.06em;">6. Critical Attention Required — Readiness &lt; 30%</div>
          <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #fecaca;border-radius:8px;overflow:hidden;margin-bottom:28px;">
            <tr style="background:#fef2f2;">
              <td style="padding:10px 12px;font-size:12px;font-weight:700;color:#6b7280;text-transform:uppercase;">University</td>
              <td style="padding:10px 12px;font-size:12px;font-weight:700;color:#6b7280;text-transform:uppercase;">Readiness</td>
            </tr>
            ${lowReadinessRows}
          </table>` : ""}

          <!-- Zone Breakdown -->
          ${data.zoneBreakdown.length > 0 ? `
          <div style="font-size:14px;font-weight:800;color:#111827;margin-bottom:12px;text-transform:uppercase;letter-spacing:0.06em;">Zone-wise Breakdown</div>
          <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;margin-bottom:28px;">
            <tr style="background:#f9fafb;">
              <td style="padding:10px 12px;font-size:12px;font-weight:700;color:#6b7280;text-transform:uppercase;">Zone</td>
              <td style="padding:10px 12px;font-size:12px;font-weight:700;color:#6b7280;text-transform:uppercase;text-align:center;">Universities</td>
              <td style="padding:10px 12px;font-size:12px;font-weight:700;color:#6b7280;text-transform:uppercase;text-align:center;">Avg Readiness</td>
            </tr>
            ${zoneRows}
          </table>` : ""}

        </td></tr>

        <!-- Footer -->
        <tr><td style="background:#1e3a5f;border-radius:0 0 16px 16px;padding:20px 36px;text-align:center;">
          <div style="font-size:12px;color:#93c5fd;margin-bottom:4px;">This is an automated report generated by NIAT InfraTracker every 3 days.</div>
          <div style="font-size:11px;color:#6b7280;">Next report in ~3 days • Generated at ${new Date(data.generatedAt).toLocaleString("en-IN")}</div>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function buildTextEmail(data: ReportData, aiInsights: string): string {
  const reportDate = new Date(data.generatedAt).toDateString();
  return `NIAT InfraTracker — Automated Status Report
${reportDate}
${"=".repeat(50)}

OVERALL SUMMARY
• Total Universities: ${data.totalUniversities}
• Overall Avg Readiness: ${data.overallReadiness}%
• Allocated (APM Assigned): ${data.allocated}
• Not Allocated: ${data.notAllocated}
• Pending Action Items: ${data.pendingActionItems}

AI KEY OBSERVATIONS
${aiInsights}

ALLOCATION STATUS
Allocated: ${data.allocated}
Not Allocated: ${data.notAllocated}
${data.notAllocatedList.length > 0 ? "Not Allocated Universities:\n" + data.notAllocatedList.map(n => `  - ${n}`).join("\n") : "All universities have APMs assigned."}

SPACE READINESS
Model Classroom: ${data.spaceReadiness.modelClassroom}%
5.0 Lab: ${data.spaceReadiness.lab5}%
Staff Room: ${data.spaceReadiness.staffRoom}%
All Classrooms: ${data.spaceReadiness.allClassrooms}%

TIMELINE SUMMARY
On Track: ${data.timelineSummary.onTrack}
Delayed: ${data.timelineSummary.delayed}
Missing: ${data.timelineSummary.missing}
Completed: ${data.timelineSummary.completed}
${data.delayedUniversities.length > 0 ? "\nDELAYED UNIVERSITIES:\n" + data.delayedUniversities.map(u => `  - ${u.name} (${u.daysOverdue}d overdue)`).join("\n") : ""}
${data.readinessBelow30.length > 0 ? "\nCRITICAL — READINESS < 30%:\n" + data.readinessBelow30.map(u => `  - ${u.name}: ${u.readiness}%`).join("\n") : ""}

This is an automated report sent every 3 days by NIAT InfraTracker.
`;
}

export async function sendReport(data: ReportData, aiInsights: string): Promise<void> {
  const htmlContent = buildHtmlEmail(data, aiInsights);
  const textContent = buildTextEmail(data, aiInsights);

  const reportDate = new Date(data.generatedAt).toLocaleDateString("en-IN", {
    day: "numeric", month: "short", year: "numeric",
  });

  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("RESEND_API_KEY environment variable is not set");

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `${FROM_NAME} <${FROM_EMAIL}>`,
      to: REPORT_RECIPIENTS,
      subject: `Infra Tracker – Allocation & Timeline Status Report (${reportDate})`,
      html: htmlContent,
      text: textContent,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Resend API error ${response.status}: ${err}`);
  }

  const result = await response.json() as { id?: string };
  logger.info({ emailId: result?.id, recipients: REPORT_RECIPIENTS }, "Report email sent successfully");
}
