import test from 'node:test';
import assert from 'node:assert/strict';
import {
  activeBudgetVersion, approve, approvals, budgetVersionView, copyBudgetVersion, decideBudgetVersion,
  listBudgetVersionViews, projectSummary, projects, setBudgetActivationGuard,
  submitBudgetVersion, updateDraftLines, WorkflowError,
} from './domain.js';
import { auditEvents } from './domain.js';

const PLAN_TOTAL_V3 = 12800000 + 6800000 + 5400000 + 3600000; // 28,600,000
const PLANNED_V3_BL103 = 5400000;

// 说明：node:test 同一文件内按定义顺序串行执行。会把 PRJ-001 基线从
// BUD-001-V3 切换走的用例（整版激活、终态只读、审计链）统一排在最后，
// 前面的用例因此可以稳定断言“V3 仍生效”。

function expectError(code: string, fn: () => unknown) {
  try {
    fn();
    assert.fail(`应当抛出 ${code}，但没有抛错`);
  } catch (error) {
    assert.ok(error instanceof WorkflowError, `应当是 WorkflowError，实际 ${String(error)}`);
    assert.equal((error as WorkflowError).code, code);
  }
}

function bumpLine(versionId: string, revision: number, overrides: Record<string, Partial<{ planned: number; committed: number; actual: number; forecast: number }>>, actor = '后期制片') {
  const view = budgetVersionView(versionId);
  const lines = view.lines.map(line => ({
    lineId: line.lineId,
    planned: line.planned, committed: line.committed, actual: line.actual, forecast: line.forecast,
    ...overrides[line.lineId],
  }));
  return updateDraftLines(versionId, lines, revision, actor);
}

test('复制草案：基线保持不变，草案独立可编辑，摘要仍读生效版本', () => {
  const before = projectSummary('PRJ-001');
  assert.equal(before.budgetVersion?.id, 'BUD-001-V3');
  assert.equal(before.planned, PLAN_TOTAL_V3);

  const draft = copyBudgetVersion('PRJ-001', { name: '后期超支预案 V4 草案', createdBy: '后期制片' });
  assert.equal(draft.status, 'draft');
  assert.equal(draft.basedOnVersionId, 'BUD-001-V3');
  assert.equal(draft.lines.length, 4);
  assert.equal(draft.revision, 0);

  // 改草案里的后期科目计划金额
  updateDraftLines(draft.id, draft.lines.map(line => ({
    lineId: line.lineId, planned: line.planned, committed: line.committed,
    actual: line.actual, forecast: line.forecast,
    ...(line.lineId === 'BL-103' ? { planned: 6100000, forecast: 6300000 } : {}),
  })), 0, '后期制片');

  // 生效基线四账纹丝不动；项目指针不变；草案自己的视图反映新数
  const after = projectSummary('PRJ-001');
  assert.equal(after.budgetVersion?.id, 'BUD-001-V3');
  assert.equal(after.planned, PLAN_TOTAL_V3);
  assert.equal(projects.find(p => p.id === 'PRJ-001')?.budgetVersionId, 'BUD-001-V3');
  const draftView = budgetVersionView(draft.id);
  assert.equal(draftView.lines.find(l => l.lineId === 'BL-103')?.planned, 6100000);
});

test('科目视图暴露计划/承诺/实际/预测差异，以及对生效基线的差异', () => {
  const draft = copyBudgetVersion('PRJ-001', { createdBy: '后期制片' });
  updateDraftLines(draft.id, draft.lines.map(line => ({
    lineId: line.lineId, planned: line.planned, committed: line.committed,
    actual: line.actual, forecast: line.forecast,
    ...(line.lineId === 'BL-103' ? { forecast: 6200000 } : {}),
  })), 0, '后期制片');
  const row = budgetVersionView(draft.id).lines.find(l => l.lineId === 'BL-103')!;
  assert.equal(row.varForecast, 6200000 - PLANNED_V3_BL103);
  assert.equal(row.varCommitted, 4300000 - PLANNED_V3_BL103);
  assert.equal(row.varActual, 2800000 - PLANNED_V3_BL103);
  assert.equal(row.baselinePlanned, PLANNED_V3_BL103);
  assert.equal(row.plannedDeltaVsBaseline, 0);
  const view = budgetVersionView(draft.id);
  assert.equal(view.totals.variance, view.totals.forecast - view.totals.planned);
});

