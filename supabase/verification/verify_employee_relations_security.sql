-- Read-only Phase 32 deployment verification. This file does not change data.

select count(*) as employee_relations_capability_count
from public.access_permissions
where permission_key in (
  'employee_relations.create_report','employee_relations.triage','employee_relations.create_case',
  'employee_relations.investigate','employee_relations.manage_nte','employee_relations.record_response',
  'employee_relations.manage_hearing','employee_relations.prepare_findings','employee_relations.propose_decision',
  'employee_relations.approve_decision','employee_relations.issue_nod','employee_relations.implement_action',
  'employee_relations.close_case','employee_relations.reopen_case','employee_relations.view_history',
  'employee_relations.manage_tda','employee_relations.override_tda_recommendation','employee_relations.view_confidential'
);

select schemaname,tablename,policyname,permissive,cmd
from pg_policies
where policyname like '%confidentiality_guard'
order by schemaname,tablename,policyname;

select event_object_schema,event_object_table,trigger_name,event_manipulation
from information_schema.triggers
where trigger_name='enforce_employee_relations_stage_permission'
   or trigger_name='enforce_employee_relations_case_create_permission'
   or trigger_name like 'hr_case%_permission_guard'
order by event_object_table,trigger_name,event_manipulation;

select column_name,data_type,column_default,is_nullable
from information_schema.columns
where table_schema='public' and table_name='hr_cases' and column_name='confidential';
