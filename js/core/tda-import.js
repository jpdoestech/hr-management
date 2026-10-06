export const TDA_REQUIRED_HEADERS = [
  'NO.',
  'OFFENSES TYPE',
  'OFFENSES REMARKS',
  '1st',
  '2nd',
  '3rd',
  '4th',
  '5th',
];

const HEADER_KEYS = {
  no: 'offenseNumber',
  offensestype: 'category',
  disciplinaryremarks: 'disciplinaryRemarks',
  offensesremarks: 'offense',
  '1st': 'consequence1',
  '2nd': 'consequence2',
  '3rd': 'consequence3',
  '4th': 'consequence4',
  '5th': 'consequence5',
};

export function normalizeTdaText(value) {
  return String(value ?? '')
    .replace(/\uFFFD/g, "'")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeTdaHeader(value) {
  return normalizeTdaText(value).toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function deriveDisciplinaryRemarks(category, firstConsequence) {
  const normalizedCategory = normalizeTdaText(category).toUpperCase();
  return normalizeTdaText(firstConsequence).toUpperCase() === 'DISMISSAL'
    ? `GRIEVANCE/${normalizedCategory}`
    : normalizedCategory;
}

export function tdaScopeKey(record) {
  const values = [
    record.tdaType,
    record.allClients === false ? record.clientName : '*',
    record.allBranches === false ? [...(record.branches || [])].sort().join('|') : '*',
    record.allDepartments === false ? [...(record.departments || [])].sort().join('|') : '*',
  ];
  return values.map(value => normalizeTdaText(value).toLowerCase()).join('::');
}

export function tdaDuplicateKey(record) {
  return `${tdaScopeKey(record)}::${normalizeTdaText(record.offense).toLowerCase()}`;
}

export function normalizeTdaScope(scope = {}) {
  const unique = values => [...new Set((values || []).map(normalizeTdaText).filter(Boolean))];
  const allClients = scope.allClients !== false;
  const allBranches = scope.allBranches !== false;
  const allDepartments = scope.allDepartments !== false;
  return {
    tdaType: normalizeTdaText(scope.tdaType) || 'Industrial',
    allClients,
    clientName: allClients ? '' : normalizeTdaText(scope.clientName),
    allBranches,
    branches: allBranches ? [] : unique(scope.branches),
    allDepartments,
    departments: allDepartments ? [] : unique(scope.departments),
  };
}

export function parseTdaMatrix(matrix, scope = {}) {
  if (!Array.isArray(matrix) || !matrix.length) {
    return { rows: [], fileErrors: ['The worksheet is empty.'] };
  }
  const keys = matrix[0].map(value => HEADER_KEYS[normalizeTdaHeader(value)] || '');
  const fileErrors = [];
  for (const header of TDA_REQUIRED_HEADERS) {
    const key = HEADER_KEYS[normalizeTdaHeader(header)];
    if (!keys.includes(key)) fileErrors.push(`Missing required column: ${header}`);
  }
  const duplicateHeaders = keys.filter((key, index) => key && keys.indexOf(key) !== index);
  if (duplicateHeaders.length) fileErrors.push('The worksheet contains duplicate recognized columns.');

  const normalizedScope = normalizeTdaScope(scope);
  if (!normalizedScope.tdaType) fileErrors.push('TDA Type is required.');
  if (!normalizedScope.allClients && !normalizedScope.clientName) fileErrors.push('Client / Account is required when All Clients is not selected.');
  if (!normalizedScope.allBranches && !normalizedScope.branches.length) fileErrors.push('Select at least one branch or use All Branches.');
  if (!normalizedScope.allDepartments && !normalizedScope.departments.length) fileErrors.push('Select at least one department or use All Departments.');

  const rows = [];
  const seen = new Set();
  matrix.slice(1).forEach((cells, index) => {
    if (!cells.some(cell => normalizeTdaText(cell))) return;
    const values = {};
    keys.forEach((key, columnIndex) => { if (key) values[key] = normalizeTdaText(cells[columnIndex]); });
    values.offenseNumber = normalizeTdaText(values.offenseNumber);
    values.category = normalizeTdaText(values.category).toUpperCase();
    values.offense = normalizeTdaText(values.offense);
    values.disciplinaryRemarks = deriveDisciplinaryRemarks(values.category, values.consequence1);
    Object.assign(values, normalizedScope);
    const errors = [];
    const warnings = [];
    if (!values.offenseNumber) errors.push('NO. is required');
    if (!values.category) errors.push('OFFENSES TYPE is required');
    if (!values.offense) errors.push('OFFENSES REMARKS is required');
    if (![1, 2, 3, 4, 5].some(level => values[`consequence${level}`])) errors.push('At least one consequence is required');
    const duplicateKey = tdaDuplicateKey(values);
    if (seen.has(duplicateKey)) errors.push('Duplicate offense within this workbook and scope');
    seen.add(duplicateKey);
    if (!/^\d+$/.test(values.offenseNumber)) warnings.push('NO. is not numeric');
    rows.push({ rowNumber: index + 2, values, errors, warnings });
  });
  if (!rows.length) fileErrors.push('No populated offense rows were found.');
  return { rows, fileErrors };
}

export function tdaRecordApplies(record, context = {}) {
  if (record.active === false) return false;
  const same = (a, b) => normalizeTdaText(a).toLowerCase() === normalizeTdaText(b).toLowerCase();
  if (context.tdaType && !same(record.tdaType || 'General', context.tdaType)) return false;
  if (record.allClients === false && (!context.clientName || !same(record.clientName, context.clientName))) return false;
  if (record.allBranches === false && (!context.branch || !(record.branches || []).some(value => same(value, context.branch)))) return false;
  if (record.allDepartments === false && (!context.department || !(record.departments || []).some(value => same(value, context.department)))) return false;
  return true;
}

export function tdaSpecificity(record, context = {}) {
  let score = 0;
  const same = (a, b) => normalizeTdaText(a).toLowerCase() === normalizeTdaText(b).toLowerCase();
  if (context.tdaType && same(record.tdaType, context.tdaType)) score += 8;
  if (record.allClients === false && context.clientName && same(record.clientName, context.clientName)) score += 4;
  if (record.allBranches === false && context.branch && (record.branches || []).some(value => same(value, context.branch))) score += 2;
  if (record.allDepartments === false && context.department && (record.departments || []).some(value => same(value, context.department))) score += 1;
  return score;
}

export function selectApplicableTdaRecord(records, offense, context = {}) {
  const target = normalizeTdaText(offense).toLowerCase();
  return (records || [])
    .filter(record => normalizeTdaText(record.offense).toLowerCase() === target && tdaRecordApplies(record, context))
    .sort((a, b) => tdaSpecificity(b, context) - tdaSpecificity(a, context))[0] || null;
}
