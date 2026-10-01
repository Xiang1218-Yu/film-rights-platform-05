import express, { type Request, type Response } from 'express';
import { activateBudgetVersion, activeBudgetLines, addBudgetLine, approve, assets, budgetVersionDetail, contracts, createApproval, createBudgetVersion, dashboard, DomainError, listBudgetVersions, projectSummary, projects, removeBudgetLine, rightsConflicts, submitBudgetVersion, updateBudgetLine } from './domain.js';

const app = express(); app.use(express.json());

const handle = (fn: (req: Request<Record<string, string>>, res: Response) => unknown) => (req: Request<Record<string, string>>, res: Response) => {
  try { fn(req, res); } catch (error) {
    if (error instanceof DomainError) return res.status(error.status).json({ message: error.message, code: error.code });
    throw error;
  }
};

app.get('/api/dashboard', (_req, res) => res.json(dashboard()));
app.get('/api/projects', (_req, res) => res.json(projects));
app.get('/api/projects/:id/summary', (req, res) => { const result = projectSummary(req.params.id); if (!result.project) return res.status(404).json({ message: '项目不存在' }); res.json(result); });
app.get('/api/projects/:id/rights-conflicts', (req, res) => res.json(rightsConflicts(req.params.id)));
app.get('/api/projects/:id/assets', (req, res) => res.json(assets.filter(asset => asset.projectId === req.params.id)));
app.get('/api/projects/:id/contracts', (req, res) => res.json(contracts.filter(contract => contract.projectId === req.params.id)));
// 预算行始终读取项目当前生效版本，与项目摘要保持同一版本结果
app.get('/api/budgets/:projectId/lines', (req, res) => res.json(activeBudgetLines(req.params.projectId)));

// 预算版本工作流：复制草案 → 编辑 → 送审 → 获批 → 整版切换
app.get('/api/projects/:id/budget-versions', handle((req, res) => res.json(listBudgetVersions(req.params.id))));
app.post('/api/projects/:id/budget-versions', handle((req, res) => res.status(201).json(createBudgetVersion(req.params.id, { title: req.body?.title, createdBy: req.body?.createdBy || '后期制片', sourceVersionId: req.body?.sourceVersionId }))));
app.get('/api/budget-versions/:id', handle((req, res) => res.json(budgetVersionDetail(req.params.id))));
app.patch('/api/budget-versions/:id/lines/:lineId', handle((req, res) => { const { expectedRevision, actor, ...patch } = req.body ?? {}; res.json(updateBudgetLine(req.params.id, req.params.lineId, patch, expectedRevision, actor || '后期制片')); }));
app.post('/api/budget-versions/:id/lines', handle((req, res) => { const { expectedRevision, actor, ...line } = req.body ?? {}; res.status(201).json(addBudgetLine(req.params.id, line, expectedRevision, actor || '后期制片')); }));
app.delete('/api/budget-versions/:id/lines/:lineId', handle((req, res) => res.json(removeBudgetLine(req.params.id, req.params.lineId, req.body?.expectedRevision ?? Number(req.query.expectedRevision), req.body?.actor || '后期制片'))));
app.post('/api/budget-versions/:id/submit', handle((req, res) => res.json(submitBudgetVersion(req.params.id, req.body?.actor || '后期制片', req.body?.approver))));
app.post('/api/budget-versions/:id/activate', handle((req, res) => res.json(activateBudgetVersion(req.params.id, req.body?.actor || '财务负责人'))));

app.post('/api/approvals', (req, res) => res.status(201).json(createApproval(req.body)));
app.patch('/api/approvals/:id', (req, res) => { const result = approve(req.params.id, req.body.status, req.body.comment); if (!result) return res.status(404).json({ message: '审批不存在' }); res.json(result); });
app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'film-rights-platform' }));
const port = Number(process.env.PORT || 4104); app.listen(port, () => console.log(`film rights API listening on ${port}`));
