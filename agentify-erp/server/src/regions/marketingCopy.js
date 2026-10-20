// Country-specific wording for the global marketing site (headline, sub-headline, highlights, extra FAQs, calculator strip).
// Defaults live here until a console editor exists; the factual claims are limited to what the product actually does.
export const COUNTRY_COPY = {
  US: {
    slug: 'us', flag: '🇺🇸',
    hero_title: 'Run your brokerage and your builds from one system',
    hero_subtitle: 'Leads, listings, transactions and commission splits for agents and brokers, plus estimates, change orders and subcontractor tracking for builders. Priced in US dollars, measured in square feet.',
    chips: ['Transaction checklists', 'Commission splits', 'Mortgage referral tracking', 'Sq ft and acres', 'Two-factor sign-in'],
    calc_title: 'Try the numbers for the United States', calc_sub: 'A mortgage payment with taxes, insurance and HOA, and estimated closing costs. Estimates only.',
    faqs: [['Do you cover townhouses, condos and multi-family?', 'Yes. Listings use US property types: single-family, townhouse, duplex, condo, co-op, loft, lots and commercial, with beds, baths, lot size, HOA and year built.'], ['Can I track earnest money and closing checklists?', 'Yes. Each sale has a checklist you can edit. The starter checklist is sample wording to be reviewed by your own advisers.']],
  },
  UK: {
    slug: 'uk', flag: '🇬🇧',
    hero_title: 'Sales, lettings and construction in one system',
    hero_subtitle: 'Manage vendors, buyers and landlords, track every sale from offer to completion, and see Stamp Duty and mortgage costs on your website. Priced in pounds, measured in square feet and square metres.',
    chips: ['Sales and lettings', 'Stamp Duty calculator', 'Tenure, EPC and council tax band', 'Mortgage referral tracking', 'UK GDPR tools'],
    calc_title: 'Try the numbers for the United Kingdom', calc_sub: 'A repayment or interest-only mortgage and Stamp Duty Land Tax for England and Northern Ireland. Estimates only.',
    faqs: [['Does it handle freehold, leasehold and EPC details?', 'Yes. UK listings carry tenure, council tax band, EPC rating, ground rent and service charge.'], ['Is Scotland and Wales covered?', 'The Stamp Duty calculator uses England and Northern Ireland rates today. Scottish and Welsh taxes are planned as separate data.']],
  },
  AE: {
    slug: 'ae', flag: '🇦🇪',
    hero_title: 'Property brokerage and construction for the UAE',
    hero_subtitle: 'Ready and off-plan listings, payment plans, mortgage tracking and Dubai Land Department fee estimates, in dirhams and square feet with an Arabic option.',
    chips: ['Ready and off-plan', 'DLD fee calculator', 'Payment plans', 'Arabic and English', 'Permit number on listings'],
    calc_title: 'Try the numbers for the UAE', calc_sub: 'A mortgage payment and Dubai Land Department purchase fees. Estimates only; other emirates differ.',
    faqs: [['Is there an Arabic interface?', 'Yes, the application can switch to Arabic with a right-to-left layout. Arabic text is being reviewed by a native speaker before it is switched on for customers.'], ['Can I record permit numbers on listings?', 'Yes. Listings have a field for the advertising permit number.']],
  },
  PK: {
    slug: 'pk', flag: '🇵🇰',
    hero_title: null, hero_subtitle: null,
    chips: ['Plot files and installment plans', 'Marla and Kanal', 'Balloon payments', 'Customer portal', 'Two-factor sign-in'],
    calc_title: 'Try the numbers for Pakistan', calc_sub: 'Convert between Marla, Kanal, square feet and square yards.',
    faqs: [],
  },
  CA: {
    slug: 'ca', flag: '🇨🇦',
    hero_title: 'Brokerage and construction management for Canada',
    hero_subtitle: 'Listings, clients, offers and commissions, with mortgage estimates that follow Canadian compounding. Priced in Canadian dollars, in English and French.',
    chips: ['Mortgage calculator', 'English and French', 'Sq ft and sq m', 'Mortgage referral tracking', 'Privacy tools'],
    calc_title: 'Try the numbers for Canada', calc_sub: 'A mortgage payment using semi-annual compounding and an estimated closing-cost allowance. Estimates only.',
    faqs: [],
  },
};
