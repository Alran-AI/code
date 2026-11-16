/**
 * Environment switches of the terminal UI.
 *
 * These switches inherited their names from the code base this fork was derived
 * from. Each one is read under its Alran name; the inherited name is still
 * honoured when the Alran name is unset, so a shell that exported the old name
 * keeps its setting. The Alran name always wins, so a user who renamed the
 * variable is never overridden.
 */

/** The Alran name of every terminal UI switch, and the inherited name it falls back to. */
export const UI_ENV_NAMES: Readonly<Record<string, string>> = Object.freeze({
	ALRAN_HARDWARE_CURSOR: 'PI_HARDWARE_CURSOR',
	ALRAN_CLEAR_ON_SHRINK: 'PI_CLEAR_ON_SHRINK',
	ALRAN_CODING_AGENT_DIR: 'PI_CODING_AGENT_DIR',
	ALRAN_HYPERLINKS: 'PI_HYPERLINKS',
	ALRAN_IMAGE_PROTOCOL: 'PI_IMAGE_PROTOCOL',
	ALRAN_TRUE_COLOR: 'PI_TRUE_COLOR',
	ALRAN_DEBUG_REDRAW: 'PI_DEBUG_REDRAW',
	ALRAN_TUI_DEBUG: 'PI_TUI_DEBUG',
	ALRAN_TUI_WRITE_LOG: 'PI_TUI_WRITE_LOG',
});

/**
 * Read a terminal UI switch.
 *
 * @param name the Alran name of the switch
 * @returns the value under the Alran name, else under the inherited name, else undefined
 */
export function readUiEnv(name: string): string | undefined {
	const inherited = UI_ENV_NAMES[name];
	if (inherited === undefined) return process.env[name];
	return process.env[name] ?? process.env[inherited];
}
