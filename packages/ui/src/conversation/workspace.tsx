import type { AgentView, ViewBlock } from "@nuum/protocol";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { SandIcon, SandIconButton } from "../kit/sand-kit-primitives";
import { AGENT_AVATAR_COLORS, AGENT_AVATAR_SHAPES, AgentAvatar } from "./agent-avatar";

export interface PendingTool {
  toolCallId: string;
  name: string;
  arguments: Record<string, unknown>;
  action: "read-file" | "list-directory" | "write-file" | "run-command";
  target: string;
}

export interface ConversationWorkspaceProps {
  agent: AgentView | null;
  blocks: readonly ViewBlock[];
  autoFocusInput?: boolean;
  creatingAgent?: boolean;
  canCancelCreate?: boolean;
  creationError?: string | null;
  pendingTool?: PendingTool | null;
  draft: string;
  onDraftChange(value: string): void;
  onSubmit(): void;
  onCancel(): void;
  onCancelCreate(): void;
  onCreateAgent(profile: {
    name: string;
    description: string;
    avatarColor: string;
    avatarShape: string;
  }): void;
  onApprove(resolution: "always" | "once" | "deny" | "never"): void;
  notice?: string | null;
}

function toolLabel(name: string): string {
  const normalized = name.toLowerCase();
  if (normalized === "bash" || normalized === "shell") return "Bash";
  if (normalized === "read") return "Read";
  if (normalized === "ls") return "List";
  if (normalized === "write") return "Write";
  return name.replace(/([a-z])([A-Z])/g, "$1 $2");
}

function toolStatus(status: "pending" | "ok" | "error"): string {
  if (status === "pending") return "执行中";
  if (status === "error") return "失败";
  return "已完成";
}

function ToolActivity({ tool }: { tool: Extract<ViewBlock, { type: "assistant" }>["tools"][number] }) {
  return (
    <details className="sand-tool-activity" data-status={tool.status}>
      <summary>
        <span className="sand-tool-activity__pulse" />
        <span>{toolLabel(tool.name)} {toolStatus(tool.status)}</span>
        <span className="sand-tool-activity__chevron" />
      </summary>
      <div className="sand-tool-activity__detail">
        <section>
          <span>Arguments</span>
          <pre>{JSON.stringify(tool.arguments, null, 2)}</pre>
        </section>
        {tool.output !== undefined ? (
          <section>
            <span>Output</span>
            <pre>{tool.output || "(no output)"}</pre>
          </section>
        ) : null}
      </div>
    </details>
  );
}

/** 主对话只显示工作状态；thinking 原文和工具详情都不主动展开。 */
function AssistantBlock({ block }: { block: Extract<ViewBlock, { type: "assistant" }> }) {
  if (!block.live && block.tools.length === 0) return null;
  return (
    <article className="sand-transcript-row sand-transcript-row--activity">
      <div className="sand-assistant-stack">
        {block.live && block.tools.length === 0 ? (
          <div className="sand-thinking-status">
            <span className="sand-thinking-status__pulse" />
            <span>思考中</span>
          </div>
        ) : null}
        {block.tools.map((tool) => <ToolActivity key={tool.id} tool={tool} />)}
      </div>
    </article>
  );
}

/** SendMessage 产出的真正助手气泡。 */
function MessageBlock({ block }: { block: Extract<ViewBlock, { type: "message" }> }) {
  const { payload } = block;
  return (
    <article className="sand-transcript-row">
      <div className="sand-message sand-message--assistant">
        <div className="sand-message-prose">
          {payload.type === "text" ? (
            <>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{payload.text}</ReactMarkdown>
              {payload.images?.map((image) => (
                <img alt="" className="sand-message-image" key={image} src={`file://${image}`} />
              ))}
            </>
          ) : payload.type === "attachment" ? (
            <>
              <a href={`file://${payload.path}`}>{payload.path}</a>
              {payload.caption ? <p>{payload.caption}</p> : null}
            </>
          ) : (
            // widget 的真实渲染是下版的事；先如实显示收到了什么，不假装画出来了。
            <pre>{`${payload.widget} ${JSON.stringify(payload.props)}`}</pre>
          )}
        </div>
      </div>
    </article>
  );
}

