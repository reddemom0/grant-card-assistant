/**
 * Granted Files RAG — exclusions (src/services/rag/exclude.js) and path tagging
 * (src/services/rag/path-meta.js). Names and folders only; no network.
 *
 * Run with: NODE_OPTIONS=--experimental-vm-modules npx jest --config tests/jest.config.cjs tests/unit/rag-exclude-meta.test.js
 */

import { exclusionReason } from '../../src/services/rag/exclude.js';
import { pathMeta } from '../../src/services/rag/path-meta.js';

const ex = (path, name = 'Application Document-Acme-CanEx.pdf') => exclusionReason({ path: path.split('/').filter(Boolean), name });
const meta = (path) => pathMeta(path.split('/').filter(Boolean), { programSet: new Set(['canexport', 'etg', 'bcafe']) });

describe('exclusions', () => {
  test.each([
    ['Departments/HR/Policies', 'area:Departments/HR'],
    ['Departments/FINANCE/2026', 'area:Departments/FINANCE'],
    ['Departments/Mindfulness', 'area:Departments/Mindfulness'],
    ['Departments/hr/old', 'area:Departments/hr']
  ])('department area %s', (path, reason) => {
    expect(ex(path, 'Notes.docx')).toBe(reason);
  });

  test('sensitive name', () => {
    expect(ex('Clients/Acme/CanExport/2026', 'Payroll Summary-2026.xlsx')).toBe('sensitive_name');
    expect(ex('Departments/Sales', 'Offer Letter-Jane.docx')).toBe('sensitive_name');
  });

  test('sensitive folder anywhere on the path', () => {
    expect(ex('Clients/Acme/General/Financial Statements/2025', 'Q3.pdf')).toBe('sensitive_path');
    expect(ex('Old Files/Legal/Contracts', 'Agreement.docx')).toBe('sensitive_path');
  });

  test('name is reported before path', () => {
    expect(ex('Clients/Acme/Legal', 'Payroll.xlsx')).toBe('sensitive_name');
  });

  test.each([
    'Clients/Acme/CanExport/2026',
    'Old Files/Clients/Acme',
    'Programs/ETG/2026',
    'Departments/Sales/Playbooks',
    'Active Clients',
    'Review'
  ])('indexed: %s', (path) => {
    expect(ex(path)).toBeNull();
  });

  test('whole words only: "Three" is not HR, "Eileen" is not EI', () => {
    expect(ex('Clients/Three Rivers/General', 'Eileen notes.docx')).toBeNull();
  });
});

describe('path meta', () => {
  test('client, program and year', () => {
    expect(meta('Clients/Acme Ltd/CanExport/2026/Claims')).toEqual({ area: 'Clients', client: 'Acme Ltd', program: 'CanExport', year: 2026 });
  });

  test('client General folder has no program', () => {
    expect(meta('Clients/Acme Ltd/General/Undated')).toEqual({ area: 'Clients', client: 'Acme Ltd', program: null, year: null });
  });

  test('Old Files keeps client and program one level down', () => {
    expect(meta('Old Files/Clients/Acme Ltd/ETG/2019')).toEqual({ area: 'Old Files', client: 'Acme Ltd', program: 'ETG', year: 2019 });
    expect(meta('Old Files/Programs/BCAFE/2018 intake')).toEqual({ area: 'Old Files', client: null, program: 'BCAFE', year: 2018 });
  });

  test('Old Files with another layout', () => {
    expect(meta('Old Files/2017 Misc/Scans')).toEqual({ area: 'Old Files', client: null, program: null, year: 2017 });
  });

  test('programs and departments', () => {
    expect(meta('Programs/ETG/2025-26 guidelines')).toEqual({ area: 'Programs', client: null, program: 'ETG', year: 2025 });
    expect(meta('Departments/Sales/2024 Q3')).toEqual({ area: 'Departments', client: null, program: null, year: 2024 });
  });

  test('the deepest year wins; a client named after a year is not a year', () => {
    expect(meta('Clients/2020 Logistics Inc/CanExport/2023/2024')).toMatchObject({ client: '2020 Logistics Inc', year: 2024 });
    expect(meta('Clients/2020 Logistics Inc/General')).toMatchObject({ year: null });
  });

  test('unknown top level is Other; numbers that are not years are ignored', () => {
    expect(meta('Active Clients/Acme')).toEqual({ area: 'Other', client: null, program: null, year: null });
    expect(meta('Programs/ETG/12345')).toMatchObject({ year: null });
  });
});