test('两个用户同时编辑：后保存者命中乐观锁 409，刷新后基于新 revision 重做成功', () => {
  const draft = copyBudgetVersion('PRJ-001', { createdBy: '后期制片' });
  // 用户 A 先保存成功，revision 0 -> 1
  bumpLine(draft.id, 0, { 'BL-103': { forecast: 6000000 } }, '后期制片-A');
  // 用户 B 仍持有 revision 0：被拒绝，且写冲突审计
  expectError('VERSION_CONFLICT', () => bumpLine(draft.id, 0, { 'BL-103': { forecast: 6500000 } }, '后期制片-B'));
  assert.ok(auditEvents.some(e => e.action === 'BUDGET_VERSION_EDIT_CONFLICT' && e.entityId === draft.id), '并发冲突必须入审计链');
  // B 刷新（拿到最新 revision 1）后重做，成功
  bumpLine(draft.id, 1, { 'BL-103': { forecast: 6500000 } }, '后期制片-B');
  assert.equal(budgetVersionView(draft.id).lines.find(l => l.lineId === 'BL-103')?.forecast, 6500000);
  assert.equal(budgetVersionView(draft.id).revision, 2);
});

test('送审后锁定：审批期间再次修改与重复送审都被拒绝', () => {
  const draft = copyBudgetVersion('PRJ-001', { createdBy: '后期制片' });
  submitBudgetVersion(draft.id, '后期制片');
  const reviewing = budgetVersionView(draft.id);
  assert.equal(reviewing.status, 'in_review');
  assert.equal(reviewing.reviewRound, 1);
  assert.ok(reviewing.openApprovalId);
  expectError('VERSION_NOT_EDITABLE', () => bumpLine(draft.id, reviewing.revision, { 'BL-103': { forecast: 9 } }));
  expectError('ALREADY_IN_REVIEW', () => submitBudgetVersion(draft.id, '后期制片'));
});

test('驳回后可修改并重新送审：轮次递增、版本 id 不变、保留驳回意见（终态前，基线仍为 V3）', () => {
  const draft = copyBudgetVersion('PRJ-001', { createdBy: '后期制片' });
  const id = draft.id;
  submitBudgetVersion(id, '后期制片', '首轮送审');
  decideBudgetVersion(id, 'rejected', '财务负责人', '后期科目需补三档预测');
  assert.equal(budgetVersionView(id).status, 'rejected');
  assert.equal(budgetVersionView(id).decisionComment, '后期科目需补三档预测');
  // 驳回不影响生效基线
  assert.equal(projects.find(p => p.id === 'PRJ-001')?.budgetVersionId, 'BUD-001-V3');

  // 驳回后直接修改（无需先“重新打开”），保存成功 revision 前进
  const rejected = budgetVersionView(id);
  bumpLine(id, rejected.revision, { 'BL-103': { forecast: 6300000 } }, '后期制片');
  submitBudgetVersion(id, '后期制片', '已补三档');
  const second = budgetVersionView(id);
  assert.equal(second.status, 'in_review');
  assert.equal(second.reviewRound, 2);
  assert.equal(second.id, id, '同一版本走多轮审批，不能另起版本号');
});

test('空版本、未知科目、非法金额、重复科目分别被拦截', () => {
  const draft = copyBudgetVersion('PRJ-001', { createdBy: '后期制片' });
  // 保存阶段允许清空（编辑中途状态），但送审与切换拦截空版本
  updateDraftLines(draft.id, [], 0, '后期制片');
  assert.equal(budgetVersionView(draft.id).lines.length, 0);
  expectError('EMPTY_VERSION', () => submitBudgetVersion(draft.id, '后期制片'));

  expectError('UNKNOWN_LINE', () => updateDraftLines(copyBudgetVersion('PRJ-001', { createdBy: 'x' }).id,
    [{ lineId: 'BL-999', planned: 1, committed: 0, actual: 0, forecast: 1 }], 0, '后期制片'));
  expectError('INVALID_AMOUNT', () => updateDraftLines(copyBudgetVersion('PRJ-001', { createdBy: 'x' }).id,
    [{ lineId: 'BL-103', planned: -1, committed: 0, actual: 0, forecast: 0 }], 0, '后期制片'));
  expectError('DUPLICATE_LINE', () => updateDraftLines(copyBudgetVersion('PRJ-001', { createdBy: 'x' }).id,
    [
      { lineId: 'BL-103', planned: 1, committed: 0, actual: 0, forecast: 1 },
      { lineId: 'BL-103', planned: 2, committed: 0, actual: 0, forecast: 2 },
    ], 0, '后期制片'));
});

