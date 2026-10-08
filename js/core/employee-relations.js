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

const NO_IMPLEMENTATION_ACTIONS = new Set([
  '',
  'none',
  'no action',
  'no disciplinary action',
  'not applicable',
  'administrative closure',
]);

export function actionRequiresImplementation(action = '') {
  return !NO_IMPLEMENTATION_ACTIONS.has(String(action || '').trim().toLowerCase());
}

export function caseImplementationReadiness({ decisions = [], history = [], implementations = [] } = {}) {
  const currentDecision = decisions.find(decision => !['Superseded', 'Reversed'].includes(decision.decision_status)) || null;
  const activeHistory = history.filter(record => !['Superseded', 'Reversed', 'Void'].includes(record.status));
  const requiredActions = [
    ...(currentDecision?.decision_status === 'Approved' ? [currentDecision.final_action] : []),
    ...activeHistory.map(record => record.disciplinary_action),
  ].filter(actionRequiresImplementation);
  const activeImplementations = implementations.filter(record => record.status !== 'Cancelled');
  const openImplementations = activeImplementations.filter(record => ['Pending', 'In Progress'].includes(record.status));
  const completedImplementations = activeImplementations.filter(record => ['Completed', 'Not Required'].includes(record.status));
  const requiresImplementation = requiredActions.length > 0;
  return {
    requiresImplementation,
    hasImplementation: !requiresImplementation || (completedImplementations.length > 0 && openImplementations.length === 0),
    hasOpenImplementationTasks: openImplementations.length > 0 || (requiresImplementation && activeImplementations.length === 0),
    currentDecision,
    activeImplementations,
    openImplementations,
  };
}

const CASE_STAGE_WORK = {
  'Reported / Created': ['Triage new report', 'Triage', 'case_triage'],
  'Under Triage': ['Complete case triage', 'Triage', 'case_triage'],
  'Under Investigation': ['Complete investigation', 'Investigation', 'case_investigation'],
  'NTE Preparation': ['Prepare Notice to Explain', 'Due Process', 'case_nte_prepare'],
  'NTE Issued': ['Record NTE service', 'Due Process', 'case_nte_service'],
  'Awaiting Employee Response': ['Monitor employee response', 'Due Process', 'case_response'],
  'Response Received': ['Review employee response', 'Due Process', 'case_response_review'],
  'Hearing / Conference': ['Complete hearing or conference', 'Due Process', 'case_hearing'],
  'For Findings': ['Prepare case findings', 'Finding', 'case_findings'],
  'For Decision': ['Review and approve decision', 'Approval', 'case_decision'],
  'Decision Approved': ['Prepare Notice of Decision', 'Due Process', 'case_nod_prepare'],
  'NOD Issued': ['Record NOD service', 'Due Process', 'case_nod_service'],
  'For Implementation': ['Complete approved action', 'Implementation', 'case_implementation'],
  Implemented: ['Review case for closure', 'Closure', 'case_closure'],
};

export function caseLifecycleWorkItem(caseRecord = {}, implementations = []) {
  if (isCaseTerminalStage(caseRecord.status)) return { closed: true, title: `Case closed — ${caseRecord.case_number || 'HR Case'}`, workflowType: 'Closure', actionType: 'none', dueDate: caseRecord.closed_at || '' };
  const [verb, workflowType, actionType] = CASE_STAGE_WORK[caseRecord.status] || ['Review case', 'Review', 'case_review'];
  const openImplementation = implementations.find(record => record.case_id === caseRecord.id && ['Pending', 'In Progress'].includes(record.status));
  return {
    closed: false,
    title: `${verb} — ${caseRecord.case_number || 'HR Case'}`,
    workflowType,
    actionType,
    dueDate: openImplementation?.due_date || caseRecord.due_date || '',
    description: caseRecord.subject || `Advance the case from ${caseRecord.status || 'its current stage'}.`,
  };
}

export function employeeRelationsMetrics({ cases = [], reports = [], allegations = [], decisions = [], history = [], implementations = [], today = '' } = {}) {
  const date = today || new Date().toISOString().slice(0, 10);
  const openCases = cases.filter(record => !isCaseTerminalStage(record.status));
  const closedCases = cases.filter(record => isCaseTerminalStage(record.status));
  const qualifyingHistory = history.filter(record => ['Substantiated', 'Partially Substantiated'].includes(record.finding)
    && (!record.verification_status || record.verification_status === 'Verified')
    && !['Superseded', 'Reversed', 'Void'].includes(record.status));
  const resolvedDays = closedCases.map(record => {
    if (!record.opened_at || !record.closed_at) return null;
    return Math.max(0, Math.round((new Date(`${record.closed_at}T00:00:00`) - new Date(`${record.opened_at}T00:00:00`)) / 86400000));
  }).filter(Number.isFinite);
  const outcomeCounts = {};
  decisions.filter(record => record.decision_status === 'Approved').forEach(record => {
    const outcome = record.overall_outcome || 'Unspecified';
    outcomeCounts[outcome] = (outcomeCounts[outcome] || 0) + 1;
  });
  return {
    reportedAllegations: reports.length,
    openCases: openCases.length,
    awaitingTriage: openCases.filter(record => ['Reported / Created', 'Under Triage'].includes(record.status)).length,
    awaitingResponse: openCases.filter(record => record.status === 'Awaiting Employee Response').length,
    underInvestigation: openCases.filter(record => ['Under Investigation', 'NTE Preparation', 'NTE Issued', 'Response Received', 'Hearing / Conference'].includes(record.status)).length,
    awaitingFindings: openCases.filter(record => record.status === 'For Findings').length,
    awaitingDecision: openCases.filter(record => record.status === 'For Decision').length,
    awaitingImplementation: implementations.filter(record => ['Pending', 'In Progress'].includes(record.status)).length,
    overdue: openCases.filter(record => record.due_date && record.due_date < date).length
      + implementations.filter(record => ['Pending', 'In Progress'].includes(record.status) && record.due_date && record.due_date < date).length,
    olderThan30Days: openCases.filter(record => record.opened_at && Math.floor((new Date(`${date}T00:00:00`) - new Date(`${record.opened_at}T00:00:00`)) / 86400000) > 30).length,
    averageResolutionDays: resolvedDays.length ? Math.round(resolvedDays.reduce((sum, value) => sum + value, 0) / resolvedDays.length * 10) / 10 : 0,
    confirmedViolations: qualifyingHistory.length,
    repeatConfirmedOffenses: qualifyingHistory.filter(record => Number(record.confirmed_occurrence) > 1).length,
    tdaDeviations: decisions.filter(record => record.decision_status === 'Approved' && record.deviation_from_tda).length,
    reversedDecisions: decisions.filter(record => ['Reversed', 'Superseded'].includes(record.decision_status)).length,
    pendingFindings: allegations.filter(record => !record.finding || record.finding === 'Pending').length,
    outcomeCounts,
  };
}
