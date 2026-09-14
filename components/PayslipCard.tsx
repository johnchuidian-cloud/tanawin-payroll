import { fmtDate, money } from '@/lib/format';
import type { Payslip, SheetDate } from '@/lib/types';

// Faithful HTML replica of the payslip Lexi has been sending for years
// (the left half of the workbook's `payslip` tab). Do not redesign.

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span>{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}

export default function PayslipCard({
  slip,
  periodStart,
  periodEnd,
}: {
  slip: Payslip;
  periodStart: SheetDate | null;
  periodEnd: SheetDate | null;
}) {
  return (
    <div
      className="bg-white text-neutral-800 italic w-[760px] shrink-0 p-8 text-[13px] leading-snug shadow-sm border border-neutral-200"
      style={{ fontFamily: "Candara, 'Segoe UI', Calibri, sans-serif" }}
    >
      {/* header */}
      <div>ASP Bed and Breakfast, Inc</div>
      <div className="font-bold">Payslip</div>
      <div>pay information is confidential, please inform Management of confidentiality violations</div>

      {/* info grid */}
      <div className="grid grid-cols-2 gap-x-10 mt-5">
        <div className="space-y-0.5">
          <div className="flex justify-between gap-2">
            <span>pay period</span>
            <span className="flex gap-8">
              <span>{fmtDate(periodStart)}</span>
              <span>{fmtDate(periodEnd)}</span>
            </span>
          </div>
          <Row label="employee name" value={slip.family} />
          <Row label="department" value={slip.department} />
          <Row label="total days in period" value={money(slip.daysInPeriod)} />
        </div>
        <div className="space-y-0.5">
          <Row label="daily rate" value={money(slip.dailyRate)} />
          <Row label="basic salary" value={money(slip.basicMonthly)} />
          <Row label="allowance" value={money(slip.allowanceMonthly)} />
          <Row label="total monthly compensation" value={money(slip.totalMonthlyComp)} />
          <Row label="benefits" value={slip.benefits || '-'} />
        </div>
      </div>

      {/* earnings / deductions boxes */}
      <div className="grid grid-cols-2 gap-x-2 mt-5">
        <div className="bg-[#d9d9d9] px-3 py-2 flex flex-col">
          <div className="font-semibold">earnings:</div>
          <div className="space-y-0.5">
            <Row label="basic salary" value={money(slip.earnings.basic)} />
            <Row label="allowance" value={money(slip.earnings.allowance)} />
            <Row label="overtime, 25% of hourly rate" value={money(slip.earnings.overtime)} />
            <Row label="meal allowance" value={money(slip.earnings.meal)} />
            <Row label="holiday pay" value={money(slip.earnings.holiday)} />
            <Row label="adjustments" value={money(slip.earnings.adjustments)} />
            <Row label="tips" value={money(slip.earnings.tips)} />
          </div>
          <div className="mt-auto pt-6">
            <Row label="total earnings" value={money(slip.earnings.total)} />
          </div>
        </div>
        <div className="bg-[#f2f2f2] px-3 py-2 flex flex-col">
          <div className="font-semibold">deductions:</div>
          <div className="space-y-0.5">
            <Row label="unpaid leaves" value={money(slip.deductions.unpaidLeaves)} />
            <Row label="sss" value={money(slip.deductions.sss)} />
            <Row label="philhealth" value={money(slip.deductions.philhealth)} />
            <Row label="hdmf" value={money(slip.deductions.hdmf)} />
          </div>
          <div className="font-semibold mt-3">loans and/or advances:</div>
          <div className="space-y-0.5">
            <Row label="sss loan" value={money(slip.deductions.sssLoan)} />
            <Row label="hdmf loan" value={money(slip.deductions.hdmfLoan)} />
            <Row label="cash advance" value={money(slip.deductions.cashAdvance)} />
            <Row label="others" value={money(slip.deductions.others)} />
          </div>
          <div className="mt-auto pt-3">
            <Row label="total deductions" value={money(slip.deductions.total)} />
          </div>
        </div>
      </div>

      {/* net pay */}
      <div className="mt-4 space-y-0.5">
        <div className="flex justify-end gap-10">
          <span>net pay, earnings less deductions</span>
          <span className="w-24 text-right font-semibold">{money(slip.netPay)}</span>
        </div>
        <div className="flex justify-end gap-10">
          <span>leaves remaining</span>
          <span className="w-24 text-right">{money(slip.leavesRemaining)}</span>
        </div>
      </div>

      {/* signature block */}
      <div className="grid grid-cols-2 gap-x-10 mt-8">
        <div>
          <div>thank you for your service and support,</div>
          <div className="mt-14">Alexandra Payumo, COO</div>
          <div>ASP Bed and Breakfast Inc</div>
        </div>
        <div className="flex flex-col">
          <div>I accept and agree that my pay computation is accurate,</div>
          <div className="mt-auto">Employee signature &amp; date signed</div>
        </div>
      </div>
    </div>
  );
}
