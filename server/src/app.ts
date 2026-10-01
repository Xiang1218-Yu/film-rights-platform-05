import express from 'express';
import {
  approve, assets, budgetVersionView, budgetVersions, contracts, copyBudgetVersion, createApproval,
  dashboard, decideBudgetVersion, listBudgetVersionViews, projectSummary, projects,
  rightsConflicts, submitBudgetVersion, updateDraftLines, WorkflowError,
} from './domain.js';

const app = express();
app.use(express.json());

function sendError(res: express.Response, error: unknown) {
  if (error instanceof WorkflowError) {
    return res.status(error.httpStatus).json({ code: error.code, message: error.message });
  }
  return res.status(500).json({ code: 'INTERNAL', message: error instanceof Error ? error.message : '服务内部错误' });
}

app.get('/api/dashboard', (_req, res) => res.json(dashboard()));
app.get('/api/projects', (_req, res) => res.json(projects));
app.get('/api/projects/:id/summary', (req, res) => {
  const result = projectSummary(req.params.id);
  if (!result.project) return res.status(404).json({ message: '项目不存在' });
  res.json(result);
});
app.get('/api/projects/:id/rights-conflicts', (req, res) => res.json(rightsConflicts(req.params.id)));
app.get('/api/projects/:id/assets', (req, res) => res.json(assets.filter(asset => asset.projectId === req.params.id)));
app.get('/api/projects/:id/contracts', (req, res) => res.json(contracts.filter(contract => contract.projectId === req.params.id)));

// 当前生效版本的科目行（服务端与控制台共用同一版本结果）
app.get('/api/budgets/:projectId/lines', (req, res) => {
  const active = budgetVersions.find(version => version.projectId === req.params.projectId && version.status === 'active');
  if (!active) return res.status(404).json({ message: '项目不存在或没有生效预算版本' });
  res.json(active.lines.map(line => ({ ...line, id: line.lineId, projectId: req.params.projectId })));
});

// ---- 预算版本工作流 --------------------------------------------------------
app.get('/api/projects/:id/budget-versions', (req, res) => {
  try { res.json(listBudgetVersionViews(req.params.id)); } catch (error) { sendError(res, error); }
});
app.get('/api/budget-versions/:versionId', (req, res) => {
  try { res.json(budgetVersionView(req.params.versionId)); } catch (error) { sendError(res, error); }
});
app.post('/api/projects/:id/budget-versions', (req, res) => {
  try {
    const version = copyBudgetVersion(req.params.id, {
      name: req.body?.name,
      basedOnVersionId: req.body?.basedOnVersionId,
      createdBy: req.body?.createdBy,
    });
    res.status(201).json(budgetVersionView(version.id));
  } catch (error) { sendError(res, error); }
});
app.put('/api/budget-versions/:versionId/lines', (req, res) => {
  try {
    const actor = req.body?.actor || '当前用户';
    const revision = Number(req.body?.revision);
    const version = updateDraftLines(req.params.versionId, req.body?.lines ?? [], revision, actor);
    res.json(budgetVersionView(version.id));
  } catch (error) { sendError(res, error); }
});
app.post('/api/budget-versions/:versionId/submit', (req, res) => {
  try {
    const { version } = submitBudgetVersion(req.params.versionId, req.body?.actor || '当前用户', req.body?.comment || '');
    res.json(budgetVersionView(version.id));
  } catch (error) { sendError(res, error); }
});
app.post('/api/budget-versions/:versionId/decision', (req, res) => {
  try {
    const decision = req.body?.decision;
    if (decision !== 'approved' && decision !== 'rejected') {
      return res.status(422).json({ code: 'INVALID_DECISION', message: 'decision 必须是 approved 或 rejected' });
    }
    const version = decideBudgetVersion(req.params.versionId, decision, req.body?.actor || '当前审批人', req.body?.comment || '');
    res.json(budgetVersionView(version.id));
  } catch (error) { sendError(res, error); }
});

app.post('/api/approvals', (req, res) => res.status(201).json(createApproval(req.body)));
app.patch('/api/approvals/:id', (req, res) => {
  try {
    const result = approve(req.params.id, req.body.status, req.body.comment ?? '', req.body.actor ?? '当前审批人');
    if (!result) return res.status(404).json({ message: '审批不存在' });
    res.json(result);
  } catch (error) { sendError(res, error); }
});
app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'film-rights-platform' }));

export default app;