test('刷新后恢复到哪个版本：未获批前一律回到生效基线，草案停在已保存 revision（动态基线）', () => {
  // 不硬编码基线 id（本用例之后还有切换用例，且同进程状态共享）：记下当前生效版本
  const baselineId = activeBudgetVersion('PRJ-001')?.id;
  const baselinePlanned = projectSummary('PRJ-001').planned;
  const draft = copyBudgetVersion('PRJ-001', { name: '待恢复草案', createdBy: '后期制片' });
  bumpLine(draft.id, 0, { 'BL-104': { forecast: 3500000 } }, '后期制片');
  // 模拟页面刷新：只从服务端重新拉取，不保留任何内存态
  const freshList = listBudgetVersionViews('PRJ-001');
  const freshDraft = freshList.find(v => v.id === draft.id)!;
  const summary = projectSummary('PRJ-001');
  assert.equal(freshDraft.status, 'draft');
  assert.equal(freshDraft.revision, 1, '草案修改已持久化，刷新后回到已保存的 revision');
  assert.equal(summary.budgetVersion?.id, baselineId, '未获批前刷新永远回到当前生效基线');
  assert.equal(summary.planned, baselinePlanned, '草案改动不影响生效基线四账');
  assert.equal(budgetVersionView(draft.id).lines.find(l => l.lineId === 'BL-104')?.forecast, 3500000);
});

test('切换失败可重试（PRJ-002）：守卫抛错时版本与指针保持原样，重试成功后才翻转', () => {
  const draft = copyBudgetVersion('PRJ-002', { name: 'V3 试算', createdBy: '后期制片' });
  const id = draft.id;
  submitBudgetVersion(id, '后期制片');

  let observedDuringGuard = '';
  setBudgetActivationGuard(() => {
    // 守卫运行在发布点之前：此刻生效版本必须仍是旧基线，不存在半版科目
    observedDuringGuard = activeBudgetVersion('PRJ-002')?.id ?? '';
    throw new Error('财务台账连接超时');
  });
  expectError('ACTIVATION_FAILED', () => decideBudgetVersion(id, 'approved', '财务负责人'));
  assert.equal(observedDuringGuard, 'BUD-002-V2', '失败路径上发布点未到达，读者只能看到旧基线');
  assert.equal(projects.find(p => p.id === 'PRJ-002')?.budgetVersionId, 'BUD-002-V2');
  assert.equal(budgetVersionView(id).status, 'in_review', '失败后仍停留在审批中，同一轮可重试');
  assert.ok(auditEvents.some(e => e.action === 'BUDGET_VERSION_ACTIVATE_FAILED' && e.entityId === id));

  // 修复外部条件后重试批准，无需重新送审
  setBudgetActivationGuard(null);
  decideBudgetVersion(id, 'approved', '财务负责人', '台账恢复，整版通过');
  assert.equal(projects.find(p => p.id === 'PRJ-002')?.budgetVersionId, id);
  assert.equal(budgetVersionView('BUD-002-V2').status, 'superseded');
  assert.ok(auditEvents.some(e => e.action === 'BUDGET_VERSION_ACTIVATE' && e.entityId === id));
});

// ---- 以下用例会把 PRJ-001 的生效基线从 V3 切走，必须排在最后 -------------

