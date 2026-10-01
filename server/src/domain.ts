export type ProjectStatus = 'development' | 'production' | 'post' | 'delivered';
export type AssetType = 'master' | 'trailer' | 'poster' | 'audio' | 'subtitle';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected';
export type BudgetVersionStatus = 'draft' | 'pending' | 'approved' | 'active' | 'archived';

export interface Project { id: string; code: string; title: string; season: number; status: ProjectStatus; currency: string; budgetVersionId: string; deliveryDate: string; }
export interface BudgetLine { id: string; projectId: string; category: string; subcategory: string; planned: number; committed: number; actual: number; forecast: number; owner: string; risk: 'low' | 'medium' | 'high'; }
export interface BudgetVersion { id: string; projectId: string; label: string; title: string; status: BudgetVersionStatus; revision: number; sourceVersionId?: string; createdBy: string; createdAt: string; updatedAt: string; submittedAt?: string; approvedAt?: string; activatedAt?: string; lines: BudgetLine[]; }
export interface Contract { id: string; projectId: string; vendor: string; scope: string; ceiling: number; committed: number; paid: number; milestones: { name: string; due: string; amount: number; status: 'open' | 'invoiced' | 'paid' }[]; }
export interface Asset { id: string; projectId: string; name: string; type: AssetType; version: number; status: 'draft' | 'review' | 'approved' | 'locked'; owner: string; checksum: string; territories: string[]; platforms: string[]; availableFrom: string; availableTo: string; rightsTags: string[]; }
export interface Approval { id: string; projectId: string; entityType: 'budget' | 'asset' | 'delivery'; entityId: string; title: string; requestedBy: string; status: ApprovalStatus; approver: string; createdAt: string; comment?: string; }
export interface AuditEvent { id: string; action: string; entity: string; entityId: string; actor: string; at: string; details: string; }

export class DomainError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); this.name = 'DomainError'; }
}

const now = Date.now();
const iso = (days: number) => new Date(now + days * 86400000).toISOString().slice(0, 10);

export const projects: Project[] = [
  { id: 'PRJ-001', code: 'NORTHSTAR-S1', title: 'Northstar / 北境回声', season: 1, status: 'post', currency: 'CNY', budgetVersionId: 'BUD-001-V3', deliveryDate: iso(44) },
  { id: 'PRJ-002', code: 'ORBIT-DOC', title: 'Orbit / 轨道之外', season: 1, status: 'production', currency: 'CNY', budgetVersionId: 'BUD-002-V2', deliveryDate: iso(126) }
];

// 预算版本采用整版快照：草案复制全部科目独立编辑，获批后通过翻转 project.budgetVersionId 一次性生效，
// 不会出现部分科目先成为基线的中间态。revision 是乐观锁，所有修改必须携带 expectedRevision。
export const budgetVersions: BudgetVersion[] = [
  {
    id: 'BUD-001-V3', projectId: 'PRJ-001', label: 'V3', title: '后期超支预案 V3', status: 'active', revision: 1,
    createdBy: '制片主任', createdAt: new Date(now - 86400000).toISOString(), updatedAt: new Date(now - 86400000).toISOString(), activatedAt: new Date(now - 86400000).toISOString(),
    lines: [
      { id: 'BL-101', projectId: 'PRJ-001', category: '制作', subcategory: '主演与主创', planned: 12800000, committed: 11200000, actual: 10400000, forecast: 13100000, owner: '制片部', risk: 'medium' },
      { id: 'BL-102', projectId: 'PRJ-001', category: '制作', subcategory: '摄影器材与场地', planned: 6800000, committed: 6400000, actual: 5980000, forecast: 7020000, owner: '现场制片', risk: 'low' },
      { id: 'BL-103', projectId: 'PRJ-001', category: '后期', subcategory: '调色、DIT、母版', planned: 5400000, committed: 4300000, actual: 2800000, forecast: 5750000, owner: '后期制片', risk: 'high' },
      { id: 'BL-104', projectId: 'PRJ-001', category: '宣发', subcategory: '预告片与物料', planned: 3600000, committed: 1900000, actual: 1240000, forecast: 3200000, owner: '营销部', risk: 'medium' }
    ]
  },
  {
    id: 'BUD-002-V2', projectId: 'PRJ-002', label: 'V2', title: '纪录片执行预算 V2', status: 'active', revision: 1,
    createdBy: '制片主任', createdAt: new Date(now - 172800000).toISOString(), updatedAt: new Date(now - 172800000).toISOString(), activatedAt: new Date(now - 172800000).toISOString(),
    lines: [
      { id: 'BL-201', projectId: 'PRJ-002', category: '制作', subcategory: '跨国拍摄', planned: 9200000, committed: 5100000, actual: 3300000, forecast: 9000000, owner: '制片部', risk: 'medium' }
    ]
  }
];

