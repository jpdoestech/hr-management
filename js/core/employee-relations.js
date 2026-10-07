export const CASE_WORKFLOW_STAGES = [
  'Reported / Created',
  'Under Triage',
  'Under Investigation',
  'NTE Preparation',
  'NTE Issued',
  'Awaiting Employee Response',
  'Response Received',
  'Hearing / Conference',
  'For Findings',
  'For Decision',
  'Decision Approved',
  'NOD Issued',
  'For Implementation',
  'Implemented',
  'Closed',
];

export const CASE_TERMINAL_STAGES = [
  'Closed',
  'Closed - No Violation',
  'Closed - Insufficient Evidence',
  'Closed - Informal Resolution',
  'Cancelled',
  'Duplicate',
];

export const LEGACY_CASE_STAGES = ['Open', 'Memo Issued', 'Resolved'];

export const CASE_RESPONSE_STATUSES = ['Received', 'No Response', 'Withdrawn'];
export const CASE_HEARING_STATUSES = ['Scheduled', 'Held', 'Cancelled', 'Not Required'];
export const CASE_DECISION_STATUSES = ['Draft', 'For Approval', 'Approved', 'Returned', 'Superseded', 'Reversed'];
export const CASE_DECISION_OUTCOMES = [
  'Substantiated',
  'Partially Substantiated',
  'Unsubstantiated',
  'No Policy Violation',
  'Administrative Closure',
];
export const CASE_NOD_STATUSES = ['Not Prepared', 'Draft', 'Finalized', 'Issued', 'Served'];

const TRANSITIONS = {
  'Reported / Created': ['Under Triage', 'Cancelled', 'Duplicate'],
  'Under Triage': ['Under Investigation', 'Closed - No Violation', 'Closed - Insufficient Evidence', 'Closed - Informal Resolution', 'Cancelled', 'Duplicate'],
  'Under Investigation': ['NTE Preparation', 'For Findings', 'Closed - No Violation', 'Closed - Insufficient Evidence', 'Closed - Informal Resolution', 'Cancelled'],
  'NTE Preparation': ['Under Investigation', 'NTE Issued', 'Cancelled'],
  'NTE Issued': ['Awaiting Employee Response', 'Response Received', 'Cancelled'],
  'Awaiting Employee Response': ['Response Received', 'For Findings', 'Cancelled'],
  'Response Received': ['Hearing / Conference', 'For Findings', 'Cancelled'],
  'Hearing / Conference': ['For Findings', 'Under Investigation', 'Cancelled'],
  'For Findings': ['For Decision', 'Under Investigation', 'Closed - No Violation', 'Closed - Insufficient Evidence', 'Closed - Informal Resolution'],
  'For Decision': ['Decision Approved', 'For Findings'],
  'Decision Approved': ['NOD Issued', 'For Decision'],
  'NOD Issued': ['For Implementation', 'Implemented'],
  'For Implementation': ['Implemented'],
  'Implemented': ['Closed'],
  Open: ['Under Triage', 'Under Investigation', 'Cancelled', 'Duplicate'],
  'Memo Issued': ['For Findings', 'For Decision', 'Cancelled'],
  Resolved: ['Implemented', 'Closed'],
};

export function isCaseTerminalStage(status) {
  return CASE_TERMINAL_STAGES.includes(status);
}

export function caseStageOptions(currentStatus = '') {
  const current = String(currentStatus || 'Reported / Created');
  const options = [current, ...(TRANSITIONS[current] || [])];
  return [...new Set(options)];
}

export function canTransitionCase(fromStatus, toStatus) {
  if (fromStatus === toStatus) return true;
  if (isCaseTerminalStage(fromStatus)) return false;
  return (TRANSITIONS[fromStatus] || []).includes(toStatus);
}

