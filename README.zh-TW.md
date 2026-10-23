# Agent Harness Profile

**狀態：草案，版本 0.2.0。** 在 1.0 之前，各章節都可能調整。

本文件為英文 [README.md](README.md) 的中文說明。規格內容以英文版 [spec/agent-harness-profile.md](spec/agent-harness-profile.md) 為準。

組織要讓 AI agent 代為處理業務時，團隊通常會請 Claude Code 或 Codex 從頭寫一套 harness：agent 可以呼叫哪些工具、哪些動作必須先經人核准、重試時如何避免同一封信寄出兩次、要留下哪些紀錄、要怎麼測試。每一套寫法都不同，外部也無從查核。Agent Harness Profile 把這套 harness 寫成規格。主要廠商或基金會已經有規格的部分一律沿用，本規格只補上現有標準沒有涵蓋的部分：與動作參數綁定的核准紀錄、確保寫入只執行一次的帳本、第三方可以驗證的稽核紀錄格式，以及驗收測試。照這份規格描述的 agent 是一份 AI Agent 範本（template bundle），可以審閱、簽章、交換，也可以用 conformance runner 檢查。

## 沿用的標準

| 項目 | 採用的標準 | 方式 |
|---|---|---|
| Agent 定義 | Oracle Open Agent Specification 26.3.1 | 原樣採用，`agent.json` 不做任何修改 |
| Skills | Agent Skills（`SKILL.md`） | 原樣採用，限純指示型 |
| 工具提示 | MCP 2026-07-28 `ToolAnnotations` | 僅作為不可信任的提示 |
| 授權政策 | Cedar 4 | 原樣採用，另附本規格的 schema |
| 核准判定模型 | Microsoft Agent Control Specification v0.4.0-beta.1 | 採用並擴充 |
| 寫入只執行一次 | IETF Idempotency-Key 草案第 08 版、Stripe 的語意 | 採用並擴充 |
| 稽核紀錄 | CloudEvents 1.0.2、RFC 8785、RFC 9162、C2SP 簽章檢查點 | 採用，另加兩個擴充屬性 |
| 追蹤 | OpenTelemetry GenAI 語意慣例、W3C Trace Context | 原樣採用 |
| 發行簽章 | in-toto attestation、Sigstore、GitHub artifact attestations | 原樣採用 |
| 本規格自行定義 | 核准請求與決定紀錄、寫入帳本、harness sidecar、驗收樣本 | 找不到既有標準 |

各標準的固定版本與狀態列在規格第 4 節。

## AI Agent 範本的結構

```
reception-enquiry/
  template.json              清單：列出每個檔案及其 SHA-256 雜湊值
  agent.json               Oracle Agent Spec 26.3.1 agent，未經修改
  harness.json             角色、知識來源、工具權限、作業步驟、
                           界線與核准規則、模型需求與預算
  policy.cedar             Cedar 政策：預設拒絕，寫入動作須經核准
  acceptance.json          驗收樣本，含提示注入（prompt injection）案例
  skills/reception-reply/SKILL.md
```

[examples/](examples/) 收錄三個完整範例：`reception-enquiry`、`ap-reconciliation`、`code-review`。

## 快速開始

### 檢查 AI Agent 範本

需要 Node.js 22 以上。

```sh
npm ci && node scripts/conformance.mjs l1 examples/reception-enquiry
```

```sh
node scripts/conformance.mjs vectors   # 以參考實作執行全部測試向量
npm test                               # CI 執行的全部檢查
```

### 用 skill 設計 AI Agent 範本

本儲存庫附有 Agent Skill `agent-harness-design`，會詢問 agent 的工作內容，再產生 AI Agent 範本。它只提供指示，只在您指定的範本目錄寫入檔案，不會更動 agent 的設定。

Claude Code，在終端機執行：

```sh
claude plugin marketplace add orbanplatform/agent-harness
claude plugin install agent-harness@orbanplatform
```

或在 Claude Code 工作階段中輸入：

```
/plugin marketplace add orbanplatform/agent-harness
/plugin install agent-harness@orbanplatform
```

Codex，在終端機執行：

```sh
codex plugin marketplace add orbanplatform/agent-harness
codex plugin add agent-harness@orbanplatform
```

或在 Codex 中開啟 `/plugins`，安裝 `agent-harness`。

## 符合性等級

| 等級 | 適用對象 | 內容 |
|---|---|---|
| **L1 Describe** | AI Agent 範本 | 每個檔案通過 schema 驗證、雜湊值相符、lint 規則通過、skill 通過 `skills-ref validate`，且 `agent.json` 可由 `pyagentspec` 26.3.1 載入。 |
| **L2 Gate** | Harness 執行環境 | 未分類的工具一律視為寫入、寫入須等待核准、Cedar 預設拒絕、核准綁定動作的確切參數、agent 不得核准、逾時即拒絕。 |
| **L3 Prove** | Harness 執行環境 | 寫入只執行一次的帳本、雜湊鏈結的稽核事件、RFC 9162 Merkle 根值，以及第三方可驗證的簽章檢查點。 |

符合性由實作方自行以本儲存庫的 runner 與測試向量評估，不提供認證。詳見規格第 16 節。

## 參與與回報

- 參與方式見 [CONTRIBUTING.md](CONTRIBUTING.md)（採 DCO 簽署，不需簽 CLA）與 [GOVERNANCE.md](GOVERNANCE.md)。會影響實作行為的修改，請先開一個標記為 `proposal` 的 GitHub issue。
- 資安問題請勿公開張貼，請透過 GitHub 的私下漏洞回報（Security 分頁）或寄信至 contact@orbanplatform.com。詳見 [SECURITY.md](SECURITY.md)。

## 授權

Apache License 2.0。見 [LICENSE](LICENSE) 與 [NOTICE](NOTICE)。

由 Orban Platform Inc. 維護。
