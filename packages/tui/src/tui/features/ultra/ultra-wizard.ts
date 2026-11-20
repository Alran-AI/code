/**
 * The `/ultra` start wizard.
 *
 * Typing `/ultra` with no task opens this. It collects the four decisions that
 * change how a run behaves — the task, whether the run is a single pass or loops
 * until the goal is met, the money it may spend, and how wide it may go — plus
 * the recipe, then hands them to the flow.
 *
 * Starting a run is slow (it plans first) and must not block the TUI, so the
 * wizard never runs anything: it only produces a request. The flow starts a
 * detached runner from it and opens the board, which then repaints itself.
 *
 * The last step is a confirmation rather than a shortcut, because a run spends
 * real money and writes a branch. Escape at any step abandons the whole thing.
 */

import { getKeybindings, matchesKey } from '../../engine/public.js';
import type { Component } from '../../rendering/component.js';
import { truncateToWidth } from '../../rendering/text.js';
import { Input } from '../../widgets/input.js';
import { tuiChalk as chalk, tuiColors as colors } from '../../theme/runtime.js';
import { questionnaireFrameContentWidth, renderQuestionnaireFrame } from '../interaction/decision-frame.js';
import type { UltraRunMode } from '@alran/ultra';

/** What the wizard decided. The flow turns this into a detached run. */
export interface UltraStartRequest {
  readonly task: string;
  readonly mode: UltraRunMode;
  readonly budgetUsd: number | null;
  readonly workers: number;
  readonly recipe: 'auto' | 'migrate' | 'bughunt' | 'refactor' | 'testgen' | 'audit';
}

export interface UltraWizardOptions {
  readonly onStart: (request: UltraStartRequest) => void;
  readonly onCancel: () => void;
  readonly requestRender: () => void;
}

type StepId = 'task' | 'mode' | 'budget' | 'workers' | 'recipe' | 'confirm';

const STEP_ORDER: readonly StepId[] = ['task', 'mode', 'budget', 'workers', 'recipe', 'confirm'];

interface Choice {
  readonly value: string;
  readonly label: string;
  readonly description: string;
}

const MODE_CHOICES: readonly Choice[] = [
  {
    value: 'run',
    label: 'One pass',
    description: 'plan, execute every packet, integrate and stop',
  },
  {
    value: 'goal',
    label: 'Until the goal is met',
    description: 'loop rounds, judge each against a goal document, keep going',
  },
];

const BUDGET_CHOICES: readonly Choice[] = [
  { value: '1', label: '$1', description: 'a small, finished result' },
  { value: '2', label: '$2', description: 'the default' },
  { value: '5', label: '$5', description: 'room for repairs and a second round' },
  { value: '10', label: '$10', description: 'a large feature or migration' },
  { value: 'none', label: 'No cap', description: 'explicit opt-in; rounds and hours still bound it' },
];

const WORKER_CHOICES: readonly Choice[] = [
  { value: '1', label: '1 worker', description: 'sequential; easiest to follow' },
  { value: '2', label: '2 workers', description: '' },
  { value: '4', label: '4 workers', description: 'the default' },
  { value: '8', label: '8 workers', description: 'the maximum' },
];

const RECIPE_CHOICES: readonly Choice[] = [
  { value: 'auto', label: 'Auto', description: 'let the planner pick the shape' },
  { value: 'migrate', label: 'Migration', description: 'move every call site to a new API' },
  { value: 'bughunt', label: 'Bug hunt', description: 'reproduce first, then fix' },
  { value: 'refactor', label: 'Refactor', description: 'restructure without changing behaviour' },
  { value: 'testgen', label: 'Test generation', description: 'add real tests to untested modules' },
  { value: 'audit', label: 'Audit', description: 'review an area and report; change nothing' },
];

function choicesFor(step: StepId): readonly Choice[] {
  switch (step) {
    case 'mode':
      return MODE_CHOICES;
    case 'budget':
      return BUDGET_CHOICES;
    case 'workers':
      return WORKER_CHOICES;
    case 'recipe':
      return RECIPE_CHOICES;
    default:
      return [];
  }
}

const TITLES: Record<StepId, string> = {
  task: 'What should Ultra do?',
  mode: 'How long should it run?',
  budget: 'What may it spend?',
  workers: 'How many workers in parallel?',
  recipe: 'Which shape of work is this?',
  confirm: 'Start this run?',
};

export class UltraWizard implements Component {
  private stepIndex = 0;
  private selectedIndex = 0;
  private started = false;
  private readonly task = new Input();
  private taskText = '';
  private mode: UltraRunMode = 'run';
  private budgetUsd: number | null = 2;
  private workers = 4;
  private recipe: UltraStartRequest['recipe'] = 'auto';

  constructor(private readonly options: UltraWizardOptions) {
    this.task.onSubmit = (value) => {
      if (this.currentStep !== 'task') return;
      const text = value.trim();
      if (!text) return;
      this.taskText = text;
      this.advance();
    };
  }

  private get currentStep(): StepId {
    return STEP_ORDER[this.stepIndex]!;
  }

  invalidate(): void {}

