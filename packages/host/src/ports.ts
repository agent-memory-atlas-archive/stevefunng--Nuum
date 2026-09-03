export interface SubAgentSpec {
  parentAgentId: string;
  prompt: string;
}

export interface ExpertProfile {
  id: string;
  systemPrompt: string;
  toolNames: string[];
}

export interface SubAgentPort {
  spawn(spec: SubAgentSpec): Promise<string>;
}

export interface ExpertPort {
  resolve(agentId: string): ExpertProfile | null;
}

export interface ProjectPort {
  bind(agentId: string, projectId: string): void;
}
