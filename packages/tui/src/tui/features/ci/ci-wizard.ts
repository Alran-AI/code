/**
 * The `/ci` setup wizard.
 *
 * A small keyboard-driven form: pull request mode, main branch mode, attempt
 * budget, monitored workflows, confirmation. It collects answers and hands
 * them to the flow, which writes .alran/ci.yml and the workflow through the
 * same core the CLI uses.
 */

import type { CiFixMainMode, CiFixPullRequestMode } from '@alran/ci-fix';
import { getKeybindings, matchesKey } from '../../engine/public.js';
import type { Component } from '../../rendering/component.js';
import { truncateToWidth } from '../../rendering/text.js';
import { tuiChalk as chalk, tuiColors as colors } from '../../theme/runtime.js';
import {
  questionnaireFrameContentWidth,
  renderQuestionnaireFrame,
} from '../interaction/decision-frame.js';

export interface CiWizardAnswers {
  readonly pullRequestMode: CiFixPullRequestMode;
  readonly mainMode: CiFixMainMode;
  readonly maxAttempts: number;
  readonly workflows: readonly string[];
}

export interface CiWizardOptions {
  readonly detectedWorkflows: readonly string[];
  readonly onComplete: (answers: CiWizardAnswers) => void;
  readonly onCancel: () => void;
  readonly requestRender: () => void;
}

interface Choice {
  readonly value: string;
  readonly label: string;
  readonly description: string;
}

const PULL_REQUEST_CHOICES: readonly Choice[] = [
  { value: 'push-to-branch', label: 'Push to the PR branch', description: 'commit straight onto the pull request branch' },
  { value: 'fix-pr', label: 'Open a fix pull request', description: 'a separate PR against the failing branch' },
  { value: 'comment-only', label: 'Comment only', description: 'verify and report, never commit' },
];

const MAIN_CHOICES: readonly Choice[] = [
  { value: 'fix-pr', label: 'Open a fix pull request', description: 'a PR against the main branch (default)' },
  { value: 'push', label: 'Push directly', description: 'explicit opt-in; respects branch protection' },
  { value: 'comment-only', label: 'Comment only', description: 'verify and report, never commit' },
];

const ATTEMPT_CHOICES: readonly Choice[] = [1, 2, 3, 4, 5].map((count) => ({
  value: String(count),
  label: `${count} attempt${count === 1 ? '' : 's'}`,
  description: count === 2 ? 'the default: one retry after the first fix' : '',
}));

type StepId = 'mode-pr' | 'mode-main' | 'attempts' | 'workflows' | 'confirm';

const STEP_ORDER: readonly StepId[] = ['mode-pr', 'mode-main', 'attempts', 'workflows', 'confirm'];

export class CiWizard implements Component {
  private stepIndex = 0;
  private selectedIndex = 0;
  private completed = false;
  private readonly selectedWorkflows: Set<string>;
  private readonly answers: {
    pullRequestMode: CiFixPullRequestMode;
    mainMode: CiFixMainMode;
    maxAttempts: number;
  };

  constructor(private readonly options: CiWizardOptions) {
    this.selectedWorkflows = new Set(options.detectedWorkflows);
    this.answers = {
      pullRequestMode: 'push-to-branch',
      mainMode: 'fix-pr',
      maxAttempts: 2,
    };
  }

  private get step(): StepId {
    return STEP_ORDER[this.stepIndex];
  }

  private choicesForStep(): readonly Choice[] {
    switch (this.step) {
      case 'mode-pr':
        return PULL_REQUEST_CHOICES;
      case 'mode-main':
        return MAIN_CHOICES;
      case 'attempts':
        return ATTEMPT_CHOICES;
      default:
        return [];
    }
  }

  handleInput(data: string): void {
    if (this.completed) return;
    if (matchesKey(data, 'escape') || getKeybindings().matches(data, 'tui.select.cancel')) {
      this.options.onCancel();
      return;
    }
    if (this.step === 'workflows') {
      this.handleWorkflowsInput(data);
      return;
    }
    if (this.step === 'confirm') {
      if (matchesKey(data, 'enter')) {
        this.completed = true;
        this.options.onComplete({
          ...this.answers,
          workflows: [...this.selectedWorkflows],
        });
      }
      return;
    }
    const choices = this.choicesForStep();
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
    if (/^[1-5]$/u.test(data)) {
      const index = Number(data) - 1;
      if (index < choices.length) {
        this.selectedIndex = index;
        this.confirmSelection();
      }
      return;
    }
    if (matchesKey(data, 'enter')) {
      this.confirmSelection();
    }
  }

