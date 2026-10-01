import test from 'node:test'; import assert from 'node:assert/strict';
import { activateBudgetVersion, activeBudgetLines, addBudgetLine, approve, approvals, auditEvents, budgetVersionDetail, budgetVersions, createBudgetVersion, getBudgetVersion, projectSummary, projects, removeBudgetLine, rightsConflicts, submitBudgetVersion, updateBudgetLine, type DomainError } from './domain.js';

const lastError = (fn: () => unknown): DomainError => { try { fn(); } catch (error) { return error as DomainError; } throw new Error('expected DomainError'); };
const auditTrail = (versionId: string) => auditEvents.filter(event => event.entityId === versionId).map(event => event.action).reverse();

test('budget summary exposes forecast variance and high risk lines', () => { const summary = projectSummary('PRJ-001'); assert.equal(summary.lines.length, 4); assert.ok(summary.forecast > summary.planned); assert.equal(summary.highRiskLines.length, 1); });
test('rights conflict engine detects overlapping licensed assets', () => { const conflicts = rightsConflicts('PRJ-001'); assert.ok(conflicts.length >= 1); assert.ok(conflicts.some(item => item.reason.includes('音乐-同步许可'))); });
test('approval changes are auditable and stateful', () => { const result = approve('APR-01', 'approved', '预算已复核'); assert.equal(result?.status, 'approved'); assert.equal(result?.comment, '预算已复核'); });

test('copying a version creates an independent editable draft and keeps the baseline untouched', () => {
  const baselineBefore = projectSummary('PRJ-001');
  const draft = createBudgetVersion('PRJ-001', { createdBy: '后期制片' });
  assert.equal(draft.status, 'draft');
  assert.equal(draft.label, 'V4');
  assert.equal(draft.sourceVersionId, 'BUD-001-V3');
  assert.equal(draft.lines.length, 4);
  const revision = draft.revision;
  const result = updateBudgetLine(draft.id, 'BL-103', { forecast: 6900000 }, revision, '后期制片');
  assert.equal(result.version.revision, revision + 1);
  // 草案编辑不影响项目正在使用的基线，服务端与控制台读取的摘要保持不变
  const baselineAfter = projectSummary('PRJ-001');
  assert.equal(baselineAfter.budgetVersion?.id, 'BUD-001-V3');
  assert.deepEqual(baselineAfter.lines, baselineBefore.lines);
  assert.equal(getBudgetVersion('BUD-001-V3')?.lines.find(line => line.id === 'BL-103')?.forecast, 5750000);
});

test('version diff reports per-line planned/committed/actual/forecast deltas', () => {
  const draft = createBudgetVersion('PRJ-001', { createdBy: '后期制片', title: '后期超支预案 V5' });
  let revision = draft.revision;
  revision = updateBudgetLine(draft.id, 'BL-103', { planned: 5600000, committed: 4600000, actual: 2900000, forecast: 6300000 }, revision, '后期制片').version.revision;
  revision = addBudgetLine(draft.id, { category: '后期', subcategory: '在线包装与字幕', planned: 300000, forecast: 320000 }, revision, '后期制片').version.revision;
  removeBudgetLine(draft.id, 'BL-104', revision, '后期制片');
  const diff = budgetVersionDetail(draft.id).diff;
  const modified = diff.lines.find(line => line.lineId === 'BL-103');
  assert.equal(modified?.change, 'modified');
  assert.deepEqual(modified?.delta, { planned: 200000, committed: 300000, actual: 100000, forecast: 550000 });
  assert.equal(diff.lines.find(line => line.subcategory === '在线包装与字幕')?.change, 'added');
  assert.equal(diff.lines.find(line => line.lineId === 'BL-104')?.change, 'removed');
  assert.equal(diff.baseVersionId, 'BUD-001-V3');
});

test('concurrent edits are detected through the revision token', () => {
  const draft = createBudgetVersion('PRJ-001', { createdBy: '后期制片' });
  const revision = draft.revision;
  updateBudgetLine(draft.id, 'BL-101', { forecast: 13200000 }, revision, '用户A');
  const error = lastError(() => updateBudgetLine(draft.id, 'BL-102', { forecast: 7100000 }, revision, '用户B'));
  assert.equal(error.status, 409);
  assert.equal(error.code, 'REVISION_CONFLICT');
  // 用户B 刷新后拿到新 revision 即可成功
  const retry = updateBudgetLine(draft.id, 'BL-102', { forecast: 7100000 }, revision + 1, '用户B');
  assert.equal(retry.line.forecast, 7100000);
});

test('unknown lines and invalid amounts are rejected', () => {
  const draft = createBudgetVersion('PRJ-001', { createdBy: '后期制片' });
  assert.equal(lastError(() => updateBudgetLine(draft.id, 'BL-999', { forecast: 1 }, draft.revision, '后期制片')).status, 404);
  assert.equal(lastError(() => updateBudgetLine(draft.id, 'BL-101', { category: ' ' }, draft.revision, '后期制片')).status, 422);
  assert.equal(lastError(() => updateBudgetLine(draft.id, 'BL-101', { forecast: -5 }, draft.revision, '后期制片')).status, 422);
  assert.equal(lastError(() => removeBudgetLine(draft.id, 'BL-999', draft.revision, '后期制片')).status, 404);
});

