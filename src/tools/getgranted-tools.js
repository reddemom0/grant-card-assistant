/**
 * GetGrantedAI Tool Functions
 * Financial calculations and GetGranted platform integration
 */

/**
 * Provincial CPP and EI rates (2026)
 */
const TAX_RATES = {
  cpp: 0.0595,  // 5.95%
  ei: 0.0167,   // 1.67%
  qpip: 0.00494 // Quebec Parental Insurance Plan (Quebec only)
};

/**
 * Provincial vacation pay rates
 */
const VACATION_RATES = {
  default: 0.04,     // 4% (standard)
  after5years: 0.06  // 6% (after 5 years employment)
};

/**
 * WCB rates by industry (examples - these should be updated with actual rates)
 */
const WCB_RATES = {
  'office': 0.0030,           // 0.30%
  'retail': 0.0050,           // 0.50%
  'manufacturing': 0.0150,    // 1.50%
  'construction': 0.0250,     // 2.50%
  'hospitality': 0.0080,      // 0.80%
  'healthcare': 0.0120,       // 1.20%
  'technology': 0.0025,       // 0.25%
  'default': 0.0100           // 1.00% (fallback)
};

/**
 * Calculate Mandatory Employment Related Costs (MERCs)
 *
 * @param {Object} params - Calculation parameters
 * @param {number} params.hourlyWage - Hourly wage rate
 * @param {number} params.hoursPerWeek - Hours worked per week
 * @param {string} params.province - Province code (BC, ON, QC, etc.)
 * @param {string} params.payFrequency - 'hourly', 'weekly', 'biweekly', 'monthly', 'annual'
 * @param {number} params.vacationPct - Vacation pay percentage (4 or 6)
 * @param {string} params.industry - Industry type for WCB calculation
 * @returns {Object} Detailed MERC breakdown
 */
export function calculateMERCs({
  hourlyWage,
  hoursPerWeek,
  province = 'BC',
  payFrequency = 'hourly',
  vacationPct = 4,
  industry = 'default'
}) {
  // Validate inputs
  if (!hourlyWage || hourlyWage <= 0) {
    throw new Error('Hourly wage must be greater than 0');
  }
  if (!hoursPerWeek || hoursPerWeek <= 0) {
    throw new Error('Hours per week must be greater than 0');
  }

  // Calculate base weekly wage
  const weeklyWage = hourlyWage * hoursPerWeek;
  const annualWage = weeklyWage * 52;

  // Calculate CPP (max pensionable earnings apply)
  const CPP_MAX_ANNUAL = 68500; // 2026 estimate
  const CPP_BASIC_EXEMPTION = 3500;
  const cppEarnings = Math.min(annualWage, CPP_MAX_ANNUAL) - CPP_BASIC_EXEMPTION;
  const annualCPP = Math.max(0, cppEarnings * TAX_RATES.cpp);
  const weeklyCPP = annualCPP / 52;

  // Calculate EI (max insurable earnings apply)
  const EI_MAX_ANNUAL = 63200; // 2026 estimate
  const eiEarnings = Math.min(annualWage, EI_MAX_ANNUAL);
  const annualEI = eiEarnings * TAX_RATES.ei;
  const weeklyEI = annualEI / 52;

  // Calculate QPIP for Quebec
  let weeklyQPIP = 0;
  if (province.toLowerCase() === 'qc' || province.toLowerCase() === 'quebec') {
    const QPIP_MAX_ANNUAL = 88000; // 2026 estimate
    const qpipEarnings = Math.min(annualWage, QPIP_MAX_ANNUAL);
    const annualQPIP = qpipEarnings * TAX_RATES.qpip;
    weeklyQPIP = annualQPIP / 52;
  }

  // Calculate Vacation Pay
  const vacationRate = vacationPct === 6 ? VACATION_RATES.after5years : VACATION_RATES.default;
  const weeklyVacationPay = weeklyWage * vacationRate;

  // Calculate WCB
  const wcbRate = WCB_RATES[industry.toLowerCase()] || WCB_RATES.default;
  const weeklyWCB = weeklyWage * wcbRate;

  // Total MERCs
  const totalWeeklyMERCs = weeklyCPP + weeklyEI + weeklyQPIP + weeklyVacationPay + weeklyWCB;
  const totalAnnualMERCs = totalWeeklyMERCs * 52;

  // Total employment cost
  const totalWeeklyCost = weeklyWage + totalWeeklyMERCs;
  const totalAnnualCost = totalWeeklyCost * 52;

  return {
    baseWage: {
      hourly: hourlyWage,
      weekly: weeklyWage,
      annual: annualWage
    },
    mercs: {
      cpp: {
        weekly: weeklyCPP,
        annual: annualCPP,
        rate: TAX_RATES.cpp
      },
      ei: {
        weekly: weeklyEI,
        annual: annualEI,
        rate: TAX_RATES.ei
      },
      qpip: province.toLowerCase() === 'qc' ? {
        weekly: weeklyQPIP,
        annual: weeklyQPIP * 52,
        rate: TAX_RATES.qpip
      } : null,
      vacationPay: {
        weekly: weeklyVacationPay,
        annual: weeklyVacationPay * 52,
        rate: vacationRate
      },
      wcb: {
        weekly: weeklyWCB,
        annual: weeklyWCB * 52,
        rate: wcbRate,
        industry
      }
    },
    totals: {
      weeklyMERCs: totalWeeklyMERCs,
      annualMERCs: totalAnnualMERCs,
      weeklyCost: totalWeeklyCost,
      annualCost: totalAnnualCost,
      mercsPercentage: (totalWeeklyMERCs / weeklyWage) * 100
    },
    metadata: {
      province,
      hoursPerWeek,
      calculatedAt: new Date().toISOString()
    }
  };
}