  private handleWorkflowsInput(data: string): void {
    const names = this.options.detectedWorkflows;
    if (matchesKey(data, 'enter')) {
      this.stepIndex += 1;
      this.selectedIndex = 0;
      this.options.requestRender();
      return;
    }
    if (names.length === 0) return;
    if (matchesKey(data, 'up')) {
      this.selectedIndex = (this.selectedIndex - 1 + names.length) % names.length;
      this.options.requestRender();
      return;
    }
    if (matchesKey(data, 'down')) {
      this.selectedIndex = (this.selectedIndex + 1) % names.length;
      this.options.requestRender();
      return;
    }
    if (data === ' ') {
      const name = names[this.selectedIndex];
      if (this.selectedWorkflows.has(name)) this.selectedWorkflows.delete(name);
      else this.selectedWorkflows.add(name);
      this.options.requestRender();
      return;
    }
    if (data === 'a') {
      for (const name of names) this.selectedWorkflows.add(name);
      this.options.requestRender();
      return;
    }
    if (data === 'n') {
      this.selectedWorkflows.clear();
      this.options.requestRender();
    }
  }

  private confirmSelection(): void {
    const value = this.choicesForStep()[this.selectedIndex]?.value;
    if (value === undefined) return;
    switch (this.step) {
      case 'mode-pr':
        this.answers.pullRequestMode = value as CiFixPullRequestMode;
        break;
      case 'mode-main':
        this.answers.mainMode = value as CiFixMainMode;
        break;
      case 'attempts':
        this.answers.maxAttempts = Number(value);
        break;
      default:
        break;
    }
    this.stepIndex += 1;
    this.selectedIndex = 0;
    this.options.requestRender();
  }

  invalidate(): void {}

  render(width: number): string[] {
    const safeWidth = Math.max(0, Math.floor(width));
    if (safeWidth === 0) return [];
    const contentWidth = questionnaireFrameContentWidth(safeWidth);
    const compact = contentWidth < 56;
    const stepNumber = `${this.stepIndex + 1}/${STEP_ORDER.length}`;

    if (this.step === 'workflows') {
      const names = this.options.detectedWorkflows;
      const body = [
        chalk.hex(colors.muted)(
          compact ? 'Monitored workflows:' : 'Choose the workflows whose failures trigger a fix.',
        ),
        '',
        ...(names.length === 0
          ? [chalk.hex(colors.muted)('No workflows detected; the CI workflow name will be used.')]
          : names.map((name, index) => {
              const marker = this.selectedWorkflows.has(name) ? '[x]' : '[ ]';
              const active = index === this.selectedIndex ? chalk.hex(colors.accent)('❯') : ' ';
              return `${active} ${marker} ${name}`;
            })),
      ];
      return renderQuestionnaireFrame(
        {
          title: safeWidth < 42 ? `CI Fix · Workflows` : 'CI Fix · Monitored workflows',
          meta: stepNumber,
          body,
          footer: 'space toggle · a all · n none · enter continue',
        },
        safeWidth,
        'signal',
      );
    }

    if (this.step === 'confirm') {
      const answers = this.answers;
      const body = [
        chalk.hex(colors.muted)('Review the setup, then install it.'),
        '',
        `Pull requests: ${answers.pullRequestMode}`,
        `Main branch:   ${answers.mainMode}`,
        `Max attempts:  ${answers.maxAttempts}`,
        `Workflows:     ${[...this.selectedWorkflows].join(', ') || 'CI'}`,
        '',
        'This writes .alran/ci.yml and .github/workflows/alran-ci-fix.yml.',
      ];
      return renderQuestionnaireFrame(
        {
          title: 'CI Fix · Confirm',
          meta: stepNumber,
          body,
          footer: 'enter install · esc cancel',
        },
        safeWidth,
        'signal',
      );
    }

    const choices = this.choicesForStep();
    const titles: Record<Exclude<StepId, 'workflows' | 'confirm'>, string> = {
      'mode-pr': 'Pull request mode',
      'mode-main': 'Main branch mode',
      attempts: 'Fix attempts per failure',
    };
    const body = [
      chalk.hex(colors.muted)(
        compact ? titles[this.step as Exclude<StepId, 'workflows' | 'confirm'>] : `${titles[this.step as Exclude<StepId, 'workflows' | 'confirm'>]}:`,
      ),
      '',
      ...choices.map((choice, index) => {
        const active = index === this.selectedIndex;
        const marker = active ? chalk.hex(colors.accent)('❯') : ' ';
        const label = active ? chalk.bold(choice.label) : choice.label;
        const description = compact ? '' : chalk.hex(colors.muted)(` — ${choice.description}`);
        return `${marker} ${index + 1}. ${label}${description}`;
      }),
    ];
    return renderQuestionnaireFrame(
      {
        title: safeWidth < 42 ? 'CI Fix · Setup' : `CI Fix · ${titles[this.step as Exclude<StepId, 'workflows' | 'confirm'>]}`,
        meta: stepNumber,
        body: body.map((line) => truncateToWidth(line, contentWidth, '')),
        footer: 'up/down move · enter select',
      },
      safeWidth,
      'signal',
    );
  }
}