test('empty versions cannot be submitted', () => {
  const draft = createBudgetVersion('PRJ-001', { createdBy: '后期制片' });
  let revision = draft.revision;
  for (const line of [...draft.lines]) revision = removeBudgetLine(draft.id, line.id, revision, '后期制片').version.revision;
  assert.equal(draft.lines.length, 0);
  const error = lastError(() => submitBudgetVersion(draft.id, '后期制片'));
  assert.equal(error.status, 422);
  assert.equal(error.code, 'EMPTY_VERSION');
});

test('submit locks the version, blocks duplicate submits, and creates a pending approval', () => {
  const draft = createBudgetVersion('PRJ-001', { createdBy: '后期制片' });
  const before = approvals.length;
  const { version, approval } = submitBudgetVersion(draft.id, '后期制片');
  assert.equal(version.status, 'pending');
  assert.equal(approval.status, 'pending');
  assert.equal(approval.entityId, draft.id);
  assert.equal(approvals.length, before + 1);
  // 审批期间再次修改被拒绝
  const locked = lastError(() => updateBudgetLine(draft.id, 'BL-101', { forecast: 1 }, version.revision, '后期制片'));
  assert.equal(locked.status, 409);
  assert.equal(locked.code, 'VERSION_LOCKED');
  // 重复提交被拒绝
  assert.equal(lastError(() => submitBudgetVersion(draft.id, '后期制片')).code, 'ALREADY_SUBMITTED');
});

test('rejection returns the version to an editable draft that can be resubmitted', () => {
  const draft = createBudgetVersion('PRJ-001', { createdBy: '后期制片' });
  const { approval } = submitBudgetVersion(draft.id, '后期制片');
  approve(approval.id, 'rejected', '后期科目预测依据不足，请补充');
  assert.equal(getBudgetVersion(draft.id)?.status, 'draft');
  const edited = updateBudgetLine(draft.id, 'BL-103', { forecast: 6100000 }, getBudgetVersion(draft.id)!.revision, '后期制片');
  assert.equal(edited.line.forecast, 6100000);
  const resubmitted = submitBudgetVersion(draft.id, '后期制片');
  assert.equal(resubmitted.version.status, 'pending');
  assert.equal(resubmitted.approval.id !== approval.id, true);
});

test('only a fully approved version can be activated; activation is atomic, idempotent and audited', () => {
  const draft = createBudgetVersion('PRJ-001', { createdBy: '后期制片', title: '后期超支预案 V9' });
  updateBudgetLine(draft.id, 'BL-103', { forecast: 6600000 }, draft.revision, '后期制片');
  // 未获批就切换：失败，可重试
  assert.equal(lastError(() => activateBudgetVersion(draft.id, '财务负责人')).code, 'NOT_APPROVED');
  const { approval } = submitBudgetVersion(draft.id, '后期制片');
  assert.equal(lastError(() => activateBudgetVersion(draft.id, '财务负责人')).code, 'NOT_APPROVED');
  approve(approval.id, 'approved', '整版复核通过');
  assert.equal(getBudgetVersion(draft.id)?.status, 'approved');
  // 获批前项目基线未变
  assert.equal(projectSummary('PRJ-001').budgetVersion?.id, 'BUD-001-V3');
  const activated = activateBudgetVersion(draft.id, '财务负责人');
  assert.equal(activated.alreadyActive, false);
  // 切换后整版一次性生效：摘要、生效行、项目指针指向同一版本
  const summary = projectSummary('PRJ-001');
  assert.equal(projects.find(project => project.id === 'PRJ-001')?.budgetVersionId, draft.id);
  assert.equal(summary.budgetVersion?.id, draft.id);
  assert.deepEqual(summary.lines, getBudgetVersion(draft.id)?.lines);
  assert.deepEqual(activeBudgetLines('PRJ-001'), summary.lines);
  assert.equal(summary.lines.find(line => line.id === 'BL-103')?.forecast, 6600000);
  assert.equal(getBudgetVersion('BUD-001-V3')?.status, 'archived');
  // 刷新后（重新读取摘要）仍恢复到生效版本，草案不会泄漏为基线
  assert.equal(projectSummary('PRJ-001').budgetVersion?.id, draft.id);
  // 切换失败重试/重复切换幂等：不重复归档、不重复写审计
  const auditsBefore = auditTrail(draft.id).filter(action => action === 'ACTIVATE').length;
  const again = activateBudgetVersion(draft.id, '财务负责人');
  assert.equal(again.alreadyActive, true);
  assert.equal(auditTrail(draft.id).filter(action => action === 'ACTIVATE').length, auditsBefore);
  // 关键转折全部进入审计链
  const trail = auditTrail(draft.id);
  for (const action of ['CREATE', 'UPDATE', 'SUBMIT', 'APPROVED', 'ACTIVATE']) assert.ok(trail.includes(action), `missing ${action} in audit trail`);
  assert.ok(trail.indexOf('CREATE') < trail.indexOf('SUBMIT') && trail.indexOf('SUBMIT') < trail.indexOf('ACTIVATE'));
});

test('new drafts copy from the currently active version after a switch', () => {
  const active = projectSummary('PRJ-001').budgetVersion;
  const draft = createBudgetVersion('PRJ-001', { createdBy: '后期制片' });
  assert.equal(draft.sourceVersionId, active?.id);
  assert.equal(draft.lines.length, activeBudgetLines('PRJ-001').length);
  assert.equal(budgetVersions.filter(version => version.projectId === 'PRJ-001' && version.status === 'active').length, 1);
});