  handleInput(data: string): void {
    if (this.started) return;
    if (matchesKey(data, 'escape') || getKeybindings().matches(data, 'tui.select.cancel')) {
      this.options.onCancel();
      return;
    }
    if (this.currentStep === 'task') {
      // The Input owns Enter: it submits through `onSubmit`, which advances.
      this.task.handleInput(data);
      return;
    }
    if (this.currentStep === 'confirm') {
      if (matchesKey(data, 'enter')) this.start();
      return;
    }
    const choices = choicesFor(this.currentStep);
    if (matchesKey(data, 'up')) {
      this.selectedIndex = (this.selectedIndex - 1 + choices.length) % choices.length;
      this.options.requestRender();
      return;
    }
    if (matchesKey(data, 'down')) {
      this.selectedIndex = (this.selectedIndex + 1) % choices.length;
      this.options.requestRender();
      return;
    }
    if (/^[1-9]$/u.test(data)) {
      const index = Number(data) - 1;
      if (index < choices.length) {
        this.selectedIndex = index;
        this.commit();
      }
      return;
    }
    if (matchesKey(data, 'enter')) this.commit();
  }

  private commit(): void {
    const value = choicesFor(this.currentStep)[this.selectedIndex]?.value;
    if (value === undefined) return;
    switch (this.currentStep) {
      case 'mode':
        this.mode = value === 'goal' ? 'goal' : 'run';
        break;
      case 'budget':
        this.budgetUsd = value === 'none' ? null : Number(value);
        break;
      case 'workers':
        this.workers = Number(value);
        break;
      case 'recipe':
        this.recipe = value as UltraStartRequest['recipe'];
        break;
      default:
        break;
    }
    this.advance();
  }

  private advance(): void {
    this.stepIndex = Math.min(this.stepIndex + 1, STEP_ORDER.length - 1);
    this.selectedIndex = 0;
    this.options.requestRender();
  }

  private start(): void {
    if (this.started) return;
    const task = this.taskText.trim();
    // A run with no task would plan nothing; say so instead of starting one.
    if (!task) {
      this.stepIndex = 0;
      this.options.requestRender();
      return;
    }
    this.started = true;
    this.options.onStart({
      task,
      mode: this.mode,
      budgetUsd: this.budgetUsd,
      workers: this.workers,
      recipe: this.recipe,
    });
  }

  render(width: number): string[] {
    const safeWidth = Math.max(0, Math.floor(width));
    if (safeWidth === 0) return [];
    const contentWidth = questionnaireFrameContentWidth(safeWidth);
    const meta = `${this.stepIndex + 1}/${STEP_ORDER.length}`;
    // The frame draws a title and a rule on one line, so a long step title has
    // to be cut to the panel width rather than pushing the border out.
    const title = truncateToWidth(
      safeWidth < 44 ? 'Ultra' : `Ultra · ${TITLES[this.currentStep]}`,
      Math.max(6, safeWidth - 4),
      '',
    );
    const body = this.body(contentWidth);

    if (this.currentStep === 'confirm') {
      return renderQuestionnaireFrame(
        {
          title,
          meta,
          body: [...body, '', chalk.hex(colors.muted)('It starts in the background: you can close this TUI.')],
          footer: 'enter start · esc cancel',
        },
        safeWidth,
        'signal',
      );
    }
    if (this.currentStep === 'task') {
      return renderQuestionnaireFrame(
        {
          title,
          meta,
          body: [
            chalk.hex(colors.muted)('Describe the task in one or two sentences.'),
            chalk.hex(colors.muted)('A goal the run can be judged against works best.'),
            '',
            ...this.task.render(contentWidth).map((line) => truncateToWidth(line, contentWidth, '')),
          ],
          footer: 'enter continue · esc cancel',
        },
        safeWidth,
        'signal',
      );
    }
    return renderQuestionnaireFrame(
      { title, meta, body, footer: 'up/down move · enter select · esc cancel' },
      safeWidth,
      'signal',
    );
  }

  private body(contentWidth: number): string[] {
    switch (this.currentStep) {
      case 'confirm':
        return [
          `Task:    ${truncateToWidth(this.taskText, contentWidth - 9, '')}`,
          `Mode:    ${this.mode === 'goal' ? 'until the goal is met' : 'one pass'}`,
          `Budget:  ${this.budgetUsd === null ? 'no cap' : `$${String(this.budgetUsd)}`}`,
          `Workers: ${String(this.workers)}`,
          `Recipe:  ${this.recipe}`,
          '',
          chalk.hex(colors.muted)('Nothing is merged into main; the branch is yours to review.'),
        ];
      case 'task':
        return [];
      default: {
        const choices = choicesFor(this.currentStep);
        return choices.map((choice, index) => {
          const active = index === this.selectedIndex;
          const marker = active ? chalk.hex(colors.accent)('❯') : ' ';
          const label = active ? chalk.bold(choice.label) : choice.label;
          const description = choice.description
            ? chalk.hex(colors.muted)(` — ${choice.description}`)
            : '';
          return truncateToWidth(`${marker} ${String(index + 1)}. ${label}${description}`, contentWidth, '');
        });
      }
    }
  }
}