export function caseTransitionValidation(toStatus, context = {}) {
  const missing = [];
  if (toStatus === 'Under Triage') {
    if (!context.employeeIdentified && !context.hasSourceReport) missing.push('an identified employee or source report');
    if (!context.hasSummary) missing.push('a report or allegation summary');
  }
  if (toStatus === 'Under Investigation') {
    if (!context.hasAllegation) missing.push('at least one allegation');
    if (!context.hasAssignee) missing.push('an assigned HR owner');
  }
  if (toStatus === 'NTE Issued') {
    if (!context.hasAllegation) missing.push('at least one allegation');
    if (!context.hasNte) missing.push('a linked Notice to Explain');
    if (!context.hasNteIssueDate) missing.push('an NTE issue date');
  }
  if (toStatus === 'Response Received' && !context.hasResponse) {
    missing.push('an employee response or a documented no-response outcome');
  }
  if (toStatus === 'For Findings' && !context.responseOpportunityHandled) {
    missing.push('a completed employee-response opportunity');
  }
  if (toStatus === 'For Decision' && !context.hasPreparedFindings) missing.push('prepared findings');
  if (toStatus === 'Decision Approved') {
    if (!context.hasFinalFindings) missing.push('final findings for every allegation');
    if (!context.hasApprovedDecision) missing.push('an authorized decision');
  }
  if (toStatus === 'NOD Issued' && !context.hasDecisionNotice) missing.push('a finalized Notice of Decision with an issue date');
  if (toStatus === 'Implemented' && context.requiresImplementation && !context.hasImplementation) missing.push('implementation details');
  if (toStatus === 'Closed') {
    if (!context.hasOutcome) missing.push('a case outcome');
    if (!context.hasClosureDate) missing.push('a closure date');
    if (context.hasOpenImplementationTasks) missing.push('completion of mandatory implementation work');
  }
  return { valid: missing.length === 0, missing };
}

export function isCaseReportSource(module) {
  return module === 'incidents' || module === 'cvr';
}

export function caseDueProcessReadiness({
  nteRecords = [],
  nodRecords = [],
  allegations = [],
  responses = [],
  hearings = [],
  decisions = [],
} = {}) {
  const currentDecision = decisions.find(decision => !['Superseded', 'Reversed'].includes(decision.decision_status)) || null;
  const activeResponses = responses.filter(response => response.status !== 'Withdrawn');
  const hearingRequired = activeResponses.some(response => response.hearing_requested === true);
  const hasHearingRecord = hearings.some(hearing => ['Held', 'Not Required'].includes(hearing.status));
  const hasResponse = activeResponses.some(response => response.status === 'Received' || response.status === 'No Response');
  const finalizedNodStates = new Set(['Finalized', 'Issued', 'Served']);
  const finalFindings = allegations.filter(allegation => allegation.finding && allegation.finding !== 'Pending');
  return {
    hasNte: nteRecords.length > 0,
    hasNteIssueDate: nteRecords.some(record => Boolean(record.dateIssued)),
    hasResponse,
    hearingRequired,
    hasHearingRecord,
    hearingHandled: !hearingRequired || hasHearingRecord,
    responseOpportunityHandled: hasResponse && (!hearingRequired || hasHearingRecord),
    hasPreparedFindings: finalFindings.length > 0,
    hasFinalFindings: allegations.length > 0 && finalFindings.length === allegations.length,
    hasApprovedDecision: currentDecision?.decision_status === 'Approved',
    hasDecisionNotice: nodRecords.some(record => record.dateOfNod && finalizedNodStates.has(record.finalizationStatus)),
    currentDecision,
  };
}

export function caseDecisionValidation(decision = {}, { requireApproval = false } = {}) {
  const missing = [];
  if (!String(decision.overall_outcome || '').trim()) missing.push('decision outcome');
  if (!String(decision.reasoning || '').trim()) missing.push('decision reasoning');
  if (!String(decision.final_action || '').trim()) missing.push('final action');
  if (decision.deviation_from_tda && !String(decision.deviation_reason || '').trim()) missing.push('TDA deviation reason');
  if (requireApproval && !decision.decision_date) missing.push('decision date');
  return { valid: missing.length === 0, missing };
}

export function qualifyingDisciplinaryHistory(records = [], { employeeRecordId = '', tdaRuleId = '', asOf = '', lookbackDays = null } = {}) {
  const cutoff = asOf && Number.isFinite(Number(lookbackDays))
    ? new Date(new Date(`${asOf}T00:00:00`).getTime() - Number(lookbackDays) * 86400000)
    : null;
  return records.filter(record => {
    if (String(record.employee_record_id || '') !== String(employeeRecordId || '')) return false;
    if (String(record.tda_rule_id || '') !== String(tdaRuleId || '')) return false;
    if (!['Substantiated', 'Partially Substantiated'].includes(record.finding)) return false;
    if (record.verification_status && record.verification_status !== 'Verified') return false;
    if (record.voided_at || record.reversed_at || ['Superseded', 'Reversed', 'Void'].includes(record.status)) return false;
    if (cutoff && record.decision_date && new Date(`${record.decision_date}T00:00:00`) < cutoff) return false;
    return Boolean(record.finalization_date) || record.finalized === true || ['Finalized', 'Active'].includes(record.status);
  });
}

export function nextPotentialOccurrence(records, options) {
  return qualifyingDisciplinaryHistory(records, options).length + 1;
}
