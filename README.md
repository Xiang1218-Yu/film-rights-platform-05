# FrameLedger · 影视制作预算与资产版权协同平台

React + Vite + TypeScript 前端，Node.js + Express + TypeScript 服务端。面向中型影视制作团队，演示预算版本、成本预测、合同里程碑、资产版本、授权窗口冲突与审批审计的协同闭环。

## 启动

```bash
npm install
npm run dev
```

前端默认 Vite 端口 5175，API 默认 `http://localhost:4104`。

## 业务能力

- 项目 / 季 / 交付日期与预算基线；计划、承诺、实际、预测成本四账合一
- **预算版本工作流**：从生效版本复制可编辑草案（整版快照，copy-on-write），查看每个科目的计划/承诺/实际/预测差异；送审锁定、驳回修改后多轮重新送审；仅整版获批时单指针原子切换为生效版本，旧版整版归档。revision 乐观锁防止两人同时编辑互相覆盖，空版本/未知科目/非法金额在保存与切换前校验，切换守卫失败不翻转、可重试，每个关键转折写入审计链。REST 与 React 控制台读取同一份版本结果
- 供应商合同额度、付款里程碑与付款暴露额
- 母版、预告、海报、音频、字幕等资产版本和 checksum 登记
- 地域、平台、有效期、版权标签冲突检测
- 预算 / 资产 / 交付审批队列和审计事件
- React 控制台支持项目切换、预算表、预算版本试算与送审审批、风险雷达、审批操作和版权资产视图

当前使用内存数据，领域服务按模块设计，后续可替换 PostgreSQL、对象存储、工作流和版权方台账服务。

## 预算版本工作流 API

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/projects/:id/budget-versions` | 版本列表（状态、轮次、四账合计） |
| POST | `/api/projects/:id/budget-versions` | 复制草案，body 可带 `name` / `basedOnVersionId` / `createdBy` |
| GET | `/api/budget-versions/:versionId` | 版本详情：科目四账差异、对基线差异、版本审计链 |
| PUT | `/api/budget-versions/:versionId/lines` | 整版保存草案，body：`{ revision, actor, lines[] }`；revision 不符返回 409 |
| POST | `/api/budget-versions/:versionId/submit` | 送审 / 驳回后重新送审 |
| POST | `/api/budget-versions/:versionId/decision` | `{ decision: approved/rejected, actor, comment }`；批准触发整版切换 |

工作流错误返回 `{ code, message }`：`VERSION_CONFLICT`(409) / `VERSION_NOT_EDITABLE`(409) / `ALREADY_IN_REVIEW`(409) / `EMPTY_VERSION`(422) / `UNKNOWN_LINE`(422) / `INVALID_AMOUNT`(422) / `ACTIVATION_FAILED`(503) 等。
