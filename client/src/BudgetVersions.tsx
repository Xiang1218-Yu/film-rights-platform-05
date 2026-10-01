import { useCallback, useEffect, useMemo, useState } from 'react';
import { ApiError, BudgetVersionSummary, BudgetVersionView, fromWan, money, moneyExact, request, signed, toWan } from './api';

const ACTORS = ['后期制片', '制片主任', '财务负责人', '总制片人'];

const statusClass: Record<string, string> = {
  draft: 'review', in_review: 'review', rejected: 'rejected', active: 'approved', superseded: 'locked',
};

/** 行编辑草稿：以万元为单位保存输入字符串，保存时整版 PUT 并携带 revision */
type RowDraft = Record<string, { planned: string; forecast: string }>;

export default function BudgetVersions({ projectId, activeVersionId, actor, onActivated, registerActor }: {
  projectId: string;
  activeVersionId?: string;
  actor: string;
  onActivated: () => void;
  registerActor: (next: string) => void;
}) {
  const [versions, setVersions] = useState<BudgetVersionSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [detail, setDetail] = useState<BudgetVersionView>();
  const [drafts, setDrafts] = useState<RowDraft>({});
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [newName, setNewName] = useState('');
  const [sourceId, setSourceId] = useState('');

  const flashError = useCallback((reason: unknown) => {
    setMessage('');
    setError(reason instanceof ApiError ? reason.message : (reason instanceof Error ? reason.message : '操作失败'));
  }, []);

  const loadList = useCallback(async () => {
    const list = await request<BudgetVersionSummary[]>(`/projects/${projectId}/budget-versions`);
    setVersions(list);
    return list;
  }, [projectId]);

  const loadDetail = useCallback(async (id: string) => {
    const view = await request<BudgetVersionView>(`/budget-versions/${id}`);
    setDetail(view);
    setSelectedId(id);
    setComment('');
    setDrafts(Object.fromEntries(view.lines.map(line => [
      line.lineId,
      { planned: String(toWan(line.planned)), forecast: String(toWan(line.forecast)) },
    ])));
  }, []);

  // 进入项目 / 项目切换：拉版本列表，优先恢复 localStorage 记住的选择，否则落到生效版本
  useEffect(() => {
    let cancelled = false;
    setDetail(undefined);
    setError(''); setMessage('');
    (async () => {
      try {
        const list = await loadList();
        if (cancelled) return;
        const remembered = localStorage.getItem(`budget-selection:${projectId}`);
        const target = list.find(v => v.id === remembered) ?? list.find(v => v.status === 'active') ?? list[0];
        if (target) await loadDetail(target.id);
      } catch (reason) { if (!cancelled) flashError(reason); }
    })();
    return () => { cancelled = true; };
  }, [projectId, loadList, loadDetail, flashError]);

  const selectVersion = async (id: string) => {
    try { localStorage.setItem(`budget-selection:${projectId}`, id); await loadDetail(id); }
    catch (reason) { flashError(reason); }
  };

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await fn(); setMessage(label); }
    catch (reason) { flashError(reason); }
    finally { setBusy(false); }
  };

  const copyDraft = () => run('已从所选版本复制出独立可编辑草案，当前生效基线未改变', async () => {
    const created = await request<BudgetVersionView>(`/projects/${projectId}/budget-versions`, {
      method: 'POST',
      body: JSON.stringify({ name: newName || undefined, basedOnVersionId: sourceId || undefined, createdBy: actor }),
    });
    setNewName('');
    await loadList();
    localStorage.setItem(`budget-selection:${projectId}`, created.id);
    await loadDetail(created.id);
  });

  const editable = detail?.status === 'draft' || detail?.status === 'rejected';

  const saveLines = async () => {
    if (!detail) return;
    const lines = detail.lines.map(line => {
      const d = drafts[line.lineId];
      return {
        lineId: line.lineId,
        planned: d ? fromWan(Number(d.planned) || 0) : line.planned,
        committed: line.committed,
        actual: line.actual,
        forecast: d ? fromWan(Number(d.forecast) || 0) : line.forecast,
      };
    });
    await run(`整版草稿已保存（revision ${detail.revision + 1}），基线未改变`, async () => {
      const view = await request<BudgetVersionView>(`/budget-versions/${detail.id}/lines`, {
        method: 'PUT',
        body: JSON.stringify({ revision: detail.revision, actor, lines }),
      });
      await loadDetail(view.id);
    });
  };

  const submit = () => detail && run(`第 ${detail.reviewRound + (detail.status === 'rejected' ? 1 : 1)} 轮送审已进入财务审批队列，草案已锁定`, async () => {
    const view = await request<BudgetVersionView>(`/budget-versions/${detail.id}/submit`, {
      method: 'POST', body: JSON.stringify({ actor, comment }),
    });
    await Promise.all([loadList(), loadDetail(view.id)]);
  });

  const decide = (decision: 'approved' | 'rejected') => detail && run(
    decision === 'approved' ? '整版获批并已一次性切换为生效版本' : '版本已驳回，可修改后重新送审',
    async () => {
      const view = await request<BudgetVersionView>(`/budget-versions/${detail.id}/decision`, {
        method: 'POST', body: JSON.stringify({ decision, actor, comment }),
      });
      await Promise.all([loadList(), loadDetail(view.id)]);
      if (decision === 'approved') onActivated();
    },
  );

  const totals = useMemo(() => {
    if (!detail) return null;
    // 编辑态合计：随输入实时试算，不落盘
    let planned = 0, forecast = 0;
    for (const line of detail.lines) {
      const d = drafts[line.lineId];
      planned += d ? fromWan(Number(d.planned) || 0) : line.planned;
      forecast += d ? fromWan(Number(d.forecast) || 0) : line.forecast;
    }
    return { planned, forecast, variance: forecast - planned };
  }, [detail, drafts]);

  if (!detail) return <section className="panel wide"><div className="empty">正在载入预算版本…</div></section>;

  return (
    <div className="grid">
      <section className="panel">
        <div className="panel-head">
          <h3>预算版本工作流</h3>
          <select value={actor} onChange={e => registerActor(e.target.value)} title="模拟当前操作人">
            {ACTORS.map(name => <option key={name} value={name}>{name}</option>)}
          </select>
        </div>
        <p className="hint">复制出独立可编辑草案试算；只有整版获批，项目指针才会一次性翻转，旧版归档。</p>
        <div className="version-list">
          {versions.map(v => (
            <button key={v.id} className={`version-item ${v.id === selectedId ? 'selected' : ''}`} onClick={() => void selectVersion(v.id)}>
              <span><b>{v.name}</b><small>{v.id} · 基于 {v.basedOnVersionId ?? '—'} · {v.createdBy}</small></span>
              <span className={`pill ${statusClass[v.status]}`}>{v.statusText}{v.status === 'in_review' ? ` R${v.reviewRound}` : ''}</span>
              {v.id === activeVersionId && <i className="active-tag">生效</i>}
            </button>
          ))}
        </div>
        <div className="copy-box">
          <input value={newName} onChange={e => setNewName(e.target.value)} placeholder="新草案名称（可留空）" />
          <select value={sourceId} onChange={e => setSourceId(e.target.value)} title="复制来源版本">
            <option value="">从当前生效版本复制</option>
            {versions.map(v => <option key={v.id} value={v.id}>从 {v.name} 复制</option>)}
          </select>
          <button disabled={busy} onClick={() => void copyDraft()}>复制为草案</button>
        </div>
        {message && <div className="inline-note ok" onClick={() => setMessage('')}>{message} ×</div>}
        {error && <div className="inline-note bad" onClick={() => setError('')}>{error} ×</div>}
      </section>

      <section className="panel">
        <div className="panel-head">
          <div>
            <h3>{detail.name} <span className={`pill ${statusClass[detail.status]}`}>{detail.statusText}</span></h3>
            <small>{detail.id} · revision {detail.revision}{detail.reviewRound > 0 ? ` · 第 ${detail.reviewRound} 轮审批` : ''} · 最近更新 {new Date(detail.updatedAt).toLocaleString('zh-CN')}</small>
          </div>
        </div>
        {detail.decisionComment && <div className={`decision-note ${detail.status}`}><b>{detail.approver}：</b>{detail.decisionComment}</div>}
        <div className="totals-row">
          <span>计划合计 <b>{money(totals?.planned ?? detail.totals.planned)}</b></span>
          <span>承诺 {money(detail.totals.committed)}</span>
          <span>实际 {money(detail.totals.actual)}</span>
          <span>预测 {money(totals?.forecast ?? detail.totals.forecast)}</span>
          <span className={totals && totals.variance > 0 ? 'bad' : ''}>预测-计划差异 {signed(totals?.variance ?? detail.totals.variance)}</span>
        </div>
        <div className="table budget-table">
          <div className="tr th"><span>科目</span><span>计划(万)</span><span>已承诺</span><span>实际</span><span>预测(万)</span><span>差异</span></div>
          {detail.lines.map(line => {
            const d = drafts[line.lineId];
            const plannedYuan = d ? fromWan(Number(d.planned) || 0) : line.planned;
            const forecastYuan = d ? fromWan(Number(d.forecast) || 0) : line.forecast;
            const varForecast = forecastYuan - plannedYuan;
            const changed = d && (plannedYuan !== line.planned || forecastYuan !== line.forecast);
            return (
              <div className="tr" key={line.lineId}>
                <span><b>{line.category} · {line.subcategory}</b><small>{line.lineId} · {line.owner}</small></span>
                <span>
                  {editable
                    ? <input className="num" value={d?.planned ?? ''} onChange={e => setDrafts(s => ({ ...s, [line.lineId]: { ...s[line.lineId], planned: e.target.value } }))} />
                    : moneyExact(line.planned)}
                  {line.plannedDeltaVsBaseline !== null && line.plannedDeltaVsBaseline !== 0 && <small className={line.plannedDeltaVsBaseline > 0 ? 'bad' : 'good'}>较基线 {signed(line.plannedDeltaVsBaseline)}</small>}
                </span>
                <span>{moneyExact(line.committed)}<small className={line.varCommitted > 0 ? 'bad' : ''}>差计划 {signed(line.varCommitted)}</small></span>
                <span>{moneyExact(line.actual)}<small className={line.varActual > 0 ? 'bad' : ''}>差计划 {signed(line.varActual)}</small></span>
                <span>
                  {editable
                    ? <input className="num" value={d?.forecast ?? ''} onChange={e => setDrafts(s => ({ ...s, [line.lineId]: { ...s[line.lineId], forecast: e.target.value } }))} />
                    : moneyExact(line.forecast)}
                </span>
                <span className={varForecast > 0 ? 'bad' : 'good'}>{signed(varForecast)}{changed ? ' ●' : ''}</span>
              </div>
            );
          })}
          {detail.lines.length === 0 && <div className="empty">当前草案没有任何科目——空版本可以保存为编辑中途态，但无法送审或切换。</div>}
        </div>

        <div className="workflow-actions">
          {editable && <button disabled={busy} onClick={() => void saveLines()}>整版保存（{detail.revision}）</button>}
          {(detail.status === 'draft' || detail.status === 'rejected') && <button className="primary" disabled={busy} onClick={() => void submit()}>{detail.status === 'rejected' ? `重新送审（第 ${detail.reviewRound + 1} 轮）` : '送审'}</button>}
          {detail.status === 'in_review' && (
            <>
              <input value={comment} onChange={e => setComment(e.target.value)} placeholder="审批意见（驳回必填说明）" />
              <button className="danger" disabled={busy} onClick={() => { if (!comment.trim()) { setError('驳回必须填写意见'); return; } void decide('rejected'); }}>驳回</button>
              <button className="primary" disabled={busy} onClick={() => void decide('approved')}>整版批准并切换</button>
            </>
          )}
          {(detail.status === 'active' || detail.status === 'superseded') && <em className="locked-note">{detail.status === 'active' ? '该版本为当前生效基线，终态只读；试算请复制新草案。' : '该版本已归档只读；被新版整版替代。'}</em>}
        </div>
        <small className="lock-hint">
          {detail.status === 'in_review' && '审批期间版本锁定：不能修改、不能重复送审；财务可驳回（回到可修改）或整版批准（一次性切换）。'}
          {editable && '保存采用整版替换并带 revision 乐观锁；若其他人先保存，你会收到 409 冲突，刷新后在最新草案上重做。'}
        </small>
      </section>

      <section className="panel wide">
        <div className="panel-head"><h3>版本审计链</h3><span>{detail.audit.length} 个关键转折</span></div>
        {detail.audit.length === 0 ? <div className="empty">该版本暂无审计事件。</div> : (
          <div className="audit-list">
            {detail.audit.map(e => (
              <div key={e.id} className="audit-row">
                <code>{e.action.replace('BUDGET_VERSION_', '')}</code>
                <div><b>{e.actor}</b><small>{new Date(e.at).toLocaleString('zh-CN')} · {e.details}</small></div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