export const contracts: Contract[] = [
  { id: 'CTR-01', projectId: 'PRJ-001', vendor: '曜石后期制作', scope: '4K HDR 调色、声音、DCP 母版', ceiling: 5200000, committed: 4300000, paid: 2300000, milestones: [{ name: '锁剪交付', due: iso(8), amount: 1200000, status: 'invoiced' }, { name: '母版验收', due: iso(36), amount: 2000000, status: 'open' }] },
  { id: 'CTR-02', projectId: 'PRJ-001', vendor: '远景国际版权', scope: '北美与欧洲音乐同步许可', ceiling: 880000, committed: 880000, paid: 440000, milestones: [{ name: '签署', due: iso(-16), amount: 440000, status: 'paid' }, { name: '交付版权证明', due: iso(4), amount: 440000, status: 'invoiced' }] },
  { id: 'CTR-03', projectId: 'PRJ-002', vendor: '云帧视觉', scope: '纪录片航拍与卫星素材', ceiling: 1600000, committed: 1100000, paid: 600000, milestones: [{ name: '素材包一', due: iso(20), amount: 500000, status: 'open' }] }
];
export const assets: Asset[] = [
  { id: 'AST-001', projectId: 'PRJ-001', name: '北境回声 S01E01 4K HDR Master', type: 'master', version: 7, status: 'review', owner: '后期制片', checksum: 'sha256:91b7…e2a1', territories: ['CN', 'HK', 'SG'], platforms: ['影院', 'StreamBox'], availableFrom: iso(-2), availableTo: iso(730), rightsTags: ['音乐-同步许可', '演员-全媒介'] },
  { id: 'AST-002', projectId: 'PRJ-001', name: '主预告 90s / Cut A', type: 'trailer', version: 4, status: 'approved', owner: '营销部', checksum: 'sha256:42ca…9b02', territories: ['CN'], platforms: ['StreamBox', '短视频'], availableFrom: iso(6), availableTo: iso(180), rightsTags: ['演员-宣传许可'] },
  { id: 'AST-003', projectId: 'PRJ-001', name: '片尾曲 / Winter Signal', type: 'audio', version: 2, status: 'locked', owner: '音乐版权', checksum: 'sha256:113c…78f0', territories: ['CN', 'US', 'CA'], platforms: ['影院', 'StreamBox'], availableFrom: iso(-40), availableTo: iso(52), rightsTags: ['音乐-同步许可'] },
  { id: 'AST-004', projectId: 'PRJ-002', name: 'Orbit E02 Satellite Plates', type: 'master', version: 3, status: 'review', owner: '视觉总监', checksum: 'sha256:8a10…4a9d', territories: ['全球'], platforms: ['影院'], availableFrom: iso(18), availableTo: iso(365), rightsTags: ['航拍-编辑许可'] }
];
export const approvals: Approval[] = [
  { id: 'APR-01', projectId: 'PRJ-001', entityType: 'budget', entityId: 'BUD-001-V3', title: '后期超支预案 V3', requestedBy: '制片主任', status: 'pending', approver: '财务负责人', createdAt: iso(-1) },
  { id: 'APR-02', projectId: 'PRJ-001', entityType: 'asset', entityId: 'AST-001', title: 'E01 最终母版锁定', requestedBy: '后期制片', status: 'pending', approver: '总制片人', createdAt: iso(-2) },
  { id: 'APR-03', projectId: 'PRJ-002', entityType: 'delivery', entityId: 'DEL-007', title: '海外节展交付包', requestedBy: '发行部', status: 'approved', approver: '法务负责人', createdAt: iso(-5), comment: '已补充航拍授权凭证' }
];
export const auditEvents: AuditEvent[] = [{ id: 'AUD-01', action: 'CREATE', entity: 'budget', entityId: 'BUD-001-V3', actor: '制片主任', at: new Date(now - 86400000).toISOString(), details: '从 V2 复制并调整后期科目' }];