/** 系统条：别的 agent 的唤醒、自改人格、上文已压缩。 */
function NoticeBlock({ block }: { block: Extract<ViewBlock, { type: "notice" }> }) {
  return (
    <article className="sand-transcript-row">
      <div className="sand-transcript-notice" data-kind={block.kind}>
        {block.text}
      </div>
    </article>
  );
}

function PeerBlock({ block }: { block: Extract<ViewBlock, { type: "peer" }> }) {
  const outbound = block.direction === "outbound";
  return (
    <article className="sand-transcript-row sand-transcript-row--peer" data-direction={block.direction}>
      <div className="sand-peer-message">
        <div className="sand-peer-message__meta">
          <AgentAvatar
            agentId={block.agentId}
            size={22}
            state={outbound ? "sending" : "receiving"}
          />
          <span>{outbound ? "To" : "From"} {block.agentName}</span>
          {block.priority ? <span className="sand-peer-message__priority">Priority</span> : null}
        </div>
        <div className={`sand-message ${outbound ? "sand-message--peer-outbound" : "sand-message--assistant"}`}>
          <div className="sand-message-prose"><p>{block.text}</p></div>
        </div>
      </div>
    </article>
  );
}

const AGENT_TEMPLATES = [
  { name: "Researcher", description: "Track a topic, read sources, and bring back concise findings." },
  { name: "Project partner", description: "Stay with one project, remember decisions, and help move it forward." },
  { name: "Daily operator", description: "Handle recurring local tasks and keep an eye on follow-ups." }
] as const;

