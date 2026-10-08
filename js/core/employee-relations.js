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

function dateOnly(value = '') {
  return String(value || '').slice(0, 10);
}

export function caseResponseChronology({ receivedAt = '', nteIssueDates = [] } = {}) {
  const received = dateOnly(receivedAt);
  const issues = nteIssueDates.map(dateOnly).filter(Boolean).sort();
  if (!received || !issues.length) return { valid: true, earliestNteIssueDate: issues[0] || '', message: '' };
  const valid = received >= issues[0];
  return { valid, earliestNteIssueDate: issues[0], message: valid ? '' : 'Employee response cannot be received before the linked NTE issue date.' };
}

export function caseDecisionNoticeValidation(decision = {}) {
  const missing = [];
  const status = decision.nod_status || 'Not Prepared';
  const formal = ['Finalized', 'Issued', 'Served'].includes(status);
  if (formal && decision.decision_status !== 'Approved') missing.push('an approved decision before NOD finalization');
  if (['Issued', 'Served'].includes(status) && !decision.nod_issued_at) missing.push('an NOD issue date');
  if (status === 'Served' && !decision.nod_served_at) missing.push('an NOD service date');
  if (decision.nod_issued_at && decision.decision_date && dateOnly(decision.nod_issued_at) < dateOnly(decision.decision_date)) missing.push('an NOD issue date on or after the decision date');
  if (decision.nod_served_at && decision.nod_issued_at && dateOnly(decision.nod_served_at) < dateOnly(decision.nod_issued_at)) missing.push('an NOD service date on or after the issue date');
  return { valid: missing.length === 0, missing };
}

export function caseImplementationValidation(record = {}, { decisionDate = '', historyFinalizationDate = '' } = {}) {
  const missing = [];
  const baseline = dateOnly(decisionDate || historyFinalizationDate);
  if (record.action_type !== 'No Action Required' && !record.decision_id && !record.history_id) missing.push('an approved decision or finalized history link');
  if (record.status === 'Completed' && !record.completion_date) missing.push('a completion date');
  if (record.status === 'Not Required' && record.action_type !== 'No Action Required') missing.push('the No Action Required action type');
  if (record.suspension_start && record.suspension_end && dateOnly(record.suspension_end) < dateOnly(record.suspension_start)) missing.push('a suspension end date on or after its start date');
  if (baseline) {
    for (const [field, label] of [['issued_date', 'issued date'], ['effective_date', 'effective date'], ['suspension_start', 'suspension start'], ['completion_date', 'completion date']]) {
      if (record[field] && dateOnly(record[field]) < baseline) missing.push(`${label} on or after ${decisionDate ? 'the decision date' : 'history finalization'}`);
    }
  }
  return { valid: missing.length === 0, missing, baseline };
}

export function employeeRelationsValidationIssues({ cases = [], allegations = [], decisions = [], responses = [], history = [], implementations = [], links = [], nteRecords = [] } = {}) {
  const issues = [];
  const add = (id, severity, title, detail, caseId = '') => issues.push({ id, severity, title, detail, caseId });
  const casesById = new Map(cases.map(record => [String(record.id), record]));
  const nteById = new Map(nteRecords.map(record => [String(record.id), record]));
  const nteDatesByCase = new Map();
  links.filter(link => link.module === 'nte').forEach(link => {
    const date = nteById.get(String(link.record_id))?.dateIssued;
    if (date) nteDatesByCase.set(String(link.case_id), [...(nteDatesByCase.get(String(link.case_id)) || []), date]);
  });
  cases.forEach(record => {
    const caseId = String(record.id || '');
    if (!String(record.employee_record_id || '').trim()) add(`case-stable-id:${caseId}`, 'warning', 'HR case has no stable employee ID', `${record.case_number || 'Case'} relies on a name-only employee reference.`, caseId);
    const caseDecisions = decisions.filter(item => String(item.case_id) === caseId);
    const caseHistory = history.filter(item => String(item.case_id) === caseId);
    const caseImplementations = implementations.filter(item => String(item.case_id) === caseId);
    const readiness = caseImplementationReadiness({ decisions: caseDecisions, history: caseHistory, implementations: caseImplementations });
    if (isCaseTerminalStage(record.status) && readiness.hasOpenImplementationTasks) add(`case-open-implementation:${caseId}`, 'error', 'Closed case has unfinished implementation', `${record.case_number || 'Case'} is closed while required final-action work remains open.`, caseId);
  });
  decisions.forEach(record => {
    const caseId = String(record.case_id || '');
    const findings = allegations.filter(item => String(item.case_id) === caseId);
    if (record.decision_status === 'Approved' && (!findings.length || findings.some(item => !item.finding || item.finding === 'Pending'))) add(`decision-findings:${record.id}`, 'error', 'Approved decision has incomplete findings', 'Every allegation must have a final finding before approval.', caseId);
    const notice = caseDecisionNoticeValidation(record);
    if (!notice.valid) add(`decision-nod:${record.id}`, 'error', 'Decision notice chronology is invalid', notice.missing.join('; '), caseId);
  });
  responses.forEach(record => {
    const caseId = String(record.case_id || '');
    const chronology = caseResponseChronology({ receivedAt: record.received_at, nteIssueDates: nteDatesByCase.get(caseId) || [] });
    if (!chronology.valid) add(`response-chronology:${record.id}`, 'error', 'Employee response predates the NTE', chronology.message, caseId);
  });
  allegations.forEach(record => {
    if (['Substantiated', 'Partially Substantiated'].includes(record.finding) && !record.tda_rule_id) add(`finding-policy:${record.id}`, 'warning', 'Confirmed finding has no TDA rule', 'Verify and document that no applicable TDA catalog rule exists before finalizing the action.', String(record.case_id || ''));
  });
  const historyKeys = new Set();
  history.forEach(record => {
    const caseId = String(record.case_id || '');
    if (record.source_type === 'case_generated' && (!record.employee_record_id || !record.case_id || !record.decision_id || !record.allegation_id || !record.finalization_date)) add(`history-source:${record.id}`, 'error', 'Disciplinary history is missing source metadata', 'Case-generated history requires stable employee, case, decision, allegation, and finalization references.', caseId);
    if (record.confirmed_occurrence && !record.tda_rule_id) add(`history-policy:${record.id}`, 'error', 'Confirmed occurrence has no TDA rule', 'A policy-counted occurrence requires a stable TDA rule ID.', caseId);
    if (record.source_type === 'case_generated') {
      const key = [record.tenant_id, record.case_id, record.decision_id, record.allegation_id].join('|');
      if (historyKeys.has(key)) add(`history-duplicate:${record.id}`, 'error', 'Duplicate case-generated disciplinary history', 'The same case decision and allegation generated more than one history record.', caseId);
      historyKeys.add(key);
    }
  });
  const decisionsById = new Map(decisions.map(record => [String(record.id), record]));
  const historyById = new Map(history.map(record => [String(record.id), record]));
  implementations.forEach(record => {
    const validation = caseImplementationValidation(record, { decisionDate: decisionsById.get(String(record.decision_id || ''))?.decision_date, historyFinalizationDate: historyById.get(String(record.history_id || ''))?.finalization_date });
    if (!validation.valid) add(`implementation:${record.id}`, 'error', 'Implementation record is invalid', validation.missing.join('; '), String(record.case_id || ''));
  });
  return issues.filter(issue => !issue.caseId || casesById.has(issue.caseId));
}
