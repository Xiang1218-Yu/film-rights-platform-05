import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import app from './app.js';
import { setBudgetActivationGuard } from './domain.js';

const server = createServer(app);
await new Promise<void>(resolve => server.listen(0, resolve));
const port = (server.address() as AddressInfo).port;
const base = `http://127.0.0.1:${port}`;

async function call(method: string, path: string, body?: unknown) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await response.json().catch(() => ({}));
  return { status: response.status, json: json as Record<string, any> };
}

test('HTTP: 完整工作流——复制草案、差异、送审、驳回、修改、重送、整版激活', async () => {
  // 列表：初始只有生效 V3
  let list = await call('GET', '/api/projects/PRJ-001/budget-versions');
  assert.equal(list.status, 200);
  const initialIds = list.json.map((v: any) => v.id);
  assert.ok(initialIds.includes('BUD-001-V3'));

  // 复制草案
  const created = await call('POST', '/api/projects/PRJ-001/budget-versions', { name: 'V4 HTTP 试算', createdBy: '后期制片' });
  assert.equal(created.status, 201);
  const id = created.json.id as string;
  assert.equal(created.json.status, 'draft');
  assert.equal(created.json.baseline.id, 'BUD-001-V3');
  assert.ok(created.json.lines.every((l: any) => typeof l.varForecast === 'number'));

  // 修改一行：BL-103 计划 540万 -> 600万
  const lines = created.json.lines.map((l: any) => ({ lineId: l.lineId, planned: l.planned, committed: l.committed, actual: l.actual, forecast: l.forecast }));
  const bl103 = lines.find((l: any) => l.lineId === 'BL-103');
  bl103.planned = 6000000; bl103.forecast = 6200000;
  const saved = await call('PUT', `/api/budget-versions/${id}/lines`, { revision: 0, actor: '后期制片', lines });
  assert.equal(saved.status, 200);
  assert.equal(saved.json.revision, 1);

  // 生效基线接口与项目摘要都仍是 V3 的数字
  const baseline = await call('GET', '/api/budgets/PRJ-001/lines');
  assert.equal(baseline.json.find((l: any) => l.id === 'BL-103').planned, 5400000);
  const summary1 = await call('GET', '/api/projects/PRJ-001/summary');
  assert.equal(summary1.json.budgetVersion.id, 'BUD-001-V3');

  // 送审
  const submitted = await call('POST', `/api/budget-versions/${id}/submit`, { actor: '后期制片' });
  assert.equal(submitted.status, 200);
  assert.equal(submitted.json.status, 'in_review');
  assert.ok(submitted.json.openApprovalId);
  // 审批期间再次修改 / 重复送审 -> 409
  const editDuringReview = await call('PUT', `/api/budget-versions/${id}/lines`, { revision: 1, actor: 'x', lines });
  assert.equal(editDuringReview.status, 409);
  assert.equal(editDuringReview.json.code, 'VERSION_NOT_EDITABLE');
  assert.equal((await call('POST', `/api/budget-versions/${id}/submit`, { actor: '后期制片' })).status, 409);

  // 通过通用审批队列 PATCH 驳回
  const rejected = await call('PATCH', `/api/approvals/${submitted.json.openApprovalId}`, { status: 'rejected', actor: '财务负责人', comment: '再核一次外包' });
  assert.equal(rejected.status, 200);
  assert.equal((await call('GET', `/api/budget-versions/${id}`)).json.status, 'rejected');
  // 重复 PATCH 同一张审批单 -> 409
  assert.equal((await call('PATCH', `/api/approvals/${submitted.json.openApprovalId}`, { status: 'approved' })).status, 409);

  // 驳回后修改、重新送审（走版本决策接口批准）
  const revision2 = await call('PUT', `/api/budget-versions/${id}/lines`, { revision: 1, actor: '后期制片', lines });
  assert.equal(revision2.status, 200);
  const resubmitted = await call('POST', `/api/budget-versions/${id}/submit`, { actor: '后期制片', comment: '已复核外包' });
  assert.equal(resubmitted.json.reviewRound, 2);
  const approved = await call('POST', `/api/budget-versions/${id}/decision`, { decision: 'approved', actor: '财务负责人', comment: '整版通过' });
  assert.equal(approved.status, 200);
  assert.equal(approved.json.status, 'active');

  // 切换后：摘要、科目接口、版本列表三处同一结果；旧版归档
  const summary2 = await call('GET', '/api/projects/PRJ-001/summary');
  assert.equal(summary2.json.budgetVersion.id, id);
  assert.equal(summary2.json.lines.find((l: any) => l.id === 'BL-103').planned, 6000000);
  const linesAfter = await call('GET', '/api/budgets/PRJ-001/lines');
  assert.equal(linesAfter.json.find((l: any) => l.id === 'BL-103').planned, 6000000);
  const listAfter = await call('GET', '/api/projects/PRJ-001/budget-versions');
  assert.equal(listAfter.json.find((v: any) => v.id === 'BUD-001-V3').status, 'superseded');
  assert.equal(listAfter.json.filter((v: any) => v.status === 'active').length, 1, '任意时刻只有一个生效版本');

  // 审计链随详情返回
  const actions = approved.json.audit.map((e: any) => e.action);
  for (const action of ['BUDGET_VERSION_CREATE', 'BUDGET_VERSION_SUBMIT', 'BUDGET_VERSION_REJECT', 'BUDGET_VERSION_RESUBMIT', 'BUDGET_VERSION_ACTIVATE']) {
    assert.ok(actions.includes(action), `审计链缺少 ${action}`);
  }
});