let seq = 0;
const nextId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${++seq}`;
export function recordAudit(action: string, entity: string, entityId: string, actor: string, details: string) {
  const event: AuditEvent = { id: nextId('AUD'), action, entity, entityId, actor, at: new Date().toISOString(), details };
  auditEvents.unshift(event);
  return event;
}

// ---------- 预算版本工作流 ----------

const AMOUNT_FIELDS = ['planned', 'committed', 'actual', 'forecast'] as const;
export type LinePatch = Partial<Pick<BudgetLine, 'category' | 'subcategory' | 'planned' | 'committed' | 'actual' | 'forecast' | 'owner' | 'risk'>>;

export function getBudgetVersion(versionId: string) { return budgetVersions.find(version => version.id === versionId); }
export function activeBudgetVersion(projectId: string) {
  const project = projects.find(item => item.id === projectId);
  return project ? getBudgetVersion(project.budgetVersionId) : undefined;
}
export function activeBudgetLines(projectId: string) { return activeBudgetVersion(projectId)?.lines ?? []; }

function lineTotals(lines: BudgetLine[]) {
  return lines.reduce((totals, line) => ({ planned: totals.planned + line.planned, committed: totals.committed + line.committed, actual: totals.actual + line.actual, forecast: totals.forecast + line.forecast }), { planned: 0, committed: 0, actual: 0, forecast: 0 });
}

function validateLineInput(input: LinePatch) {
  if (input.category !== undefined && !input.category.trim()) throw new DomainError(422, 'INVALID_LINE', '科目类别不能为空');
  if (input.subcategory !== undefined && !input.subcategory.trim()) throw new DomainError(422, 'INVALID_LINE', '科目名称不能为空');
  for (const field of AMOUNT_FIELDS) {
    const value = input[field];
    if (value !== undefined && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) throw new DomainError(422, 'INVALID_AMOUNT', '计划/承诺/实际/预测必须是非负数字');
  }
  if (input.risk !== undefined && !['low', 'medium', 'high'].includes(input.risk)) throw new DomainError(422, 'INVALID_LINE', '风险等级必须是 low/medium/high');
}

function requireVersion(versionId: string) {
  const version = getBudgetVersion(versionId);
  if (!version) throw new DomainError(404, 'VERSION_NOT_FOUND', `预算版本 ${versionId} 不存在`);
  return version;
}

function requireEditable(version: BudgetVersion) {
  if (version.status === 'pending') throw new DomainError(409, 'VERSION_LOCKED', '版本已送审，审批期间不能修改；请先驳回或撤回后再编辑');
  if (version.status !== 'draft') throw new DomainError(409, 'VERSION_LOCKED', `只有草稿状态可以编辑，当前状态为 ${version.status}`);
}

function requireRevision(version: BudgetVersion, expectedRevision: unknown) {
  if (typeof expectedRevision !== 'number') throw new DomainError(400, 'REVISION_REQUIRED', '缺少 expectedRevision，请先读取最新版本再修改');
  if (version.revision !== expectedRevision) throw new DomainError(409, 'REVISION_CONFLICT', `版本已被他人修改（当前 revision ${version.revision}），请刷新后重试`);
}

function touch(version: BudgetVersion) { version.revision += 1; version.updatedAt = new Date().toISOString(); }

export function listBudgetVersions(projectId: string) {
  return budgetVersions
    .filter(version => version.projectId === projectId)
    .map(version => ({ id: version.id, projectId: version.projectId, label: version.label, title: version.title, status: version.status, revision: version.revision, sourceVersionId: version.sourceVersionId, createdBy: version.createdBy, createdAt: version.createdAt, updatedAt: version.updatedAt, lineCount: version.lines.length, ...lineTotals(version.lines) }));
}

export function createBudgetVersion(projectId: string, input: { title?: string; createdBy: string; sourceVersionId?: string }) {
  const project = projects.find(item => item.id === projectId);
  if (!project) throw new DomainError(404, 'PROJECT_NOT_FOUND', '项目不存在');
  const source = input.sourceVersionId ? getBudgetVersion(input.sourceVersionId) : activeBudgetVersion(projectId);
  if (!source || source.projectId !== projectId) throw new DomainError(404, 'SOURCE_VERSION_NOT_FOUND', '源版本不存在或不属于该项目');
  const nextNumber = budgetVersions.filter(version => version.projectId === projectId).reduce((max, version) => Math.max(max, Number(version.label.replace(/^V/, '')) || 0), 0) + 1;
  const label = `V${nextNumber}`;
  const title = input.title?.trim() || (source.title.endsWith(source.label) ? `${source.title.slice(0, -source.label.length)}${label}` : `${source.title} (${label})`);
  const version: BudgetVersion = {
    id: `BUD-${projectId.split('-')[1]}-${label}`, projectId, label, title, status: 'draft', revision: 1,
    sourceVersionId: source.id, createdBy: input.createdBy, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    lines: source.lines.map(line => ({ ...line }))
  };
  budgetVersions.unshift(version);
  recordAudit('CREATE', 'budget', version.id, input.createdBy, `从 ${source.label}（${source.id}）复制生成草案 ${label}，共 ${version.lines.length} 个科目`);
  return version;
}

export interface BudgetLineDiff { lineId: string; category: string; subcategory: string; change: 'added' | 'removed' | 'modified' | 'unchanged'; base?: BudgetLine; next?: BudgetLine; delta: { planned: number; committed: number; actual: number; forecast: number }; }

export function budgetVersionDiff(versionId: string) {
  const version = requireVersion(versionId);
  const base = activeBudgetVersion(version.projectId);
  const baseLines = base ? base.lines : [];
  const baseById = new Map(baseLines.map(line => [line.id, line]));
  const lines: BudgetLineDiff[] = version.lines.map(line => {
    const baseline = baseById.get(line.id);
    const delta = { planned: line.planned - (baseline?.planned ?? 0), committed: line.committed - (baseline?.committed ?? 0), actual: line.actual - (baseline?.actual ?? 0), forecast: line.forecast - (baseline?.forecast ?? 0) };
    const changed = AMOUNT_FIELDS.some(field => delta[field] !== 0);
    return { lineId: line.id, category: line.category, subcategory: line.subcategory, change: !baseline ? 'added' : changed ? 'modified' : 'unchanged', base: baseline, next: line, delta };
  });
  for (const baseline of baseLines) {
    if (!version.lines.some(line => line.id === baseline.id)) lines.push({ lineId: baseline.id, category: baseline.category, subcategory: baseline.subcategory, change: 'removed', base: baseline, delta: { planned: -baseline.planned, committed: -baseline.committed, actual: -baseline.actual, forecast: -baseline.forecast } });
  }
  const versionTotals = lineTotals(version.lines);
  const baseTotals = lineTotals(baseLines);
  return { versionId: version.id, baseVersionId: base?.id ?? null, lines, totals: { planned: versionTotals.planned - baseTotals.planned, committed: versionTotals.committed - baseTotals.committed, actual: versionTotals.actual - baseTotals.actual, forecast: versionTotals.forecast - baseTotals.forecast } };
}

export function budgetVersionDetail(versionId: string) {
  const version = requireVersion(versionId);
  return { ...version, totals: lineTotals(version.lines), diff: budgetVersionDiff(versionId), approvals: approvals.filter(item => item.entityType === 'budget' && item.entityId === version.id) };
}

export function updateBudgetLine(versionId: string, lineId: string, patch: LinePatch, expectedRevision: unknown, actor: string) {
  const version = requireVersion(versionId);
  requireEditable(version);
  requireRevision(version, expectedRevision);
  const line = version.lines.find(item => item.id === lineId);
  if (!line) throw new DomainError(404, 'LINE_NOT_FOUND', `科目 ${lineId} 不在版本 ${version.label} 中`);
  validateLineInput(patch);
  for (const field of ['category', 'subcategory', 'owner', 'risk', ...AMOUNT_FIELDS] as const) {
    const value = patch[field];
    if (value !== undefined) (line as unknown as Record<string, unknown>)[field] = value;
  }
  touch(version);
  recordAudit('UPDATE', 'budget', version.id, actor, `调整 ${version.label} 科目「${line.category}/${line.subcategory}」`);
  return { version, line };
}

export function addBudgetLine(versionId: string, input: { category: string; subcategory: string; planned?: number; committed?: number; actual?: number; forecast?: number; owner?: string; risk?: BudgetLine['risk'] }, expectedRevision: unknown, actor: string) {
  const version = requireVersion(versionId);
  requireEditable(version);
  requireRevision(version, expectedRevision);
  if (!input.category?.trim() || !input.subcategory?.trim()) throw new DomainError(422, 'INVALID_LINE', '新增科目必须填写类别与名称');
  validateLineInput(input);
  const line: BudgetLine = { id: nextId('BL'), projectId: version.projectId, category: input.category.trim(), subcategory: input.subcategory.trim(), planned: input.planned ?? 0, committed: input.committed ?? 0, actual: input.actual ?? 0, forecast: input.forecast ?? 0, owner: input.owner?.trim() || actor, risk: input.risk ?? 'medium' };
  version.lines.push(line);
  touch(version);
  recordAudit('UPDATE', 'budget', version.id, actor, `在 ${version.label} 新增科目「${line.category}/${line.subcategory}」`);
  return { version, line };
}

export function removeBudgetLine(versionId: string, lineId: string, expectedRevision: unknown, actor: string) {
  const version = requireVersion(versionId);
  requireEditable(version);
  requireRevision(version, expectedRevision);
  const index = version.lines.findIndex(item => item.id === lineId);
  if (index < 0) throw new DomainError(404, 'LINE_NOT_FOUND', `科目 ${lineId} 不在版本 ${version.label} 中`);
  const [removed] = version.lines.splice(index, 1);
  touch(version);
  recordAudit('UPDATE', 'budget', version.id, actor, `从 ${version.label} 移除科目「${removed.category}/${removed.subcategory}」`);
  return { version, removed };
}

export function submitBudgetVersion(versionId: string, actor: string, approver = '财务负责人') {
  const version = requireVersion(versionId);
  if (version.status !== 'draft') throw new DomainError(409, 'ALREADY_SUBMITTED', `版本当前状态为 ${version.status}，不能重复提交`);
  if (version.lines.length === 0) throw new DomainError(422, 'EMPTY_VERSION', '空版本不能送审，请至少保留一个预算科目');
  version.lines.forEach(line => validateLineInput(line));
  version.status = 'pending';
  version.submittedAt = new Date().toISOString();
  touch(version);
  const approval = createApproval({ projectId: version.projectId, entityType: 'budget', entityId: version.id, title: version.title, requestedBy: actor, approver });
  recordAudit('SUBMIT', 'budget', version.id, actor, `${version.label}「${version.title}」送审，审批人 ${approver}，共 ${version.lines.length} 个科目`);
  return { version, approval };
}

export function activateBudgetVersion(versionId: string, actor: string) {
  const version = requireVersion(versionId);
  const project = projects.find(item => item.id === version.projectId);
  if (!project) throw new DomainError(404, 'PROJECT_NOT_FOUND', '项目不存在');
  // 幂等重试：已经生效的版本直接返回当前状态，不产生重复审计
  if (project.budgetVersionId === version.id && version.status === 'active') return { version, project, alreadyActive: true };
  if (version.status !== 'approved') throw new DomainError(409, 'NOT_APPROVED', `版本未整版获批（当前状态 ${version.status}），不能切换为生效版本`);
  if (version.lines.length === 0) throw new DomainError(422, 'EMPTY_VERSION', '空版本不能切换为项目基线');
  // 原子切换：同步块内一次性完成旧版归档、新版生效与基线指针翻转，读取方不会看到半版科目
  const previous = activeBudgetVersion(version.projectId);
  if (previous && previous.id !== version.id) { previous.status = 'archived'; previous.updatedAt = new Date().toISOString(); }
  version.status = 'active';
  version.activatedAt = new Date().toISOString();
  touch(version);
  project.budgetVersionId = version.id;
  recordAudit('ACTIVATE', 'budget', version.id, actor, `${version.label}「${version.title}」整版获批，已切换为 ${project.code} 的生效基线${previous && previous.id !== version.id ? `，${previous.label} 已归档` : ''}`);
  return { version, project, alreadyActive: false };
}

// ---------- 项目摘要 / 版权冲突 ----------

export function projectSummary(projectId = projects[0].id) {
  const lines = activeBudgetLines(projectId);
  const projectContracts = contracts.filter(contract => contract.projectId === projectId);
  const projectAssets = assets.filter(asset => asset.projectId === projectId);
  const projectApprovals = approvals.filter(approval => approval.projectId === projectId);
  const planned = lines.reduce((sum, line) => sum + line.planned, 0);
  const forecast = lines.reduce((sum, line) => sum + line.forecast, 0);
  const actual = lines.reduce((sum, line) => sum + line.actual, 0);
  const budgetVersion = activeBudgetVersion(projectId);
  return { project: projects.find(project => project.id === projectId), budgetVersion: budgetVersion ? { id: budgetVersion.id, label: budgetVersion.label, title: budgetVersion.title, status: budgetVersion.status, revision: budgetVersion.revision } : undefined, planned, forecast, actual, variance: forecast - planned, utilization: planned ? actual / planned : 0, committed: lines.reduce((sum, line) => sum + line.committed, 0), contractExposure: projectContracts.reduce((sum, contract) => sum + contract.ceiling, 0), assetCount: projectAssets.length, pendingApprovals: projectApprovals.filter(item => item.status === 'pending').length, highRiskLines: lines.filter(line => line.risk === 'high'), lines, contracts: projectContracts, assets: projectAssets, approvals: projectApprovals };
}

export function rightsConflicts(projectId = projects[0].id) {
  const list = assets.filter(asset => asset.projectId === projectId);
  const conflicts: { severity: 'critical' | 'warning'; assetA: string; assetB: string; reason: string }[] = [];
  for (let i = 0; i < list.length; i += 1) for (let j = i + 1; j < list.length; j += 1) {
    const a = list[i], b = list[j];
    const sameTag = a.rightsTags.some(tag => b.rightsTags.includes(tag));
    const sameTerritory = a.territories.includes('全球') || b.territories.includes('全球') || a.territories.some(territory => b.territories.includes(territory));
    if (sameTag && sameTerritory && a.availableTo >= b.availableFrom && b.availableTo >= a.availableFrom) conflicts.push({ severity: a.status === 'locked' || b.status === 'locked' ? 'critical' : 'warning', assetA: a.name, assetB: b.name, reason: `同一授权标签在重叠窗口内覆盖相同地域：${a.rightsTags.filter(tag => b.rightsTags.includes(tag)).join('、')}` });
  }
  return conflicts;
}

export function approve(id: string, status: ApprovalStatus, comment = '') {
  const item = approvals.find(approval => approval.id === id); if (!item) return undefined;
  item.status = status; item.comment = comment;
  let details = comment || `${item.title} 已${status === 'approved' ? '通过' : '驳回'}`;
  // 预算版本审批联动：仅处理送审中的版本；获批后等待切换，驳回退回草稿可修改后重新送审
  if (item.entityType === 'budget') {
    const version = getBudgetVersion(item.entityId);
    if (version && version.status === 'pending') {
      version.status = status === 'approved' ? 'approved' : 'draft';
      if (status === 'approved') version.approvedAt = new Date().toISOString();
      touch(version);
      details += status === 'approved' ? `；版本 ${version.label} 已整版获批，等待切换为生效基线` : `；版本 ${version.label} 已退回草稿，可修改后重新送审`;
    }
  }
  recordAudit(status.toUpperCase(), item.entityType, item.entityId, '当前审批人', details);
  return item;
}
export function createApproval(input: Pick<Approval, 'projectId' | 'entityType' | 'entityId' | 'title' | 'requestedBy' | 'approver'>) { const item: Approval = { ...input, id: nextId('APR'), status: 'pending', createdAt: new Date().toISOString() }; approvals.unshift(item); return item; }
export function dashboard() { return projects.map(project => projectSummary(project.id)).map(summary => ({ id: summary.project?.id, title: summary.project?.title, status: summary.project?.status, forecast: summary.forecast, variance: summary.variance, pendingApprovals: summary.pendingApprovals, rightsConflicts: rightsConflicts(summary.project?.id).length })); }
