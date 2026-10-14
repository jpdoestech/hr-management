import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const sql=readFileSync(new URL('../../supabase/migrations/0062_attendance_preparation.sql',import.meta.url),'utf8'),ui=readFileSync(new URL('../../js/core/attendance-preparation.js',import.meta.url),'utf8');
test('bulk saves are guarded server transactions on canonical records, not browser upserts',()=>{
  assert.match(ui,/call\('save_attendance_matrix'/);assert.doesNotMatch(ui,/from\('hr_records'\)\.upsert/);
  for(const text of ['expectedHash','sourceHash','for update','attendance.create','attendance.update','current_user_scope_allows','record_history','hr_audit_logs'])assert.ok(sql.includes(text));
  assert.doesNotMatch(sql,/disable trigger|drop policy|drop table/i);
});
test('posting locks are independent of approval and not exposed to authenticated browser roles',()=>{
  assert.match(sql,/grant execute on function public.register_attendance_posting_lock\(uuid,text,date,text\) to service_role/);
  assert.match(sql,/Protected attendance metadata/);assert.match(sql,/Posted attendance requires a controlled adjustment/);
  assert.match(sql,/coalesce\(previous.data->>'reviewState','Draft'\)/);
});
test('matrix roster stays bounded and search/filter occurs before server pagination',()=>{
  assert.match(sql,/limit least\(greatest\(p_limit,1\),100\)/);assert.match(sql,/regexp_split_to_table/);assert.match(sql,/p_department/);assert.match(sql,/p_position/);
  assert.match(ui,/rectangleCells/);assert.match(ui,/Confirm attendance defaults/);assert.match(ui,/compatibleTimeInputs/);
});

test('application navigation and reload protect staged attendance drafts',()=>{
  const app=readFileSync(new URL('../../js/app.js',import.meta.url),'utf8');
  assert.match(app,/await ATTENDANCE_PREPARATION\.canLeave\(\)/);
  assert.match(app,/const attendanceDirty=.*ATTENDANCE_PREPARATION\?\.dirty\|\|ATTENDANCE_PREPARATION\?\.busy/);
  assert.match(app,/if\(!attendanceDirty&&!modalHasUnsavedChanges\(\)&&!pageHasUnsavedChanges\(\)\) return/);
});

test('attendance opens directly with month/cutoff controls, transaction buttons and actual totals',()=>{
  assert.match(ui,/if\(active\(\)\).*matrixPeriod.*await load\(\)/);
  for(const text of ['Attendance month','Attendance cutoff','All assignment locations','data-brush','matrixSummary(row,edits)','Attendance quick transactions'])assert.ok(ui.includes(text));
  const allSql=readFileSync(new URL('../../supabase/migrations/0063_attendance_direct_matrix.sql',import.meta.url),'utf8');
  assert.match(allSql,/alter function public.save_attendance_matrix\(jsonb,jsonb,text\) set schema attendance_private/);
  assert.match(allSql,/revoke all on function attendance_private.save_attendance_matrix/);
  assert.match(allSql,/public.attendance_client_access\(c.data->>'clientId',false\)/);
});