function AgentCreation({
  canCancel,
  error,
  onCancel,
  onCreate
}: {
  canCancel: boolean;
  error?: string | null;
  onCancel(): void;
  onCreate(profile: { name: string; description: string; avatarColor: string; avatarShape: string }): void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [avatarColor, setAvatarColor] = useState("green");
  const [avatarShape, setAvatarShape] = useState("blob");
  const submit = () => {
    if (!name.trim()) return;
    onCreate({ name: name.trim(), description: description.trim(), avatarColor, avatarShape });
  };
  return (
    <div className="sand-agent-create">
      <div className="sand-agent-create__hero">
        <AgentAvatar
          agentId={name || "new-agent"}
          color={avatarColor}
          shape={avatarShape}
          size={92}
          state="happy"
        />
        <div>
          <span className="sand-agent-create__eyebrow">A teammate with its own context</span>
          <h1>Create an Agent</h1>
          <p>Give it an ongoing job. It gets its own conversation, memory, and workspace.</p>
        </div>
      </div>
      <div className="sand-agent-create__editor">
        <label>
          <span>Name</span>
          <input autoFocus onChange={(event) => setName(event.target.value)} placeholder="e.g. Release scout" value={name} />
        </label>
        <label>
          <span>What should this Agent do?</span>
          <textarea
            onChange={(event) => setDescription(event.target.value)}
            placeholder="A standing role helps other Agents know when to message it."
            value={description}
          />
        </label>
        <div className="sand-agent-create__appearance">
          <span>Character</span>
          <div aria-label="Character color" className="sand-agent-create__colors" role="radiogroup">
            {AGENT_AVATAR_COLORS.map((color) => (
              <button
                aria-checked={avatarColor === color.id}
                aria-label={`${color.id} color`}
                key={color.id}
                onClick={() => setAvatarColor(color.id)}
                role="radio"
                style={{ background: color.value }}
                type="button"
              />
            ))}
          </div>
          <div aria-label="Character shape" className="sand-agent-create__shapes" role="radiogroup">
            {AGENT_AVATAR_SHAPES.map((shape) => (
              <button
                aria-checked={avatarShape === shape}
                aria-label={`${shape} shape`}
                key={shape}
                onClick={() => setAvatarShape(shape)}
                role="radio"
                type="button"
              >
                <AgentAvatar agentId={`shape-${shape}`} color={avatarColor} shape={shape} size={28} />
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="sand-agent-create__suggestions">
        <span>Or start with a role</span>
        <div>
          {AGENT_TEMPLATES.map((template) => (
            <button
              key={template.name}
              onClick={() => {
                setName(template.name);
                setDescription(template.description);
              }}
              type="button"
            >
              <strong>{template.name}</strong>
              <span>{template.description}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="sand-agent-create__actions">
        {error ? <span className="sand-agent-create__error">{error}</span> : null}
        {canCancel ? <button className="sand-agent-create__cancel" onClick={onCancel} type="button">Cancel</button> : null}
        <button className="sand-agent-create__submit" disabled={!name.trim()} onClick={submit} type="button">Create Agent</button>
      </div>
    </div>
  );
}

export function ConversationWorkspace({
  agent,
  blocks,
  autoFocusInput = false,
  creatingAgent = false,
  canCancelCreate = false,
  creationError,
  pendingTool,
  draft,
  onDraftChange,
  onSubmit,
  onCancel,
  onCancelCreate,
  onCreateAgent,
  onApprove,
  notice
}: ConversationWorkspaceProps) {
  const empty = agent == null || blocks.length === 0;
  const transcriptRef = useRef<HTMLDivElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const composingRef = useRef(false);

  useEffect(() => {
    if (creatingAgent) return;
    const transcript = transcriptRef.current;
    if (!transcript) return;
    transcript.scrollTo({ top: transcript.scrollHeight, behavior: "smooth" });
  }, [blocks.length, creatingAgent]);

  useEffect(() => {
    if (autoFocusInput) promptRef.current?.focus();
  }, [agent?.profile.id, autoFocusInput]);

  return (
    <section className="sand-chat-stage">
      <header className="sand-chat-header">
        {agent ? (
          <div className="sand-chat-header__identity">
            <span className="sand-chat-header__avatar">
              <AgentAvatar
                agentId={agent.profile.id}
                color={agent.profile.avatarColor}
                shape={agent.profile.avatarShape}
                size={28}
                state={agent.runtime.status === "running" ? "working" : "idle"}
              />
            </span>
            <span id="sand-conversation-heading">{agent.profile.name}</span>
            {agent.runtime.status === "running" ? <small>Working</small> : null}
          </div>
        ) : (
          <div className="sand-chat-header__identity sand-chat-header__identity--blank" />
        )}
      </header>
      {creatingAgent ? (
        <AgentCreation canCancel={canCancelCreate} error={creationError} onCancel={onCancelCreate} onCreate={onCreateAgent} />
      ) : <>
      <div aria-label="Conversation transcript" className="sand-virtual-transcript" ref={transcriptRef} role="log">
        {empty ? (
          <div className="sand-empty sand-empty--welcome">
            <strong className="sand-empty__mark">Nuum</strong>
            <span>Ask anything, or drop a file.</span>
          </div>
        ) : null}
        {blocks.map((block) =>
          block.type === "user" ? (
            <article className="sand-transcript-row" key={block.id}>
              <div className="sand-message sand-message--user">
                <div className="sand-message-prose">
                  <p>{block.text}</p>
                </div>
              </div>
            </article>
          ) : block.type === "message" ? (
            <MessageBlock block={block} key={block.id} />
          ) : block.type === "notice" ? (
            <NoticeBlock block={block} key={block.id} />
          ) : block.type === "peer" ? (
            <PeerBlock block={block} key={block.id} />
          ) : (
            <AssistantBlock block={block} key={block.id} />
          )
        )}
      </div>
      <div className="sand-chat-input-dock">
        {pendingTool ? (
          <div className="sand-permission-dock">
            <div>
              <strong>Allow {pendingTool.action}?</strong>
              <div className="sand-permission-dock__preview">{pendingTool.target}</div>
            </div>
            <div className="sand-permission-dock__actions">
              <button className="sand-permission-dock__btn sand-permission-dock__btn--deny" onClick={() => onApprove("deny")} type="button">Deny</button>
              <button className="sand-permission-dock__btn sand-permission-dock__btn--deny" onClick={() => onApprove("never")} type="button">Never</button>
              <button className="sand-permission-dock__btn sand-permission-dock__btn--once" onClick={() => onApprove("once")} type="button">Only this time</button>
              <button className="sand-permission-dock__btn sand-permission-dock__btn--always" onClick={() => onApprove("always")} type="button">Always this action</button>
            </div>
          </div>
        ) : null}
        {notice ? <div className="sand-prompt-attachment-notice">{notice}</div> : null}
        <form
          className="sand-prompt-form"
          onSubmit={(event: FormEvent) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <div className="sand-prompt-shell">
            <textarea
              className="sand-prompt-field"
              ref={promptRef}
              onChange={(event) => onDraftChange(event.target.value)}
              onCompositionEnd={() => {
                composingRef.current = false;
              }}
              onCompositionStart={() => {
                composingRef.current = true;
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  // Electron/Chromium 在输入法确认候选时也会发 Enter keydown。
                  // ref 覆盖 React composition 生命周期，isComposing / 229 覆盖浏览器原生状态。
                  const nativeEvent = event.nativeEvent;
                  if (composingRef.current || nativeEvent.isComposing || nativeEvent.keyCode === 229) return;
                  event.preventDefault();
                  onSubmit();
                }
              }}
              placeholder={agent ? `Message ${agent.profile.name}` : "Ask anything, or drop a file."}
              value={draft}
            />
            <div className="sand-prompt-actions-row">
              <button className="sand-prompt-attach" disabled type="button" aria-label="Attach file">
                <SandIcon name="attach" />
              </button>
              {agent?.runtime.status === "running" ? (
                <button className="sand-prompt-send" onClick={onCancel} type="button" aria-label="Stop">
                  <SandIcon name="stop" />
                </button>
              ) : (
                <button className="sand-prompt-send" disabled={!draft.trim()} type="submit" aria-label="Send message">
                  <SandIcon name="arrow-up" size={16} />
                </button>
              )}
            </div>
          </div>
        </form>
      </div>
      </>}
    </section>
  );
}

export function SettingsOverlay({
  open,
  section,
  onSection,
  onClose,
  children
}: {
  open: boolean;
  section: "general" | "models";
  onSection(section: "general" | "models"): void;
  onClose(): void;
  children: ReactNode;
}): ReactNode {
  if (!open) return null;
  const headingId = `sand-settings-panel-${section}-heading`;
  return (
    <div className="sand-settings-overlay" onClick={onClose} role="presentation">
      <div
        aria-labelledby={headingId}
        className="sand-settings-dialog"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="sand-settings-layout">
          <nav aria-label="Settings sections" className="sand-settings-nav">
            <button
              aria-current={section === "general" ? "page" : undefined}
              className="sand-settings-nav__item"
              data-active={section === "general" || undefined}
              onClick={() => onSection("general")}
              type="button"
            >
              <SandIcon name="settings-gear" size="sm" />
              <span>General</span>
            </button>
            <button
              aria-current={section === "models" ? "page" : undefined}
              className="sand-settings-nav__item"
              data-active={section === "models" || undefined}
              onClick={() => onSection("models")}
              type="button"
            >
              <SandIcon name="sliders" size="sm" />
              <span>Models</span>
            </button>
          </nav>
          <section className="sand-settings-panel">
            <SandIconButton
              aria-label="Close"
              className="sand-settings-panel__close"
              icon="close"
              label="Close"
              onClick={onClose}
              size="sm"
            />
            <h2 id={headingId}>{section === "general" ? "General" : "Models"}</h2>
            <div className="sand-settings-panel__body">{children}</div>
          </section>
        </div>
      </div>
    </div>
  );
}
