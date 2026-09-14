// PDF generation runs entirely client-side — salary data never touches a server.
// This module is dynamic-imported from the page so @react-pdf/renderer's weight
// only loads when Lexi actually clicks download.
import { Document, Font, Page, StyleSheet, Text, View, pdf } from '@react-pdf/renderer';

// A payslip line must never break mid-word ("accu-rate").
Font.registerHyphenationCallback((word) => [word]);
import { fmtDate, money } from './format';
import type { Payslip, SheetDate } from './types';

const styles = StyleSheet.create({
  page: {
    fontFamily: 'Helvetica-Oblique',
    fontSize: 10,
    color: '#262626',
    paddingTop: 48,
    paddingBottom: 48,
    paddingHorizontal: 52,
  },
  bold: { fontFamily: 'Helvetica-BoldOblique' },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 },
  cols: { flexDirection: 'row', gap: 24 },
  col: { flex: 1 },
  box: { flex: 1, paddingHorizontal: 10, paddingVertical: 8 },
});

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={bold ? styles.bold : undefined}>{label}</Text>
      <Text style={bold ? styles.bold : undefined}>{value}</Text>
    </View>
  );
}

export function PayslipDoc({
  slip,
  periodStart,
  periodEnd,
}: {
  slip: Payslip;
  periodStart: SheetDate | null;
  periodEnd: SheetDate | null;
}) {
  return (
    <Document title={`Payslip — ${slip.family}`} author="ASP Bed and Breakfast, Inc">
      <Page size="A4" style={styles.page}>
        <Text>ASP Bed and Breakfast, Inc</Text>
        <Text style={styles.bold}>Payslip</Text>
        <Text>pay information is confidential, please inform Management of confidentiality violations</Text>

        {/* info grid */}
        <View style={[styles.cols, { marginTop: 18 }]}>
          <View style={styles.col}>
            <View style={styles.row}>
              <Text>pay period</Text>
              <View style={{ flexDirection: 'row', gap: 20 }}>
                <Text>{fmtDate(periodStart)}</Text>
                <Text>{fmtDate(periodEnd)}</Text>
              </View>
            </View>
            <Row label="employee name" value={slip.family} />
            <Row label="department" value={slip.department} />
            <Row label="total days in period" value={money(slip.daysInPeriod)} />
          </View>
          <View style={styles.col}>
            <Row label="daily rate" value={money(slip.dailyRate)} />
            <Row label="basic salary" value={money(slip.basicMonthly)} />
            <Row label="allowance" value={money(slip.allowanceMonthly)} />
            <Row label="total monthly compensation" value={money(slip.totalMonthlyComp)} />
            <Row label="benefits" value={slip.benefits || '-'} />
          </View>
        </View>

        {/* earnings / deductions boxes */}
        <View style={[styles.cols, { marginTop: 18, gap: 8 }]}>
          <View style={[styles.box, { backgroundColor: '#d9d9d9' }]}>
            <Text style={[styles.bold, { marginBottom: 2 }]}>earnings:</Text>
            <Row label="basic salary" value={money(slip.earnings.basic)} />
            <Row label="allowance" value={money(slip.earnings.allowance)} />
            <Row label="overtime, 25% of hourly rate" value={money(slip.earnings.overtime)} />
            <Row label="meal allowance" value={money(slip.earnings.meal)} />
            <Row label="holiday pay" value={money(slip.earnings.holiday)} />
            <Row label="adjustments" value={money(slip.earnings.adjustments)} />
            <Row label="tips" value={money(slip.earnings.tips)} />
            <View style={{ marginTop: 'auto', paddingTop: 16 }}>
              <Row label="total earnings" value={money(slip.earnings.total)} />
            </View>
          </View>
          <View style={[styles.box, { backgroundColor: '#f2f2f2' }]}>
            <Text style={[styles.bold, { marginBottom: 2 }]}>deductions:</Text>
            <Row label="unpaid leaves" value={money(slip.deductions.unpaidLeaves)} />
            <Row label="sss" value={money(slip.deductions.sss)} />
            <Row label="philhealth" value={money(slip.deductions.philhealth)} />
            <Row label="hdmf" value={money(slip.deductions.hdmf)} />
            <Text style={[styles.bold, { marginTop: 10, marginBottom: 2 }]}>loans and/or advances:</Text>
            <Row label="sss loan" value={money(slip.deductions.sssLoan)} />
            <Row label="hdmf loan" value={money(slip.deductions.hdmfLoan)} />
            <Row label="cash advance" value={money(slip.deductions.cashAdvance)} />
            <Row label="others" value={money(slip.deductions.others)} />
            <View style={{ marginTop: 'auto', paddingTop: 10 }}>
              <Row label="total deductions" value={money(slip.deductions.total)} />
            </View>
          </View>
        </View>

        {/* net pay */}
        <View style={{ marginTop: 14 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 30, marginBottom: 2 }}>
            <Text>net pay, earnings less deductions</Text>
            <Text style={[styles.bold, { width: 70, textAlign: 'right' }]}>{money(slip.netPay)}</Text>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 30 }}>
            <Text>leaves remaining</Text>
            <Text style={{ width: 70, textAlign: 'right' }}>{money(slip.leavesRemaining)}</Text>
          </View>
        </View>

        {/* signature block */}
        <View style={[styles.cols, { marginTop: 32 }]}>
          <View style={styles.col}>
            <Text>thank you for your service and support,</Text>
            <Text style={{ marginTop: 56 }}>Alexandra Payumo, COO</Text>
            <Text>ASP Bed and Breakfast Inc</Text>
          </View>
          <View style={styles.col}>
            <Text>I accept and agree that my pay computation is accurate,</Text>
            <Text style={{ marginTop: 68 }}>Employee signature & date signed</Text>
          </View>
        </View>
      </Page>
    </Document>
  );
}

export async function payslipPdfBlob(
  slip: Payslip,
  periodStart: SheetDate | null,
  periodEnd: SheetDate | null
): Promise<Blob> {
  return pdf(
    <PayslipDoc slip={slip} periodStart={periodStart} periodEnd={periodEnd} />
  ).toBlob();
}
