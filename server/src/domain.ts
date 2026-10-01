export type ProjectStatus = 'development' | 'production' | 'post' | 'delivered';
export type AssetType = 'master' | 'trailer' | 'poster' | 'audio' | 'subtitle';
export type ApprovalStatus = 'pending' | 'approved' | 'rejected';

export interface Project { id: string; code: string; title: string; season: number; status: ProjectStatus; currency: string; budgetVersionId: string; deliveryDate: string; }
export interface BudgetLine { id: string; projectId: string; category: string; subcategory: string; planned: number; committed: number; actual: number; forecast: number; owner: string; risk: 'low' | 'medium' | 'high'; }
export interface Contract { id: string; projectId: string; vendor: string; scope: string; ceiling: number; committed: number; paid: number; milestones: { name: string; due: string; amount: number; status: 'open' | 'invoiced' | 'paid' }[]; }
export interface Asset { id: string; projectId: string; name: string; type: AssetType; version: number; status: 'draft' | 'review' | 'approved' | 'locked'; owner: string; checksum: string; territories: string[]; platforms: string[]; availableFrom: string; availableTo: string; rightsTags: string[]; }
export interface Approval { id: string; projectId: string; entityType: 'budget' | 'asset' | 'delivery'; entityId: string; title: string; requestedBy: string; status: ApprovalStatus; approver: string; createdAt: string; comment?: string; }
export interface AuditEvent { id: string; action: string; entity: string; entityId: string; actor: string; at: string; details: string; }

// ---------------------------------------------------------------------------
// 预算版本工作流
//
// 采用整版快照而不是变更集：每个版本自带完整科目行，草案修改与审批过程都在
// 快照上进行，与项目当前生效基线物理隔离。获批切换时只有一个发布动作
// （project.budgetVersionId 指针翻转），因此不存在逐行 apply 中途让半版科目
// 短暂成为基线的窗口。
// ---------------------------------------------------------------------------

export type BudgetVersionStatus = 'draft' | 'in_review' | 'rejected' | 'active' | 'superseded';

export interface BudgetVersionLine {
  lineId: string;
  category: string;
  subcategory: string;
  planned: number;
  committed: number;
  actual: number;
  forecast: number;
  owner: string;
  risk: 'low' | 'medium' | 'high';
}

export interface BudgetVersion {
  id: string;
  projectId: string;
  name: string;
  status: BudgetVersionStatus;
  basedOnVersionId: string | null;
  lines: BudgetVersionLine[];
  /** 乐观并发版本号：每次保存 +1，保存时必须携带当前 revision，防止两人同时编辑互相覆盖 */
  revision: number;
  /** 送审轮次：首次送审为 1，驳回后重新送审递增 */
  reviewRound: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  submittedAt?: string;
  decidedAt?: string;
  approver?: string;
  decisionComment?: string;
  /** 当前轮次对应的审批单 id，审批期间重复送审 / 审批结论都挂在这一轮上 */
  openApprovalId?: string;
}

export interface LineAmountInput { lineId: string; planned: number; committed: number; actual: number; forecast: number; }

