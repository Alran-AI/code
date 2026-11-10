import type {
  LocalSandboxBashExecutionPort,
  LocalSandboxBashOperationsFactory,
} from '@alran/agent-tools/desktop';

export interface DeferredLocalSandboxBashOperationsFactory extends LocalSandboxBashExecutionPort {
  bind(factory: LocalSandboxBashOperationsFactory): void;
}
