// Company identity shown on payslips, exports and the app header. The real
// values live in .env (NEXT_PUBLIC_COMPANY_*), which never enters the public
// portfolio mirror — a build without them renders this fictional placeholder
// company instead.
export const COMPANY_NAME =
  process.env.NEXT_PUBLIC_COMPANY_NAME || 'Sampaguita Bed and Breakfast, Inc';

// The paper payslip's signature block writes the name without the comma —
// kept as its own value so the replica stays byte-faithful.
export const COMPANY_NAME_SIGNATURE =
  process.env.NEXT_PUBLIC_COMPANY_NAME_SIGNATURE || 'Sampaguita Bed and Breakfast Inc';

export const COMPANY_SIGNATORY =
  process.env.NEXT_PUBLIC_COMPANY_SIGNATORY || 'Maya dela Cruz, COO';