/** 工作流可预期错误：code 供客户端分支处理，httpStatus 供 REST 层映射 */
export class WorkflowError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  constructor(code: string, message: string, httpStatus = 409) {
    super(message);
    this.name = 'WorkflowError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

const STATUS_TEXT: Record<BudgetVersionStatus, string> = {
  draft: '草案',
  in_review: '审批中',
  rejected: '已驳回',
  active: '生效中',
  superseded: '已归档',
};
const FIELD_TEXT: Record<'planned' | 'committed' | 'actual' | 'forecast', string> = {
  planned: '计划金额',
  committed: '承诺金额',
  actual: '实际金额',
  forecast: '预测金额',
};
const AMOUNT_FIELDS = ['planned', 'committed', 'actual', 'forecast'] as const;

const now = Date.now();
const iso = (days: number) => new Date(now + days * 86400000).toISOString().slice(0, 10);
const stamp = () => new Date().toISOString();

export const projects: Project[] = [
  { id: 'PRJ-001', code: 'NORTHSTAR-S1', title: 'Northstar / 北境回声', season: 1, status: 'post', currency: 'CNY', budgetVersionId: 'BUD-001-V3', deliveryDate: iso(44) },
  { id: 'PRJ-002', code: 'ORBIT-DOC', title: 'Orbit / 轨道之外', season: 1, status: 'production', currency: 'CNY', budgetVersionId: 'BUD-002-V2', deliveryDate: iso(126) }
];

/** 种子科目行：仅用于引导出生效版本快照，之后所有读取都以版本为准 */
export const budgetLines: BudgetLine[] = [
  { id: 'BL-101', projectId: 'PRJ-001', category: '制作', subcategory: '主演与主创', planned: 12800000, committed: 11200000, actual: 10400000, forecast: 13100000, owner: '制片部', risk: 'medium' },
  { id: 'BL-102', projectId: 'PRJ-001', category: '制作', subcategory: '摄影器材与场地', planned: 6800000, committed: 6400000, actual: 5980000, forecast: 7020000, owner: '现场制片', risk: 'low' },
  { id: 'BL-103', projectId: 'PRJ-001', category: '后期', subcategory: '调色、DIT、母版', planned: 5400000, committed: 4300000, actual: 2800000, forecast: 5750000, owner: '后期制片', risk: 'high' },
  { id: 'BL-104', projectId: 'PRJ-001', category: '宣发', subcategory: '预告片与物料', planned: 3600000, committed: 1900000, actual: 1240000, forecast: 3200000, owner: '营销部', risk: 'medium' },
  { id: 'BL-201', projectId: 'PRJ-002', category: '制作', subcategory: '跨国拍摄', planned: 9200000, committed: 5100000, actual: 3300000, forecast: 9000000, owner: '制片部', risk: 'medium' }
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
export const auditEvents: AuditEvent[] = [{ id: 'AUD-01', action: 'BUDGET_VERSION_CREATE', entity: 'budget', entityId: 'BUD-001-V3', actor: '制片主任', at: new Date(now - 86400000).toISOString(), details: '从 V2 复制并调整后期科目，V3 整版获批后成为生效基线' }];

// ---------------------------------------------------------------------------
// 版本仓储（内存单例；REST 与控制台经同一组函数读取同一结果）
// ---------------------------------------------------------------------------

export const budgetVersions: BudgetVersion[] = [];

function seedVersion(id: string, projectId: string, name: string, createdBy: string, at: string): BudgetVersion {
  return {
    id, projectId, name, status: 'active', basedOnVersionId: null,
    lines: budgetLines
      .filter(line => line.projectId === projectId)
      .map(line => ({ lineId: line.id, category: line.category, subcategory: line.subcategory, planned: line.planned, committed: line.committed, actual: line.actual, forecast: line.forecast, owner: line.owner, risk: line.risk })),
    revision: 0, reviewRound: 0, createdBy, createdAt: at, updatedAt: at,
  };
}
budgetVersions.push(seedVersion('BUD-001-V3', 'PRJ-001', '后期超支预案 V3', '制片主任', new Date(now - 86400000).toISOString()));
budgetVersions.push(seedVersion('BUD-002-V2', 'PRJ-002', '制作预算 V2', '制片主任', new Date(now - 20 * 86400000).toISOString()));

let workflowSeq = 0;
let approvalSeq = 0;
let auditSeq = 0;
const newWorkflowId = (projectId: string) => `BUD-${projectId}-DRAFT-${Date.now().toString(36).toUpperCase()}-${++workflowSeq}`;

function recordAudit(action: string, entity: string, entityId: string, actor: string, details: string): AuditEvent {
  const event: AuditEvent = { id: `AUD-${Date.now()}-${++auditSeq}`, action, entity, entityId, actor, at: stamp(), details };
  auditEvents.unshift(event);
  return event;
}

function totalsOf(lines: BudgetVersionLine[]) {
  const planned = lines.reduce((sum, line) => sum + line.planned, 0);
  const committed = lines.reduce((sum, line) => sum + line.committed, 0);
  const actual = lines.reduce((sum, line) => sum + line.actual, 0);
  const forecast = lines.reduce((sum, line) => sum + line.forecast, 0);
  return { planned, committed, actual, forecast, variance: forecast - planned };
}

export function activeBudgetVersion(projectId: string): BudgetVersion | undefined {
  return budgetVersions.find(version => version.projectId === projectId && version.status === 'active');
}

export function getBudgetVersion(versionId: string): BudgetVersion | undefined {
  return budgetVersions.find(version => version.id === versionId);
}

function requireVersion(versionId: string): BudgetVersion {
  const version = getBudgetVersion(versionId);
  if (!version) throw new WorkflowError('VERSION_NOT_FOUND', '预算版本不存在', 404);
  return version;
}

function requireProject(projectId: string): Project {
  const project = projects.find(item => item.id === projectId);
  if (!project) throw new WorkflowError('PROJECT_NOT_FOUND', '项目不存在', 404);
  return project;
}

/** 规范科目目录：始终以当前生效版本为准，草案只能引用既有科目 */
function lineCatalog(projectId: string): Map<string, BudgetVersionLine> {
  const active = activeBudgetVersion(projectId);
  if (!active) throw new WorkflowError('NO_BASELINE', '项目尚无生效预算基线，无法建立科目目录', 409);
  return new Map(active.lines.map(line => [line.lineId, line]));
}

function validateAmounts(version: BudgetVersion, lines: { lineId: string; planned: number; committed: number; actual: number; forecast: number }[], catalog: Map<string, BudgetVersionLine>) {
  for (const row of lines) {
    if (!catalog.has(row.lineId)) throw new WorkflowError('UNKNOWN_LINE', `未知科目 ${row.lineId}：预算版本只能引用项目既有科目，不接受凭空新增或伪造科目`, 422);
    for (const field of AMOUNT_FIELDS) {
      const value = row[field];
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
        throw new WorkflowError('INVALID_AMOUNT', `科目 ${row.lineId} 的${FIELD_TEXT[field]}必须是非负有限数值`, 422);
      }
    }
  }
}

/** 切换前的整版快照校验：空版本 / 未知科目 / 非法金额都不允许进入发布动作 */
function validateSnapshot(version: BudgetVersion) {
  if (version.lines.length === 0) {
    throw new WorkflowError('EMPTY_VERSION', '预算版本为空：至少需要保留一个科目才能成为生效版本', 422);
  }
  validateAmounts(version, version.lines, lineCatalog(version.projectId));
}

function serializeVersion(version: BudgetVersion) {
  return {
    id: version.id,
    projectId: version.projectId,
    name: version.name,
    status: version.status,
    statusText: STATUS_TEXT[version.status],
    basedOnVersionId: version.basedOnVersionId,
    revision: version.revision,
    reviewRound: version.reviewRound,
    createdBy: version.createdBy,
    createdAt: version.createdAt,
    updatedAt: version.updatedAt,
    submittedAt: version.submittedAt,
    decidedAt: version.decidedAt,
    approver: version.approver,
    decisionComment: version.decisionComment,
    openApprovalId: version.openApprovalId,
    totals: totalsOf(version.lines),
  };
}

export function listBudgetVersionViews(projectId: string) {
  requireProject(projectId);
  return budgetVersions
    .filter(version => version.projectId === projectId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map(serializeVersion);
}

/** 版本详情：每个科目的计划/承诺/实际/预测四账，及对计划的差异、对生效基线的差异 */
export function budgetVersionView(versionId: string) {
  const version = requireVersion(versionId);
  const baseline = activeBudgetVersion(version.projectId);
  const baselineLines = new Map((baseline?.lines ?? []).map(line => [line.lineId, line]));
  const lines = version.lines.map(line => {
    const baselineLine = baselineLines.get(line.lineId);
    return {
      ...line,
      varForecast: line.forecast - line.planned,
      varCommitted: line.committed - line.planned,
      varActual: line.actual - line.planned,
      baselinePlanned: baselineLine ? baselineLine.planned : null,
      plannedDeltaVsBaseline: baselineLine ? line.planned - baselineLine.planned : null,
    };
  });
  return {
    ...serializeVersion(version),
    baseline: baseline ? { id: baseline.id, name: baseline.name, status: baseline.status } : null,
    lines,
    audit: budgetVersionAudit(version.id),
  };
}

export function budgetVersionAudit(versionId: string): AuditEvent[] {
  return auditEvents.filter(event => event.entity === 'budget' && event.entityId === versionId);
}

// ---------------------------------------------------------------------------
// 工作流转折：复制草案 → 编辑 → 送审 → 驳回 / 批准切换
// ---------------------------------------------------------------------------

/** 从任意既有版本复制出独立可编辑草案；源版本与生效基线都不受影响 */
export function copyBudgetVersion(projectId: string, input: { name?: string; basedOnVersionId?: string; createdBy?: string } = {}): BudgetVersion {
  requireProject(projectId);
  const source = input.basedOnVersionId ? requireVersion(input.basedOnVersionId) : activeBudgetVersion(projectId);
  if (!source || source.projectId !== projectId) {
    throw new WorkflowError('VERSION_NOT_FOUND', '来源预算版本不存在', 404);
  }
  const actor = input.createdBy?.trim() || '当前用户';
  const version: BudgetVersion = {
    id: newWorkflowId(projectId),
    projectId,
    name: input.name?.trim() || `${source.name} 草案`,
    status: 'draft',
    basedOnVersionId: source.id,
    lines: source.lines.map(line => ({ ...line })),
    revision: 0,
    reviewRound: 0,
    createdBy: actor,
    createdAt: stamp(),
    updatedAt: stamp(),
  };
  budgetVersions.push(version);
  recordAudit('BUDGET_VERSION_CREATE', 'budget', version.id, actor, `从 ${source.id}（${source.name}）复制为可编辑草案，含 ${version.lines.length} 个科目；获批前不影响项目生效基线`);
  return version;
}

/**
 * 整版保存草案科目（全量替换语义）。
 * - 仅 draft / rejected 可保存：审批期间（in_review）与终态版本一律拒绝
 * - expectedRevision 乐观锁：两人同时编辑时后保存者拿到 409，必须刷新后重做
 * - 未知科目、重复科目、非法金额在落盘前拒绝；允许保存为空（空版本在送审/切换环节拦截）
 */
export function updateDraftLines(versionId: string, incoming: LineAmountInput[], expectedRevision: number, actor: string): BudgetVersion {
  const version = requireVersion(versionId);
  if (version.status !== 'draft' && version.status !== 'rejected') {
    throw new WorkflowError('VERSION_NOT_EDITABLE', `版本处于「${STATUS_TEXT[version.status]}」状态，只有草案或被驳回的版本可以修改；审批期间的改动请等待审批结论`, 409);
  }
  if (!Number.isInteger(expectedRevision) || version.revision !== expectedRevision) {
    recordAudit('BUDGET_VERSION_EDIT_CONFLICT', 'budget', version.id, actor, `并发保存被阻止：提交基于 revision ${expectedRevision}，服务端当前已是 revision ${version.revision}，需刷新后在最新草案上重做修改`);
    throw new WorkflowError('VERSION_CONFLICT', `版本已被其他人保存（当前 revision ${version.revision}），请刷新获取最新草案后再提交你的修改`, 409);
  }
  if (!Array.isArray(incoming)) throw new WorkflowError('INVALID_PAYLOAD', 'lines 必须是科目数组', 422);
  const catalog = lineCatalog(version.projectId);
  const seen = new Set<string>();
  for (const row of incoming) {
    if (seen.has(row.lineId)) throw new WorkflowError('DUPLICATE_LINE', `科目 ${row.lineId} 在同一次保存中重复出现`, 422);
    seen.add(row.lineId);
  }
  validateAmounts(version, incoming, catalog);

  const order = [...catalog.keys()];
  version.lines = incoming
    .map(row => ({ ...catalog.get(row.lineId)!, planned: row.planned, committed: row.committed, actual: row.actual, forecast: row.forecast }))
    .sort((a, b) => order.indexOf(a.lineId) - order.indexOf(b.lineId));
  version.revision += 1;
  version.updatedAt = stamp();
  recordAudit('BUDGET_VERSION_EDIT', 'budget', version.id, actor, `保存草案修改：${version.lines.length} 个科目，计划合计 ${totalsOf(version.lines).planned}（revision → ${version.revision}）`);
  return version;
}

/** 送审：草案锁定进入审批队列；重复送审、终态送审、空版本送审都会被拒绝 */
export function submitBudgetVersion(versionId: string, actor: string, comment = ''): { version: BudgetVersion; approval: Approval } {
  const version = requireVersion(versionId);
  if (version.status === 'in_review') {
    throw new WorkflowError('ALREADY_IN_REVIEW', `版本已在审批队列中（第 ${version.reviewRound} 轮），审批期间不能重复送审`, 409);
  }
  if (version.status !== 'draft' && version.status !== 'rejected') {
    throw new WorkflowError('VERSION_NOT_SUBMITTABLE', `「${STATUS_TEXT[version.status]}」状态的版本不能送审`, 409);
  }
  validateSnapshot(version);

  const resubmit = version.status === 'rejected';
  version.reviewRound = resubmit ? version.reviewRound + 1 : 1;
  version.status = 'in_review';
  version.submittedAt = stamp();
  version.updatedAt = stamp();
  const approval = createApproval({
    projectId: version.projectId,
    entityType: 'budget',
    entityId: version.id,
    title: `${version.name}（预算版本第 ${version.reviewRound} 轮送审）`,
    requestedBy: actor,
    approver: '财务负责人',
  });
  version.openApprovalId = approval.id;
  recordAudit(
    resubmit ? 'BUDGET_VERSION_RESUBMIT' : 'BUDGET_VERSION_SUBMIT',
    'budget', version.id, actor,
    resubmit
      ? `已按驳回意见修改（${version.decisionComment || '见上轮审批'}），第 ${version.reviewRound} 轮重新送审${comment ? `；备注：${comment}` : ''}`
      : `第 1 轮送审至财务负责人，含 ${version.lines.length} 个科目；审批期间草案锁定，不可修改、不可重复送审`,
  );
  return { version, approval };
}

/** 切换前守卫：测试 / 后续接入财务台账时可注入，抛错表示外部条件不满足，本次切换整体中止 */
let activationGuard: ((version: BudgetVersion) => void) | null = null;
export function setBudgetActivationGuard(guard: ((version: BudgetVersion) => void) | null) { activationGuard = guard; }

export type BudgetDecision = Extract<ApprovalStatus, 'approved' | 'rejected'>;

/**
 * 审批结论。
 * rejected：版本回到可修改状态，保留驳回意见，修改后可走重新送审。
 * approved：整版校验 + 外部守卫通过后，在同步临界区内一次性发布——
 * 旧版置 superseded、指针翻到新版本，读者不可能观察到半新半旧的基线。
 * 任一步失败，所有状态保持原样，同一轮审批可重试。
 */
export function decideBudgetVersion(versionId: string, decision: BudgetDecision, actor = '当前审批人', comment = ''): BudgetVersion {
  const version = requireVersion(versionId);
  if (version.status !== 'in_review') {
    throw new WorkflowError('VERSION_NOT_IN_REVIEW', `版本当前为「${STATUS_TEXT[version.status]}」，不在审批中，无法给出审批结论`, 409);
  }
  const approval = version.openApprovalId
    ? approvals.find(item => item.id === version.openApprovalId)
    : approvals.find(item => item.entityType === 'budget' && item.entityId === version.id && item.status === 'pending');

  if (decision === 'rejected') {
    version.status = 'rejected';
    version.decidedAt = stamp();
    version.approver = actor;
    version.decisionComment = comment || '请按意见调整后重新送审';
    version.updatedAt = stamp();
    if (approval) { approval.status = 'rejected'; approval.comment = version.decisionComment; }
    recordAudit('BUDGET_VERSION_REJECT', 'budget', version.id, actor, `第 ${version.reviewRound} 轮送审被驳回：${version.decisionComment}。版本恢复为可修改状态，修改并保存后可重新送审`);
    return version;
  }

  // 批准路径：以下任何一步抛错，版本、审批单、项目指针都保持原样，可整体重试
  validateSnapshot(version);
  const project = requireProject(version.projectId);
  if (activationGuard) {
    try {
      activationGuard(version);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      recordAudit('BUDGET_VERSION_ACTIVATE_FAILED', 'budget', version.id, actor, `整版切换中止，生效基线仍为 ${project.budgetVersionId}：${reason}。条件修复后可重试批准，无需重新送审`);
      throw new WorkflowError('ACTIVATION_FAILED', `预算版本切换失败：${reason}。当前生效基线未改变，请修复后重试`, 503);
    }
  }

  const previous = activeBudgetVersion(version.projectId);
  // 切换会让其他版本上“仍在排队”的预算审批单失去意义（含历史遗留挂单），
  // 一并在同一临界区作废旧单，保证审批队列与当前基线一致
  const stalePending = approvals.filter(item =>
    item.projectId === version.projectId && item.entityType === 'budget' &&
    item.status === 'pending' && item.id !== approval?.id);
  // —— 同步临界区开始：整版一次性发布，中间不存在可被读取的半版状态 ——
  version.status = 'active';
  version.decidedAt = stamp();
  version.approver = actor;
  version.decisionComment = comment;
  version.updatedAt = stamp();
  if (approval) { approval.status = 'approved'; approval.comment = comment || '整版复核通过'; }
  for (const stale of stalePending) {
    stale.status = 'rejected';
    stale.comment = `项目已切换生效版本至 ${version.id}，该在途预算审批单随旧基线自动作废`;
  }
  if (previous && previous.id !== version.id) previous.status = 'superseded';
  project.budgetVersionId = version.id; // 唯一发布点：此行之前所有读者仍读到旧基线
  // —— 同步临界区结束 ——

  recordAudit('BUDGET_VERSION_ACTIVATE', 'budget', version.id, actor, `整版获批并一次性切换为项目生效版本：${version.lines.length} 个科目同时生效（无逐行中间态）；原生效版本 ${previous?.id ?? '无'} 归档为 superseded${stalePending.length ? `；${stalePending.length} 张在途预算审批单同步作废` : ''}${comment ? `；意见：${comment}` : ''}`);
  return version;
}

// ---------------------------------------------------------------------------
// 既有能力：审批队列、项目摘要、版权冲突
// ---------------------------------------------------------------------------

export function projectSummary(projectId = projects[0].id) {
  const project = projects.find(item => item.id === projectId);
  // 预算四账统一从当前生效版本快照读取；版本未切换前，任何草案都不会影响这里
  const active = project ? activeBudgetVersion(projectId) : undefined;
  const lines = active ? active.lines.map(line => ({ ...line, id: line.lineId })) : [];
  const projectContracts = contracts.filter(contract => contract.projectId === projectId);
  const projectAssets = assets.filter(asset => asset.projectId === projectId);
  const projectApprovals = approvals.filter(approval => approval.projectId === projectId);
  const planned = lines.reduce((sum, line) => sum + line.planned, 0);
  const forecast = lines.reduce((sum, line) => sum + line.forecast, 0);
  const actual = lines.reduce((sum, line) => sum + line.actual, 0);
  return {
    project,
    budgetVersion: active ? { id: active.id, name: active.name, status: active.status, revision: active.revision, reviewRound: active.reviewRound } : null,
    planned, forecast, actual,
    variance: forecast - planned,
    utilization: planned ? actual / planned : 0,
    committed: lines.reduce((sum, line) => sum + line.committed, 0),
    contractExposure: projectContracts.reduce((sum, contract) => sum + contract.ceiling, 0),
    assetCount: projectAssets.length,
    pendingApprovals: projectApprovals.filter(item => item.status === 'pending').length,
    highRiskLines: lines.filter(line => line.risk === 'high'),
    lines,
    contracts: projectContracts,
    assets: projectAssets,
    approvals: projectApprovals,
  };
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

export function approve(id: string, status: ApprovalStatus, comment = '', actor = '当前审批人') {
  const item = approvals.find(approval => approval.id === id);
  if (!item) return undefined;
  if (item.status !== 'pending') {
    throw new WorkflowError('APPROVAL_DECIDED', `审批单 ${id} 已有结论（${item.status}），不能重复提交`, 409);
  }
  // 预算版本工作流的审批单：把结论交给版本状态机（驳回 / 整版激活）
  const version = item.entityType === 'budget' ? getBudgetVersion(item.entityId) : undefined;
  if (version && version.status === 'in_review') {
    if (status !== 'approved' && status !== 'rejected') {
      throw new WorkflowError('INVALID_DECISION', '预算审批结论只能是 approved 或 rejected', 422);
    }
    decideBudgetVersion(version.id, status, actor, comment);
    return item;
  }
  item.status = status;
  item.comment = comment;
  recordAudit(status.toUpperCase(), item.entityType, item.entityId, actor, comment || `${item.title} 已${status === 'approved' ? '通过' : '驳回'}`);
  return item;
}

export function createApproval(input: Pick<Approval, 'projectId' | 'entityType' | 'entityId' | 'title' | 'requestedBy' | 'approver'>) {
  const item: Approval = { ...input, id: `APR-${Date.now()}-${++approvalSeq}`, status: 'pending', createdAt: stamp() };
  approvals.unshift(item);
  return item;
}

export function dashboard() { return projects.map(project => projectSummary(project.id)).map(summary => ({ id: summary.project?.id, title: summary.project?.title, status: summary.project?.status, forecast: summary.forecast, variance: summary.variance, pendingApprovals: summary.pendingApprovals, rightsConflicts: rightsConflicts(summary.project?.id).length })); }
