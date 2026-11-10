import chalk from 'chalk';
import { Command } from 'commander';

const BOT_COLOR = chalk.hex('#FF8C00');
const BOT_WIDTH = 15;
const PADDING_LEFT = 20;

type BotMode = 'idle' | 'jump' | 'dance' | 'sleep';

const ANSI_CLEAR_SCREEN = '\x1b[2J';
const ANSI_CURSOR_HOME = '\x1b[H';
const ANSI_CURSOR_HIDE = '\x1b[?25l';
const ANSI_CURSOR_SHOW = '\x1b[?25h';

/**
 * Renders a single frame of the Alran mascot bot.
 * Returns the lines to print (including vertical offset and left padding).
 */
function renderMascotFrame(mode: BotMode, posY: number, tick: number): string[] {
  let color = BOT_COLOR;
  if (mode === 'sleep') color = chalk.hex('#555555');
  if (mode === 'dance') {
    const partyColors = [
      chalk.hex('#FF00FF'),
      chalk.hex('#00FFFF'),
      chalk.hex('#FFFF00'),
      chalk.hex('#00FF00'),
    ];
    color = partyColors[Math.floor(tick / 5) % partyColors.length];
  } else if (posY > 0) {
    color = chalk.cyan;
  }

  const getFace = (): string => {
    if (mode === 'sleep') return '-   -';
    if (mode === 'dance') return chalk.magenta('♪   ♪');
    if (posY > 2) return chalk.yellow('O   O');
    return '◕   ◕';
  };

  const eyes = getFace();

  let art: string[];
  if (mode === 'sleep') {
    const z1 = tick % 6 === 0 ? 'z' : ' ';
    const z2 = tick % 6 === 2 ? 'Z' : ' ';
    const z3 = tick % 6 === 4 ? 'z' : ' ';
    art = [
      color(`   ╭───────╮ ${z3} `),
      color('   │ ') + eyes + color(' │ ') + chalk.blue(`${z2}`),
      color('   ╰───┬───╯') + chalk.blue(` ${z1} `),
      color('      ╱ ╲      '),
    ];
  } else if (mode === 'dance') {
    const armL = Math.floor(tick / 5) % 2 === 0 ? '\\' : '/';
    const armR = Math.floor(tick / 5) % 2 === 0 ? '/' : '\\';
    const legL = Math.floor(tick / 5) % 2 === 0 ? '╱' : '╲';
    const legR = Math.floor(tick / 5) % 2 === 0 ? '╲' : '╱';
    art = [
      color(`   ${armL}╭───────╮${armR}   `),
      color('    │ ') + eyes + color(' │    '),
      color('    ╰───┬───╯    '),
      color(`       ${legL} ${legR}       `),
    ];
  } else {
    art = [
      color('   ╭───────╮   '),
      color('   │ ') + eyes + color(' │   '),
      color('   ╰───┬───╯   '),
      color('      ╱ ╲      '),
    ];
  }

  const lines: string[] = [];
  const emptyLinesAbove = mode === 'sleep' ? 8 : Math.max(0, 8 - posY);
  const emptyLinesBelow = mode === 'sleep' ? 0 : posY;

  for (let i = 0; i < emptyLinesAbove; i++) lines.push('');
  for (const line of art) lines.push(' '.repeat(PADDING_LEFT) + line);
  for (let i = 0; i < emptyLinesBelow; i++) lines.push('');

  return lines;
}

interface MascotCommandOptions {
  /** Milliseconds between animation frames. Default: 50. */
  frameIntervalMs?: number;
}

/**
 * Runs the animated Alran mascot bot in the terminal.
 * The animation runs until the user presses `q` or Ctrl+C.
 * Keyboard commands: `jump`, `dance`, `sleep` to change the bot's mode.
 */
export function runMascot(options: MascotCommandOptions = {}): void {
  const frameIntervalMs = options.frameIntervalMs ?? 50;

  let mode: BotMode = 'idle';
  let posY = 0;
  let velY = 0;
  let tick = 0;
  let keyBuffer = '';
  let running = true;

  let stdinRawMode = false;
  let stdinPaused = false;

  function cleanup(): void {
    running = false;
    process.stdout.write(ANSI_CURSOR_SHOW);
    if (stdinRawMode) {
      try {
        process.stdin.setRawMode(false);
      } catch {
        // Ignore errors during cleanup
      }
    }
    if (!stdinPaused) {
      process.stdin.pause();
    }
  }

  function render(): void {
    if (!running) return;

    const lines = renderMascotFrame(mode, posY, tick);

    process.stdout.write(ANSI_CLEAR_SCREEN + ANSI_CURSOR_HOME);
    process.stdout.write(`${lines.join('\n')}\n`);
    process.stdout.write(
      chalk.dim('Alran Mascot — drücke q zum Beenden. Befehle: jump, dance, sleep\n'),
    );
  }

  function tickAnimation(): void {
    if (!running) return;

    tick++;

    if (mode !== 'sleep') {
      if (posY > 0 || velY > 0) {
        posY += velY;
        velY -= 1;
      }

      if (posY <= 0 && velY < 0) {
        posY = 0;
        velY = 0;
        if (mode === 'dance') {
          setTimeout(() => {
            if (running && mode === 'dance') {
              velY = 5;
              posY = 1;
            }
          }, 50);
        }
      }
    }

    render();
  }

  const interval = setInterval(tickAnimation, frameIntervalMs);
  interval.unref?.();

  // Initial render
  render();

  // Set up keyboard input
  if (process.stdin.isTTY) {
    try {
      process.stdin.setRawMode(true);
      stdinRawMode = true;
    } catch {
      // Not a TTY or raw mode unavailable — fall back to static render
    }
    process.stdin.resume();
    stdinPaused = false;
    process.stdin.setEncoding('utf8');

    process.stdin.on('data', (chunk: string) => {
      if (!running) return;

      for (const char of chunk) {
        // Ctrl+C or 'q' quits
        if (char === '\u0003' || char === 'q') {
          cleanup();
          clearInterval(interval);
          process.stdout.write('\n');
          process.exit(0);
          return;
        }

        // Enter/Return resets the key buffer
        if (char === '\r' || char === '\n') {
          keyBuffer = '';
          continue;
        }

        // Collect printable characters for command matching
        if (char >= ' ' && char <= '~') {
          keyBuffer += char.toLowerCase();
          if (keyBuffer.length > 20) {
            keyBuffer = keyBuffer.slice(-20);
          }

          if (keyBuffer.includes('jump')) {
            mode = 'jump';
            velY = 6;
            posY = 1;
            keyBuffer = '';
          } else if (keyBuffer.includes('dance')) {
            mode = 'dance';
            velY = 5;
            posY = 1;
            keyBuffer = '';
          } else if (keyBuffer.includes('sleep')) {
            mode = 'sleep';
            keyBuffer = '';
          }
        }
      }
    });
  }

  // Handle process termination gracefully
  process.on('SIGINT', () => {
    cleanup();
    clearInterval(interval);
    process.stdout.write(`${ANSI_CURSOR_SHOW}\n`);
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    cleanup();
    clearInterval(interval);
    process.stdout.write(`${ANSI_CURSOR_SHOW}\n`);
    process.exit(0);
  });
}

/**
 * Registers the `alran mascot` command on a Commander program.
 */
export function registerMascotCommand(program: Command): void {
  program
    .command('mascot')
    .description('Show the animated Alran mascot bot')
    .allowExcessArguments(false)
    .action(() => {
      runMascot();
    });
}