test('整版获批才切换：指针翻转、旧版归档、四账结果只来自新版，读者口径一致；其他在途预算审批单同步作废', () => {
  // 先制造一张“竞争者在途挂单”：另一份草案也在审批中
  const competitor = copyBudgetVersion('PRJ-001', { name: '竞争方案', createdBy: '制片主任' });
  const { approval: competingApproval } = submitBudgetVersion(competitor.id, '制片主任');

  const draft = copyBudgetVersion('PRJ-001', { name: 'V4', createdBy: '后期制片' });
  const id = draft.id;
  bumpLine(id, 0, { 'BL-103': { planned: 6100000, forecast: 6250000 } }, '后期制片');
  submitBudgetVersion(id, '后期制片');
  decideBudgetVersion(id, 'approved', '财务负责人', '整版复核通过');

  const project = projects.find(p => p.id === 'PRJ-001')!;
  assert.equal(project.budgetVersionId, id);
  assert.equal(activeBudgetVersion('PRJ-001')?.id, id);
  assert.equal(budgetVersionView('BUD-001-V3').status, 'superseded', '旧基线整版归档，不可被中途读到半版');

  // 竞争者挂单在同一临界区作废，不能再被 PATCH 出结论
  const staleItem = approvals.find(a => a.id === competingApproval.id)!;
  assert.equal(staleItem.status, 'rejected');
  expectError('APPROVAL_DECIDED', () => approve(staleItem.id, 'approved'));
  assert.equal(budgetVersionView(competitor.id).status, 'in_review', '挂单作废不改动竞争版本自身状态');

  // 服务端唯一读口径：摘要 / 版本列表 / 生效版本三者一致
  const summary = projectSummary('PRJ-001');
  assert.equal(summary.budgetVersion?.id, id);
  assert.equal(summary.lines.find(l => l.id === 'BL-103')?.planned, 6100000);
  assert.equal(summary.planned, PLAN_TOTAL_V3 - PLANNED_V3_BL103 + 6100000);
  assert.ok(!summary.approvals.some(a => a.id === competingApproval.id && a.status === 'pending'), '摘要审批队列不再出现作废挂单');
  const activeView = listBudgetVersionViews('PRJ-001').find(v => v.status === 'active');
  assert.equal(activeView?.id, id);
});

test('终态版本只读：归档/生效版本不能再改或再送审，非审批中版本不能给结论', () => {
  const draft = copyBudgetVersion('PRJ-001', { createdBy: '后期制片' });
  const id = draft.id;
  submitBudgetVersion(id, '后期制片');
  decideBudgetVersion(id, 'approved', '财务负责人');
  const view = budgetVersionView(id);
  expectError('VERSION_NOT_EDITABLE', () => bumpLine(id, view.revision, { 'BL-103': { forecast: 1 } }));
  expectError('VERSION_NOT_SUBMITTABLE', () => submitBudgetVersion(id, '后期制片'));
  const freshDraft = copyBudgetVersion('PRJ-001', { createdBy: '后期制片' });
  expectError('VERSION_NOT_IN_REVIEW', () => decideBudgetVersion(freshDraft.id, 'approved', '财务负责人'));
});

test('每个关键转折都写入同一条审计链', () => {
  const draft = copyBudgetVersion('PRJ-001', { name: '审计用草案', createdBy: '后期制片' });
  bumpLine(draft.id, 0, { 'BL-103': { forecast: 6100000 } }, '后期制片');
  submitBudgetVersion(draft.id, '后期制片');
  decideBudgetVersion(draft.id, 'rejected', '财务负责人', '再细化');
  const rejected = budgetVersionView(draft.id);
  bumpLine(draft.id, rejected.revision, { 'BL-103': { forecast: 6200000 } }, '后期制片');
  submitBudgetVersion(draft.id, '后期制片');
  decideBudgetVersion(draft.id, 'approved', '财务负责人', '通过');
  for (const action of ['BUDGET_VERSION_CREATE', 'BUDGET_VERSION_EDIT', 'BUDGET_VERSION_SUBMIT',
    'BUDGET_VERSION_REJECT', 'BUDGET_VERSION_RESUBMIT', 'BUDGET_VERSION_ACTIVATE']) {
    assert.ok(auditEvents.some(e => e.action === action && e.entityId === draft.id), `缺少审计动作 ${action}`);
  }
});