test('HTTP: 并发编辑 409、空版本 422、未知科目 422', async () => {
  const created = await call('POST', '/api/projects/PRJ-002/budget-versions', { createdBy: '后期制片' });
  const id = created.json.id;
  const lines = created.json.lines.map((l: any) => ({ lineId: l.lineId, planned: l.planned, committed: l.committed, actual: l.actual, forecast: l.forecast }));

  const first = await call('PUT', `/api/budget-versions/${id}/lines`, { revision: 0, actor: 'A', lines });
  assert.equal(first.status, 200);
  const stale = await call('PUT', `/api/budget-versions/${id}/lines`, { revision: 0, actor: 'B', lines });
  assert.equal(stale.status, 409);
  assert.equal(stale.json.code, 'VERSION_CONFLICT');

  // 未知科目与当前 revision 无关：先于“清空保存”验证，避免与 revision 推进耦合
  const unknown = await call('PUT', `/api/budget-versions/${id}/lines`, {
    revision: 1, actor: 'A',
    lines: [{ lineId: 'BL-X', planned: 1, committed: 0, actual: 0, forecast: 1 }],
  });
  assert.equal(unknown.status, 422);
  assert.equal(unknown.json.code, 'UNKNOWN_LINE');

  const empty = await call('PUT', `/api/budget-versions/${id}/lines`, { revision: 1, actor: 'A', lines: [] });
  assert.equal(empty.status, 200, '空内容允许保存为编辑中途态');
  const submitEmpty = await call('POST', `/api/budget-versions/${id}/submit`, { actor: 'A' });
  assert.equal(submitEmpty.status, 422);
  assert.equal(submitEmpty.json.code, 'EMPTY_VERSION');

  assert.equal((await call('GET', `/api/budget-versions/NOPE`)).status, 404);
});

test('HTTP: 切换失败 503 且基线不动，重试成功', async () => {
  const created = await call('POST', '/api/projects/PRJ-002/budget-versions', { name: '守卫试算', createdBy: '后期制片' });
  const id = created.json.id;
  await call('POST', `/api/budget-versions/${id}/submit`, { actor: '后期制片' });
  setBudgetActivationGuard(() => { throw new Error('台账不可用'); });
  const failed = await call('POST', `/api/budget-versions/${id}/decision`, { decision: 'approved', actor: '财务负责人' });
  assert.equal(failed.status, 503);
  assert.equal(failed.json.code, 'ACTIVATION_FAILED');
  const summary = await call('GET', '/api/projects/PRJ-002/summary');
  assert.equal(summary.json.budgetVersion.id, 'BUD-002-V2', '失败后控制台/服务端读到的仍是旧基线');
  setBudgetActivationGuard(null);
  const retried = await call('POST', `/api/budget-versions/${id}/decision`, { decision: 'approved', actor: '财务负责人' });
  assert.equal(retried.status, 200);
  assert.equal((await call('GET', '/api/projects/PRJ-002/summary')).json.budgetVersion.id, id);
});

test.after(async () => { await once(server.close(), 'close'); });