/**
 * Convert between hourly and annual salary
 *
 * @param {number} amount - Amount to convert
 * @param {string} direction - 'hourlyToAnnual' or 'annualToHourly'
 * @param {number} hoursPerWeek - Hours worked per week (default 40)
 * @returns {Object} Conversion result with breakdown
 */
export function convertSalary(amount, direction, hoursPerWeek = 40) {
  if (!amount || amount <= 0) {
    throw new Error('Amount must be greater than 0');
  }
  if (hoursPerWeek <= 0 || hoursPerWeek > 80) {
    throw new Error('Hours per week must be between 1 and 80');
  }

  const weeksPerYear = 52;
  const annualHours = hoursPerWeek * weeksPerYear;

  if (direction === 'hourlyToAnnual') {
    const weeklyWage = amount * hoursPerWeek;
    const annualSalary = weeklyWage * weeksPerYear;

    return {
      input: {
        hourlyRate: amount,
        hoursPerWeek
      },
      output: {
        weeklyWage,
        annualSalary,
        annualHours
      },
      formatted: {
        hourly: `$${amount.toFixed(2)}/hour`,
        weekly: `$${weeklyWage.toFixed(2)}/week`,
        annual: `$${annualSalary.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/year`
      }
    };
  } else if (direction === 'annualToHourly') {
    const hourlyRate = amount / annualHours;
    const weeklyWage = hourlyRate * hoursPerWeek;

    return {
      input: {
        annualSalary: amount,
        hoursPerWeek
      },
      output: {
        hourlyRate,
        weeklyWage,
        annualHours
      },
      formatted: {
        hourly: `$${hourlyRate.toFixed(2)}/hour`,
        weekly: `$${weeklyWage.toFixed(2)}/week`,
        annual: `$${amount.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/year`
      }
    };
  } else {
    throw new Error('Direction must be "hourlyToAnnual" or "annualToHourly"');
  }
}

/**
 * Query GetGranted platform for available grants and client details
 * STUB: This will be implemented once GetGranted API integration is ready
 *
 * @param {string} query - Search query
 * @param {Object} filters - Optional filters {type, deadline, province, etc}
 * @returns {Promise<Object>} Search results
 */
export async function getGrantedLookup(query, filters = {}) {
  // TODO: Implement actual GetGranted API integration
  console.log('🔍 GetGranted Lookup (STUB):', query, filters);

  // Stub response
  return {
    status: 'stub',
    message: 'GetGranted API integration coming soon',
    query,
    filters,
    results: {
      grants: [],
      clients: []
    },
    note: 'This is a placeholder. Real implementation will query GetGranted platform for available grants and client data.'
  };
}

export default {
  calculateMERCs,
  convertSalary,
  getGrantedLookup
};
